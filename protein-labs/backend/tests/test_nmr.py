"""Known-answer and honesty tests for the HSQC predictor contract."""

from protein_labs.nmr import predict_hsqc


def test_disorder_proline_and_ligand_flags_are_explicit_and_deterministic():
    request = {"sequence": "MPSW", "disorderedPositions": [1, 3], "ligandAdjacentPositions": [4]}
    first, second = predict_hsqc(request), predict_hsqc(request)
    assert first == second
    assert first["predictionStatus"] == "limited_random_coil_only"
    assert first["residues"][1]["hasHnPeak"] is False
    assert first["residues"][0]["flags"]["collapsedAmideRegion"] is True
    assert first["residues"][3]["flags"]["ligandAdjacent"] is True
    assert first["residues"][2]["flags"]["structurePredictionUnavailable"] is False


def test_bmrb_5387_ubiquitin_assignments_report_h_and_n_rmse():
    result = predict_hsqc({"sequence": "MQIF", "observedAssignments": [
        {"sequencePosition": 2, "atomType": "H", "chemicalShiftPpm": 9.01}, {"sequencePosition": 2, "atomType": "N", "chemicalShiftPpm": 123.6},
        {"sequencePosition": 3, "atomType": "H", "chemicalShiftPpm": 8.32}, {"sequencePosition": 3, "atomType": "N", "chemicalShiftPpm": 115.0},
        {"sequencePosition": 4, "atomType": "H", "chemicalShiftPpm": 8.54}, {"sequencePosition": 4, "atomType": "N", "chemicalShiftPpm": 118.4},
    ]})
    assert result["benchmark"] == {"matchedAssignments": {"H": 3, "N": 3}, "rmsePpm": {"H": 0.5119, "N": 3.6751}}
