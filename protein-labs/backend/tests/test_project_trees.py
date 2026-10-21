from __future__ import annotations

from contextlib import contextmanager
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from threading import Thread
from time import perf_counter

import pytest

from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.project_trees import (
    ALIGNMENT_METHOD,
    IMPORT_SOURCE_KEY,
    ProjectTreeService,
)
from protein_labs.server import ApiHandler, make_planner


def create_project(
    database: Database,
    name: str,
    sequence: str,
    **fields,
) -> dict:
    return database.create_protein({"name": name, **fields}, sequence)


@contextmanager
def project_tree_api(tmp_path):
    planner = make_planner(tmp_path / "api-project-trees.sqlite3")
    handler = type("ProjectTreeApiHandler", (ApiHandler,), {"planner": planner})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        yield server.server_port, planner
    finally:
        server.shutdown()
        thread.join()
        server.server_close()


def request(port: int, method: str, path: str, body: dict | None = None):
    connection = HTTPConnection("127.0.0.1", port, timeout=5)
    encoded = None if body is None else json.dumps(body)
    connection.request(
        method,
        path,
        body=encoded,
        headers={"Content-Type": "application/json"},
    )
    response = connection.getresponse()
    value = json.loads(response.read())
    connection.close()
    return response.status, value


def test_alignment_reports_hand_checked_residue_edits(tmp_path):
    database = Database(tmp_path / "known-answer.sqlite3")
    before = create_project(database, "Before", "ACDEFGHIK")
    # W is inserted after before-residue 3; before I8 is changed to V.
    after = create_project(database, "After", "ACDWEFGHVK")
    service = ProjectTreeService(database)

    result = service.project_diff(before["id"], after["id"])
    sequence_changes = [
        change for change in result["changes"]
        if change["category"] == "sequence"
    ]

    assert result["algorithm"]["sequenceAlignment"] == ALIGNMENT_METHOD
    assert result["algorithm"]["positions"] == "1-based"
    assert [(change["kind"], change["summary"]) for change in sequence_changes] == [
        ("insertion", "+W after residue 3"),
        ("substitution", "I8V"),
    ]
    assert sequence_changes[0]["details"] == {
        "beforeStart": 3,
        "beforeEnd": 3,
        "afterStart": 4,
        "afterEnd": 4,
    }
    assert result["sequenceAlignment"]["before"] == "ACD-EFGHIK"
    assert result["sequenceAlignment"]["after"] == "ACDWEFGHVK"

    ui_result = service.project_diff_for_ui(before["id"], after["id"])
    assert ui_result["fromProjectId"] == before["id"]
    assert ui_result["toProjectId"] == after["id"]
    assert ui_result["sequence"] == {
        "identityPercent": 80.0,
        "lengthBefore": 9,
        "lengthAfter": 10,
        "alignedBefore": "ACD-EFGHIK",
        "alignedAfter": "ACDWEFGHVK",
        "edits": [
            {
                "kind": "insertion",
                "position": 4,
                "before": "",
                "after": "W",
                "label": "+W after residue 3",
            },
            {
                "kind": "substitution",
                "position": 8,
                "before": "I",
                "after": "V",
                "label": "I8V",
            },
        ],
    }
    assert len(ui_result["sequence"]["alignedBefore"]) == len(
        ui_result["sequence"]["alignedAfter"]
    )
    assert all(
        change["category"] in {
            "sequence", "vector", "host", "tag", "purification", "assay",
            "protparam", "notes", "other",
        }
        for change in ui_result["changes"]
    )


def test_alignment_distinguishes_deletion_and_terminal_truncation(tmp_path):
    database = Database(tmp_path / "deletions.sqlite3")
    original = create_project(database, "Original", "ACDEFGHIK")
    deletion = create_project(database, "Deletion", "ACDFGHIK")
    full = create_project(database, "Full", "MNACDE")
    truncated = create_project(database, "Truncated", "ACDE")
    service = ProjectTreeService(database)

    deleted = service.project_diff(original["id"], deletion["id"])["changes"][0]
    terminal = service.project_diff(full["id"], truncated["id"])["changes"][0]

    assert deleted["kind"] == "deletion"
    assert deleted["summary"] == "ΔE4"
    assert deleted["details"]["beforeStart"] == 4
    assert terminal["kind"] == "truncation"
    assert terminal["summary"] == "N-terminal truncation Δ1–2"
    assert terminal["details"]["terminus"] == "N"


