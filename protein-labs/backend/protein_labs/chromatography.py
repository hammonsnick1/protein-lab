"""Version 1 chromatography analysis; all axis units are explicit.

No synthetic noise is added. Detection uses a seven-sample moving average and
three robust standard deviations of first differences, assuming independent
additive noise. Peak measurements use the unsmoothed processed signal and a
straight baseline between integration endpoints. No deconvolution is claimed.
"""
from __future__ import annotations

import json
import math
from statistics import mean
from typing import Any


def number(value: Any, name: str) -> float:
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{name} must be a finite number")
    return float(value)


def positive(value: Any, name: str) -> float:
    result = number(value, name)
    if result <= 0:
        raise ValueError(f"{name} must be positive")
    return result


def finite(value: float, name: str) -> float:
    """Reject overflow from arithmetic on otherwise finite inputs."""
    if not math.isfinite(value):
        raise ValueError(f"{name} overflowed; rescale input values explicitly")
    return value


def finite_sum(values: Any, name: str) -> float:
    """Compute an accurate sum while mapping arithmetic overflow to input error."""
    try:
        return finite(math.fsum(values), name)
    except OverflowError as error:
        raise ValueError(f"{name} overflowed; rescale input values explicitly") from error


def json_result(value: dict) -> dict:
    """Keep non-finite numbers from reaching the JSON response boundary."""
    try:
        json.dumps(value, allow_nan=False)
    except (ValueError, OverflowError) as error:
        raise ValueError('Numeric overflow; rescale input values explicitly') from error
    return value


def quantile(values: list[float], fraction: float) -> float:
    ordered = sorted(values)
    position = (len(ordered) - 1) * fraction
    low = math.floor(position)
    return ordered[low] + (ordered[math.ceil(position)] - ordered[low]) * (position - low)


def moving_average(points: list[dict], window: int) -> list[dict]:
    radius = window // 2
    prefix = [0.0]
    for p in points:
        prefix.append(prefix[-1] + p['y'])
    result = []
    for i, p in enumerate(points):
        left, right = max(0, i - radius), min(len(points), i + radius + 1)
        result.append({'x': p['x'], 'y': (prefix[right] - prefix[left]) / (right - left)})
    return result


def area(points: list[dict]) -> float:
    return math.fsum((b['x'] - a['x']) * (a['y'] + b['y']) / 2 for a, b in zip(points, points[1:]))


def kav(ve: float, vo: float, vt: float) -> float:
    vo, vt = positive(vo, 'voMl'), positive(vt, 'vtMl')
    if vo >= vt:
        raise ValueError('SEC requires 0 < voMl < vtMl (void volume below column volume)')
    return finite((number(ve, 'veMl') - vo) / (vt - vo), 'SEC Kav calculation')


