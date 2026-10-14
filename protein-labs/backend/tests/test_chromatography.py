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


def test_three_sample_triangle_is_detected_and_recovers_1_5_mg():
    # mg/mL × mL: trapezoids are (1 × 1 / 2) + (2 × 1 / 2) = 1.5 mg.
    triangle = [{'x': 0, 'y': 0}, {'x': 1, 'y': 1}, {'x': 3, 'y': 0}]
    result = analyze_chromatogram(request(triangle, massBalance={'loadedMg': 2}))
    assert len(result['peaks']) == 1
    assert result['massBalance']['recoveredMg'] == pytest.approx(1.5)


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


def test_calibration_mass_range_uses_only_included_standards():
    config = calibration()
    config['standards'].append({'mwDa': 1e9, 'veMl': 9, 'included': False})
    assert fit_sec(config)['standardMassRangeKDa'] == [1, 100]


def test_inverse_mass_uncertainty_known_answer():
    # log10(MwDa) = 3,4,5,6; Kav residuals = +.01,-.01,-.01,+.01.
    # The residuals are orthogonal to the fitted line (slope=-.25).
    # SSE=.0004, df=2, mean x=4.5, Sxx=5. At x=4, leverage=1.3.
    config = {'voMl': 8, 'vtMl': 24, 'standards': [
        {'mwDa': 10 ** x, 'veMl': 8 + 16 * (1.5 - .25 * x + residual)}
        for x, residual in zip([3, 4, 5, 6], [.01, -.01, -.01, .01])]}
    fit = fit_sec(config)
    assert fit['residualVarianceKav'] == pytest.approx(.0002)
    prediction = calibrate(16, fit)
    expected = 10 * math.log(10) * math.sqrt(.0002 * 1.3) / .25
    assert prediction['mwKDa'] == pytest.approx(10)
    assert prediction['mwUncertaintyKDa'] == pytest.approx(expected)
    assert prediction['flags'][0]['code'] == 'calibration_only_mass_uncertainty'
    status, response = dispatch({**config, 'elutionVolumesMl': [16]}, '/v1/chromatogram/calibrate-sec')
    assert status == 200
    assert response['predictions'][0] == {'veMl': 16, **prediction}
    result = analyze_chromatogram(request(gaussian(center=16, sigma=.2), sec=config))
    assert result['peaks'][0]['mwUncertaintyKDa'] == pytest.approx(expected)


def test_uncertainty_absent_when_extrapolated_or_underidentified():
    config = calibration()
    config['standards'] = config['standards'][:2]
    prediction = calibrate(18, fit_sec(config))
    assert prediction['mwKDa'] == pytest.approx(math.sqrt(10))
    assert prediction['mwUncertaintyKDa'] is None
    assert prediction['flags'][0]['code'] == 'mass_uncertainty_unavailable'
    prediction = calibrate(10, fit_sec(calibration()))
    assert prediction['mwKDa'] is None
    assert prediction['mwUncertaintyKDa'] is None
    # Perfect calibration has zero calibration scatter, not zero total error.
    prediction = calibrate(16, fit_sec(calibration()))
    assert prediction['mwUncertaintyKDa'] == 0
    assert 'excludes peak localization' in prediction['flags'][0]['message']


def test_peak_quality_closed_form_known_answer_and_units():
    # Triangle: FWHM=2; Gaussian basis=[1/16,1/2,1,1/2,1/16].
    # Least-squares amplitude=192/193, SSE=3/386, SST=.7.
    points = [{'x': i, 'y': y} for i, y in enumerate([0, .5, 1, .5, 0])]
    result = analyze_chromatogram(request(points, ranges=[{'start': 0, 'end': 4}]))
    peak = result['peaks'][0]
    assert peak['area'] == 2
    assert peak['fitQuality']['model'] == 'gaussian_fixed_apex_fwhm_amplitude_fit'
    assert peak['fitQuality']['rSquared'] == pytest.approx(1 - 15 / 1351)
    assert peak['fitQuality']['residual'] == pytest.approx(math.sqrt(3 / 1930))
    assert result['units']['fitResidual'] == 'mg/mL'
    scaled = request([{'x': p['x'], 'y': 100 * p['y']} for p in points], ranges=[{'start': 0, 'end': 4}])
    scaled['units'] = {'x': 'min', 'y': 'mAU'}
    result = analyze_chromatogram(scaled)
    assert result['units']['fitResidual'] == 'mAU'
    assert result['peaks'][0]['fitQuality']['residual'] == pytest.approx(100 * math.sqrt(3 / 1930))
    assert result['peaks'][0]['fitQuality']['rSquared'] == pytest.approx(peak['fitQuality']['rSquared'])


def test_gaussian_quality_with_noise_and_drift():
    for noise in [0, .002]:
        result = analyze_chromatogram(request(gaussian(drift=.3, noise=noise), maxPeaks=1))
        quality = result['peaks'][0]['fitQuality']
        assert quality['rSquared'] > .999
        # Fixed center inherits the sampled noisy apex; this is not a free-center fit.
        assert quality['residual'] < (.02 if noise else 1e-4)  # mg/mL
        assert not any(f['code'] == 'poor_gaussian_fit' for f in result['peaks'][0]['flags'])


def test_sparse_and_poor_fit_flags_and_null_statistics():
    points = [{'x': i, 'y': y} for i, y in enumerate([0, 1, 0])]
    peak = analyze_chromatogram(request(points, ranges=[{'start': 0, 'end': 2}]))['peaks'][0]
    assert peak['fitQuality']['rSquared'] is None
    assert peak['fitQuality']['residual'] is None
    assert {f['code'] for f in peak['flags']} == {'peak_fit_unavailable', 'sparse_peak_sampling'}
    # Long, asymmetric triangular tail cannot be explained by a symmetric Gaussian.
    points = [{'x': i / 10, 'y': max(0, i / 10 if i <= 10 else (10 - i / 10) / 9)} for i in range(101)]
    peak = analyze_chromatogram(request(points, ranges=[{'start': 0, 'end': 10}]))['peaks'][0]
    assert peak['fitQuality']['rSquared'] < .95
    assert 'poor_gaussian_fit' in {f['code'] for f in peak['flags']}


def test_unresolved_neighbors_are_flagged_without_changing_areas():
    # Two disjoint broad triangles with center spacing=2, FWHM=1 each: Rs=1.18.
    points = [{'x': i / 10, 'y': max(0, 1 - abs(i / 10 - 1)) +
               max(0, 1 - abs(i / 10 - 3))} for i in range(41)]
    result = analyze_chromatogram(request(points, ranges=[{'start': 0, 'end': 2}, {'start': 2, 'end': 4}]))
    assert result['resolutions'][0]['rs'] == pytest.approx(1.18)
    assert [p['area'] for p in result['peaks']] == pytest.approx([1, 1])
    assert all('unresolved_neighbor' in {f['code'] for f in p['flags']} for p in result['peaks'])


@pytest.mark.parametrize('two_standards', [False, True])
def test_report_fields_disk_round_trip(tmp_path, two_standards):
    config = calibration()
    if two_standards:
        config['standards'] = config['standards'][:2]
    status, result = dispatch(request(gaussian(center=18, sigma=.2), sec=config))
    assert status == 200
    peak = result['peaks'][0]
    assert {'mwUncertaintyKDa', 'fitQuality', 'flags'} <= peak.keys()
    assert 'standardMassRangeKDa' in result['calibration']
    path = tmp_path / 'report-fields.json'
    path.write_text(json.dumps(result, allow_nan=False))
    assert json.loads(path.read_text()) == result