def test_diff_orders_experiment_changes_and_hides_ids_and_timestamps(tmp_path):
    database = Database(tmp_path / "structured.sqlite3")
    before = create_project(
        database,
        "WT",
        "ACDEFGHIK",
        tags=["6xHis"],
        expressionSystem="E. coli",
        notes="baseline",
    )
    after = create_project(
        database,
        "K9A",
        "ACDEFGHIA",
        tags=["MBP"],
        expressionSystem="Pichia pastoris",
        notes="new process",
    )
    database.save_expression_vector(before["id"], {
        "name": "pET-28a — target",
        "sequence": "ATG" * 50,
        "features": [],
    })
    database.save_expression_vector(after["id"], {
        "name": "pMAL-c5X — target",
        "sequence": "ATG" * 55,
        "features": [{"name": "MBP fusion", "type": "fusion"}],
    })
    database.create_project_job(
        before["id"],
        "Ni-NTA capture",
        "purification-affinity",
        {"column": "HisTrap", "valid": True, "sourceJobId": "noise-before"},
    )
    database.create_project_job(
        after["id"],
        "Amylose capture",
        "purification-affinity",
        {"column": "MBPTrap", "sourceJobId": "noise-after"},
    )
    database.create_project_job(
        after["id"],
        "Activity assay",
        "gel-analysis",
        {"replicates": 3, "updatedAt": "noise"},
    )

    result = ProjectTreeService(database).project_diff(before["id"], after["id"])
    categories = [change["category"] for change in result["changes"]]
    serialized = json.dumps(result)

    assert categories == sorted(
        categories,
        key=[
            "sequence", "construct", "vector", "host", "purification",
            "assay", "protparam", "metadata",
        ].index,
    )
    assert result["summary"].startswith("K9A · Tags/fusions:")
    assert "Vector: pET-28a → pMAL-c5X" in result["summary"]
    assert "noise-before" not in serialized
    assert "noise-after" not in serialized
    assert '"updatedAt": "noise"' not in serialized
    assert '"valid": true' in serialized
    assert all(
        {"category", "kind", "before", "after", "summary", "details"}
        <= change.keys()
        for change in result["changes"]
    )


def test_tree_graph_integrity_and_deleted_projects_remain_readable(tmp_path):
    database = Database(tmp_path / "graph.sqlite3")
    root = create_project(database, "Root", "ACDE")
    child = create_project(database, "Child", "ACDF")
    grandchild = create_project(database, "Grandchild", "ACDG")
    service = ProjectTreeService(database)
    tree = service.create_tree({"name": "Lineage", "rootProjectId": root["id"]})

    first = service.create_link(tree["id"], {
        "fromProjectId": root["id"],
        "toProjectId": child["id"],
        "changeType": "Construct change",
    })
    service.create_link(tree["id"], {
        "fromProjectId": child["id"],
        "toProjectId": grandchild["id"],
    })

    with pytest.raises(ValueError, match="already exists"):
        service.create_link(tree["id"], {
            "fromProjectId": root["id"],
            "toProjectId": child["id"],
        })
    with pytest.raises(ValueError, match="cycle"):
        service.create_link(tree["id"], {
            "fromProjectId": grandchild["id"],
            "toProjectId": root["id"],
        })

    database.delete_protein(child["id"])
    reloaded = service.get_tree(tree["id"])
    missing = next(
        node for node in reloaded["nodes"] if node["projectId"] == child["id"]
    )
    cached = next(link for link in reloaded["links"] if link["id"] == first["id"])

    assert missing == {"projectId": child["id"], "project": None, "missing": True}
    assert cached["diffSummary"] == "E4F"
    assert reloaded["relationships"] == reloaded["links"]
    assert reloaded["branches"][0] == {
        "id": first["id"],
        "fromProjectId": root["id"],
        "toProjectId": child["id"],
        "summary": "E4F",
        "categories": ["sequence", "protparam", "notes"],
        "changeCount": 4,
        "note": "",
    }
    with pytest.raises(LookupError, match="was not found"):
        service.create_link(tree["id"], {
            "fromProjectId": root["id"],
            "toProjectId": child["id"],
        })