def fit_sec(config: dict) -> dict:
    vo, vt = config.get('voMl'), config.get('vtMl')
    kav(0, vo, vt)
    standards = config.get('standards', [])
    if not isinstance(standards, list):
        raise ValueError('standards must be an array')
    xs, ys, volumes, masses = [], [], [], []
    for s in standards:
        if not isinstance(s, dict):
            raise ValueError('Each standard must be an object')
        if s.get('included', True) is False:
            continue
        mw = positive(s.get('mwDa'), 'mwDa')
        ve = number(s.get('veMl'), 'veMl')
        if not vo < ve < vt:
            raise ValueError('Included SEC standards require voMl < veMl < vtMl')
        xs.append(math.log10(mw))
        ys.append(kav(ve, vo, vt))
        volumes.append(ve)
        masses.append(mw / 1000)
    if len(xs) < 2:
        raise ValueError('SEC calibration requires at least two included standards')
    mx, my = finite(mean(xs), 'SEC mean log molecular weight'), finite(mean(ys), 'SEC mean Kav')
    denominator = finite_sum(((x - mx) ** 2 for x in xs), 'SEC fit denominator')
    if denominator < 1e-20:
        raise ValueError('SEC standards must have distinct molecular weights')
    numerator = finite_sum(((x - mx) * (y - my) for x, y in zip(xs, ys)),
                           'SEC fit numerator')
    slope = finite(numerator / denominator, 'SEC fit slope')
    if slope >= -1e-12:
        raise ValueError('SEC calibration requires a negative, invertible slope')
    intercept = finite(my - slope * mx, 'SEC fit intercept')
    residual = finite_sum(((y - slope * x - intercept) ** 2 for x, y in zip(xs, ys)),
                          'SEC residual sum of squares')
    total = finite_sum(((y - my) ** 2 for y in ys), 'SEC total sum of squares')
    result = {'slope': slope, 'intercept': intercept,
              'r2': finite(1 - residual / total, 'SEC R squared'),
              'logMwDaRange': [min(xs), max(xs)], 'veMlRange': [min(volumes), max(volumes)],
              'standardMassRangeKDa': [min(masses), max(masses)],
              'residualVarianceKav': finite(residual / (len(xs) - 2), 'SEC residual variance') if len(xs) > 2 else None,
            'meanLogMwDa': mx, 'sumSquaredLogMwDa': denominator,
            'voMl': vo, 'vtMl': vt, 'standardCount': len(xs)}
    return json_result(result)


def calibrate_sec(body: dict) -> dict:
    """Calibrate independently of an imported trace (standards workspace)."""
    if not isinstance(body, dict):
        raise ValueError('Request must be an object')
    fit = fit_sec(body)
    volumes = body.get('elutionVolumesMl', [])
    if not isinstance(volumes, list) or len(volumes) > 200000:
        raise ValueError('elutionVolumesMl must be an array with at most 200000 values')
    result = {'schemaVersion': 1, 'calibration': fit,
              'predictions': [dict(veMl=number(ve, 'veMl'), **calibrate(ve, fit)) for ve in volumes]}
    return json_result(result)


def calibrate(ve: float, fit: dict) -> dict:
    value = kav(ve, fit['voMl'], fit['vtMl'])
    log_mw = finite((value - fit['intercept']) / fit['slope'],
                    'SEC molecular-weight calculation')
    lo, hi = fit['logMwDaRange']
    v_lo, v_hi = fit['veMlRange']
    outside = not (lo - 1e-12 <= log_mw <= hi + 1e-12 and v_lo - 1e-12 <= ve <= v_hi + 1e-12)
    mw = None if outside else finite(10 ** min(hi, max(lo, log_mw)) / 1000,
                                     'SEC molecular weight')
    uncertainty = None
    flags = []
    if mw is not None:
        variance = fit['residualVarianceKav']
        if variance is None:
            flags.append(flag('mass_uncertainty_unavailable', 'caution',
                              'At least three included standards are needed to estimate calibration scatter.'))
        else:
            # First-order inverse prediction for one new Kav observation, then
            # propagate log10(Mw) to Mw. Not a confidence/prediction interval.
            leverage = 1 + 1 / fit['standardCount'] + (log_mw - fit['meanLogMwDa']) ** 2 / fit['sumSquaredLogMwDa']
            uncertainty = finite(mw * math.log(10) * math.sqrt(variance * leverage) / abs(fit['slope']),
                                 'SEC molecular-weight uncertainty')
            flags.append(flag('calibration_only_mass_uncertainty', 'note',
                              'Mass uncertainty is an approximate one-sigma calibration estimate; it excludes '
                              'peak localization, standard mass errors, column volume errors and shape effects.'))
            if uncertainty >= mw:
                flags.append(flag('large_mass_uncertainty', 'warning',
                                  'Calibration uncertainty is at least the apparent mass; linear propagation is unreliable.'))
    return {'kav': value, 'mwKDa': mw, 'mwUncertaintyKDa': uncertainty,
            'outOfRange': outside, 'flags': flags}


def flag(code: str, level: str, message: str) -> dict:
    return {'code': code, 'level': level, 'title': code.replace('_', ' ').capitalize(), 'message': message}


