"""Vector Workbench: project-free parsing, export, analysis and library saves."""

from __future__ import annotations

from tests.test_vector_catalogue import catalogue_api, planner, snapgene_base64  # noqa: F401

# A small circular plasmid with an EcoRI site, a BamHI site and a 61-aa ORF (Met + 60 Ala).
ORF = "ATG" + "GCT" * 60 + "TAA"
PLASMID = "GAATTC" + "AAACCCGGGTTT" * 3 + ORF + "GGATCC" + "TTTAAACCCGGG" * 4
FEATURES = [
    {"name": "Test CDS", "type": "CDS", "start": 42, "end": 42 + len(ORF), "strand": 1, "notes": "made up"},
    {"name": "wrap", "type": "misc_feature", "start": len(PLASMID) - 6, "end": 6, "strand": -1},
]
VECTOR = {"name": "pTest", "sequence": PLASMID, "circular": True, "features": FEATURES}


def summary(vector):
    return {
        "sequence": vector["sequence"],
        "circular": vector["circular"],
        "features": sorted(
            (f["name"], f["type"], f["start"], f["end"], f["strand"]) for f in vector["features"]
        ),
    }


def test_genbank_and_snapgene_round_trip_keep_sequence_and_features(catalogue_api):
    _, request = catalogue_api
    for file_format in ("genbank", "snapgene"):
        status, exported = request("POST", "/v1/vector-workbench/export", {"vector": VECTOR, "format": file_format})
        assert status == 200, exported
        assert exported["filename"] == f"pTest.{'gb' if file_format == 'genbank' else 'dna'}"
        assert exported["encoding"] == ("base64" if file_format == "snapgene" else "text")
        status, parsed = request("POST", "/v1/vector-workbench/parse", {"filename": exported["filename"], "content": exported["content"]})
        assert status == 200, parsed
        assert parsed["fileFormat"] == file_format
        assert summary(parsed) == summary({**VECTOR, "features": FEATURES})
        assert parsed["features"][0]["notes"] == "made up"


def test_fasta_round_trip_keeps_sequence(catalogue_api):
    _, request = catalogue_api
    status, exported = request("POST", "/v1/vector-workbench/export", {"vector": VECTOR, "format": "fasta"})
    assert status == 200
    assert exported["content"].startswith(">pTest")
    status, parsed = request("POST", "/v1/vector-workbench/parse", {"filename": "x.fasta", "content": exported["content"]})
    assert status == 200
    assert parsed["sequence"] == PLASMID
    assert parsed["features"] == []


def test_parse_reads_snapgene_dna_files(catalogue_api):
    _, request = catalogue_api
    status, parsed = request("POST", "/v1/vector-workbench/parse", {"filename": "tiny.dna", "content": snapgene_base64("ATGAAATAAGGGCCC")})
    assert status == 200
    assert parsed["sequence"] == "ATGAAATAAGGGCCC"
    assert parsed["circular"] is True
    assert parsed["features"][0]["name"] == "Test CDS"


def test_parse_and_export_reject_bad_input(catalogue_api):
    _, request = catalogue_api
    status, error = request("POST", "/v1/vector-workbench/parse", {"filename": "bad.gb", "content": "not a genbank file"})
    assert status == 400 and "genbank" in error["error"]
    status, error = request("POST", "/v1/vector-workbench/export", {"vector": {**VECTOR, "features": [{"start": 5, "end": 99999}]}, "format": "genbank"})
    assert status == 400
    status, error = request("POST", "/v1/vector-workbench/export", {"vector": VECTOR, "format": "pdf"})
    assert status == 400


def test_analyze_finds_sites_and_orfs_without_a_project(catalogue_api):
    _, request = catalogue_api
    status, result = request("POST", "/v1/vector-workbench/analyze", {"sequence": PLASMID, "circular": True, "minimumOrfAminoAcids": 50})
    assert status == 200
    enzymes = {site["enzyme"]: site["cutCount"] for site in result["restrictionSites"]}
    assert enzymes["EcoRI"] == 1 and enzymes["BamHI"] == 1
    assert enzymes["SmaI"] == 7
    assert any(orf["aminoAcids"] == 61 and orf["start"] == 42 for orf in result["orfs"])


def test_save_to_library_as_new_and_overwrite(catalogue_api):
    service, request = catalogue_api
    status, created = request("POST", "/v1/protein-planner/vector-library", VECTOR)
    assert status == 201
    assert created["sequence"] == PLASMID and created["origin"] == "import"
    # Saving the same sequence again still makes a second entry.
    status, again = request("POST", "/v1/protein-planner/vector-library", {**VECTOR, "name": "pTest again"})
    assert status == 201 and again["id"] != created["id"]

    edited = {**VECTOR, "name": "pTest v2", "sequence": PLASMID + "ACGT", "circular": False, "features": FEATURES[:1]}
    status, replaced = request("POST", f"/v1/protein-planner/vector-library/{created['id']}/contents", edited)
    assert status == 200
    assert replaced["id"] == created["id"]
    assert replaced["name"] == "pTest v2" and replaced["sequence"].endswith("ACGT") and replaced["circular"] is False
    assert [f["name"] for f in replaced["features"]] == ["Test CDS"]
    # Overwriting to a sequence another entry already holds does not collide.
    status, _ = request("POST", f"/v1/protein-planner/vector-library/{created['id']}/contents", {**VECTOR, "name": "pTest twin"})
    assert status == 200

    standard = next(item for item in service.list_library_vectors() if item["isStandard"])
    status, error = request("POST", f"/v1/protein-planner/vector-library/{standard['id']}/contents", VECTOR)
    assert status == 403 and error["error"] == "read_only"
    status, _ = request("POST", "/v1/protein-planner/vector-library/missing/contents", VECTOR)
    assert status == 404

