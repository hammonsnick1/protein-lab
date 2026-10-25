"""Local gel-image lane and band densitometry for Protein Labs."""

from __future__ import annotations

from base64 import b64decode, b64encode
from hashlib import sha256
from io import BytesIO
from pathlib import Path
from typing import Any
import math
import statistics

from PIL import Image, ImageOps

SATURATION_SIGNAL = 255.0
BACKGROUND_METHOD = "rolling_ball"
DEFAULT_BACKGROUND_RADIUS = 28
LINEAR_RANGE_MAX = 254.0
INTEGRATED_DENSITY_UNIT = "8_bit_polarity_corrected_intensity_px"
NORMALIZATION_BASIS = "fraction_of_detected_band_integrals"
NORMALIZATION_UNAVAILABLE_SATURATION = "lane_fraction_unavailable_due_to_saturation"


def _stable_id(prefix: str, *parts: object) -> str:
    payload = "|".join(str(part) for part in parts)
    digest = sha256(payload.encode()).hexdigest()[:12]
    return f"{prefix}-{digest}"


def _smooth(values: list[float], radius: int) -> list[float]:
    if radius <= 0 or len(values) < 3:
        return values[:]
    prefix = [0.0]
    for value in values:
        prefix.append(prefix[-1] + value)
    result: list[float] = []
    for index in range(len(values)):
        start = max(0, index - radius)
        end = min(len(values), index + radius + 1)
        result.append((prefix[end] - prefix[start]) / (end - start))
    return result


def _rolling_ball(profile: list[float], radius: int) -> list[float]:
    """Fit circular caps below the profile and reconstruct their upper envelope.

    Radius uses pixels horizontally and 8-bit signal units vertically. The
    erosion lowers each center until its entire cap fits; dilation reconstructs
    the background. Truncated support avoids inventing off-image signal.
    Unlike a minimum filter, this opening preserves interior linear ramps.
    """
    if not profile:
        return []
    radius = max(1, radius)
    cap = [(dx, math.sqrt(radius * radius - dx * dx))
           for dx in range(-radius, radius + 1)]
    length = len(profile)
    centers = [
        min(profile[i + dx] - height for dx, height in cap if 0 <= i + dx < length)
        for i in range(length)
    ]
    return [
        min(profile[i], max(centers[i - dx] + height
                            for dx, height in cap if 0 <= i - dx < length))
        for i in range(length)
    ]


def _percentile(values: list[float], fraction: float) -> float:
    if not values:
        return 0.0
    ordered = sorted(values)
    position = max(0.0, min(1.0, fraction)) * (len(ordered) - 1)
    low = int(math.floor(position))
    high = int(math.ceil(position))
    if low == high:
        return ordered[low]
    weight = position - low
    return ordered[low] * (1 - weight) + ordered[high] * weight


def _load_image(request: dict[str, Any]) -> tuple[Image.Image, str, dict[str, Any]]:
    encoded = str(request.get("imageBase64") or "").strip()
    path = str(request.get("path") or "").strip()
    if encoded:
        raw = b64decode(encoded, validate=True)
        source = str(request.get("filename") or "gel image")
    elif path:
        source_path = Path(path).expanduser().resolve()
        raw = source_path.read_bytes()
        source = source_path.name
    else:
        raise ValueError("Choose an SDS-PAGE or Native PAGE image first")
    try:
        image = Image.open(BytesIO(raw))
        image.load()
    except Exception as error:
        raise ValueError("The selected file is not a readable gel image") from error
    if image.mode not in {"L", "RGB"}:
        raise ValueError("Quantification requires an 8-bit grayscale or RGB image; "
                         "higher bit depths, palette images, and alpha channels are unsupported")
    image = ImageOps.exif_transpose(image)
    if image.width < 40 or image.height < 40:
        raise ValueError("The gel image is too small to analyze")
    original_width, original_height = image.size
    processing: dict[str, Any] = {
        "downscaled": False,
        "originalWidth": original_width,
        "originalHeight": original_height,
        "maxDimensionLimit": None,
        "scaleFactor": 1.0,
        "resampling": None,
        "sourceMode": image.mode,
        "measurementConversion": "Pillow_RGB_to_L" if image.mode == "RGB" else None,
    }
    return image, source, processing


