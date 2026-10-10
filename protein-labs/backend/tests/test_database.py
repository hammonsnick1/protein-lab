import json
from pathlib import Path
import zipfile

from protein_labs import expression_planner
from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import HttpClient, NCBIBlastClient, RCSBClient, UniProtClient
from protein_labs.protein_planner.service import ProteinPlanner


ALPHAFOLD_CIF = """data_AF-TEST-F1
loop_
_atom_site.group_PDB
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.label_comp_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.B_iso_or_equiv
ATOM CA . A 1 ALA 1.0 2.0 3.0 95.0
ATOM CA . A 2 CYS 2.0 2.5 3.4 82.0
"""


def planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(
        Database(tmp_path / "planner.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
    )


def test_create_update_and_delete_protein(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({
        "name": "Test construct",
        "sequence": "MKWVTFISLLFLFSSAYS",
        "organism": "Homo sapiens",
        "notes": "Expression trial A",
        "tags": ["secreted"],
    })
    protein_id = created["protein"]["id"]
    assert created["protparam"]["result"]["sequence"]["length"] == 18
    assert created["protein"]["tags"] == ["secreted"]

    updated = service.update_protein(protein_id, {"name": "Test construct v2"})
    assert updated["protein"]["name"] == "Test construct v2"
    assert len(service.database.list_proteins()) == 1

    service.database.delete_protein(protein_id)
    assert service.database.list_proteins() == []


def test_sequence_update_recalculates_protparam(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "A", "sequence": "AAAA"})
    protein_id = created["protein"]["id"]
    updated = service.update_protein(protein_id, {"sequence": "AAAAAA"})
    assert updated["protparam"]["result"]["sequence"]["length"] == 6


def test_exact_uniprot_sequence_matching_needs_no_metadata(tmp_path):
    sequence = "ACDEFGHIK"

    class FakeUniProt:
        def search(self, query, size=10):
            assert query.startswith("checksum:")
            assert size == 25
            return [
                {"accession": "P12345", "sequence": {"value": sequence}},
                {"accession": "Q99999", "sequence": {"value": "AAAAAAAAA"}},
            ]

    service = planner(tmp_path)
    service.uniprot = FakeUniProt()
    created = service.create_protein({"sequence": sequence})
    protein_id = created["protein"]["id"]

    matches = service.match_uniprot_sequence(protein_id)
    bundle = service.database.get_bundle(protein_id)

    assert [match["accession"] for match in matches] == ["P12345"]
    assert bundle["uniprotMatches"][0]["source"] == "UniProt exact sequence"
    assert bundle["uniprotMatches"][0]["identity"] == 1.0


def test_approximate_uniprot_sequence_matching_saves_alignment_metrics(tmp_path):
    sequence = "VHLSAEEKEAVLGLWGKVNVDEVG"

    class FakeUniProt:
        def search(self, query, size=10):
            assert query.startswith("checksum:")
            return []

        def find_sequence_matches(self, query_sequence, size=25, hint=""):
            assert query_sequence == sequence
            assert hint == "hemoglobin"
            return [{
                "accession": "P02067",
                "sequence": {"value": f"M{sequence}"},
                "sequenceMatch": {"identity": 1.0, "queryCoverage": 1.0},
            }]

    service = planner(tmp_path)
    service.uniprot = FakeUniProt()
    created = service.create_protein({"name": "hemoglobin", "sequence": sequence})
    protein_id = created["protein"]["id"]

    matches = service.match_uniprot_sequence(protein_id)
    saved = service.database.get_bundle(protein_id)["uniprotMatches"][0]

    assert matches[0]["accession"] == "P02067"
    assert saved["source"] == "UniProt peptide-assisted sequence match"
    assert saved["identity"] == 1.0
    assert saved["queryCoverage"] == 1.0


def test_uniprot_one_click_uses_rcsb_cross_reference_when_direct_search_is_empty(tmp_path):
    sequence = "GAMDNQRQYPRTPLKCRIRISHPLFGELMAQTRDLSDTGVYVKHPDLTQLPTGSVVTGQVQDLPIDAPILQMEVVRVDAEGVGLRFLSEA"

    class FakeUniProt:
        def search(self, query, size=10):
            return []

        def find_sequence_matches(self, query_sequence, size=25, hint=""):
            return []

        def fetch(self, accession):
            assert accession == "Q9I7B4"
            return {"accession": accession, "sequence": {"value": sequence}}

    class FakeRCSB:
        def search_sequence(self, query_sequence, **kwargs):
            assert query_sequence == sequence
            return [{
                "pdbId": "8U0I",
                "entityId": "1",
                "identity": 1.0,
                "evalue": 0.0,
                "uniprotIds": ["Q9I7B4"],
            }]

    service = planner(tmp_path)
    service.uniprot = FakeUniProt()
    service.rcsb = FakeRCSB()
    protein_id = service.create_protein({"name": "8U0I", "sequence": sequence})["protein"]["id"]

    matches = service.match_uniprot_sequence(protein_id)

    assert matches[0]["accession"] == "Q9I7B4"
    saved = service.database.get_bundle(protein_id)["uniprotMatches"][0]
    assert saved["source"] == "RCSB PDB UniProt cross-reference"
    assert saved["identity"] == 1.0


def test_blast_job_progress_and_local_cancellation(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"sequence": "ACDEFGHIK"})
    protein_id = created["protein"]["id"]
    service.database.save_blast_job(
        protein_id,
        "TEST-RID",
        "waiting",
        {"database": "swissprot", "hitlistSize": 25, "purpose": "uniprot"},
    )

    waiting = service.database.get_blast_job("TEST-RID")
    assert waiting["canCancel"] is True
    assert waiting["progress"] is None
    assert "UniProt" in waiting["stage"]

    canceled = service.cancel_blast("TEST-RID")
    assert canceled["status"] == "canceled"
    assert canceled["stage"] == "Terminated locally"
    assert canceled["canCancel"] is False
    assert service.poll_blast("TEST-RID")["status"] == "canceled"


