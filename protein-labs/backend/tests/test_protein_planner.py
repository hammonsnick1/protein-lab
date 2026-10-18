"""Service-level checks for the project-job catalogue."""

from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    HttpClient,
    NCBIBlastClient,
    RCSBClient,
    UniProtClient,
)
from protein_labs.protein_planner.service import ProteinPlanner

# Every job the workspace can save. Transformation and expression was missing
# from the service's accepted list, so that step failed with "Select a valid
# Protein Labs application" and could never be recorded.
WORKFLOW_APP_TYPES = [
    "protein-planner",
    "protparam",
    "database-research",
    "reference-match",
    "alphafold",
    "protein-readiness",
    "expression-system",
    "expression-planning",
    "purification-lysis",
    "purification-affinity",
    "purification-cleavage",
    "purification-subtractive",
    "purification-sec",
    "purification-buffer",
    "purification-workflow",
    "transformation-expression",
    "chromatogram-studio",
    "gel-analysis",
]


def build_planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(
        Database(tmp_path / "planner.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
    )


def test_every_workflow_job_type_can_be_saved(tmp_path):
    service = build_planner(tmp_path)
    protein = service.create_protein({"name": "Test", "sequence": "MKWVTFISLLLLFSSAYS"})
    for app_type in WORKFLOW_APP_TYPES:
        job = service.create_project_job(protein["protein"]["id"], {"appType": app_type, "config": {}})
        assert job["appType"] == app_type


def test_report_pages_keep_their_layout_data(tmp_path):
    service = build_planner(tmp_path)
    protein = service.create_protein({"name": "Test", "sequence": "MKWVTFISLLLLFSSAYS"})
    saved = service.save_project_notebook(protein["protein"]["id"], {
        "title": "Purification report",
        "summary": "",
        "sections": [{
            "title": "Affinity capture",
            "content": "Loaded 40 mL of clarified lysate.",
            "data": {"templateId": "affinity", "showFacts": True, "figures": [{"id": "f1", "jobId": "j1", "caption": "Capture trace"}]},
        }],
    })
    page = saved["sections"][0]
    assert page["data"]["templateId"] == "affinity"
    assert page["data"]["figures"][0]["caption"] == "Capture trace"


def test_vector_catalogue_records_every_project_that_uses_a_vector(tmp_path):
    service = build_planner(tmp_path)
    first = service.create_protein({"name": "Project A", "sequence": "MKWVTFISLLLLFSSAYS"})["protein"]
    second = service.create_protein({"name": "Project B", "sequence": "MKWVTFISLLLLFSSAYS"})["protein"]
    sequence = "ATG" + "GCT" * 40 + "TAA"

    service.save_expression_vector(first["id"], {
        "name": "pET-28a(+) — target CDS",
        "sequence": sequence,
        "features": [{"name": "Target CDS", "type": "CDS", "start": 0, "end": 123, "isInsert": True}],
    })
    catalogue = [
        vector for vector in service.list_library_vectors()
        if not vector["isStandard"]
    ]
    assert len(catalogue) == 1
    assert catalogue[0]["insertName"] == "Target CDS"
    assert [use["proteinName"] for use in catalogue[0]["projects"]] == ["Project A"]

    # The same construct saved in another project joins the existing entry.
    service.save_expression_vector(second["id"], {
        "name": "pET-28a(+) — target CDS",
        "sequence": sequence,
        "features": [],
    })
    catalogue = [
        vector for vector in service.list_library_vectors()
        if not vector["isStandard"]
    ]
    assert len(catalogue) == 1
    assert catalogue[0]["projectCount"] == 2
    assert sorted(use["proteinName"] for use in catalogue[0]["projects"]) == ["Project A", "Project B"]


def test_copying_a_catalogued_vector_into_a_project_records_the_use(tmp_path):
    service = build_planner(tmp_path)
    source = service.create_protein({"name": "Source", "sequence": "MKWVTFISLLLLFSSAYS"})["protein"]
    target = service.create_protein({"name": "Target", "sequence": "MKWVTFISLLLLFSSAYS"})["protein"]
    service.save_expression_vector(source["id"], {"name": "pUC19", "sequence": "ATGC" * 60})
    entry = next(
        vector for vector in service.list_library_vectors()
        if not vector["isStandard"]
    )

    copied = service.copy_library_vector(target["id"], entry["id"])
    assert copied["name"] == "pUC19"
    assert [v["name"] for v in service.list_expression_vectors(target["id"])] == ["pUC19"]
    assert service.get_library_vector(entry["id"])["projectCount"] == 2
