"""Local gel-image lane and band densitometry for Protein Labs."""

from __future__ import annotations

from base64 import b64decode, b64encode
from io import BytesIO
from pathlib import Path
from typing import Any
import math
import statistics
import uuid

from PIL import Image, ImageOps


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


def _load_image(request: dict[str, Any]) -> tuple[Image.Image, str]:
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
    maximum = 1800
    if max(image.size) > maximum:
        scale = maximum / max(image.size)
        image = image.resize(
            (max(1, round(image.width * scale)), max(1, round(image.height * scale))),
            Image.Resampling.LANCZOS,
        )
    return image, source


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
    return [
        {
            "id": f"lane-{uuid.uuid4().hex[:10]}",
            "label": f"Lane {index + 1}",
            "xStart": start / width,
            "xEnd": (end + 1) / width,
            "isLadder": index == 0,
        }
        for index, (start, end) in enumerate(merged[:24])
    ]


def _lane_bands(
    signal: list[list[float]], lane: dict[str, Any], sensitivity: float
) -> list[dict[str, Any]]:
    height = len(signal)
    width = len(signal[0])
    x0 = max(0, min(width - 1, round(float(lane["xStart"]) * width)))
    x1 = max(x0 + 1, min(width, round(float(lane["xEnd"]) * width)))
    inset = max(0, (x1 - x0) // 12)
    x0, x1 = min(x1 - 1, x0 + inset), max(x0 + 1, x1 - inset)
    raw = [sum(signal[y][x0:x1]) / max(1, x1 - x0) for y in range(height)]
    smooth = _smooth(raw, max(1, height // 350))
    background = _smooth(smooth, max(8, height // 28))
    corrected = [max(0.0, value - base) for value, base in zip(smooth, background)]
    usable = corrected[round(height * 0.04) : round(height * 0.97)]
    median = statistics.median(usable) if usable else 0.0
    mad = statistics.median(abs(value - median) for value in usable) if usable else 0.0
    high = _percentile(usable, 0.94)
    sensitivity = max(0.0, min(1.0, sensitivity))
    threshold = max(median + (4.8 - sensitivity * 3.0) * max(0.5, 1.4826 * mad), high * (0.30 - sensitivity * 0.14))
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
        density = sum(corrected[start : end + 1]) * max(1, x1 - x0)
        if density <= 0:
            continue
        bands.append({
            "id": f"band-{uuid.uuid4().hex[:12]}",
            "laneId": str(lane["id"]),
            "label": f"Band {len(bands) + 1}",
            "yStart": start / height,
            "yEnd": (end + 1) / height,
            "centerY": apex / height,
            "density": density,
            "peakSignal": corrected[apex],
            "autoDetected": True,
            "isTarget": False,
        })
    total = sum(float(item["density"]) for item in bands)
    for band in bands:
        band["laneFraction"] = float(band["density"]) / total if total else 0.0
    return bands


def analyze_gel(request: dict[str, Any]) -> dict[str, Any]:
    image, source = _load_image(request)
    signal, polarity = _signal_matrix(image)
    sensitivity = float(request.get("sensitivity", 0.52))
    requested_lanes = request.get("lanes")
    lanes = (
        [dict(value) for value in requested_lanes]
        if isinstance(requested_lanes, list) and requested_lanes
        else _auto_lanes(signal, sensitivity)
    )
    bands: list[dict[str, Any]] = []
    for lane in lanes:
        bands.extend(_lane_bands(signal, lane, sensitivity))
    for lane in lanes:
        lane_bands = [band for band in bands if band["laneId"] == lane["id"]]
        if lane_bands and not bool(lane.get("isLadder")):
            max(lane_bands, key=lambda item: float(item["density"]))["isTarget"] = True
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
    }
