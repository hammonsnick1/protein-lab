"""Purification run records: model validation and the roadmap → Run 1 importer.

The roadmap fixtures follow what ``saveBoard`` in
protein-labs-web/components/protein-labs/purification-roadmap.tsx writes:
``{steps: RoadmapStep[], savedByUser, updatedAt}``, each step with
``components`` of type buffer / measurement / gel / chromatogram / image / note.
"""

from __future__ import annotations

import copy
import json

import pytest

from protein_labs.protein_planner.purification_run import (
    LIVE_ROADMAP_STEPS,
    normalize_run,
)

from test_project_trees import project_tree_api, request
from test_protein_planner import build_planner

GEL_PREVIEW = "data:image/png;base64,iVBORw0KGgo="


def make_protein(service):
    bundle = service.create_protein({"name": "CA2", "sequence": "MSHHWGYGKHNGPEHWHKDFPIAK"})
    return bundle["protein"]["id"]


def add_job(service, protein_id, app_type, config, name=None):
    fields = {"appType": app_type, "config": config}
    if name:
        fields["name"] = name
    return service.create_project_job(protein_id, fields)


def seed_plan(service, protein_id):
    """Planning jobs with the field names liveSteps() reads."""
    return {
        "expression-system": add_job(service, protein_id, "expression-system", {"strainId": "bl21-de3", "strainName": "BL21(DE3)"}),
        "transformation-expression": add_job(service, protein_id, "transformation-expression", {"mediaId": "tb", "mediaName": "Terrific broth"}),
        "purification-lysis": add_job(service, protein_id, "purification-lysis", {"methodId": "sonication", "methodName": "Probe sonication", "bufferName": "Lysis buffer A"}),
        "purification-affinity": add_job(service, protein_id, "purification-affinity", {"columnId": "histrap-5", "columnName": "HisTrap HP 5 mL", "tag": "His6"}),
        "purification-cleavage": add_job(service, protein_id, "purification-cleavage", {"proteaseId": "tev", "proteaseName": "TEV protease"}),
        "purification-buffer": add_job(service, protein_id, "purification-buffer", {
            "presetId": "tris-nacl", "presetName": "Tris/NaCl",
            "steps": {"binding": {"pH": "8.0"}, "elution": {"pH": "8.0"}, "storage": {"pH": "7.5"}},
        }),
    }


def roadmap_board(gel_job_id):
    return {
        "savedByUser": True,
        "updatedAt": "2026-10-28T09:00:00Z",
        "steps": [
            # Live steps saved in board order; lysis was moved ahead of expression.
            {"id": "lysis", "title": "Cell lysis and clarification", "instruction": "Sonicate.", "record": "Pellet mass.",
             "ready": True, "jobId": "purification-lysis", "jobLabel": "Cell lysis job", "planDetails": [], "components": [
                 {"id": "buf-1", "type": "buffer", "title": "Lysis buffer", "notes": "", "purpose": "Cell lysis", "pH": "8.0",
                  "ingredients": [{"name": "Tris-HCl", "concentration": "50", "unit": "mM", "role": "Buffer"}],
                  "sourceBufferKey": "purification-lysis:selected", "sourceJobId": "lysis-job"},
             ]},
            {"id": "transformation-expression", "title": "Transformation and expression", "instruction": "", "record": "",
             "ready": True, "jobId": "transformation-expression", "jobLabel": "Transformation and Expression", "planDetails": [], "components": []},
            {"id": "affinity", "title": "Affinity capture", "instruction": "Capture.", "record": "Column, load.", "ready": True,
             "jobId": "purification-affinity", "jobLabel": "Affinity capture job", "planDetails": [], "components": [
                 {"id": "m-1", "type": "measurement", "title": "IMAC pool", "notes": "E2–E4", "yieldValue": "12.4", "yieldUnit": "mg",
                  "yieldMethod": "A280 / NanoDrop", "purityValue": "92", "purityMethod": "SDS-PAGE densitometry"},
                 {"id": "g-1", "type": "gel", "title": "IMAC fractions", "notes": "", "sourceJobId": gel_job_id,
                  "dataUrl": GEL_PREVIEW, "mimeType": "image/png"},
                 {"id": "img-1", "type": "image", "title": "Column photo", "notes": "", "fileName": "col.jpg",
                  "mimeType": "image/jpeg", "dataUrl": "data:image/jpeg;base64,/9j/"},
                 {"id": "n-1", "type": "note", "title": "Observation", "notes": "Breakthrough in FT"},
             ]},
            # Inserted from the template picker (random id, template title kept).
            {"id": "added-7f1c", "title": "Ion-exchange chromatography", "instruction": "Separate by charge.", "record": "Resin.",
             "ready": False, "jobId": "", "jobLabel": "User-defined step", "planDetails": [], "custom": True, "components": [
                 {"id": "m-2", "type": "measurement", "title": "Q pool", "notes": "", "yieldValue": "850", "yieldUnit": "µg",
                  "yieldMethod": "Bradford assay", "purityValue": "", "purityMethod": "SDS-PAGE densitometry"},
             ]},
            # A custom step renamed by the scientist, carrying the old (wrong)
            # SEC job pointer from the template.
            {"id": "added-9a2b", "title": "Overnight dialysis", "instruction": "Dialyse.", "record": "Volumes.", "ready": False,
             "jobId": "purification-sec", "jobLabel": "SEC polishing job", "planDetails": ["Bag: 10 kDa"], "custom": True, "components": []},
        ],
    }


