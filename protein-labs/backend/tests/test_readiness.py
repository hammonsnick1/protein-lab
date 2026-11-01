"""Known-answer tests for readiness structure evidence.

``fixtures/alphafold/AF-P00918-F1-v6-ca.cif`` is a C-alpha extract of the
AlphaFold DB model of human carbonic anhydrase 2 (CC BY 4.0; source and
access date in the file header).  The expected values come from the AlphaFold
DB entry API, not from this implementation: globalMetricValue 97.38 and
fractionPlddtVeryLow 0.004 (one of 260 residues below pLDDT 50).  CA2 residues
8-37 are ordered in every crystal structure (e.g. 1CA2), which is why the
readiness check must not call them disordered.
"""

import json
from http.server import ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.request import urlopen

from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    HttpClient,
    NCBIBlastClient,
    RCSBClient,
    UniProtClient,
)
from protein_labs.protein_planner.readiness import (
    choose_model,
    conservation_grades_by_construct,
    low_confidence_runs,
    model_confidence_evidence,
    model_sequence_and_plddt,
)
from protein_labs.protein_planner.service import ProteinPlanner
from protein_labs.server import ApiHandler


CA2_MODEL = (Path(__file__).parent / "fixtures" / "alphafold" / "AF-P00918-F1-v6-ca.cif").read_text()
CA2_SEQUENCE = (
    "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLG"
    "IFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK"
)
HIS_TAG = "MGSSHHHHHHSSGLVPRGSH"


def planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(
        Database(tmp_path / "planner.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
    )


def test_ca2_alphafold_model_matches_the_alphafold_db_summary():
    sequence, plddt = model_sequence_and_plddt(CA2_MODEL, "cif")
    evidence = model_confidence_evidence(CA2_SEQUENCE, sequence, plddt)

    assert sequence == CA2_SEQUENCE
    # AlphaFold DB rounds its own mean independently; agree within 0.02.
    assert abs(evidence["meanPlddt"] - 97.38) <= 0.02
    assert evidence["lowConfidenceResidueCount"] == round(0.004 * 260)
    assert evidence["lowConfidenceRegions"] == []
    assert evidence["shortLowConfidenceRuns"] == 1
    assert evidence["constructResiduesNotInModel"] == []
    assert min(plddt[7:37]) > 90


def test_tagged_truncated_construct_maps_through_the_alignment():
    sequence, plddt = model_sequence_and_plddt(CA2_MODEL, "cif")
    # N-terminal His tag plus a C-terminal truncation after CA2 residue 250.
    construct = HIS_TAG + CA2_SEQUENCE[:250]
    # Pretend model residues 249-260 were low confidence.
    plddt = plddt[:248] + [30.0] * 12

    evidence = model_confidence_evidence(construct, sequence, plddt)

    assert evidence["constructResiduesNotInModel"] == [{"start": 1, "end": len(HIS_TAG)}]
    assert evidence["mismatches"] == 0
    [region] = evidence["lowConfidenceRegions"]
    assert (region["modelStart"], region["modelEnd"], region["length"]) == (249, 260, 12)
    # Only model 249-250 are in the construct, after the 20-residue tag.
    assert (region["constructStart"], region["constructEnd"]) == (269, 270)
    assert region["meanPlddt"] == 30.0


def test_low_confidence_runs_are_inclusive_and_skip_missing_values():
    values = [80, 40, 40, None, 49.9, 50, 10]
    assert low_confidence_runs(values) == [(2, 3), (5, 5), (7, 7)]


def test_conservation_grades_align_to_the_construct_and_drop_insufficient_rows():
    rows = [
        {"position": index, "residue": residue, "grade": 9 if index % 2 else 3, "insufficientData": index == 4}
        for index, residue in enumerate(CA2_SEQUENCE[:30], 1)
    ]
    grades = conservation_grades_by_construct(HIS_TAG + CA2_SEQUENCE[:30], rows)

    assert grades[: len(HIS_TAG)] == "." * len(HIS_TAG)
    assert grades[len(HIS_TAG):][:5] == "939.9"


def test_server_model_is_preferred_over_database_models():
    models = [
        {"modelId": "AF-X-F1", "source": "AlphaFold DB", "accession": "X"},
        {"modelId": "AFS-1", "source": "AlphaFold Server", "accession": ""},
        {"modelId": "AF-P00918-F1", "source": "AlphaFold DB", "accession": "P00918"},
    ]
    assert choose_model(models, "P00918")["modelId"] == "AFS-1"
    assert choose_model(models[::2], "P00918")["modelId"] == "AF-P00918-F1"
    assert choose_model(models[:1], "") ["modelId"] == "AF-X-F1"
    assert choose_model([], "P00918") is None


def test_readiness_evidence_service_and_route(tmp_path):
    service = planner(tmp_path)
    protein_id = service.create_protein({"sequence": CA2_SEQUENCE})["protein"]["id"]

    empty = service.readiness_evidence(protein_id)
    assert empty["modelConfidence"] is None and empty["conservation"] is None

    service.database.save_alphafold_model(protein_id, {
        "modelId": "AF-P00918-F1",
        "accession": "P00918",
        "name": "Carbonic anhydrase 2",
        "source": "AlphaFold DB",
        "format": "cif",
        "structureText": CA2_MODEL,
        "metadata": {"residueCount": 260},
    })
    service.database.save_conservation_job(protein_id, {
        "source": "consurf-db",
        "status": "complete",
        "pdbId": "1CA3",
        "chain": "A",
        "residues": [{"position": i, "residue": r, "grade": 7} for i, r in enumerate(CA2_SEQUENCE, 1)],
        "metadata": {"identicalPdbId": "5Y2S", "identicalChain": "A"},
    })

    handler = type("ReadinessApiHandler", (ApiHandler,), {"planner": service})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    Thread(target=server.serve_forever, daemon=True).start()
    try:
        url = f"http://127.0.0.1:{server.server_address[1]}/v1/protein-planner/proteins/{protein_id}/readiness/evidence"
        with urlopen(url) as response:
            body = json.load(response)
    finally:
        server.shutdown()

    confidence = body["modelConfidence"]
    assert confidence["modelId"] == "AF-P00918-F1" and confidence["error"] == ""
    assert confidence["threshold"] == 50.0 and confidence["minimumRunLength"] == 10
    assert confidence["lowConfidenceRegions"] == []
    conservation = body["conservation"]
    assert conservation["identicalPdbId"] == "5Y2S"
    assert conservation["constructGrades"] == "7" * 260
    assert conservation["gradedConstructResidues"] == 260


def test_unreadable_model_fails_soft(tmp_path):
    service = planner(tmp_path)
    protein_id = service.create_protein({"sequence": CA2_SEQUENCE})["protein"]["id"]
    service.database.save_alphafold_model(protein_id, {
        "modelId": "AFS-broken", "accession": "", "name": "broken", "source": "AlphaFold Server",
        "format": "cif", "structureText": "data_empty\n", "metadata": {},
    })

    confidence = service.readiness_evidence(protein_id)["modelConfidence"]

    assert confidence["modelId"] == "AFS-broken"
    assert "C-alpha" in confidence["error"]
    assert "lowConfidenceRegions" not in confidence