def test_new_search_supersedes_only_matching_waiting_purpose(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"sequence": "ACDEFGHIK"})
    protein_id = created["protein"]["id"]
    for rid, purpose in (
        ("OLD-BLAST", "blast"),
        ("OLD-UNIPROT", "uniprot"),
        ("NEW-BLAST", "blast"),
    ):
        service.database.save_blast_job(
            protein_id,
            rid,
            "waiting",
            {"database": "swissprot", "purpose": purpose},
        )

    service.database.cancel_superseded_blast_jobs(
        protein_id, "NEW-BLAST", "blast"
    )

    assert service.database.get_blast_job("OLD-BLAST")["status"] == "canceled"
    assert service.database.get_blast_job("NEW-BLAST")["status"] == "waiting"
    assert service.database.get_blast_job("OLD-UNIPROT")["status"] == "waiting"


def test_completed_blast_batch_imports_uniprot_hits(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"sequence": "ACDEFGHIK"})
    protein_id = created["protein"]["id"]
    service.database.save_blast_job(
        protein_id,
        "EBI-RID",
        "waiting",
        {"provider": "ebi-ncbiblast", "purpose": "blast"},
    )

    class FakeBlast:
        def poll(self, rid):
            return {
                "rid": rid,
                "status": "complete",
                "results": [{
                    "uniprotAccession": "P02067",
                    "identity": 0.993,
                    "queryCoverage": 1.0,
                    "evalue": 9e-104,
                }],
            }

    class FakeUniProt:
        def fetch_many(self, accessions):
            assert accessions == ["P02067"]
            return [{"accession": "P02067", "sequence": {"value": "ACD"}}]

    service.blast = FakeBlast()
    service.uniprot = FakeUniProt()
    completed = service.poll_blast("EBI-RID")
    saved = service.database.get_bundle(protein_id)["uniprotMatches"]

    assert completed["status"] == "complete"
    assert completed["results"][0]["uniprotAccession"] == "P02067"
    assert saved[0]["accession"] == "P02067"
    assert saved[0]["identity"] == 0.993