def import_board(tmp_path):
    service = build_planner(tmp_path)
    protein_id = make_protein(service)
    plan = seed_plan(service, protein_id)
    gel = add_job(service, protein_id, "gel-analysis", {"filename": "imac.png"})
    roadmap = add_job(service, protein_id, "purification-roadmap", roadmap_board(gel["id"]))
    return service, protein_id, plan, gel, roadmap


def test_roadmap_board_imports_as_run_1_with_ids_order_and_records(tmp_path):
    service, protein_id, plan, gel, roadmap = import_board(tmp_path)

    result = service.import_purification_roadmap(protein_id)

    assert result["created"] is True
    run = result["run"]
    assert (run["name"], run["appType"]) == ("Run 1", "purification-run")
    config = run["config"]
    assert config["status"] == "planned"
    assert config["importedFrom"]["jobId"] == roadmap["id"]
    # Saved board order first, then the live steps the board never saved
    # (cleavage, subtractive, sec, quality-storage) in liveSteps() order.
    assert [s["id"] for s in config["steps"]] == [
        "lysis", "transformation-expression", "affinity", "added-7f1c", "added-9a2b",
        "cleavage", "subtractive", "sec", "quality-storage",
    ]
    assert [s["order"] for s in config["steps"]] == list(range(1, 10))
    steps = {s["id"]: s for s in config["steps"]}
    assert {i: steps[i]["kind"] for i in steps} == {
        "lysis": "lysis", "transformation-expression": "expression", "affinity": "capture",
        "added-7f1c": "iex", "added-9a2b": "custom", "cleavage": "cleavage",
        "subtractive": "reverse-affinity", "sec": "sec", "quality-storage": "qc",
    }
    assert all(s["status"] == "planned" for s in config["steps"])

    # Plan side: the corrected job pointers (report R8) and liveSteps() details.
    assert steps["cleavage"]["plan"]["appType"] == "purification-cleavage"
    assert steps["cleavage"]["plan"]["jobId"] == plan["purification-cleavage"]["id"]
    assert steps["quality-storage"]["plan"]["appType"] == "purification-buffer"
    assert steps["affinity"]["plan"]["details"] == ["Column: HisTrap HP 5 mL", "Tag: His6"]
    assert steps["affinity"]["plan"]["buffers"] == ["purification-buffer:binding", "purification-buffer:elution"]
    assert steps["lysis"]["plan"]["buffers"] == ["purification-lysis:selected"]
    assert (steps["cleavage"]["plan"]["ready"], steps["sec"]["plan"]["ready"]) == (True, False)
    assert steps["added-9a2b"]["plan"]["appType"] == "purification-sec"
    assert steps["added-9a2b"]["plan"]["details"] == ["Bag: 10 kDa"]
    assert steps["affinity"]["plan"]["instruction"] == "Capture."

    # Records: buffer → bench, measurement → measurements, analyses → attachments.
    buffer = steps["lysis"]["bench"]["buffersUsed"][0]
    assert (buffer["bufferKey"], buffer["mode"], buffer["pH"]) == ("purification-lysis:selected", "as-planned", "8.0")
    assert buffer["ingredients"] == [{"name": "Tris-HCl", "concentration": "50", "unit": "mM", "role": "Buffer"}]
    m = steps["affinity"]["measurements"]
    assert (m["totalMg"], m["totalMgMethod"], m["purityPct"], m["purityMethod"]) == (
        12.4, "A280 / NanoDrop", 92.0, "SDS-PAGE densitometry")
    assert steps["added-7f1c"]["measurements"]["totalMg"] == pytest.approx(0.85)  # 850 µg
    assert steps["added-7f1c"]["measurements"]["purityPct"] is None
    attachments = {a["id"]: a for a in steps["affinity"]["attachments"]}
    assert (attachments["g-1"]["kind"], attachments["g-1"]["jobId"], attachments["g-1"]["dataUrl"]) == ("gel", gel["id"], GEL_PREVIEW)
    assert (attachments["img-1"]["kind"], attachments["img-1"]["fileName"]) == ("image", "col.jpg")
    assert (attachments["n-1"]["kind"], attachments["n-1"]["notes"]) == ("note", "Breakthrough in FT")
    assert steps["affinity"]["measurementRecords"][0]["notes"] == "E2–E4"
    assert config["samples"] == []
    assert config["importWarnings"] == []

    # The snapshot freezes planning jobs only, never the analyses or the board.
    assert set(config["planSnapshot"]["jobs"]) == set(plan)
    assert config["planSnapshot"]["jobs"]["purification-affinity"]["config"]["columnName"] == "HisTrap HP 5 mL"