def _signal_matrix(image: Image.Image) -> tuple[list[list[float]], str, list[list[bool]]]:
    width, height = image.size
    pixels = list(image.convert("L").tobytes())
    rows = [
        [float(value) for value in pixels[row * width : (row + 1) * width]]
        for row in range(height)
    ]
    flat = [value for row in rows for value in row]
    median = statistics.median(flat)
    dark_contrast = sum(max(0.0, median - value) for value in flat)
    light_contrast = sum(max(0.0, value - median) for value in flat)
    dark_bands = dark_contrast >= light_contrast
    # Channel clipping must be checked before luminance conversion hides it.
    endpoint = 0 if dark_bands else 255
    channels = len(image.getbands())
    source_pixels = image.tobytes()
    clipped = [endpoint in source_pixels[i:i + channels]
               for i in range(0, len(source_pixels), channels)]
    clipping_mask = [clipped[y * width:(y + 1) * width] for y in range(height)]
    if dark_bands:
        return [[255.0 - value for value in row] for row in rows], "dark", clipping_mask
    return rows, "light", clipping_mask


def _regions_above(profile: list[float], threshold: float, minimum: int) -> list[tuple[int, int]]:
    result: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(profile + [float("-inf")]):
        if value >= threshold and start is None:
            start = index
        elif value < threshold and start is not None:
            if index - start >= minimum:
                result.append((start, index - 1))
            start = None
    return result


