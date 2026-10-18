from base64 import b64decode, b64encode
from io import BytesIO
import json
import math

from PIL import Image, ImageDraw
import pytest

from protein_labs.gel_analysis import analyze_gel


def _gel_base64(image_format: str = "PNG", *, saturated_lane: bool = False) -> str:
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
    if saturated_lane:
        draw.rectangle((92, 88, 126, 97), fill=0)
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
    assert len(ladder_bands) == 5
    assert len(sample_bands) == 3
    quantified = [band for band in sample_bands if not band["quantificationRefused"]]
    assert sum(band["laneFraction"] for band in quantified) == pytest.approx(1.0)
    assert sum(bool(band["isTarget"]) for band in sample_bands) == 1
    assert result["quantification"]["backgroundMethod"] == "rolling_ball"
    assert result["quantification"]["normalizationBasis"] == "fraction_of_detected_band_integrals"
    assert result["ladderCalibration"]["status"] == "ladder_masses_required"


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


def test_analyze_gel_is_deterministic():
    payload = {"imageBase64": _gel_base64(), "sensitivity": 0.6}
    first = analyze_gel(payload)
    second = analyze_gel(payload)
    assert json.dumps(first, sort_keys=True) == json.dumps(second, sort_keys=True)


def test_refuses_quantification_for_saturated_band():
    lanes = [
        {"id": "ladder", "label": "Ladder", "xStart": 0.10, "xEnd": 0.27, "isLadder": True},
        {"id": "sample", "label": "Sample", "xStart": 0.38, "xEnd": 0.55, "isLadder": False},
    ]
    result = analyze_gel({
        "imageBase64": _gel_base64(saturated_lane=True),
        "lanes": lanes,
        "sensitivity": 0.55,
    })
    sample_bands = [band for band in result["bands"] if band["laneId"] == "sample"]
    refused = [band for band in sample_bands if band["quantificationRefused"]]
    assert len(refused) == 1
    assert refused[0]["density"] is None
    assert "saturated" in refused[0]["saturationReason"]
    assert all(band["density"] > 0 for band in sample_bands if band not in refused)
    for band in sample_bands:
        assert band["laneFraction"] is None
        assert band["laneFractionUncertainty"] is None
        assert band["normalizationBasis"] == "lane_fraction_unavailable_due_to_saturation"
    assert not any(band.get("isTarget") for band in sample_bands)


def test_fixture_mass_ratios_within_tolerance():
    """Uniform-response fixture: integrated signals within 2%, fractions within 0.002.

    Baseline is 224; bands fill the effective 33-pixel lane width for 10 rows.
    These are synthetic signal-equivalent masses, not calibrated protein masses.
    """
    lanes = [
        {"id": "ladder", "label": "Ladder", "xStart": 0.10, "xEnd": 0.27, "isLadder": True},
        {"id": "sample", "label": "Sample", "xStart": 0.38, "xEnd": 0.55, "isLadder": False},
    ]
    result = analyze_gel({
        "imageBase64": _gel_base64(),
        "lanes": lanes,
        "sensitivity": 0.55,
    })
    sample_bands = sorted(
        [
            band
            for band in result["bands"]
            if band["laneId"] == "sample" and not band["quantificationRefused"]
        ],
        key=lambda item: float(item["centerY"]),
    )
    assert len(sample_bands) == 3
    shades = (50, 92, 135)
    signals = [(224.0 - shade) * 33 * 10 for shade in shades]
    total_signal = sum(signals)
    expected = [value / total_signal for value in signals]
    for band, target, mass in zip(sample_bands, expected, signals):
        assert band["density"] == pytest.approx(mass, rel=0.02)
        assert band["laneFraction"] == pytest.approx(target, abs=0.002)
        assert band["laneFractionUncertainty"] is not None
        assert band["laneFractionUncertainty"] >= 0.0