def test_import_is_idempotent_and_leaves_the_roadmap_untouched(tmp_path):
    service, protein_id, _, _, roadmap = import_board(tmp_path)

    first = service.import_purification_roadmap(protein_id)
    second = build_planner(tmp_path).import_purification_roadmap(protein_id)

    assert second["created"] is False
    assert second["run"]["id"] == first["run"]["id"]
    jobs = service.database.get_bundle(protein_id)["projectJobs"]
    assert [j["appType"] for j in jobs].count("purification-run") == 1
    after = next(j for j in jobs if j["appType"] == "purification-roadmap")
    assert after["config"] == roadmap["config"]
    assert after["updatedAt"] == roadmap["updatedAt"]


def test_plan_snapshot_is_frozen_when_the_plan_changes_later(tmp_path):
    service, protein_id, plan, _, _ = import_board(tmp_path)
    run = service.import_purification_roadmap(protein_id)["run"]
    affinity = plan["purification-affinity"]
    service.update_project_job(protein_id, affinity["id"], {"config": {"columnId": "strep", "columnName": "StrepTrap"}})

    saved = service.database.get_project_job(run["id"])
    assert saved["config"]["planSnapshot"]["jobs"]["purification-affinity"]["config"]["columnName"] == "HisTrap HP 5 mL"


def test_protein_without_a_saved_board_imports_the_live_plan(tmp_path):
    service = build_planner(tmp_path)
    protein_id = make_protein(service)
    add_job(service, protein_id, "purification-cleavage", {"proteaseId": "retain"})

    config = service.import_purification_roadmap(protein_id)["run"]["config"]

    assert [s["id"] for s in config["steps"]] == [step_id for step_id, _, _ in LIVE_ROADMAP_STEPS]
    steps = {s["id"]: s for s in config["steps"]}
    # liveSteps(): a retained tag renames step 4 and makes subtractive ready.
    assert steps["cleavage"]["title"] == "Retain affinity tag"
    assert steps["subtractive"]["plan"]["ready"] is True
    assert steps["affinity"]["plan"]["ready"] is False
    assert config["importedFrom"]["jobId"] is None