def peak_quality(points: list[dict], center: float, width: float | None) -> dict:
    """Fit only nonnegative amplitude; measured center/FWHM stay fixed.

    Signed baseline residuals include negative noise in the quality statistic.
    Closed-form least squares avoids an iterative, potentially divergent fit.
    """
    result = {'rSquared': None, 'residual': None, 'model': 'gaussian_fixed_apex_fwhm_amplitude_fit'}
    if len(points) < 5 or width is None or width <= 0:
        return result
    # Compute exp(-4 ln(2) ((x-center)/FWHM)^2) without squaring huge ratios.
    shape = []
    for p in points:
        distance = abs(p['x'] - center) / width
        shape.append(0.0 if distance > 20 else math.exp(-4 * math.log(2) * distance ** 2))
    amplitude = max(0.0, math.fsum(p['y'] * g for p, g in zip(points, shape)) / math.fsum(g * g for g in shape))
    residual = math.fsum((p['y'] - amplitude * g) ** 2 for p, g in zip(points, shape))
    average = mean(p['y'] for p in points)
    total = math.fsum((p['y'] - average) ** 2 for p in points)
    result.update(rSquared=1 - residual / total if total > 0 else None,
                  residual=math.sqrt(residual / len(points)))
    return result


def measure_peak(points: list[dict], start: float, end: float) -> dict | None:
    region = [p for p in points if start <= p['x'] <= end]
    if len(region) < 3:
        return None
    a, b = region[0], region[-1]
    signed = [{'x': p['x'], 'y': p['y'] - a['y'] -
               (b['y'] - a['y']) * (p['x'] - a['x']) / (b['x'] - a['x'])} for p in region]
    corrected = [{'x': p['x'], 'y': max(0, p['y'])} for p in signed]
    apex = max(range(len(region)), key=lambda i: corrected[i]['y'])
    height = corrected[apex]['y']
    if height <= 0 or apex in (0, len(region) - 1):
        return None

    def crossing(fraction: float, direction: int) -> float | None:
        level = height * fraction
        i = apex
        while 0 <= i + direction < len(corrected):
            p, q = corrected[i], corrected[i + direction]
            if q['y'] <= level < p['y']:
                return p['x'] + (q['x'] - p['x']) * (level - p['y']) / (q['y'] - p['y'])
            i += direction
        return None

    left50, right50 = crossing(.5, -1), crossing(.5, 1)
    left10, right10 = crossing(.1, -1), crossing(.1, 1)
    x = region[apex]['x']
    width = None if left50 is None or right50 is None else right50 - left50
    quality = peak_quality(signed, x, width)
    flags = []
    if quality['rSquared'] is None:
        flags.append(flag('peak_fit_unavailable', 'caution',
                          'Peak quality needs at least five samples and a positive FWHM.'))
    elif quality['rSquared'] < .95:
        flags.append(flag('poor_gaussian_fit', 'caution',
                          'Gaussian amplitude fit R-squared is below 0.95; inspect overlap, truncation, noise or asymmetry.'))
    if width is not None and sum(left50 <= p['x'] <= right50 for p in region) < 5:
        flags.append(flag('sparse_peak_sampling', 'caution',
                          'Fewer than five samples span the FWHM; apex and width may be poorly resolved.'))
    return {'start': a['x'], 'end': b['x'], 'apexX': x, 'response': region[apex]['y'],
            'height': height, 'area': area(corrected),
            'fwhm': width, 'fitQuality': quality, 'flags': flags,
            'asymmetry10': None if left10 is None or right10 is None else (right10 - x) / (x - left10)}