def test_branch_summary_cache_refreshes_when_a_vector_changes(tmp_path):
    database = Database(tmp_path / "cache.sqlite3")
    root = create_project(database, "Root", "ACDE")
    child = create_project(database, "Child", "ACDE")
    service = ProjectTreeService(database)
    tree = service.create_tree({"name": "Lineage", "rootProjectId": root["id"]})
    link = service.create_link(tree["id"], {
        "fromProjectId": root["id"],
        "toProjectId": child["id"],
    })
    assert link["diffSummary"] == "Name changed"

    # Existing installations add this cache column with zero. A tree read must
    # populate it without requiring any user edit or losing the cached summary.
    with database.connect() as connection:
        connection.execute(
            "UPDATE project_tree_links SET diff_change_count = 0 WHERE id = ?",
            (link["id"],),
        )
    assert service.get_tree(tree["id"])["branches"][0]["changeCount"] == 1

    database.save_expression_vector(child["id"], {
        "name": "pET-28a — target",
        "sequence": "ATG" * 50,
        "features": [],
    })
    refreshed = service.get_tree(tree["id"])["links"][0]

    assert refreshed["diffSummary"] == "Vector: none → pET-28a"
    assert refreshed["changeCategories"] == ["vector", "metadata"]


def test_local_storage_import_is_atomic_idempotent_and_non_overwriting(tmp_path):
    database = Database(tmp_path / "import.sqlite3")
    service = ProjectTreeService(database)
    payload = {
        "sourceKey": IMPORT_SOURCE_KEY,
        "trees": [{
            "id": "legacy-tree",
            "name": "Imported tree",
            "rootProjectId": "missing-root",
            "relationships": [{
                "id": "legacy-link",
                "fromProjectId": "missing-root",
                "toProjectId": "missing-child",
                "changeType": "Construct change",
                "description": "Preserve this history",
            }],
            "createdAt": "2025-01-02T03:04:05Z",
            "updatedAt": "2025-01-02T03:04:05Z",
        }],
    }

    first = service.import_local_trees(payload)
    database.rename_project_tree("legacy-tree", "Database rename")
    second = service.import_local_trees(payload)

    assert first["confirmed"] is True
    assert first["importedTreeIds"] == ["legacy-tree"]
    assert first["existingTreeIds"] == []
    assert second["importedTreeIds"] == []
    assert second["existingTreeIds"] == ["legacy-tree"]
    assert len(second["trees"]) == 1
    assert second["trees"][0]["name"] == "Database rename"
    assert second["trees"][0]["links"][0]["description"] == "Preserve this history"
    assert all(node["missing"] for node in second["trees"][0]["nodes"])

    cyclic = json.loads(json.dumps(payload))
    cyclic["trees"][0]["id"] = "cycle-tree"
    cyclic["trees"][0]["relationships"].append({
        "id": "reverse-link",
        "fromProjectId": "missing-child",
        "toProjectId": "missing-root",
    })
    with pytest.raises(ValueError, match="cycle"):
        service.import_local_trees(cyclic)
    assert [tree["id"] for tree in service.list_trees()] == ["legacy-tree"]


def test_diff_of_1000_residue_projects_finishes_under_one_second(tmp_path):
    database = Database(tmp_path / "performance.sqlite3")
    before = create_project(database, "Before", "ACDEFGHIKL" * 100)
    after_sequence = ("ACDEFGHIKL" * 50) + "W" + ("ACDEFGHIKL" * 50)
    after = create_project(database, "After", after_sequence)
    service = ProjectTreeService(database)

    started = perf_counter()
    result = service.project_diff(before["id"], after["id"])
    elapsed = perf_counter() - started

    insertion = next(
        change for change in result["changes"]
        if change["category"] == "sequence"
    )
    assert insertion["kind"] == "insertion"
    assert insertion["details"]["beforeStart"] == 500
    assert elapsed < 1.0


