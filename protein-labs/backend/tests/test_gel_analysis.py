from base64 import b64decode, b64encode
from io import BytesIO

from PIL import Image, ImageDraw
import pytest

from protein_labs.gel_analysis import analyze_gel


def _gel_base64(image_format: str = "PNG") -> str:
    image = Image.new("L", (240, 320), 238)
    draw = ImageDraw.Draw(image)
    for left in (25, 90, 155):
        draw.rectangle((left, 18, left + 38, 302), fill=224)
    for y in (52, 91, 138, 196, 254):
        draw.rectangle((27, y, 61, y + 7), fill=35)
    for y, shade in ((88, 50), (171, 92), (226, 135)):
        draw.rectangle((92, y, 126, y + 9), fill=shade)
    for y, shade in ((108, 65), (210, 115)):
        draw.rectangle((157, y, 191, y + 8), fill=shade)
    buffer = BytesIO()
    image.save(buffer, format=image_format)
    return b64encode(buffer.getvalue()).decode("ascii")


def test_detects_bands_and_quantifies_lane_fraction():
    lanes = [
        {"id": "ladder", "label": "Ladder", "xStart": 0.10, "xEnd": 0.27, "isLadder": True},
        {"id": "sample", "label": "Sample", "xStart": 0.38, "xEnd": 0.55, "isLadder": False},
    ]
    result = analyze_gel({
        "imageBase64": _gel_base64(),
        "filename": "synthetic.png",
        "lanes": lanes,
        "sensitivity": 0.55,
    })
    ladder_bands = [band for band in result["bands"] if band["laneId"] == "ladder"]
    sample_bands = [band for band in result["bands"] if band["laneId"] == "sample"]
    assert len(ladder_bands) >= 5
    assert len(sample_bands) >= 3
    assert sum(band["laneFraction"] for band in sample_bands) == pytest.approx(1.0)
    assert sum(bool(band["isTarget"]) for band in sample_bands) == 1


def test_can_propose_lanes_automatically():
    result = analyze_gel({"imageBase64": _gel_base64(), "sensitivity": 0.6})
    assert result["width"] == 240
    assert result["height"] == 320
    assert result["polarity"] == "dark"
    assert len(result["lanes"]) >= 2
    assert result["bands"]


def test_imports_tiff_and_returns_flutter_compatible_png_preview():
    result = analyze_gel({
        "imageBase64": _gel_base64("TIFF"),
        "filename": "gel-scan.tif",
        "sensitivity": 0.55,
    })
    preview = b64decode(result["previewBase64"])
    assert preview.startswith(b"\x89PNG\r\n\x1a\n")
    assert result["source"] == "gel-scan.tif"
    assert result["bands"]
