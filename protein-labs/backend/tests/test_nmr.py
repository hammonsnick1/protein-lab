"""Known-answer and honesty tests for the HSQC predictor contract."""

import csv
from pathlib import Path

from protein_labs.nmr import BACKBONE_RMSE_PPM, PREDICTOR_DETAILS, predict_hsqc


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
    assert result["benchmark"] == {"matchedAssignments": {"H": 3, "N": 3}, "rmsePpm": {"H": 0.4605, "N": 3.7443}}


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


def test_random_coil_fallback_uses_wishart_1995_per_residue_table():
    # Wishart et al. 1995 (doi:10.1007/BF00227471), Ac-GGXAGG-NH2 amide H / N in ppm.
    published = {"A": (8.24, 123.8), "G": (8.33, 108.8), "S": (8.31, 115.7), "T": (8.15, 113.6), "I": (8.00, 119.9), "E": (8.42, 120.2), "W": (8.25, 121.3)}
    sequence = "".join(published)
    result = predict_hsqc({"sequence": sequence})
    assert {row["residue"]: (row["hShiftPpm"], row["nShiftPpm"]) for row in result["residues"]} == published
    every = predict_hsqc({"sequence": "ACDEFGHIKLMNQRSTVWY"})["residues"]
    assert len({(row["hShiftPpm"], row["nShiftPpm"]) for row in every}) == 19


def test_residue_before_proline_uses_wishart_ggxpgg_set():
    residues = predict_hsqc({"sequence": "APA"})["residues"]
    assert (residues[0]["hShiftPpm"], residues[0]["nShiftPpm"]) == (8.19, 125.0)
    assert residues[1]["hasHnPeak"] is False and residues[1]["hShiftPpm"] is None
    assert (residues[2]["hShiftPpm"], residues[2]["nShiftPpm"]) == (8.24, 123.8)


def test_random_coil_reference_cites_the_wishart_1995_doi():
    assert "doi:10.1007/BF00227471" in PREDICTOR_DETAILS["random_coil"]["reference"]


def test_shiftx2_reference_names_han_2011_not_neal_2003_shiftx():
    # Han B, Liu Y, Ginzinger SW, Wishart DS, J Biomol NMR 50:43-57 (2011).
    assert PREDICTOR_DETAILS["shiftx2"]["reference"].startswith("Han et al., J Biomol NMR (2011)")
    assert "doi:10.1007/s10858-011-9478-4" in PREDICTOR_DETAILS["shiftx2"]["reference"]


def test_published_backbone_rmse_matches_the_papers():
    # UCBShift 1.0 backbone model (kept by 2.0): Li et al., Chem Sci 11:3180 (2020)
    # abstract, H 0.31 / N 1.81 ppm. SHIFTX2 abstract: 1HN 0.1711 / 15N 1.1169 ppm.
    assert BACKBONE_RMSE_PPM["ucbshift2"] == {"H": 0.31, "N": 1.81}
    assert BACKBONE_RMSE_PPM["shiftx2"] == {"H": 0.17, "N": 1.12}


def _predictor(monkeypatch, csv_text):
    lines = "; ".join(f"print({line!r})" for line in csv_text.strip().splitlines())
    monkeypatch.setenv("PROTEIN_LABS_UCBSHIFT_COMMAND", f"python -c {('import sys; ' + lines)!r} {{input}}")


def _mapping(chain, start, length, first_position=1, codes=None):
    codes = codes or {}
    return [{"chainId": chain, "authSeqId": str(start + index), "insertionCode": codes.get(index), "constructPosition": first_position + index, "modeled": True} for index in range(length)]


def test_predictor_output_is_renumbered_from_author_numbering_to_construct_positions(monkeypatch):
    # The PDB file numbers the construct's residues 1-3 as A101-A103.
    _predictor(monkeypatch, "CHAIN,SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\nA,101,H,8.9\nA,101,N,125.1\nA,103,H,7.6\nA,103,N,112.4\nA,103,ND2,111.0\nA,250,H,8.0")
    result = predict_hsqc({"sequence": "MKN", "structureText": "ATOM", "residueMapping": _mapping("A", 101, 3)})
    rows = result["residues"]
    assert (rows[0]["hShiftPpm"], rows[0]["nShiftPpm"]) == (8.9, 125.1)
    assert rows[1]["hShiftPpm"] is None
    assert (rows[2]["hShiftPpm"], rows[2]["nShiftPpm"]) == (7.6, 112.4)
    assert result["sideChainPeaks"] == [{"sequencePosition": 3, "atomType": "ND2", "chemicalShiftPpm": 111.0}]
    assert result["method"]["predictorNumbering"] == "renumbered_from_residue_mapping"
    assert any("1 predicted structure residue(s) have no construct position" in warning for warning in result["warnings"])


def test_renumbering_handles_insertion_codes_and_unchained_homodimers(monkeypatch):
    # Construct 1-3 is author 52, 52A, 53 on both chains of a homodimer; the predictor gives no chain column.
    mapping = _mapping("A", 52, 3, codes={1: "A"}) + _mapping("B", 52, 3, codes={1: "A"})
    for item in mapping:
        if item["insertionCode"]:
            item["authSeqId"] = "52"
        elif item["constructPosition"] == 3:
            item["authSeqId"] = "53"
    _predictor(monkeypatch, "SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\n52,H,8.5\n52A,H,8.7\n53,H,7.9")
    rows = predict_hsqc({"sequence": "GSA", "structureText": "ATOM", "residueMapping": mapping})["residues"]
    assert [row["hShiftPpm"] for row in rows] == [8.5, 8.7, 7.9]


def test_renumbering_keeps_the_first_chain_when_both_copies_are_predicted(monkeypatch):
    mapping = _mapping("A", 10, 1) + _mapping("B", 10, 1)
    _predictor(monkeypatch, "CHAIN,SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\nA,10,H,8.5\nB,10,H,8.6")
    result = predict_hsqc({"sequence": "G", "structureText": "ATOM", "residueMapping": mapping})
    assert result["residues"][0]["hShiftPpm"] == 8.5
    assert any("more than one chain" in warning for warning in result["warnings"])


def test_renumbering_keeps_the_first_copy_when_unchained_rows_repeat_a_position(monkeypatch):
    mapping = _mapping("A", 10, 1) + _mapping("B", 10, 1)
    _predictor(monkeypatch, "SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\n10,H,8.5\n10,N,118.0\n10,HN,8.6\n10,N,119.0")
    result = predict_hsqc({"sequence": "G", "structureText": "ATOM", "residueMapping": mapping})
    assert (result["residues"][0]["hShiftPpm"], result["residues"][0]["nShiftPpm"]) == (8.5, 118.0)
    assert any("more than one chain" in warning for warning in result["warnings"])


def test_without_residue_mapping_seq_id_is_still_the_construct_position(monkeypatch):
    _predictor(monkeypatch, "SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT\n2,H,8.8")
    result = predict_hsqc({"sequence": "GS", "structureText": "ATOM"})
    assert [row["hShiftPpm"] for row in result["residues"]] == [None, 8.8]
    assert result["method"]["predictorNumbering"] == "seq_id_is_construct_position"