def test_ladder_mass_units_da_and_kda_equivalent():
    from protein_labs.gel_analysis import _apply_molecular_weights

    mobilities = [0.2, 0.4, 0.6]
    bands = [
        {
            "id": f"b{i}",
            "laneId": "ladder",
            "centerY": m,
            "quantificationRefused": False,
        }
        for i, m in enumerate(mobilities)
    ] + [
        {
            "id": "sample",
            "laneId": "sample",
            "centerY": 0.4,
            "quantificationRefused": False,
        }
    ]
    lanes = [
        {"id": "ladder", "isLadder": True},
        {"id": "sample", "isLadder": False},
    ]
    da_request = {
        "ladderMassesDa": [100_000.0, 50_000.0, 25_000.0],
    }
    kda_request = {
        "ladderMassesKDa": [100.0, 50.0, 25.0],
    }
    _apply_molecular_weights(bands, lanes, da_request)
    sample_da = next(b for b in bands if b["id"] == "sample")["molecularWeightDa"]
    for band in bands:
        band.pop("molecularWeightDa", None)
        band.pop("molecularWeightStatus", None)
        band.pop("ladderMarkerMassDa", None)
    _apply_molecular_weights(bands, lanes, kda_request)
    sample_kda = next(b for b in bands if b["id"] == "sample")["molecularWeightDa"]
    assert sample_da == pytest.approx(50_000.0, rel=0.01)
    assert sample_kda == pytest.approx(sample_da)


def test_saturated_ladder_marker_keeps_mass_assignment():
    from protein_labs.gel_analysis import _apply_molecular_weights

    bands = [
        {
            "id": "m0",
            "laneId": "ladder",
            "centerY": 0.2,
            "quantificationRefused": True,
        },
        {
            "id": "m1",
            "laneId": "ladder",
            "centerY": 0.4,
            "quantificationRefused": False,
        },
        {
            "id": "m2",
            "laneId": "ladder",
            "centerY": 0.6,
            "quantificationRefused": False,
        },
        {
            "id": "sample",
            "laneId": "sample",
            "centerY": 0.4,
            "quantificationRefused": False,
        },
    ]
    lanes = [
        {"id": "ladder", "isLadder": True},
        {"id": "sample", "isLadder": False},
    ]
    _apply_molecular_weights(
        bands,
        lanes,
        {"ladderMassesKDa": [100.0, 50.0, 25.0]},
    )
    sample = next(b for b in bands if b["id"] == "sample")
    assert sample["molecularWeightDa"] == pytest.approx(50_000.0, rel=0.01)
    assert bands[0]["ladderMarkerMassDa"] == pytest.approx(100_000.0)


def test_rolling_ball_removes_linear_ramp_background():
    from protein_labs.gel_analysis import _rolling_ball

    radius = 28
    profile = [float(index) for index in range(200)]
    background = _rolling_ball(profile, radius)
    residuals = [profile[i] - background[i] for i in range(len(profile))]
    assert max(abs(value) for value in residuals[80:120]) < 1.0


def test_sloped_background_band_integral_recovery():
    """Gaussian band on a linear ramp; rolling-ball should recover most integrated signal."""
    from protein_labs.gel_analysis import _rolling_ball

    height = 320
    ramp = [float(y) * 0.15 for y in range(height)]
    apex = 140
    sigma = 6.0
    band = [
        80.0 * math.exp(-0.5 * ((y - apex) / sigma) ** 2) for y in range(height)
    ]
    profile = [ramp[y] + band[y] for y in range(height)]
    # A wider radius is required for this broad Gaussian than the narrow boxes.
    background = _rolling_ball(profile, 120)
    corrected = [max(0.0, profile[y] - background[y]) for y in range(height)]
    recovered = sum(corrected)
    expected = sum(band)
    assert recovered == pytest.approx(expected, rel=0.05)