def test_prepare_and_import_alphafold_server_result(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Test protein", "sequence": "AC"})
    protein_id = created["protein"]["id"]

    submission = service.prepare_alphafold_server_job(protein_id)
    job = json.loads(Path(submission["submissionPath"]).read_text())
    assert job[0]["dialect"] == "alphafoldserver"
    assert job[0]["sequences"][0]["proteinChain"]["sequence"] == "AC"

    archive_path = tmp_path / "alphafold_result.zip"
    with zipfile.ZipFile(archive_path, "w") as archive:
        archive.writestr("test_model.cif", ALPHAFOLD_CIF)
        archive.writestr(
            "test_summary_confidences_0.json",
            json.dumps({"ranking_score": 0.91, "ptm": 0.88}),
        )
    imported = service.import_alphafold_result(protein_id, str(archive_path))
    loaded = service.get_alphafold_model(protein_id, imported["modelId"])

    assert imported["source"] == "AlphaFold Server"
    assert loaded["geometry"]["residueCount"] == 2
    assert loaded["geometry"]["meanPlddt"] == 88.5
    assert loaded["geometry"]["format"] == "cif"
    assert loaded["geometry"]["structureText"].startswith("data_AF-TEST-F1")
    assert (
        service.database.get_bundle(protein_id)["alphaFoldModels"][0]["modelId"]
        == imported["modelId"]
    )
    project_summary = service.database.list_proteins()[0]
    assert project_summary["alphaFoldModel"]["modelId"] == imported["modelId"]


def test_project_jobs_are_saved_in_the_protein_bundle(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Workflow", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]

    job = service.create_project_job(
        protein_id,
        {"name": "Predict construct", "appType": "alphafold"},
    )
    bundle = service.database.get_bundle(protein_id)

    assert job["status"] == "ready"
    assert job["appType"] == "alphafold"
    assert bundle["projectJobs"][0]["name"] == "Predict construct"


def test_project_job_configuration_can_be_completed_and_updated(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Expression", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    job = service.create_project_job(
        protein_id,
        {"name": "Choose expression system", "appType": "expression-system"},
    )

    updated = service.update_project_job(
        protein_id,
        job["id"],
        {
            "status": "complete",
            "config": {
                "hostSystem": "E. coli",
                "strainId": "bl21-de3",
                "strainName": "BL21(DE3)",
            },
        },
    )
    saved = service.database.get_bundle(protein_id)["projectJobs"][0]

    assert updated["status"] == "complete"
    assert saved["config"]["strainId"] == "bl21-de3"


def test_project_job_can_be_deleted_without_deleting_its_protein(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Editable tree", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    job = service.create_project_job(
        protein_id,
        {"name": "Temporary analysis", "appType": "database-research"},
    )

    service.delete_project_job(protein_id, job["id"])

    bundle = service.database.get_bundle(protein_id)
    assert bundle["protein"]["id"] == protein_id
    assert bundle["projectJobs"] == []


def test_purification_planner_job_types_are_persistent(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Purification", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]

    job_types = [
        "reference-match",
        "protein-readiness",
        "purification-lysis",
        "purification-affinity",
        "purification-cleavage",
        "purification-subtractive",
        "purification-sec",
        "purification-buffer",
        "purification-workflow",
    ]
    jobs = [
        service.create_project_job(protein_id, {"appType": app_type})
        for app_type in job_types
    ]

    assert [job["appType"] for job in jobs] == job_types
    assert [job["appType"] for job in service.database.get_bundle(protein_id)["projectJobs"]] == job_types


def test_project_notebook_is_saved_with_section_provenance(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Notebook", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]

    notebook = service.save_project_notebook(
        protein_id,
        {
            "title": "Notebook purification report",
            "summary": "A reproducible purification record.",
            "sections": [
                {
                    "id": "section-1",
                    "type": "job-result",
                    "title": "SEC analysis",
                    "content": "Main peak: 12.9 mL",
                    "sourceJobId": "job-1",
                    "sourceAppType": "chromatogram-studio",
                    "sourceLabel": "Analytical SEC",
                    "capturedAt": "2026-09-16T12:00:00+00:00",
                }
            ],
        },
    )
    bundle = service.database.get_bundle(protein_id)

    assert notebook["sections"][0]["sourceJobId"] == "job-1"
    assert bundle["projectNotebook"]["title"] == "Notebook purification report"
    assert bundle["projectNotebook"]["sections"][0]["content"] == "Main peak: 12.9 mL"


def test_expression_vector_round_trip_and_opencloning_history(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Vector project", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]

    vector = service.save_expression_vector(
        protein_id,
        {
            "name": "pProteinLabs",
            "sequence": "ATGGAATTCTAA",
            "circular": True,
            "features": [
                {
                    "id": "cds-1",
                    "name": "protein coding sequence",
                    "type": "CDS",
                    "start": 0,
                    "end": 12,
                    "strand": 1,
                    "color": "#43A047",
                    "notes": "Verified construct",
                    "qualifiers": {"gene": ["protein_labs"], "codon_start": ["1"]},
                }
            ],
        },
    )
    vectors = service.list_expression_vectors(protein_id)
    exported = service.export_expression_vector(
        protein_id, vector["id"], "genbank"
    )

    assert vectors[0]["name"] == "pProteinLabs"
    assert vectors[0]["history"][0]["type"] == "ManuallyTypedSource"
    assert any(site["enzyme"] == "EcoRI" for site in vector["restrictionSites"])
    assert "LOCUS" in exported["content"]
    assert "protein coding sequence" in exported["content"]
    assert "/gene=\"protein_labs\"" in exported["content"]
    assert "Verified construct" in exported["content"]


def test_expression_vector_imports_fasta(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Import", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]

    vector = service.import_expression_vector(
        protein_id, "backbone.fasta", ">backbone\nATGCGTGAATTC\n"
    )

    assert vector["name"] == "backbone"
    assert vector["sequence"] == "ATGCGTGAATTC"
    assert vector["history"][0]["type"] == "UploadedFileSource"


def test_expression_vector_auto_annotation_finds_motifs_tags_and_orfs(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Annotate", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    coding = "ATG" + "CAT" * 6 + "GCT" * 6 + "TAA"
    vector = service.save_expression_vector(
        protein_id,
        {
            "name": "Auto annotation",
            "sequence": "TAATACGACTCACTATAGGG" + coding,
            "minimumOrfAminoAcids": 5,
        },
    )

    annotated = service.auto_annotate_expression_vector(
        protein_id,
        vector["id"],
        {"minimumOrfAminoAcids": 5, "includeOrfs": True},
    )
    names = [feature["name"] for feature in annotated["features"]]

    assert "T7 promoter" in names
    assert "6xHis tag" in names
    assert any(name.startswith("ORF ") for name in names)
    assert annotated["annotationReport"]["added"] >= 3


def test_plannotate_sidecar_contract_imports_returned_genbank(monkeypatch):
    annotated_genbank = expression_planner.export_sequence(
        {
            "name": "sidecar result",
            "sequence": "ATGCGTGAATTC",
            "circular": True,
            "features": [
                {
                    "name": "ColE1 origin",
                    "type": "rep_origin",
                    "start": 0,
                    "end": 12,
                    "strand": 1,
                    "notes": "pLannotate database match",
                    "qualifiers": {"database": ["snapgene"], "identity": ["99.8"]},
                }
            ],
        },
        "genbank",
    )
    captured = {}

    class FakeResponse:
        def __enter__(self):
            return self

        def __exit__(self, *_):
            return False

        def read(self):
            return json.dumps(
                {"version": "1.2.2", "gb_file": annotated_genbank, "report": [{"Feature": "ColE1 origin"}]}
            ).encode()

    def fake_urlopen(request, timeout):
        captured["url"] = request.full_url
        captured["contentType"] = request.headers["Content-type"]
        captured["body"] = request.data
        captured["timeout"] = timeout
        return FakeResponse()

    monkeypatch.setattr(expression_planner, "urlopen", fake_urlopen)
    result = expression_planner.annotate_with_plannotate(
        {
            "name": "input vector",
            "sequence": "ATGCGTGAATTC",
            "circular": True,
            "features": [],
        },
        "http://127.0.0.1:9876",
        timeout=12,
    )

    assert captured["url"] == "http://127.0.0.1:9876/annotate"
    assert captured["contentType"].startswith("multipart/form-data; boundary=")
    assert b'name="file"' in captured["body"]
    assert captured["timeout"] == 12
    assert result["version"] == "1.2.2"
    assert result["features"][0]["name"] == "ColE1 origin"
    assert result["features"][0]["qualifiers"]["database"] == ["snapgene"]


def test_expression_vector_designs_primers_and_tracks_sequence_edits(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Primers", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    vector = service.save_expression_vector(
        protein_id,
        {
            "name": "PCR vector",
            "sequence": "ATGCGTACGTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAGCTAA",
            "features": [
                {
                    "name": "insert",
                    "type": "CDS",
                    "start": 3,
                    "end": 30,
                }
            ],
        },
    )

    designed = service.design_expression_primers(
        protein_id,
        vector["id"],
        {"name": "Insert PCR", "start": 3, "end": 40, "primerLength": 18},
    )
    edited = service.edit_expression_vector_sequence(
        protein_id,
        vector["id"],
        {"operation": "insert", "start": 3, "end": 3, "replacement": "GGG"},
    )

    assert len(designed["primers"]) == 2
    assert designed["primers"][0]["tmCelsius"] > 0
    assert edited["sequence"].startswith("ATGGGG")
    assert edited["features"][0]["start"] == 6
    assert edited["history"][-1]["type"] == "SequenceEditSource"


def test_expression_vector_simulates_linear_and_circular_digests(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Digest", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    linear = service.save_expression_vector(
        protein_id,
        {
            "name": "Digest substrate",
            "sequence": "AAAAGAATTCTTTGAATTCA",
            "circular": False,
        },
    )

    linear_result = service.digest_expression_vector(
        protein_id, linear["id"], {"enzymeNames": ["EcoRI"]}
    )
    circular = service.save_expression_vector(
        protein_id, {**linear, "circular": True}, linear["id"]
    )
    circular_result = service.digest_expression_vector(
        protein_id, circular["id"], {"enzymeNames": ["EcoRI"]}
    )

    assert linear_result["cutCount"] == 2
    assert sum(fragment["length"] for fragment in linear_result["fragments"]) == 20
    assert sorted(fragment["length"] for fragment in linear_result["fragments"]) == [5, 6, 9]
    assert sorted(fragment["length"] for fragment in circular_result["fragments"]) == [9, 11]


def test_expression_vector_alignment_reports_identity_mismatches_and_gaps(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Alignment", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    reference = service.save_expression_vector(
        protein_id, {"name": "Reference", "sequence": "ACGTACGT"}
    )
    query = service.save_expression_vector(
        protein_id, {"name": "Variant", "sequence": "ACGTCGT"}
    )

    result = service.align_expression_vectors(
        protein_id, reference["id"], {"queryVectorId": query["id"]}
    )

    assert result["matches"] == 7
    assert result["gaps"] == 1
    assert result["mismatches"] == 0
    assert result["identityPercent"] == 87.5
    assert len(result["referenceAligned"]) == len(result["queryAligned"])


def test_expression_vector_overlap_assembly_creates_annotated_product(tmp_path):
    service = planner(tmp_path)
    created = service.create_protein({"name": "Assembly", "sequence": "ACDE"})
    protein_id = created["protein"]["id"]
    left = service.save_expression_vector(
        protein_id,
        {
            "name": "Left",
            "sequence": "TTTTAAAACCCC",
            "features": [{"name": "left feature", "type": "CDS", "start": 0, "end": 4}],
        },
    )
    right = service.save_expression_vector(
        protein_id,
        {
            "name": "Right",
            "sequence": "AAAACCCCGGGG",
            "features": [{"name": "right feature", "type": "CDS", "start": 8, "end": 12}],
        },
    )

    product = service.assemble_expression_vectors(
        protein_id,
        {
            "name": "Gibson product",
            "vectorIds": [left["id"], right["id"]],
            "minimumOverlap": 8,
            "circular": False,
        },
    )

    assert product["sequence"] == "TTTTAAAACCCCGGGG"
    assert [feature["name"] for feature in product["features"]] == [
        "left feature",
        "right feature",
    ]
    assert product["features"][1]["start"] == 12
    assert product["history"][0]["type"] == "AssemblySource"
