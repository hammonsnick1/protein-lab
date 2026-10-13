import io
import json
import math
import random

import pytest

from protein_labs.chromatography import analyze_chromatogram, calibrate, fit_sec, kav, quantile
from protein_labs.server import ApiHandler


def gaussian(center=10, sigma=1, amplitude=2, drift=0, noise=0):
    rng = random.Random(17)
    return [{'x': i / 100, 'y': 3 + drift * i / 100 + amplitude * math.exp(-.5 * ((i / 100 - center) / sigma) ** 2)
             + rng.gauss(0, noise)} for i in range(2001)]


def request(points=None, **kwargs):
    return {'schemaVersion': 1, 'units': {'x': 'mL', 'y': 'mg/mL'},
            'points': points if points is not None else gaussian(), **kwargs}


def calibration():
    # Kav = 1.5 - .25 log10(MwDa): 1, 10, 100 kDa elute at 20, 16, 12 mL.
    return {'voMl': 8, 'vtMl': 24, 'standards': [
        {'mwDa': 1000, 'veMl': 20}, {'mwDa': 10000, 'veMl': 16}, {'mwDa': 100000, 'veMl': 12}]}


def test_gaussian_known_area_width_asymmetry_and_recovery():
    result = analyze_chromatogram(request(ranges=[{'start': 0, 'end': 20}], massBalance={'loadedMg': 10}))
    peak = result['peaks'][0]
    expected = 2 * math.sqrt(2 * math.pi)
    assert peak['area'] == pytest.approx(expected, rel=1e-10)
    assert peak['fwhm'] == pytest.approx(2 * math.sqrt(2 * math.log(2)), rel=1e-5)
    assert peak['asymmetry10'] == pytest.approx(1, abs=1e-12)
    assert result['massBalance']['recoveredMg'] == pytest.approx(expected)
    assert result['massBalance']['recoveryPercent'] == pytest.approx(50.13256549)


def test_sec_known_answer_and_inverse():
    assert kav(16, 8, 24) == .5
    fit = fit_sec(calibration())
    assert fit['slope'] == -.25
    assert fit['intercept'] == 1.5
    assert fit['r2'] == 1
    for ve, mw in [(12, 100), (16, 10), (20, 1), (18, math.sqrt(10))]:
        assert calibrate(ve, fit)['mwKDa'] == pytest.approx(mw)
        assert not calibrate(ve, fit)['outOfRange']
    for ve in [11, 21, 7, 25]:
        assert calibrate(ve, fit)['mwKDa'] is None
        assert calibrate(ve, fit)['outOfRange']


@pytest.mark.parametrize('vo,vt', [(8, 8), (9, 8), (0, 24), (-1, 24)])
def test_invalid_column_rejected(vo, vt):
    with pytest.raises(ValueError, match='voMl|void volume'):
        fit_sec({**calibration(), 'voMl': vo, 'vtMl': vt})


def test_degenerate_and_reversed_calibrations_rejected():
    for standards in [[{'mwDa': 1000, 'veMl': 12}] * 2,
                      [{'mwDa': 1000, 'veMl': 12}, {'mwDa': 10000, 'veMl': 20}],
                      [{'mwDa': 1000, 'veMl': 12}, {'mwDa': 10000, 'veMl': 12}]]:
        with pytest.raises(ValueError):
            fit_sec({**calibration(), 'standards': standards})


def test_sec_api_calibrates_peak():
    result = analyze_chromatogram(request(gaussian(center=16, sigma=.2), sec=calibration()))
    assert result['peaks'][0]['mwKDa'] == pytest.approx(10)


def test_resolution_known_triangular_peaks_and_asymmetry():
    # FWHM = 2 mL, separation = 6 mL: Rs = 1.18 * 6 / 4 = 1.77.
    points = [{'x': i / 10, 'y': max(0, 1 - abs(i / 10 - 2) / 2) +
               max(0, 1 - abs(i / 10 - 8) / 2)} for i in range(101)]
    result = analyze_chromatogram(request(points, ranges=[{'start': 0, 'end': 4}, {'start': 6, 'end': 10}]))
    assert result['resolutions'][0]['rs'] == pytest.approx(1.77)
    assert [p['area'] for p in result['peaks']] == pytest.approx([2, 2])
    skew = [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}, {'x': 3, 'y': 0}]
    result = analyze_chromatogram(request(skew, ranges=[{'start': 0, 'end': 3}]))
    assert result['peaks'][0]['asymmetry10'] == pytest.approx(2)


def test_detection_survives_linear_drift_and_seeded_noise():
    result = analyze_chromatogram(request(gaussian(drift=.3, noise=.002), maxPeaks=1))
    assert len(result['peaks']) == 1
    assert result['peaks'][0]['apexX'] == pytest.approx(10, abs=.1)
    assert result['peaks'][0]['area'] == pytest.approx(2 * math.sqrt(2 * math.pi), rel=.02)


def test_two_gaussians_have_disjoint_areas():
    points = [{'x': i / 100, 'y': math.exp(-.5 * ((i / 100 - 5) / .3) ** 2) +
               math.exp(-.5 * ((i / 100 - 15) / .3) ** 2)} for i in range(2001)]
    result = analyze_chromatogram(request(points, maxPeaks=2))
    assert len(result['peaks']) == 2
    assert result['massBalance']['integratedArea'] == pytest.approx(.6 * math.sqrt(2 * math.pi), rel=1e-8)
    assert result['resolutions'][0]['rs'] == pytest.approx(1.18 * 10 / (4 * .3 * math.sqrt(2 * math.log(2))), rel=1e-4)