def _known_mw_gel(*, saturated_marker=False, missing_marker=False, light=False):
    """8-bit gel: markers 100/50/25 kDa at rows 80/160/240 on a ramp.

    Equal-width sample bands centered at 40/120/160/200/280 have known Mw
    only inside the ladder. Their signal increments are 100, width 20, height 5.
    """
    image = Image.new("L", (100, 320))
    image.putdata([240 - y // 10 for y in range(320) for _ in range(100)])
    for x0, centers in ((10, (80, 160, 240)), (60, (40, 120, 160, 200, 280))):
        for center in centers:
            if missing_marker and x0 == 10 and center == 80:
                continue
            for y in range(center - 2, center + 3):
                for x in range(x0, x0 + 20):
                    image.putpixel((x, y), 0 if saturated_marker and x0 == 10 and center == 80
                                   else 240 - y // 10 - 100)
    if light:
        from PIL import ImageOps
        image = ImageOps.invert(image)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    return {
        "imageBase64": b64encode(buffer.getvalue()).decode("ascii"),
        "lanes": [{"id": "ladder", "xStart": .08, "xEnd": .32, "isLadder": True},
                  {"id": "sample", "xStart": .58, "xEnd": .82}],
        "ladderMassesKDa": [100, 50, 25],
        "backgroundRadiusPx": 120,
    }


@pytest.mark.parametrize("light", [False, True])
def test_end_to_end_known_mw_and_integrals_on_sloped_background(light):
    result = analyze_gel(_known_mw_gel(light=light))
    assert result["polarity"] == ("light" if light else "dark")
    assert result["ladderCalibration"]["fitR2"] > .999
    samples = [b for b in result["bands"] if b["laneId"] == "sample"]
    assert len(samples) == 5
    for band, mw in zip(samples, (None, 70_710.7, 50_000, 35_355.3, None)):
        # Known signal-equivalent mass: 100 signal units * 20 columns * 5 rows.
        assert band["density"] == pytest.approx(10_000, rel=.03)
        if mw is None:
            assert band["molecularWeightDa"] is None
            assert band["molecularWeightStatus"] == "outside_ladder_range"
        else:
            assert band["molecularWeightDa"] == pytest.approx(mw, rel=.01)


@pytest.mark.parametrize("light", [False, True])
def test_end_to_end_saturated_marker_does_not_shift_masses(light):
    result = analyze_gel(_known_mw_gel(saturated_marker=True, light=light))
    assert result["ladderCalibration"]["calibrationMarkerCount"] == 2
    samples = [b for b in result["bands"] if b["laneId"] == "sample"]
    assert len(samples) == 5
    assert samples[2]["molecularWeightDa"] == pytest.approx(50_000, rel=.01)
    assert samples[1]["molecularWeightStatus"] == "outside_ladder_range"
    markers = [b for b in result["bands"] if b["laneId"] == "ladder"]
    assert [b["ladderMarkerMassDa"] for b in markers] == [100_000, 50_000, 25_000]
    assert markers[0]["density"] is None
    assert all(b["laneFraction"] is None for b in markers)


@pytest.mark.parametrize("masses", [[100, 50], [100, 50, 25, 10], []])
def test_ladder_mismatched_counts_are_refused(masses):
    request = _known_mw_gel()
    request["ladderMassesKDa"] = masses
    result = analyze_gel(request)
    assert result["ladderCalibration"]["status"] == "ladder_mass_count_mismatch"
    assert all(b["molecularWeightDa"] is None for b in result["bands"])


def test_missing_detected_marker_refuses_calibration():
    result = analyze_gel(_known_mw_gel(missing_marker=True))
    assert result["ladderCalibration"]["status"] == "ladder_mass_count_mismatch"
    assert all(b["molecularWeightDa"] is None for b in result["bands"])


@pytest.mark.parametrize("masses", [[100, 0, 25], [100, float("nan"), 25],
                                   [100, float("inf"), 25], [100, 100, 25], [25, 50, 100]])
def test_invalid_ladder_masses_rejected(masses):
    request = _known_mw_gel()
    request["ladderMassesKDa"] = masses
    with pytest.raises(ValueError, match="Ladder masses"):
        analyze_gel(request)


def test_conflicting_ladder_units_rejected():
    request = _known_mw_gel()
    request["ladderMassesDa"] = [100_000, 50_000, 25_000]
    with pytest.raises(ValueError, match="not both"):
        analyze_gel(request)


def test_full_resolution_and_processing_metadata():
    image = Image.new("L", (40, 1801), 230)
    ImageDraw.Draw(image).rectangle((8, 900, 30, 908), fill=90)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = analyze_gel({"imageBase64": b64encode(buffer.getvalue()).decode("ascii"),
                          "lanes": [{"id": "sample", "xStart": .2, "xEnd": .8}],
                          "backgroundRadiusPx": 56})
    assert result["height"] == 1801
    meta = result["quantification"]
    assert meta["imageProcessing"]["downscaled"] is False
    assert meta["imageProcessing"]["scaleFactor"] == 1
    assert meta["backgroundRadiusPx"] == 56
    assert meta["backgroundIntensityRadius"] == 56
    assert meta["linearDynamicRange"]["maxSignal"] == 254
    assert meta["caveats"]


def test_high_bit_depth_is_not_silently_clipped_to_eight_bits():
    image = Image.new("I;16", (40, 40), 1000)
    buffer = BytesIO()
    image.save(buffer, format="TIFF")
    with pytest.raises(ValueError, match="8-bit"):
        analyze_gel({"imageBase64": b64encode(buffer.getvalue()).decode("ascii")})


@pytest.mark.parametrize("light", [False, True])
def test_rgb_channel_clipping_cannot_be_hidden_by_grayscale_conversion(light):
    image = Image.new("RGB", (80, 120), (230, 230, 230))
    ImageDraw.Draw(image).rectangle((20, 50, 59, 56), fill=(0, 70, 70))
    if light:
        from PIL import ImageOps
        image = ImageOps.invert(image)
    buffer = BytesIO()
    image.save(buffer, format="PNG")
    result = analyze_gel({"imageBase64": b64encode(buffer.getvalue()).decode("ascii"),
                          "lanes": [{"id": "sample", "xStart": .25, "xEnd": .75}]})
    assert len(result["bands"]) == 1
    assert result["bands"][0]["quantificationRefused"] is True
    assert result["bands"][0]["density"] is None
    assert result["quantification"]["imageProcessing"]["sourceMode"] == "RGB"


def test_report_contract_keeps_labels_stage_binding_and_input_unchanged():
    request = _known_mw_gel()
    request["lanes"][1].update(sampleLabel="SEC pool", stageId="step-sec")
    before = json.dumps(request, sort_keys=True)
    result = analyze_gel(request)
    assert json.dumps(request, sort_keys=True) == before
    assert result["lanes"][1]["sampleLabel"] == "SEC pool"
    assert result["lanes"][1]["stageId"] == "step-sec"
    assert result["lanes"][0]["sampleLabel"] == "Lane 1"
    assert result["lanes"][0]["stageId"] is None
    for band in result["bands"]:
        assert 0 < band["densityUncertainty"] < band["density"] * .02
        assert "density_uncertainty_noise_only" in {f["code"] for f in band["flags"]}
        assert all(f["level"] in {"warning", "caution", "note"} for f in band["flags"])
        assert all(f["title"] and f["message"] for f in band["flags"])
        if band["molecularWeightStatus"] == "outside_ladder_range":
            assert "outside_ladder_range" in {f["code"] for f in band["flags"]}


def test_density_uncertainty_remains_available_for_valid_bands_in_refused_lane():
    request = _known_mw_gel(saturated_marker=True)
    result = analyze_gel(request)
    ladder = [b for b in result["bands"] if b["laneId"] == "ladder"]
    assert ladder[0]["densityUncertainty"] is None
    assert "band_saturated" in {f["code"] for f in ladder[0]["flags"]}
    for band in ladder:
        assert "lane_fraction_unavailable" in {f["code"] for f in band["flags"]}
        assert band["laneFractionUncertainty"] is None
    assert all(b["densityUncertainty"] > 0 for b in ladder[1:])
    matches = result["ladderCalibration"]["matchedBands"]
    assert [m["massKDa"] for m in matches] == [50, 25]
    assert [m["bandId"] for m in matches] == [b["id"] for b in ladder[1:]]


def test_ladder_report_residuals_have_known_sign_units_and_fit_quality():
    from protein_labs.gel_analysis import _apply_molecular_weights

    bands = [{"id": str(i), "laneId": "ladder", "centerY": m}
             for i, m in enumerate((.2, .4, .6))]
    calibration = _apply_molecular_weights(
        bands, [{"id": "ladder", "isLadder": True}], {"ladderMassesKDa": [100, 60, 25]})
    # Equal spacing: fitted middle is the geometric mean, slope is set by endpoints.
    middle = (100 * 60 * 25) ** (1 / 3)
    expected_fits = [middle * 2, middle, middle / 2]
    assert .97 < calibration["r2"] < .99
    assert calibration["residualConvention"] == "observed_minus_fitted_kDa"
    for match, mass, fit in zip(calibration["matchedBands"], (100, 60, 25), expected_fits):
        assert match["fittedKDa"] == pytest.approx(fit, abs=1e-9)
        assert match["residualKDa"] == pytest.approx(mass - fit, abs=1e-9)


def test_missing_ladder_masses_are_visible_in_report_flags():
    request = _known_mw_gel()
    del request["ladderMassesKDa"]
    result = analyze_gel(request)
    assert all(any(f["title"] == "Molecular weight unavailable" for f in b["flags"])
               for b in result["bands"])
    assert "matchedBands" not in result["ladderCalibration"]