def test_unconvertible_measurements_are_kept_and_reported(tmp_path):
    service = build_planner(tmp_path)
    protein_id = make_protein(service)
    measurement = {"type": "measurement", "notes": "", "yieldMethod": "Bradford assay", "purityMethod": "SDS-PAGE densitometry"}
    add_job(service, protein_id, "purification-roadmap", {"steps": [
        {"id": "affinity", "components": [
            {**measurement, "id": "a", "title": "recovery", "yieldValue": "40", "yieldUnit": "% recovery", "purityValue": "105"},
        ]},
        {"id": "sec", "components": [
            {**measurement, "id": "b", "title": "comma", "yieldValue": "12,4", "yieldUnit": "mg", "purityValue": "88%"},
        ]},
        {"id": "lysis", "components": [
            {**measurement, "id": "c", "title": "one", "yieldValue": "1", "yieldUnit": "mg", "purityValue": ""},
            {**measurement, "id": "d", "title": "two", "yieldValue": "2", "yieldUnit": "mg", "purityValue": ""},
        ]},
        {"id": "added-x", "title": "Odd", "components": [{"id": "e", "type": "gel", "title": "Unlinked gel", "notes": ""}]},
    ]})

    config = service.import_purification_roadmap(protein_id)["run"]["config"]

    steps = {s["id"]: s for s in config["steps"]}
    assert steps["affinity"]["measurements"]["totalMg"] is None
    assert steps["affinity"]["measurements"]["purityPct"] is None
    assert steps["affinity"]["measurementRecords"][0]["yieldValue"] == "40"
    assert steps["sec"]["measurements"]["totalMg"] is None
    assert steps["sec"]["measurements"]["purityPct"] == 88.0
    assert steps["lysis"]["measurements"]["totalMg"] is None
    assert [r["id"] for r in steps["lysis"]["measurementRecords"]] == ["c", "d"]
    assert steps["added-x"]["attachments"][0]["kind"] == "note"
    assert len(config["importWarnings"]) == 5
    warnings = " | ".join(config["importWarnings"])
    for fragment in ("% recovery", "'105'", "'12,4'", "2 yield-and-purity records", "no linked analysis job"):
        assert fragment in warnings


def valid_run():
    return {
        "status": "running",
        "steps": [
            {"id": "s1", "kind": "lysis", "title": "Lysis", "outputs": ["lysate"],
             "measurements": {"volumeMl": 42, "concMgMl": 8.1, "totalMg": 340}},
            {"id": "s2", "kind": "capture", "title": "IMAC", "status": "done", "outputs": ["pool"],
             "bench": {"inputSampleId": "lysate", "parameters": {"flowMlMin": 2}},
             "measurements": {"totalMg": 44, "purityPct": 85, "activity": {"value": 120, "unit": "U/mg"}},
             "attachments": [{"id": "a1", "kind": "gel-lane", "jobId": "gel-1", "laneIndex": 3, "sampleId": "pool"}],
             "decision": {"outcome": "repeat", "reason": "breakthrough", "createdStepId": "s3"}},
            {"id": "s3", "kind": "capture", "title": "IMAC (repeat)", "repeatOfStepId": "s2"},
        ],
        "samples": [
            {"id": "lysate", "stepId": "s1", "label": "Clarified lysate", "volumeMl": 42},
            {"id": "pool", "stepId": "s2", "label": "E2–E4 pool", "storage": {"temp": "4 °C", "aliquots": 0}},
        ],
    }


