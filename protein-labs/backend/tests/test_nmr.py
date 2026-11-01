"""Known-answer and honesty tests for the HSQC predictor contract."""

import csv
from pathlib import Path

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
    fixture = Path(__file__).with_name("fixtures") / "nmr" / "bmrb_5387_hn_v3.1.1.61.csv"
    with fixture.open(newline="", encoding="utf-8") as stream:
        observed = list(csv.DictReader(stream))
    result = predict_hsqc({"sequence": "MQIF", "observedAssignments": observed})
    assert result["benchmark"] == {"matchedAssignments": {"H": 3, "N": 3}, "rmsePpm": {"H": 0.5119, "N": 3.6751}}


def test_command_without_input_placeholder_cannot_claim_structure_aware(monkeypatch):
    monkeypatch.setenv("PROTEIN_LABS_UCBSHIFT_COMMAND", "printf 'SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\\n1,H,8.1\\n1,N,121.0\\n'")
    result = predict_hsqc({"sequence": "A", "structureText": "ATOM"})
    assert result["predictionStatus"] == "limited_random_coil_only"
    assert result["predictor"]["id"] == "random_coil"
    assert "must include the {input} placeholder" in result["warnings"][0]


def test_external_adapter_does_not_claim_determinism_without_a_reproducibility_contract(monkeypatch):
    script = "import sys; print('SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT'); print('1,H,8.1'); print('1,N,121.0')"
    monkeypatch.setenv("PROTEIN_LABS_UCBSHIFT_COMMAND", f"python -c {script!r} {{input}}")
    result = predict_hsqc({"sequence": "A", "structureText": "ATOM"})
    assert result["predictionStatus"] == "structure_aware"
    assert result["method"]["deterministic"] is False
    assert "unknown" in result["method"]["determinismScope"]


def test_command_with_other_literal_braces_still_substitutes_input(monkeypatch):
    script = "import sys; d = {}; print('SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT'); print('1,H,8.1'); print('1,N,121.0')"
    monkeypatch.setenv("PROTEIN_LABS_UCBSHIFT_COMMAND", f"python -c {script!r} {{input}}")
    result = predict_hsqc({"sequence": "A", "structureText": "ATOM"})
    assert result["predictionStatus"] == "structure_aware"
    assert result["residues"][0]["hShiftPpm"] == 8.1
