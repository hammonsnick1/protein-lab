"""Regression and known-answer tests for the expression-vector catalogue."""

from protein_labs.server import parse_vector_library_search
from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    HttpClient,
    NCBIBlastClient,
    RCSBClient,
    UniProtClient,
)
from protein_labs.protein_planner.service import ProteinPlanner


def planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(
        Database(tmp_path / "planner.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
    )


def project(service, name="Vector project"):
    return service.create_protein({"name": name, "sequence": "ACDE"})["protein"]


def test_edit_keeps_source_catalogue_link_without_creating_a_version(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    original_sequence = "ATG" + "GCT" * 20 + "TAA"
    created = service.save_expression_vector(protein["id"], {
        "name": "Stable source",
        "sequence": original_sequence,
    })
    source_id = created["libraryId"]
    before_ids = {item["id"] for item in service.list_library_vectors()}

    edited = service.save_expression_vector(protein["id"], {
        **created,
        "sequence": original_sequence[:-3] + "GGT" + "TAA",
    }, created["id"])

    assert edited["libraryId"] == source_id
    assert {item["id"] for item in service.list_library_vectors()} == before_ids
    assert service.get_library_vector(source_id)["sequence"] == original_sequence


def test_deleting_project_vector_removes_its_catalogue_usage(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    vector = service.save_expression_vector(protein["id"], {
        "name": "Disposable project copy",
        "sequence": "ATG" + "GAA" * 20 + "TAA",
    })

    service.database.delete_expression_vector(protein["id"], vector["id"])

    source = service.get_library_vector(vector["libraryId"])
    assert source["projectCount"] == 0
    assert source["projects"] == []


def test_project_rename_does_not_rename_catalogue_source(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    created = service.save_expression_vector(protein["id"], {
        "name": "Catalogue name",
        "sequence": "ATG" + "CAA" * 20 + "TAA",
    })

    renamed = service.save_expression_vector(protein["id"], {
        **created,
        "name": "Project-only name",
    }, created["id"])

    assert renamed["name"] == "Project-only name"
    assert service.get_library_vector(created["libraryId"])["name"] == "Catalogue name"


def test_fresh_database_loads_attributed_standard_collection(tmp_path):
    service = planner(tmp_path)
    standards = [
        vector for vector in service.list_library_vectors()
        if vector["isStandard"]
    ]

    assert len(standards) == 8
    assert {vector["name"] for vector in standards} >= {
        "pET28a-LIC", "pGEX-4T-1", "pBAD24", "pFastBacMam3"
    }
    pet = next(vector for vector in standards if vector["name"] == "pET28a-LIC")
    assert pet["sizeBp"] == 7328  # GenBank EF442785.1 known length.
    assert pet["sourceUrl"].endswith("/EF442785.1")
    assert "no restrictions" in pet["license"]


def test_search_filters_facets_favorites_and_recent_usage(tmp_path):
    service = planner(tmp_path)

    result = service.search_library_vectors(
        query="T7",
        filters={"host": ["Escherichia coli"], "nTag": ["6×His"]},
    )
    assert [vector["name"] for vector in result["vectors"]] == ["pET28a-LIC"]
    assert {item["value"]: item["count"] for item in result["facets"]["nTag"]}[
        "6×His"
    ] >= 1

    vector_id = result["vectors"][0]["id"]
    favorite = service.set_library_favorite(vector_id, {"favorite": True})
    assert favorite["favorite"] is True
    assert service.search_library_vectors(favorite=True)["vectors"][0]["id"] == vector_id

    protein = project(service, "Recent project")
    service.copy_library_vector(protein["id"], vector_id)
    recent = service.list_recent_library_vectors()
    assert recent[0]["id"] == vector_id
    assert recent[0]["lastUsedAt"]


def test_vector_library_api_query_contract(tmp_path):
    service = planner(tmp_path)
    request = parse_vector_library_search(
        {
            "q": ["GST"],
            "host": ["Escherichia coli"],
            "promoter": ["tac,T7-lac"],
            "favorite": ["false"],
            "limit": ["25"],
        },
        service.database.VECTOR_LIBRARY_FACETS,
    )

    assert request == {
        "query": "GST",
        "filters": {
            "host": ["Escherichia coli"],
            "promoter": ["tac", "T7-lac"],
        },
        "favorite": False,
        "limit": 25,
        "offset": 0,
    }
    payload = service.search_library_vectors(**request)
    assert [vector["name"] for vector in payload["vectors"]] == ["pGEX-4T-1"]
    assert payload["total"] == 1
    assert "host" in payload["facets"]