def test_valid_run_round_trips_through_create_and_update(tmp_path):
    service = build_planner(tmp_path)
    protein_id = make_protein(service)
    created = add_job(service, protein_id, "purification-run", valid_run(), name="Prep 2 · 2 L TB")
    assert created["config"]["steps"][1]["measurements"]["purityPct"] == 85.0
    assert created["config"]["steps"][1]["bench"]["parameters"] == {"flowMlMin": 2}

    moved = copy.deepcopy(created["config"])
    moved["steps"] = [moved["steps"][0], moved["steps"][2], moved["steps"][1]]
    moved["steps"][1]["order"] = 99
    updated = service.update_project_job(protein_id, created["id"], {"config": moved})
    assert [(s["id"], s["order"]) for s in updated["config"]["steps"]] == [("s1", 1), ("s3", 2), ("s2", 3)]
    assert json.loads(json.dumps(updated["config"])) == updated["config"]


def test_empty_config_is_a_valid_empty_run(tmp_path):
    service = build_planner(tmp_path)
    created = add_job(service, make_protein(service), "purification-run", {})
    assert created["config"]["steps"] == [] and created["config"]["status"] == "planned"


@pytest.mark.parametrize(("mutate", "message"), [
    (lambda r: r.update(color="red"), "unknown field(s): color"),
    (lambda r: r["steps"][0].update(kind="centrifuge"), "kind must be one of"),
    (lambda r: r["steps"].append({"id": "s1", "title": "Again"}), "Run step ids must be unique: 's1'"),
    (lambda r: r["samples"][0].update(stepId="gone"), "which is not in this run"),
    (lambda r: r["steps"][0]["bench"].__setitem__("inputSampleId", "pool") if "bench" in r["steps"][0] else r["steps"][0].update(bench={"inputSampleId": "pool"}), "does not come before it"),
    (lambda r: r["steps"][0].update(outputs=["pool"]), "not a sample of that step"),
    (lambda r: r["steps"][1]["measurements"].update(purityPct=101), "between 0 and 100"),
    (lambda r: r["steps"][0]["measurements"].update(volumeMl=-1), "zero or more"),
    (lambda r: r["steps"][0]["measurements"].update(volumeMl="42"), "must be a number"),
    (lambda r: r["steps"][1]["attachments"][0].pop("laneIndex"), "must name its laneIndex"),
    (lambda r: r["steps"][1]["decision"].update(createdStepId="s9"), "names step 's9'"),
    (lambda r: r["steps"][2].update(repeatOfStepId="s9"), "repeats step 's9'"),
    (lambda r: r.update(schemaVersion=2), "schemaVersion 2 is not supported"),
])
def test_invalid_runs_are_rejected_with_the_reason(mutate, message):
    run = valid_run()
    mutate(run)
    with pytest.raises(ValueError, match=message.replace("(", r"\(").replace(")", r"\)")):
        normalize_run(run)


def test_invalid_run_is_not_saved(tmp_path):
    service = build_planner(tmp_path)
    protein_id = make_protein(service)
    run = valid_run()
    run["samples"][0]["stepId"] = "gone"
    with pytest.raises(ValueError):
        add_job(service, protein_id, "purification-run", run)
    jobs = service.database.get_bundle(protein_id)["projectJobs"]
    assert not [j for j in jobs if j["appType"] == "purification-run"]


def test_http_import_returns_201_then_200(tmp_path):
    with project_tree_api(tmp_path) as (port, planner):
        protein_id = planner.create_protein({"name": "CA2", "sequence": "MSHHWGYGK"})["protein"]["id"]
        path = f"/v1/protein-planner/proteins/{protein_id}/purification-runs/import-roadmap"
        first_status, first = request(port, "POST", path, {})
        second_status, second = request(port, "POST", path, {})
        missing_status, _ = request(port, "POST", "/v1/protein-planner/proteins/nope/purification-runs/import-roadmap", {})
    assert (first_status, second_status) == (201, 200)
    assert first["created"] is True and second["created"] is False
    assert first["run"]["id"] == second["run"]["id"]
    assert missing_status == 404