def _auto_lanes(signal: list[list[float]], sensitivity: float) -> list[dict[str, Any]]:
    height = len(signal)
    width = len(signal[0])
    top, bottom = round(height * 0.06), round(height * 0.96)
    profile = [
        sum(signal[y][x] for y in range(top, bottom)) / max(1, bottom - top)
        for x in range(width)
    ]
    radius = max(2, width // 140)
    smooth = _smooth(profile, radius)
    # The lower fifth of columns is the gel background.  A higher percentile
    # treats lightly loaded lanes as background whenever strongly loaded lanes
    # are present in the same image.
    baseline = _percentile(smooth, 0.20)
    high = _percentile(smooth, 0.90)
    sensitivity = max(0.0, min(1.0, sensitivity))
    # Keep a small absolute contrast floor for detector noise, while allowing
    # faint lanes to survive beside a heavily stained ladder.
    fraction = 0.12 - sensitivity * 0.08
    threshold = baseline + max(1.0, (high - baseline) * fraction)
    regions = _regions_above(smooth, threshold, max(3, width // 100))
    # A profile region describes where a lane contains visible bands.  It is
    # normally narrower than the physical lane, so expand it for a useful
    # editing geometry.  Crucially, do not let that cosmetic expansion cross
    # the valley between neighbouring regions: doing so used to merge sparsely
    # loaded lanes into a single lane at high sensitivity.
    join_gap = max(2, width // 150)
    merged: list[tuple[int, int]] = []
    for start, end in regions:
        if merged and start <= merged[-1][1] + join_gap:
            previous = merged.pop()
            merged.append((previous[0], max(previous[1], end)))
        else:
            merged.append((start, end))
    padded: list[tuple[int, int]] = []
    minimum_gap = max(2, width // 300)
    for index, (start, end) in enumerate(merged):
        requested_pad = max(2, round((end - start + 1) * 0.32))
        left_gap = start - (merged[index - 1][1] if index else -1) - 1
        right_gap = (
            (merged[index + 1][0] if index + 1 < len(merged) else width) - end - 1
        )
        left_pad = min(requested_pad, max(0, (left_gap - minimum_gap) // 2))
        right_pad = min(requested_pad, max(0, (right_gap - minimum_gap) // 2))
        padded.append((max(0, start - left_pad), min(width - 1, end + right_pad)))
    merged = padded
    if not merged:
        lane_count = max(1, min(12, round(width / max(45, height * 0.13))))
        step = width / lane_count
        merged = [
            (round(i * step + step * 0.16), round((i + 1) * step - step * 0.16))
            for i in range(lane_count)
        ]
    lanes: list[dict[str, Any]] = []
    for index, (start, end) in enumerate(merged[:24]):
        x_start = start / width
        x_end = (end + 1) / width
        lanes.append({
            "id": _stable_id("lane", width, height, round(x_start, 6), round(x_end, 6), index),
            "label": f"Lane {index + 1}",
            "xStart": x_start,
            "xEnd": x_end,
            "isLadder": index == 0,
        })
    return lanes


def _band_saturation(
    clipping_mask: list[list[bool]], x0: int, x1: int, y0: int, y1: int
) -> tuple[bool, str | None]:
    pixels: list[bool] = []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1):
            pixels.append(clipping_mask[y][x])
    if not pixels:
        return False, None
    saturated = sum(pixels)
    fraction = saturated / len(pixels)
    if saturated:
        return True, (
            f"Band pixels are saturated ({fraction:.1%} with a source channel at "
            "the signal-side endpoint); intensity is not in the linear range"
        )
    return False, None


def _lane_bands(
    signal: list[list[float]],
    lane: dict[str, Any],
    sensitivity: float,
    background_radius: int,
    clipping_mask: list[list[bool]],
) -> list[dict[str, Any]]:
    height = len(signal)
    width = len(signal[0])
    x0 = max(0, min(width - 1, round(float(lane["xStart"]) * width)))
    x1 = max(x0 + 1, min(width, round(float(lane["xEnd"]) * width)))
    inset = max(0, (x1 - x0) // 12)
    x0, x1 = min(x1 - 1, x0 + inset), max(x0 + 1, x1 - inset)
    raw = [sum(signal[y][x0:x1]) / max(1, x1 - x0) for y in range(height)]
    smoothing_radius = max(1, height // 350)
    smooth = _smooth(raw, smoothing_radius)
    background = _rolling_ball(smooth, background_radius)
    corrected = [max(0.0, value - base) for value, base in zip(smooth, background)]
    usable = corrected[round(height * 0.04) : round(height * 0.97)]
    median = statistics.median(usable) if usable else 0.0
    mad = statistics.median(abs(value - median) for value in usable) if usable else 0.0
    high = _percentile(usable, 0.94)
    sensitivity = max(0.0, min(1.0, sensitivity))
    threshold = max(
        median + (4.8 - sensitivity * 3.0) * max(0.5, 1.4826 * mad),
        high * (0.30 - sensitivity * 0.14),
    )
    candidates: list[int] = []
    margin = max(2, height // 100)
    for index in range(margin, height - margin):
        value = corrected[index]
        if value < threshold:
            continue
        left = corrected[max(0, index - margin) : index]
        right = corrected[index + 1 : min(height, index + margin + 1)]
        if value >= max(left, default=value) and value > max(right, default=-1):
            if candidates and index - candidates[-1] < max(4, height // 80):
                if value > corrected[candidates[-1]]:
                    candidates[-1] = index
            else:
                candidates.append(index)
    regions: list[tuple[int, int]] = []
    for apex in candidates:
        cutoff = max(median + mad, corrected[apex] * 0.16)
        start = apex
        while start > 1 and corrected[start] > cutoff:
            start -= 1
        end = apex
        while end < height - 2 and corrected[end] > cutoff:
            end += 1
        start, end = max(0, start), min(height - 1, end)
        # A circular opening can leave two shoulders on a flat-topped band.
        # Integrate overlapping support once, rather than counting both peaks.
        if regions and start <= regions[-1][1]:
            previous_start, previous_end = regions.pop()
            regions.append((previous_start, max(previous_end, end)))
        else:
            regions.append((start, end))
    bands: list[dict[str, Any]] = []
    for start, end in regions:
        integral = sum(corrected[start : end + 1])
        center = sum(y * corrected[y] for y in range(start, end + 1)) / integral
        y_start = start / height
        y_end = (end + 1) / height
        center_y = center / height
        saturated, saturation_reason = _band_saturation(clipping_mask, x0, x1, start, end)
        density = integral * max(1, x1 - x0)
        band_id = _stable_id(
            "band",
            lane["id"],
            round(y_start, 6),
            round(y_end, 6),
            round(center_y, 6),
        )
        band: dict[str, Any] = {
            "id": band_id,
            "laneId": str(lane["id"]),
            "label": f"Band {len(bands) + 1}",
            "yStart": y_start,
            "yEnd": y_end,
            "centerY": center_y,
            "peakSignal": max(corrected[start : end + 1]),
            "autoDetected": True,
            "isTarget": False,
            "quantificationRefused": saturated,
            "saturationReason": saturation_reason,
            # Corrected 8-bit intensity integrated over the band area (pixels).
            # This also applies to densityUncertainty when it is available.
            "densityUnit": INTEGRATED_DENSITY_UNIT,
            "normalizationBasis": NORMALIZATION_BASIS,
            # Noise-only approximate standard error in integrated signal units.
            # The profile has already been averaged across the lane and smoothed.
            "densityUncertainty": None if saturated else (
                max(0.5, 1.4826 * mad) * (x1 - x0)
                * math.sqrt((end - start + 1) * (2 * smoothing_radius + 1))
            ),
        }
        if saturated:
            band["density"] = None
            band["laneFraction"] = None
            band["laneFractionUncertainty"] = None
        else:
            band["density"] = density
            band["laneFraction"] = 0.0
            band["laneFractionUncertainty"] = None
        bands.append(band)
    refused_in_lane = any(item["quantificationRefused"] for item in bands)
    quantified = [item for item in bands if not item["quantificationRefused"]]
    if refused_in_lane:
        for band in bands:
            band["laneFraction"] = None
            band["laneFractionUncertainty"] = None
            band["normalizationBasis"] = NORMALIZATION_UNAVAILABLE_SATURATION
        return bands
    total = sum(float(item["density"]) for item in quantified)
    # MAD is measured on a column-averaged, smoothed profile. Scale back by
    # lane width (not sqrt(width)), and approximate smoothing correlation.
    density_variances = [
        band["densityUncertainty"]**2
        for band in quantified
    ]
    total_variance = sum(density_variances)
    for band, variance in zip(quantified, density_variances):
        fraction = float(band["density"]) / total if total else 0.0
        band["laneFraction"] = fraction
        # Delta method for I_i / sum(I): account for the shared denominator.
        fraction_variance = ((1 - fraction)**2 * variance
                             + fraction**2 * (total_variance - variance)) / total**2
        band["laneFractionUncertainty"] = math.sqrt(max(0.0, fraction_variance))
    return bands


def _linear_regression(xs: list[float], ys: list[float]) -> tuple[float, float, float]:
    if len(xs) < 2:
        return 0.0, 0.0, 0.0
    mean_x = statistics.mean(xs)
    mean_y = statistics.mean(ys)
    var_x = sum((x - mean_x) ** 2 for x in xs)
    if var_x <= 0:
        return 0.0, mean_y, 0.0
    cov = sum((x - mean_x) * (y - mean_y) for x, y in zip(xs, ys))
    slope = cov / var_x
    intercept = mean_y - slope * mean_x
    ss_res = sum((y - (slope * x + intercept)) ** 2 for x, y in zip(xs, ys))
    ss_tot = sum((y - mean_y) ** 2 for y in ys)
    r2 = 1.0 - (ss_res / ss_tot) if ss_tot > 0 else 0.0
    return slope, intercept, max(0.0, min(1.0, r2))


def _ladder_mass_list_da(request: dict[str, Any]) -> list[float] | None:
    """Masses must explicitly match all detected markers, from top to bottom."""
    keys = [key for key in ("ladderMassesDa", "ladderMassesKDa") if key in request]
    if not keys:
        return None
    if len(keys) != 1:
        raise ValueError("Supply ladderMassesDa or ladderMassesKDa, not both")
    key = keys[0]
    if not isinstance(request[key], list):
        raise ValueError("Ladder masses must be a list ordered from top to bottom")
    factor = 1000.0 if key == "ladderMassesKDa" else 1.0
    try:
        masses = [float(item) * factor for item in request[key]]
    except (TypeError, ValueError) as error:
        raise ValueError("Ladder masses must be finite positive numbers") from error
    if any(not math.isfinite(mass) or mass <= 0 for mass in masses):
        raise ValueError("Ladder masses must be finite positive numbers")
    if any(a <= b for a, b in zip(masses, masses[1:])):
        raise ValueError("Ladder masses must decrease strictly from top to bottom")
    return masses


def _apply_molecular_weights(
    bands: list[dict[str, Any]],
    lanes: list[dict[str, Any]],
    request: dict[str, Any],
) -> dict[str, Any] | None:
    ladder_lane = next((lane for lane in lanes if lane.get("isLadder")), None)
    if ladder_lane is None:
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "no_ladder_lane"
        return None
    ladder_bands = [
        band for band in bands if band["laneId"] == ladder_lane["id"]
    ]
    ladder_bands.sort(key=lambda item: float(item["centerY"]))
    if len(ladder_bands) < 2:
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "insufficient_ladder_bands"
        return None
    masses_da = _ladder_mass_list_da(request)
    failure = None
    if masses_da is None:
        failure = "ladder_masses_required"
    elif len(masses_da) != len(ladder_bands):
        failure = "ladder_mass_count_mismatch"
    if failure:
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = failure
        return {
            "method": "log10_da_vs_relative_mobility",
            "status": failure,
            "detectedMarkerCount": len(ladder_bands),
            "providedMarkerCount": len(masses_da) if masses_da is not None else 0,
        }
    for band, mass_da in zip(ladder_bands, masses_da):
        band["ladderMarkerMassDa"] = mass_da
    calibration_bands = [
        band
        for band in ladder_bands
        if not band.get("quantificationRefused")
    ]
    if len(calibration_bands) < 2:
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "insufficient_ladder_bands"
        return None
    mobilities = [float(band["centerY"]) for band in calibration_bands]
    log_mw = [math.log10(float(band["ladderMarkerMassDa"])) for band in calibration_bands]
    if len(set(mobilities)) != len(mobilities):
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "ambiguous_ladder_mobility"
        return {"status": "ambiguous_ladder_mobility"}
    slope, intercept, r2 = _linear_regression(mobilities, log_mw)
    min_m = min(mobilities)
    max_m = max(mobilities)
    calibration = {
        "method": "log10_da_vs_relative_mobility",
        "status": "calibrated",
        "relativeMobilityAxis": "centerY_fraction_from_top",
        "markerAssignment": "provided_masses_top_to_bottom_before_saturation_filter",
        "assumption": "All ladder markers are detected and correctly identified by the caller",
        "fitR2": round(r2, 4),
        "r2": r2,
        "slope": slope,
        "intercept": intercept,
        "ladderBandCount": len(ladder_bands),
        "calibrationMarkerCount": len(calibration_bands),
        "mobilityRange": [min_m, max_m],
        "residualConvention": "observed_minus_fitted_kDa",
        "matchedBands": [
            {
                "bandId": band["id"],
                "relativeMobility": band["centerY"],
                "massKDa": band["ladderMarkerMassDa"] / 1000,
                "fittedKDa": 10**(slope * band["centerY"] + intercept) / 1000,
                "residualKDa": (band["ladderMarkerMassDa"]
                                - 10**(slope * band["centerY"] + intercept)) / 1000,
            }
            for band in calibration_bands
        ],
    }
    for band in bands:
        if band.get("quantificationRefused"):
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "quantification_refused"
            continue
        mobility = float(band["centerY"])
        if mobility < min_m or mobility > max_m:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "outside_ladder_range"
            continue
        log_estimate = slope * mobility + intercept
        band["molecularWeightDa"] = round(10**log_estimate, 1)
        band["molecularWeightStatus"] = "estimated"
    return calibration


def _report_flags(band: dict[str, Any]) -> list[dict[str, str]]:
    flags = []
    if band["quantificationRefused"]:
        flags.append({"code": "band_saturated", "level": "warning",
                      "title": "Band saturated", "message": band["saturationReason"]})
    if band["normalizationBasis"] == NORMALIZATION_UNAVAILABLE_SATURATION:
        flags.append({"code": "lane_fraction_unavailable", "level": "warning",
                      "title": "Lane fraction unavailable",
                      "message": "A saturated band makes the lane total unknown; lane fractions cannot be reported."})
    if band["densityUncertainty"] is not None:
        flags.append({"code": "density_uncertainty_noise_only", "level": "note",
                      "title": "Noise-only uncertainty",
                      "message": "Density uncertainty is an approximate one-standard-error noise estimate; background bias, staining response, and lane curvature are excluded. Signal fraction is not validated protein mass purity."})
    mw_status = band["molecularWeightStatus"]
    if mw_status == "outside_ladder_range":
        flags.append({"code": mw_status, "level": "caution",
                      "title": "Outside ladder range",
                      "message": "Band mobility lies outside the calibrated ladder range; molecular weight is not extrapolated."})
    elif mw_status not in {"estimated", "quantification_refused"}:
        flags.append({"code": "ladder_" + mw_status, "level": "caution",
                      "title": "Molecular weight unavailable",
                      "message": "Ladder calibration unavailable: " + mw_status.replace("_", " ") + "."})
    return flags


def analyze_gel(request: dict[str, Any]) -> dict[str, Any]:
    image, source, image_processing = _load_image(request)
    signal, polarity, clipping_mask = _signal_matrix(image)
    sensitivity = float(request.get("sensitivity", 0.52))
    background_radius = int(request.get("backgroundRadiusPx", DEFAULT_BACKGROUND_RADIUS))
    background_radius = max(4, min(120, background_radius))
    requested_lanes = request.get("lanes")
    lanes = (
        [dict(value) for value in requested_lanes]
        if isinstance(requested_lanes, list) and requested_lanes
        else _auto_lanes(signal, sensitivity)
    )
    if isinstance(requested_lanes, list) and requested_lanes:
        for index, lane in enumerate(lanes):
            if not lane.get("id"):
                lane["id"] = _stable_id(
                    "lane",
                    image.width,
                    image.height,
                    round(float(lane.get("xStart", 0)), 6),
                    round(float(lane.get("xEnd", 0)), 6),
                    lane.get("label", index),
                )
    bands: list[dict[str, Any]] = []
    for index, lane in enumerate(lanes):
        lane.setdefault("label", f"Lane {index + 1}")
        lane.setdefault("sampleLabel", lane["label"])
        # Only the caller can bind a lane to a roadmap step; never guess an id.
        lane.setdefault("stageId", None)
        bands.extend(_lane_bands(signal, lane, sensitivity, background_radius, clipping_mask))
    for lane in lanes:
        lane_bands = [band for band in bands if band["laneId"] == lane["id"]]
        quantified = [
            band
            for band in lane_bands
            if not band.get("quantificationRefused") and band.get("laneFraction") is not None
        ]
        if (
            quantified
            and not bool(lane.get("isLadder"))
            and not any(band.get("quantificationRefused") for band in lane_bands)
        ):
            max(quantified, key=lambda item: float(item["density"]))["isTarget"] = True
    ladder_calibration = _apply_molecular_weights(bands, lanes, request)
    for band in bands:
        band["flags"] = _report_flags(band)
    preview = BytesIO()
    image.save(preview, format="PNG", optimize=True)
    return {
        "source": source,
        "width": image.width,
        "height": image.height,
        "polarity": polarity,
        "previewBase64": b64encode(preview.getvalue()).decode("ascii"),
        "lanes": lanes,
        "bands": bands,
        "quantification": {
            "backgroundMethod": BACKGROUND_METHOD,
            "backgroundRadiusPx": background_radius,
            "backgroundKernel": "circular_cap_1d_opening",
            "backgroundIntensityRadius": background_radius,
            "backgroundBoundary": "truncated_support",
            "laneGeometry": "straight_rectangles_with_one_twelfth_width_inset",
            "uncertaintyMethod": "profile_MAD_noise_only_approximate_standard_error",
            "uncertaintyPropagation": "ratio_delta_method_independent_band_integrals",
            "profileNoiseFloor": 0.5,
            "profileSmoothingRadiusPx": max(1, image.height // 350),
            "caveats": [
                "Lane fractions describe detected band signal; undetected material is excluded",
                "Noise uncertainty excludes background bias, staining response, and lane curvature",
                "Intensity fractions are not a validated protein mass purity measurement",
                "Detector linearity is assumed, not established from an image",
                "Background radius must exceed band width; broad bands can be underestimated",
            ],
            "normalizationBasis": NORMALIZATION_BASIS,
            "linearDynamicRange": {
                "minSignal": 0.0,
                "maxSignal": LINEAR_RANGE_MAX,
                "unit": "8_bit_polarity_corrected",
            },
            "imageProcessing": image_processing,
        },
        "ladderCalibration": ladder_calibration,
    }