def test_http_api_exposes_tree_crud_links_reparent_diff_and_import(tmp_path):
    with project_tree_api(tmp_path) as (port, planner):
        root = planner.create_protein({"name": "Root", "sequence": "ACDE"})["protein"]
        child = planner.create_protein({"name": "Child", "sequence": "ACDF"})["protein"]
        other = planner.create_protein({"name": "Other", "sequence": "ACDG"})["protein"]

        status, tree = request(port, "POST", "/v1/protein-planner/project-trees", {
            "name": "API tree", "rootProjectId": root["id"],
        })
        assert status == 201

        status, link = request(
            port,
            "POST",
            f"/v1/protein-planner/project-trees/{tree['id']}/links",
            {"fromProjectId": root["id"], "toProjectId": child["id"]},
        )
        assert status == 201
        assert link["diffSummary"] == "E4F"

        status, ui_diff = request(
            port,
            "GET",
            "/v1/protein-planner/project-diff"
            f"?from={root['id']}&to={child['id']}",
        )
        assert status == 200
        assert ui_diff["sequence"]["alignedBefore"] == "ACDE"
        assert ui_diff["sequence"]["alignedAfter"] == "ACDF"
        assert ui_diff["sequence"]["edits"][0]["position"] == 4

        status, tree_with_branch = request(
            port,
            "POST",
            f"/v1/protein-planner/project-trees/{tree['id']}/branches",
            {
                "fromProjectId": root["id"],
                "toProjectId": other["id"],
                "note": "Alternative construct",
            },
        )
        assert status == 201
        ui_branch = next(
            branch for branch in tree_with_branch["branches"]
            if branch["toProjectId"] == other["id"]
        )
        assert ui_branch["note"] == "Alternative construct"
        assert ui_branch["summary"] == "E4G"
        assert ui_branch["changeCount"] > 0

        status, patched_tree = request(
            port,
            "PATCH",
            f"/v1/protein-planner/project-trees/{tree['id']}"
            f"/branches/{ui_branch['id']}",
            {"note": "Updated note"},
        )
        assert status == 200
        assert next(
            branch for branch in patched_tree["branches"]
            if branch["id"] == ui_branch["id"]
        )["note"] == "Updated note"

        status, diff = request(
            port,
            "GET",
            "/v1/protein-planner/project-trees/diff"
            f"?fromProjectId={root['id']}&toProjectId={child['id']}",
        )
        assert status == 200
        assert diff["changes"][0]["summary"] == "E4F"

        status, reparented = request(
            port,
            "PATCH",
            f"/v1/protein-planner/project-trees/{tree['id']}/links/{link['id']}",
            {"fromProjectId": other["id"], "toProjectId": child["id"]},
        )
        assert status == 200
        assert reparented["fromProjectId"] == other["id"]

        status, renamed = request(
            port,
            "PATCH",
            f"/v1/protein-planner/project-trees/{tree['id']}",
            {"name": "Renamed"},
        )
        assert status == 200
        assert renamed["name"] == "Renamed"

        status, listed = request(port, "GET", "/v1/protein-planner/project-trees")
        assert status == 200
        assert listed["trees"][0]["links"][0]["diffSummary"] == "G4F"

        status, imported = request(
            port,
            "POST",
            "/v1/protein-planner/project-trees/import",
            {"trees": []},
        )
        assert status == 200
        assert imported["confirmed"] is True
        assert imported["imported"] == 0
        assert imported["skipped"] == 0

        status, tree_without_branch = request(
            port,
            "DELETE",
            f"/v1/protein-planner/project-trees/{tree['id']}"
            f"/branches/{ui_branch['id']}",
        )
        assert status == 200
        assert all(
            branch["id"] != ui_branch["id"]
            for branch in tree_without_branch["branches"]
        )

        status, deleted_link = request(
            port,
            "DELETE",
            f"/v1/protein-planner/project-trees/{tree['id']}/links/{link['id']}",
        )
        assert status == 200
        assert deleted_link == {"deleted": link["id"]}

        status, deleted_tree = request(
            port,
            "DELETE",
            f"/v1/protein-planner/project-trees/{tree['id']}",
        )
        assert status == 200
        assert deleted_tree == {"deleted": tree["id"]}