def test_explicit_uv_and_time_mass_conversion():
    # 100 mAU*min / (50 mAU/(mg/mL)) * .5 mL/min = 1 mg.
    body = request([{'x': 0, 'y': 0}, {'x': 1, 'y': 100}, {'x': 2, 'y': 0}],
                   ranges=[{'start': 0, 'end': 2}], massBalance={
                       'loadedMg': 2, 'responseFactorMAUPerMgMl': 50, 'flowMlPerMin': .5})
    body['units'] = {'x': 'min', 'y': 'mAU'}
    result = analyze_chromatogram(body)
    assert result['massBalance']['recoveredMg'] == 1
    assert result['massBalance']['recoveryPercent'] == 50
    del body['massBalance']['flowMlPerMin']
    with pytest.raises(ValueError, match='flowMlPerMin'):
        analyze_chromatogram(body)
    body['units']['x'] = 'mL'
    del body['massBalance']['responseFactorMAUPerMgMl']
    with pytest.raises(ValueError, match='responseFactor'):
        analyze_chromatogram(body)


def test_over_recovery_is_reported_not_clamped():
    result = analyze_chromatogram(request(ranges=[{'start': 0, 'end': 20}], massBalance={'loadedMg': 1}))
    assert result['massBalance']['recoveryPercent'] > 500
    assert result['massBalance']['exceedsLoaded']
    assert result['massBalance']['unaccountedMg'] < 0


def test_baseline_quantile_exact_index_and_smoothing():
    assert quantile([1, 2, 3], .5) == 2
    assert quantile([1, 2, 3], .25) == 1.5
    points = [{'x': i, 'y': v} for i, v in enumerate([2, 5, 2])]
    result = analyze_chromatogram(request(points, ranges=[], processing={'smoothing': 3, 'baseline': 'percentile5'}))
    assert result['baselineOffset'] == pytest.approx(3.05)
    assert [p['y'] for p in result['points']] == pytest.approx([.45, -.05, .45])


@pytest.mark.parametrize('patch,match', [
    ({'units': {'x': 'seconds', 'y': 'mAU'}}, 'units'),
    ({'ranges': [{'start': 0, 'end': 12}, {'start': 10, 'end': 20}]}, 'overlap'),
    ({'schemaVersion': 2}, 'schemaVersion'),
    ({'processing': {'smoothing': 0}}, 'smoothing'),
    ({'massBalance': {'loadedMg': 0}}, 'loadedMg'),
    ({'maxPeaks': 0}, 'maxPeaks'),
])
def test_input_validation(patch, match):
    with pytest.raises(ValueError, match=match):
        analyze_chromatogram(request(**patch))


@pytest.mark.parametrize('points', [
    [{'x': 0, 'y': 1}, {'x': 0, 'y': 2}, {'x': 1, 'y': 0}],
    [{'x': 1, 'y': 1}, {'x': 0, 'y': 2}, {'x': 2, 'y': 0}],
    [{'x': 0, 'y': float('nan')}, {'x': 1, 'y': 1}, {'x': 2, 'y': 0}],
])
def test_bad_samples_rejected(points):
    with pytest.raises(ValueError):
        analyze_chromatogram(request(points))


def test_no_implicit_time_to_volume():
    body = request(sec=calibration())
    body['units']['x'] = 'min'
    with pytest.raises(ValueError, match='mL axis'):
        analyze_chromatogram(body)


def test_flat_trace_and_short_trace_detection():
    for values in ([2, 2, 2], [0, 1, 0, 1, 0]):
        result = analyze_chromatogram(request([{'x': i, 'y': v} for i, v in enumerate(values)]))
        assert isinstance(result['peaks'], list)
    assert analyze_chromatogram(request([{'x': i, 'y': 2} for i in range(50)]))['peaks'] == []


def test_response_disk_round_trip(tmp_path):
    result = analyze_chromatogram(request(gaussian(center=16, sigma=.2), sec=calibration(), massBalance={'loadedMg': 2}))
    path = tmp_path / 'analysis.json'
    path.write_text(json.dumps(result, allow_nan=False))
    assert json.loads(path.read_text()) == result


def dispatch(body, path='/v1/chromatogram/analyze'):
    # Exercise the real handler routing and error mapping without opening a port.
    handler = object.__new__(ApiHandler)
    handler.path = path
    data = json.dumps(body).encode()
    handler.headers = {'Content-Length': str(len(data))}
    handler.rfile = io.BytesIO(data)
    responses = []
    handler._send = lambda status, value: responses.append((status, value))
    handler.do_POST()
    return responses[0]


def test_route_success_and_readable_400():
    status, result = dispatch(request())
    assert status == 200
    assert result['schemaVersion'] == 1
    status, result = dispatch(request(sec={**calibration(), 'voMl': 24}))
    assert status == 400
    assert 'void volume' in result['error']


def test_calibration_route_without_trace():
    status, result = dispatch({**calibration(), 'elutionVolumesMl': [16, 21]}, '/v1/chromatogram/calibrate-sec')
    assert status == 200
    assert result['predictions'][0]['mwKDa'] == 10
    assert result['predictions'][1]['outOfRange']
    assert result['predictions'][1]['mwKDa'] is None