def detect_ranges(points: list[dict], count: int) -> list[dict]:
    # Remove endpoint drift only for detection; measurements use local baselines.
    a, b = points[0], points[-1]
    detrended = [{'x': p['x'], 'y': p['y'] - a['y'] - (b['y'] - a['y']) *
                  (p['x'] - a['x']) / (b['x'] - a['x'])} for p in points]
    # Short traces cannot support the seven-sample smoother or noise estimate.
    # Use a directly observed strict local maximum instead of silently losing it.
    if len(points) < 7:
        candidates = [i for i in range(1, len(points) - 1)
                      if detrended[i]['y'] > 0
                      and detrended[i]['y'] > detrended[i - 1]['y']
                      and detrended[i]['y'] > detrended[i + 1]['y']]
        return ([{'start': points[0]['x'], 'end': points[-1]['x']}]
                if candidates[:count] else [])
    smooth = moving_average(detrended, 7)
    differences = [b['y'] - a['y'] for a, b in zip(detrended, detrended[1:])]
    median = quantile(differences, .5)
    noise = 1.4826 * quantile([abs(v - median) for v in differences], .5) / math.sqrt(2)
    threshold = max(quantile([p['y'] for p in smooth], .65), 3 * noise)
    candidates = [i for i in range(1, len(points) - 1) if smooth[i]['y'] > threshold
                  and smooth[i]['y'] >= smooth[i - 1]['y'] and smooth[i]['y'] > smooth[i + 1]['y']]
    chosen = []
    for i in sorted(candidates, key=lambda i: smooth[i]['y'], reverse=True):
        if all(abs(i - other) > max(1, len(points) * .03) for other in chosen):
            chosen.append(i)
        if len(chosen) == count:
            break
    chosen.sort()
    # Bound each integration at the observed valley, never across a neighbour.
    bounds = [0] + [min(range(i + 1, j), key=lambda k: smooth[k]['y'])
                    for i, j in zip(chosen, chosen[1:])] + [len(points) - 1]
    return [{'start': points[bounds[i]]['x'], 'end': points[bounds[i + 1]]['x']} for i in range(len(chosen))]


