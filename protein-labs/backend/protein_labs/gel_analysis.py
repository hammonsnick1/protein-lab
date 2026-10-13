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

MAX_IMAGE_DIMENSION = 1800
SATURATION_SIGNAL = 253.5
SATURATION_PIXEL_FRACTION = 0.02
BACKGROUND_METHOD = "rolling_ball"
DEFAULT_BACKGROUND_RADIUS = 28
LINEAR_RANGE_MAX = 254.0
NORMALIZATION_BASIS = "percent_of_lane_integral"
DEFAULT_LADDER_MASSES_KDA = [
    250,
    150,
    100,
    75,
    50,
    37,
    25,
    20,
    15,
    10,
]


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
    if not profile:
        return []
    radius = max(1, radius)
    window = radius * 2 + 1
    eroded: list[float] = []
    for index in range(len(profile)):
        start = max(0, index - radius)
        end = min(len(profile), index + radius + 1)
        eroded.append(min(profile[start:end]))
    return _smooth(eroded, max(1, radius // 3))


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
    image = ImageOps.exif_transpose(image).convert("L")
    if image.width < 40 or image.height < 40:
        raise ValueError("The gel image is too small to analyze")
    original_width, original_height = image.size
    processing: dict[str, Any] = {
        "downscaled": False,
        "originalWidth": original_width,
        "originalHeight": original_height,
        "maxDimensionLimit": MAX_IMAGE_DIMENSION,
        "scaleFactor": 1.0,
        "resampling": None,
    }
    if max(image.size) > MAX_IMAGE_DIMENSION:
        scale = MAX_IMAGE_DIMENSION / max(image.size)
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
        processing["downscaled"] = True
        processing["scaleFactor"] = scale
        processing["resampling"] = "LANCZOS"
    return image, source, processing


def _signal_matrix(image: Image.Image) -> tuple[list[list[float]], str]:
    width, height = image.size
    pixels = list(image.tobytes())
    rows = [
        [float(value) for value in pixels[row * width : (row + 1) * width]]
        for row in range(height)
    ]
    flat = [value for row in rows for value in row]
    median = statistics.median(flat)
    dark_contrast = sum(max(0.0, median - value) for value in flat)
    light_contrast = sum(max(0.0, value - median) for value in flat)
    dark_bands = dark_contrast >= light_contrast
    if dark_bands:
        return [[255.0 - value for value in row] for row in rows], "dark"
    return rows, "light"


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
    baseline = _percentile(smooth, 0.35)
    high = _percentile(smooth, 0.90)
    fraction = 0.48 - max(0.0, min(1.0, sensitivity)) * 0.20
    threshold = baseline + max(2.0, (high - baseline) * fraction)
    regions = _regions_above(smooth, threshold, max(3, width // 100))
    padded: list[tuple[int, int]] = []
    for start, end in regions:
        pad = max(2, round((end - start + 1) * 0.32))
        padded.append((max(0, start - pad), min(width - 1, end + pad)))
    merged: list[tuple[int, int]] = []
    for start, end in padded:
        if merged and start <= merged[-1][1] + max(2, width // 150):
            previous = merged.pop()
            merged.append((previous[0], max(previous[1], end)))
        else:
            merged.append((start, end))
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
    signal: list[list[float]], x0: int, x1: int, y0: int, y1: int
) -> tuple[bool, str | None]:
    pixels: list[float] = []
    for y in range(y0, y1 + 1):
        for x in range(x0, x1):
            pixels.append(signal[y][x])
    if not pixels:
        return False, None
    saturated = sum(1 for value in pixels if value >= SATURATION_SIGNAL)
    fraction = saturated / len(pixels)
    if fraction >= SATURATION_PIXEL_FRACTION:
        return True, (
            f"Band pixels are saturated ({fraction:.1%} at or above "
            f"{SATURATION_SIGNAL:.0f}); intensity is not in the linear range"
        )
    return False, None


def _lane_bands(
    signal: list[list[float]],
    lane: dict[str, Any],
    sensitivity: float,
    background_radius: int,
) -> list[dict[str, Any]]:
    height = len(signal)
    width = len(signal[0])
    x0 = max(0, min(width - 1, round(float(lane["xStart"]) * width)))
    x1 = max(x0 + 1, min(width, round(float(lane["xEnd"]) * width)))
    inset = max(0, (x1 - x0) // 12)
    x0, x1 = min(x1 - 1, x0 + inset), max(x0 + 1, x1 - inset)
    raw = [sum(signal[y][x0:x1]) / max(1, x1 - x0) for y in range(height)]
    smooth = _smooth(raw, max(1, height // 350))
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
    bands: list[dict[str, Any]] = []
    for apex in candidates:
        cutoff = max(median + mad, corrected[apex] * 0.16)
        start = apex
        while start > 1 and corrected[start] > cutoff:
            start -= 1
        end = apex
        while end < height - 2 and corrected[end] > cutoff:
            end += 1
        start, end = max(0, start), min(height - 1, end)
        y_start = start / height
        y_end = (end + 1) / height
        center_y = apex / height
        saturated, saturation_reason = _band_saturation(signal, x0, x1, start, end)
        density = sum(corrected[start : end + 1]) * max(1, x1 - x0)
        band_height = end - start + 1
        lane_width = max(1, x1 - x0)
        noise_scale = max(0.5, 1.4826 * mad) * math.sqrt(band_height * lane_width)
        relative = noise_scale / max(density, 1e-6)
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
            "peakSignal": corrected[apex],
            "autoDetected": True,
            "isTarget": False,
            "quantificationRefused": saturated,
            "saturationReason": saturation_reason,
            "normalizationBasis": NORMALIZATION_BASIS,
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
    quantified = [item for item in bands if not item["quantificationRefused"]]
    total = sum(float(item["density"]) for item in quantified)
    for band in quantified:
        fraction = float(band["density"]) / total if total else 0.0
        band["laneFraction"] = fraction
        noise_scale = max(0.5, 1.4826 * mad) * math.sqrt(
            max(1, round((band["yEnd"] - band["yStart"]) * height)) * max(1, x1 - x0)
        )
        relative = noise_scale / max(float(band["density"]), 1e-6)
        band["laneFractionUncertainty"] = min(0.5, fraction * relative)
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


def _ladder_masses(request: dict[str, Any], band_count: int) -> list[float]:
    custom = request.get("ladderMassesDa") or request.get("ladderMassesKDa")
    if isinstance(custom, list) and custom:
        values = [float(item) for item in custom]
        if len(values) >= band_count:
            return values[:band_count]
        return values
    return DEFAULT_LADDER_MASSES_KDA[: max(2, min(band_count, len(DEFAULT_LADDER_MASSES_KDA)))]


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
        band
        for band in bands
        if band["laneId"] == ladder_lane["id"] and not band.get("quantificationRefused")
    ]
    if len(ladder_bands) < 2:
        for band in bands:
            band["molecularWeightDa"] = None
            band["molecularWeightStatus"] = "insufficient_ladder_bands"
        return None
    ladder_bands.sort(key=lambda item: float(item["centerY"]))
    masses = _ladder_masses(request, len(ladder_bands))
    if len(masses) < len(ladder_bands):
        masses = masses + [masses[-1]] * (len(ladder_bands) - len(masses))
    mobilities = [float(band["centerY"]) for band in ladder_bands]
    log_mw = [math.log10(mass * 1000.0) for mass in masses[: len(ladder_bands)]]
    slope, intercept, r2 = _linear_regression(mobilities, log_mw)
    min_m = min(mobilities)
    max_m = max(mobilities)
    calibration = {
        "method": "log10_da_vs_relative_mobility",
        "relativeMobilityAxis": "centerY_fraction_from_top",
        "fitR2": round(r2, 4),
        "slope": slope,
        "intercept": intercept,
        "ladderBandCount": len(ladder_bands),
        "mobilityRange": [min_m, max_m],
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


def analyze_gel(request: dict[str, Any]) -> dict[str, Any]:
    image, source, image_processing = _load_image(request)
    signal, polarity = _signal_matrix(image)
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
    for lane in lanes:
        bands.extend(_lane_bands(signal, lane, sensitivity, background_radius))
    for lane in lanes:
        lane_bands = [
            band
            for band in bands
            if band["laneId"] == lane["id"] and not band.get("quantificationRefused")
        ]
        if lane_bands and not bool(lane.get("isLadder")):
            max(lane_bands, key=lambda item: float(item["density"]))["isTarget"] = True
    ladder_calibration = _apply_molecular_weights(bands, lanes, request)
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
