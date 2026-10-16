import io
import json

import pytest

from protein_labs.chromatography import create_chromatography_run, model_affinity_run
from protein_labs.server import ApiHandler


def affinity_request(load_mg=15, recovery=.8, peak_position=.25, elute_volume=10):
    return {
        'schemaVersion': 1,
        'method': 'affinity',
        'column': {
            'resinName': 'Example affinity resin',
            'columnVolumeMl': 2,
            'dynamicBindingCapacityMgPerMl': 10,
        },
        'load': {'proteinMassMg': load_mg},
        'phases': [
            {'type': 'load', 'volumeMl': 10, 'buffer': '20 mM phosphate, pH 7.4'},
            {'type': 'wash', 'volumeMl': 5, 'buffer': '20 mM phosphate, 20 mM imidazole'},
            {'type': 'elute', 'volumeMl': elute_volume,
             'buffer': '20 mM phosphate, 300 mM imidazole',
             'peakPositionFraction': peak_position, 'peakWidthFraction': .1,
             'recoveryFraction': recovery},
        ],
        'fractions': [{'id': 'E1', 'startVolumeMl': 16, 'endVolumeMl': 20}],
        'sampling': {'pointsPerMl': 20},
    }


def test_below_capacity_has_no_breakthrough_and_mass_closes():
    # Capacity = 2 mL * 10 mg/mL = 20 mg. A 15 mg load binds completely.
    result = model_affinity_run(affinity_request())
    mass = result['massBalance']
    assert mass['capacityMg'] == 20
    assert mass['boundMg'] == 15
    assert mass['breakthroughMg'] == 0
    assert mass['elutedMg'] == 12
    assert mass['retainedMg'] == 3
    assert mass['recoveryPercent'] == 80
    assert mass['accountedMg'] == 15
    assert mass['unaccountedMg'] == pytest.approx(0, abs=1e-12)
    assert mass['closes']
    assert mass['traceAreaMg'] == pytest.approx(12, abs=1e-12)
    assert [peak['kind'] for peak in result['peaks']] == ['elution']


def test_over_capacity_excess_is_load_phase_breakthrough_not_extra_elution():
    # A 25 mg load on a 20 mg column gives exactly 5 mg breakthrough.
    overloaded = model_affinity_run(affinity_request(load_mg=25, recovery=1))
    at_capacity = model_affinity_run(affinity_request(load_mg=20, recovery=1))
    mass = overloaded['massBalance']
    assert mass['boundMg'] == 20
    assert mass['breakthroughMg'] == 5
    assert mass['elutedMg'] == 20
    assert mass['accountedMg'] == 25
    assert mass['traceAreaMg'] == pytest.approx(25, abs=1e-12)
    assert overloaded['peaks'][0]['kind'] == 'breakthrough'
    assert overloaded['peaks'][0]['phase'] == 'load'
    assert overloaded['peaks'][0]['massMg'] == pytest.approx(5)
    assert overloaded['peaks'][1]['kind'] == 'elution'
    assert overloaded['peaks'][1]['height'] == pytest.approx(
        at_capacity['peaks'][0]['height'], rel=1e-12)


def test_elution_peak_uses_declared_phase_volume_and_position():
    # Load + wash ends at 15 mL; 25% of a 10 mL elution is 17.5 mL.
    first = model_affinity_run(affinity_request(peak_position=.25, elute_volume=10))
    second = model_affinity_run(affinity_request(peak_position=.75, elute_volume=12))
    first_peak = next(peak for peak in first['peaks'] if peak['kind'] == 'elution')
    second_peak = next(peak for peak in second['peaks'] if peak['kind'] == 'elution')
    assert first_peak['apexX'] == pytest.approx(17.5)
    assert second_peak['apexX'] == pytest.approx(24)
    assert first['phases'][2]['startVolumeMl'] == 15
    assert first['phases'][2]['endVolumeMl'] == 25


def test_affinity_run_disk_round_trip_preserves_phases_resin_and_fractions(tmp_path):
    result = model_affinity_run(affinity_request(load_mg=25))
    path = tmp_path / 'affinity-run.json'
    path.write_text(json.dumps(result, allow_nan=False))
    reopened = json.loads(path.read_text())
    assert reopened == result
    assert reopened['method'] == 'affinity'
    assert reopened['column']['resinName'] == 'Example affinity resin'
    assert [phase['buffer'] for phase in reopened['phases']] == [
        '20 mM phosphate, pH 7.4',
        '20 mM phosphate, 20 mM imidazole',
        '20 mM phosphate, 300 mM imidazole',
    ]
    assert reopened['fractions'][0]['id'] == 'E1'


def dispatch(body, path='/v1/chromatogram/run'):
    handler = object.__new__(ApiHandler)
    handler.path = path
    data = json.dumps(body).encode()
    handler.headers = {'Content-Length': str(len(data))}
    handler.rfile = io.BytesIO(data)
    responses = []
    handler._send = lambda status, value: responses.append(
        (status, json.loads(json.dumps(value, allow_nan=False))))
    handler.do_POST()
    return responses[0]


def test_run_route_and_sec_default_are_versioned():
    status, affinity = dispatch(affinity_request())
    assert status == 200
    assert affinity['schemaVersion'] == 1
    assert affinity['method'] == 'affinity'

    sec = {
        'schemaVersion': 1,
        'units': {'x': 'mL', 'y': 'mg/mL'},
        'points': [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}, {'x': 2, 'y': 0}],
        'ranges': [{'start': 0, 'end': 2}],
    }
    result = create_chromatography_run(sec)
    assert result['schemaVersion'] == 1
    assert result['method'] == 'sec'
    assert result['peaks'][0]['area'] == 1


@pytest.mark.parametrize('patch,match', [
    ({'method': 'ion-exchange'}, 'method'),
    ({'column': {'resinName': '', 'columnVolumeMl': 2,
                 'dynamicBindingCapacityMgPerMl': 10}}, 'resinName'),
    ({'phases': [{'type': 'wash', 'volumeMl': 10, 'buffer': 'x'}] * 3}, 'ordered'),
])
def test_affinity_validation_is_readable(patch, match):
    body = affinity_request()
    body.update(patch)
    with pytest.raises(ValueError, match=match):
        create_chromatography_run(body)


def test_run_route_returns_readable_400():
    body = affinity_request()
    body['column']['dynamicBindingCapacityMgPerMl'] = 0
    status, result = dispatch(body)
    assert status == 400
    assert result['type'] == 'ValueError'
    assert 'dynamicBindingCapacityMgPerMl' in result['error']