def analyze_chromatogram(body: dict) -> dict:
    if not isinstance(body, dict):
        raise ValueError('Request must be an object')
    if body.get('schemaVersion', 1) != 1:
        raise ValueError('Unsupported schemaVersion; expected 1')
    units = body.get('units')
    if not isinstance(units, dict) or units.get('x') not in ('mL', 'min') or units.get('y') not in ('mAU', 'mg/mL'):
        raise ValueError('units must specify x: mL or min, y: mAU or mg/mL')
    raw = body.get('points')
    if not isinstance(raw, list) or not 3 <= len(raw) <= 200000:
        raise ValueError('points must contain 3 to 200000 samples')
    points = []
    for p in raw:
        if not isinstance(p, dict):
            raise ValueError('Each sample must be an object with x and y')
        points.append({'x': number(p.get('x'), 'x'), 'y': number(p.get('y'), 'y')})
    if any(b['x'] <= a['x'] for a, b in zip(points, points[1:])):
        raise ValueError('Sample x coordinates must be strictly increasing')
    processing = body.get('processing', {})
    if not isinstance(processing, dict):
        raise ValueError('processing must be an object')
    window = processing.get('smoothing', 1)
    if isinstance(window, bool) or not isinstance(window, int) or not 1 <= window <= 1001:
        raise ValueError('smoothing must be an integer from 1 to 1001')
    points = moving_average(points, window) if window > 1 else points
    baseline = processing.get('baseline', 'none')
    if baseline not in ('none', 'percentile5'):
        raise ValueError('baseline must be none or percentile5')
    offset = quantile([p['y'] for p in points], .05) if baseline == 'percentile5' else 0
    points = [{'x': p['x'], 'y': p['y'] - offset} for p in points]
    ranges = body.get('ranges')
    if ranges is None:
        count = body.get('maxPeaks', 10)
        if isinstance(count, bool) or not isinstance(count, int) or not 1 <= count <= 100:
            raise ValueError('maxPeaks must be an integer from 1 to 100')
        ranges = detect_ranges(points, count)
    if not isinstance(ranges, list) or len(ranges) > 100:
        raise ValueError('ranges must be an array with at most 100 entries')
    checked = []
    for r in ranges:
        if not isinstance(r, dict):
            raise ValueError('Each range must be an object')
        start, end = number(r.get('start'), 'start'), number(r.get('end'), 'end')
        if not points[0]['x'] <= start < end <= points[-1]['x']:
            raise ValueError('Integration ranges must lie within the trace and have start < end')
        checked.append((start, end))
    checked.sort()
    if any(b[0] < a[1] for a, b in zip(checked, checked[1:])):
        raise ValueError('Integration ranges must not overlap (mass would be counted twice)')
    peaks = [p for start, end in checked if (p := measure_peak(points, start, end)) is not None]
    sec = body.get('sec')
    fit = None
    if sec is not None:
        if not isinstance(sec, dict):
            raise ValueError('sec must be an object')
        if units['x'] != 'mL':
            raise ValueError('SEC requires an mL axis; explicitly convert time using measured flow before analysis')
        fit = fit_sec(sec)
        for p in peaks:
            prediction = calibrate(p['apexX'], fit)
            p['flags'].extend(prediction.pop('flags'))
            p.update(prediction)
    resolutions = []
    for i, (a, b) in enumerate(zip(peaks, peaks[1:])):
        widths = [a['fwhm'], b['fwhm']]
        rs = None if None in widths else 1.18 * (b['apexX'] - a['apexX']) / sum(widths)
        resolutions.append({'leftPeakIndex': i, 'rightPeakIndex': i + 1, 'rs': rs})
        if rs is not None and rs < 1.5:
            for p in (a, b):
                if not any(f['code'] == 'unresolved_neighbor' for f in p['flags']):
                    p['flags'].append(flag('unresolved_neighbor', 'caution',
                                           'An adjacent peak has Rs below 1.5; species contributions are not deconvolved.'))
    total_area = finite_sum((p['area'] for p in peaks), 'integrated peak area')
    mass = body.get('massBalance')
    recovery = {'status': 'not_requested', 'integratedArea': total_area, 'recoveredMg': None, 'recoveryPercent': None}
    if mass is not None:
        if not isinstance(mass, dict):
            raise ValueError('massBalance must be an object')
        loaded = positive(mass.get('loadedMg'), 'loadedMg')
        factor = 1.0
        if units['y'] == 'mAU':
            factor = positive(mass.get('responseFactorMAUPerMgMl'), 'responseFactorMAUPerMgMl')
        flow = positive(mass.get('flowMlPerMin'), 'flowMlPerMin') if units['x'] == 'min' else 1.0
        recovered = finite(total_area / factor * flow, 'recovered mass')
        recovery.update(status='calculated', loadedMg=loaded, recoveredMg=recovered,
                        recoveryPercent=finite(100 * recovered / loaded, 'recovery percent'),
                        unaccountedMg=finite(loaded - recovered, 'unaccounted mass'),
                        exceedsLoaded=recovered > loaded)
    result = {'schemaVersion': 1, 'units': {**units, 'area': units['y'] + '*' + units['x'],
              'width': units['x'], 'mw': 'kDa', 'mass': 'mg', 'recovery': '%',
              'fitResidual': units['y'], 'mwUncertainty': 'kDa'},
              'points': points, 'baselineOffset': offset, 'peaks': peaks,
              'calibration': fit, 'resolutions': resolutions, 'massBalance': recovery,
              'methods': {'baseline': baseline, 'peakBaseline': 'linear_endpoints_positive_area',
                          'resolution': '1.18*apex_distance/(fwhm1+fwhm2)',
                          'asymmetry': 'trailing/leading width at 10% height',
                          'peakFit': 'nonnegative least-squares Gaussian amplitude; measured apex/FWHM fixed; signed endpoint baseline residuals; RMSE in y units',
                          'mwUncertainty': 'first-order one-sigma inverse SEC prediction from calibration scatter only; not a confidence interval',
                          'noise': '1.4826*MAD(first differences)/sqrt(2); 3 sigma threshold'}}
    return json_result(result)
