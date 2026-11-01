"""Purification run records: the data model and the roadmap importer.

A purification run is one prep of a protein, kept as a ``purification-run``
project job. The plan is an input (a frozen snapshot of the planning jobs);
the record is the product (ordered steps with bench facts, measurements,
attachments and samples). See ``PURIFICATION_RUN_API.md`` for the contract.

``normalize_run`` validates a run config before it is saved and rejects
unknown keys rather than dropping them, so nothing the UI sends is lost
silently. ``roadmap_to_run`` turns the existing one-per-protein
``purification-roadmap`` board into "Run 1" without touching the board.
"""

from __future__ import annotations

import math
from typing import Any
import uuid

SCHEMA_VERSION = 1
RUN_APP_TYPE = "purification-run"
ROADMAP_APP_TYPE = "purification-roadmap"
IMPORTED_RUN_NAME = "Run 1"

RUN_STATUSES = ("planned", "running", "done", "abandoned")
STEP_STATUSES = ("planned", "in-progress", "done", "skipped", "failed")
STEP_KINDS = (
    "expression", "harvest", "lysis", "clarify", "capture", "wash-elute",
    "buffer-exchange", "cleavage", "reverse-affinity", "iex", "hic", "sec",
    "concentrate", "qc", "formulate-store", "custom",
)
DECISION_OUTCOMES = ("proceed", "repeat", "insert", "stop")
BUFFER_MODES = ("as-planned", "edited")
ATTACHMENT_KINDS = (
    "gel", "gel-lane", "chromatogram", "chromatogram-trace", "image", "file", "note",
)

# Planning jobs frozen into a run's plan snapshot. Analysis jobs (gels,
# chromatograms) and the roadmap itself are records, not plan, so they stay out.
PLAN_APP_TYPES = (
    "expression-system",
    "expression-planning",
    "transformation-expression",
    "purification-lysis",
    "purification-affinity",
    "purification-cleavage",
    "purification-subtractive",
    "purification-sec",
    "purification-buffer",
    "purification-workflow",
)

# The planning job each step kind reads. The roadmap pointed cleavage and
# QC/storage at the SEC and subtractive jobs (report R8); the run does not.
KIND_PLAN_APP_TYPE = {
    "expression": "transformation-expression",
    "harvest": "transformation-expression",
    "lysis": "purification-lysis",
    "clarify": "purification-lysis",
    "capture": "purification-affinity",
    "wash-elute": "purification-affinity",
    "cleavage": "purification-cleavage",
    "reverse-affinity": "purification-subtractive",
    "sec": "purification-sec",
    "qc": "purification-buffer",
    "formulate-store": "purification-buffer",
}

# Buffer records (``purification-buffer`` config.steps keys) each kind uses.
KIND_BUFFER_STEPS = {
    "lysis": ("lysis",),
    "clarify": ("lysis",),
    "capture": ("binding", "wash", "elution"),
    "wash-elute": ("wash", "elution"),
    "cleavage": ("cleavage",),
    "sec": ("storage",),
    "formulate-store": ("storage",),
}

# The seven board steps `liveSteps()` in protein-labs-web/lib/roadmap-steps.ts
# derives from the plan, by their fixed ids, with the run step kind each maps to.
LIVE_ROADMAP_STEPS = (
    ("transformation-expression", "expression", "Transformation and expression"),
    ("lysis", "lysis", "Cell lysis and clarification"),
    ("affinity", "capture", "Affinity capture"),
    ("cleavage", "cleavage", "Affinity-tag cleavage"),
    ("subtractive", "reverse-affinity", "Subtractive cleanup"),
    ("sec", "sec", "SEC polishing"),
    ("quality-storage", "qc", "Quality control and storage"),
)
_LIVE_KIND = {step_id: kind for step_id, kind, _ in LIVE_ROADMAP_STEPS}

# Steps added from the board's template picker get a random id, so their kind
# is read from the template title they were created with (purification-roadmap.tsx
# `stepTemplates`). A renamed step falls back to "custom".
_TEMPLATE_TITLE_KIND = {
    "transformation and expression": "expression",
    "cell lysis": "lysis",
    "clarification": "clarify",
    "affinity capture": "capture",
    "buffer exchange / desalting": "buffer-exchange",
    "affinity-tag cleavage": "cleavage",
    "retain affinity tag": "cleavage",
    "subtractive cleanup": "reverse-affinity",
    "concentration": "concentrate",
    "ion-exchange chromatography": "iex",
    "hydrophobic-interaction chromatography": "hic",
    "size-exclusion chromatography": "sec",
    "quality control": "qc",
    "formulation and storage": "formulate-store",
}

# Roadmap yield units that convert to the run's total protein in mg.
_YIELD_TO_MG = {"mg": 1.0, "µg": 0.001, "μg": 0.001, "ug": 0.001}

_RUN_KEYS = {
    "schemaVersion", "status", "startedAt", "planSnapshot", "steps", "samples",
    "importedFrom", "importWarnings",
}
_STEP_KEYS = {
    "id", "kind", "title", "order", "status", "plan", "bench", "outputs",
    "measurements", "measurementRecords", "attachments", "decision",
    "repeatOfStepId",
}
_PLAN_KEYS = {"appType", "jobId", "ready", "details", "buffers", "instruction", "record"}
_BENCH_KEYS = {
    "date", "operator", "inputSampleId", "parameters", "buffersUsed",
    "deviations", "notes",
}
_MEASUREMENT_KEYS = {
    "volumeMl", "a280", "concMgMl", "totalMg", "purityPct", "purityMethod",
    "totalMgMethod", "activity",
}
_SAMPLE_KEYS = {
    "id", "stepId", "label", "volumeMl", "concMgMl", "totalMg", "storage",
    "gelLaneRefs", "chromatogramFractionRefs",
}
_ATTACHMENT_KEYS = {
    "id", "kind", "title", "notes", "jobId", "sampleId", "laneIndex", "traceId",
    "fileName", "mimeType", "dataUrl",
}
_BUFFER_KEYS = {
    "bufferKey", "mode", "title", "purpose", "pH", "ingredients", "sourceJobId",
    "notes",
}
_RECORD_KEYS = {
    "id", "title", "notes", "yieldValue", "yieldUnit", "yieldMethod",
    "purityValue", "purityMethod",
}


# ---------------------------------------------------------------------------
# Validation
# ---------------------------------------------------------------------------


def empty_measurements() -> dict[str, Any]:
    return {
        "volumeMl": None, "a280": None, "concMgMl": None, "totalMg": None,
        "purityPct": None, "purityMethod": "", "totalMgMethod": "", "activity": None,
    }


def normalize_run(config: Any) -> dict[str, Any]:
    """Validate a ``purification-run`` config and return its canonical form.

    Raises ``ValueError`` naming the first problem: unknown keys, bad enum
    values, non-finite or negative numbers, duplicate ids, or a sample,
    input, decision or repeat reference that points at nothing.
    """
    run = _object(config, "The purification run")
    _reject_unknown(run, _RUN_KEYS, "The purification run")
    version = run.get("schemaVersion", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise ValueError(
            f"Purification run schemaVersion {version!r} is not supported "
            f"(expected {SCHEMA_VERSION})"
        )
    steps_raw = _list(run.get("steps"), "Run steps")
    samples_raw = _list(run.get("samples"), "Run samples")
    steps = [_normalize_step(value, index) for index, value in enumerate(steps_raw)]
    samples = [_normalize_sample(value) for value in samples_raw]

    step_order = {step["id"]: step["order"] for step in steps}
    if len(step_order) != len(steps):
        raise ValueError(f"Run step ids must be unique: {_duplicates(s['id'] for s in steps)}")
    sample_step = {sample["id"]: sample["stepId"] for sample in samples}
    if len(sample_step) != len(samples):
        raise ValueError(f"Sample ids must be unique: {_duplicates(s['id'] for s in samples)}")
    for sample in samples:
        if sample["stepId"] not in step_order:
            raise ValueError(
                f"Sample {sample['id']!r} belongs to step {sample['stepId']!r}, "
                "which is not in this run"
            )
    for step in steps:
        for sample_id in step["outputs"]:
            if sample_step.get(sample_id) != step["id"]:
                raise ValueError(
                    f"Step {step['id']!r} lists output {sample_id!r}, which is not "
                    "a sample of that step"
                )
        input_id = step["bench"]["inputSampleId"]
        if input_id is not None:
            source_step = sample_step.get(input_id)
            if source_step is None:
                raise ValueError(
                    f"Step {step['id']!r} takes input sample {input_id!r}, which "
                    "is not in this run"
                )
            if step_order[source_step] >= step["order"]:
                raise ValueError(
                    f"Step {step['id']!r} takes its input from a step that does "
                    "not come before it"
                )
        for attachment in step["attachments"]:
            if attachment["sampleId"] is not None and attachment["sampleId"] not in sample_step:
                raise ValueError(
                    f"Attachment {attachment['id']!r} names sample "
                    f"{attachment['sampleId']!r}, which is not in this run"
                )
        repeat_of = step["repeatOfStepId"]
        if repeat_of is not None and repeat_of not in step_order:
            raise ValueError(
                f"Step {step['id']!r} repeats step {repeat_of!r}, which is not in this run"
            )
        decision = step["decision"]
        if decision and decision["createdStepId"] is not None and decision["createdStepId"] not in step_order:
            raise ValueError(
                f"The decision on step {step['id']!r} names step "
                f"{decision['createdStepId']!r}, which is not in this run"
            )

    status = _enum(run.get("status", "planned"), RUN_STATUSES, "Run status")
    imported = run.get("importedFrom")
    return {
        "schemaVersion": SCHEMA_VERSION,
        "status": status,
        "startedAt": _optional_text(run.get("startedAt"), "Run startedAt"),
        "planSnapshot": _normalize_snapshot(run.get("planSnapshot")),
        "steps": steps,
        "samples": samples,
        "importedFrom": None if imported is None else dict(_object(imported, "importedFrom")),
        "importWarnings": [str(value) for value in _list(run.get("importWarnings"), "importWarnings")],
    }


def _normalize_snapshot(value: Any) -> dict[str, Any]:
    if value is None:
        return {"takenAt": None, "jobs": {}}
    snapshot = _object(value, "Plan snapshot")
    _reject_unknown(snapshot, {"takenAt", "jobs"}, "Plan snapshot")
    jobs = _object(snapshot.get("jobs") or {}, "Plan snapshot jobs")
    normalized: dict[str, Any] = {}
    for app_type, raw in jobs.items():
        if app_type not in PLAN_APP_TYPES:
            raise ValueError(f"{app_type!r} is not a planning job and cannot be in a plan snapshot")
        job = _object(raw, f"Plan snapshot job {app_type!r}")
        _reject_unknown(job, {"jobId", "name", "updatedAt", "config"}, f"Plan snapshot job {app_type!r}")
        normalized[app_type] = {
            "jobId": _optional_text(job.get("jobId"), "Plan snapshot jobId"),
            "name": str(job.get("name") or ""),
            "updatedAt": _optional_text(job.get("updatedAt"), "Plan snapshot updatedAt"),
            "config": dict(_object(job.get("config") or {}, "Plan snapshot config")),
        }
    return {
        "takenAt": _optional_text(snapshot.get("takenAt"), "Plan snapshot takenAt"),
        "jobs": normalized,
    }


def _normalize_step(value: Any, index: int) -> dict[str, Any]:
    step = _object(value, f"Run step {index + 1}")
    _reject_unknown(step, _STEP_KEYS, f"Run step {index + 1}")
    step_id = _required_id(step.get("id"), f"Run step {index + 1} id")
    label = f"Run step {step_id!r}"
    plan = _object(step.get("plan") or {}, f"{label} plan")
    _reject_unknown(plan, _PLAN_KEYS, f"{label} plan")
    bench = _object(step.get("bench") or {}, f"{label} bench")
    _reject_unknown(bench, _BENCH_KEYS, f"{label} bench")
    title = str(step.get("title") or "").strip()
    if not title or len(title) > 200:
        raise ValueError(f"{label} title must contain 1–200 characters")
    decision = step.get("decision")
    if decision is not None:
        decision = _object(decision, f"{label} decision")
        _reject_unknown(decision, {"outcome", "reason", "createdStepId"}, f"{label} decision")
        decision = {
            "outcome": _enum(decision.get("outcome"), DECISION_OUTCOMES, f"{label} decision outcome"),
            "reason": str(decision.get("reason") or ""),
            "createdStepId": _optional_text(decision.get("createdStepId"), f"{label} createdStepId"),
        }
    return {
        "id": step_id,
        "kind": _enum(step.get("kind", "custom"), STEP_KINDS, f"{label} kind"),
        "title": title,
        # Order is the list position, so a reorder in the UI cannot leave gaps
        # or ties that disagree with what the scientist sees.
        "order": index + 1,
        "status": _enum(step.get("status", "planned"), STEP_STATUSES, f"{label} status"),
        "plan": {
            "appType": _optional_text(plan.get("appType"), f"{label} plan appType"),
            "jobId": _optional_text(plan.get("jobId"), f"{label} plan jobId"),
            "ready": bool(plan.get("ready", False)),
            "details": [str(item) for item in _list(plan.get("details"), f"{label} plan details")],
            "buffers": [str(item) for item in _list(plan.get("buffers"), f"{label} plan buffers")],
            "instruction": str(plan.get("instruction") or ""),
            "record": str(plan.get("record") or ""),
        },
        "bench": {
            "date": _optional_text(bench.get("date"), f"{label} bench date"),
            "operator": str(bench.get("operator") or ""),
            "inputSampleId": _optional_text(bench.get("inputSampleId"), f"{label} inputSampleId"),
            "parameters": dict(_object(bench.get("parameters") or {}, f"{label} parameters")),
            "buffersUsed": [
                _normalize_buffer(item, label)
                for item in _list(bench.get("buffersUsed"), f"{label} buffersUsed")
            ],
            "deviations": str(bench.get("deviations") or ""),
            "notes": str(bench.get("notes") or ""),
        },
        "outputs": [
            _required_id(item, f"{label} output")
            for item in _list(step.get("outputs"), f"{label} outputs")
        ],
        "measurements": _normalize_measurements(step.get("measurements"), label),
        "measurementRecords": [
            _normalize_record(item, label)
            for item in _list(step.get("measurementRecords"), f"{label} measurementRecords")
        ],
        "attachments": _unique([
            _normalize_attachment(item, label)
            for item in _list(step.get("attachments"), f"{label} attachments")
        ], f"{label} attachment"),
        "decision": decision,
        "repeatOfStepId": _optional_text(step.get("repeatOfStepId"), f"{label} repeatOfStepId"),
    }


def _normalize_measurements(value: Any, label: str) -> dict[str, Any]:
    raw = _object(value or {}, f"{label} measurements")
    _reject_unknown(raw, _MEASUREMENT_KEYS, f"{label} measurements")
    values = empty_measurements()
    for key in ("volumeMl", "a280", "concMgMl", "totalMg"):
        values[key] = _quantity(raw.get(key), f"{label} {key}")
    purity = _quantity(raw.get("purityPct"), f"{label} purityPct")
    if purity is not None and purity > 100:
        raise ValueError(f"{label} purityPct must be between 0 and 100")
    values["purityPct"] = purity
    values["purityMethod"] = str(raw.get("purityMethod") or "")
    values["totalMgMethod"] = str(raw.get("totalMgMethod") or "")
    activity = raw.get("activity")
    if activity is not None:
        activity = _object(activity, f"{label} activity")
        _reject_unknown(activity, {"value", "unit"}, f"{label} activity")
        amount = _quantity(activity.get("value"), f"{label} activity value")
        unit = str(activity.get("unit") or "").strip()
        if amount is None or not unit:
            raise ValueError(f"{label} activity needs both a value and a unit")
        activity = {"value": amount, "unit": unit}
    values["activity"] = activity
    return values


def _normalize_record(value: Any, label: str) -> dict[str, Any]:
    record = _object(value, f"{label} measurement record")
    _reject_unknown(record, _RECORD_KEYS, f"{label} measurement record")
    return {key: str(record.get(key) or "") for key in sorted(_RECORD_KEYS)}


def _normalize_buffer(value: Any, label: str) -> dict[str, Any]:
    buffer = _object(value, f"{label} buffer")
    _reject_unknown(buffer, _BUFFER_KEYS, f"{label} buffer")
    ingredients = []
    for item in _list(buffer.get("ingredients"), f"{label} buffer ingredients"):
        ingredient = _object(item, f"{label} buffer ingredient")
        ingredients.append({
            key: str(ingredient.get(key) or "")
            for key in ("name", "concentration", "unit", "role")
        })
    return {
        "bufferKey": str(buffer.get("bufferKey") or ""),
        "mode": _enum(buffer.get("mode", "as-planned"), BUFFER_MODES, f"{label} buffer mode"),
        "title": str(buffer.get("title") or ""),
        "purpose": str(buffer.get("purpose") or ""),
        "pH": str(buffer.get("pH") or ""),
        "ingredients": ingredients,
        "sourceJobId": _optional_text(buffer.get("sourceJobId"), f"{label} buffer sourceJobId"),
        "notes": str(buffer.get("notes") or ""),
    }


def _normalize_attachment(value: Any, label: str) -> dict[str, Any]:
    item = _object(value, f"{label} attachment")
    _reject_unknown(item, _ATTACHMENT_KEYS, f"{label} attachment")
    kind = _enum(item.get("kind"), ATTACHMENT_KINDS, f"{label} attachment kind")
    job_id = _optional_text(item.get("jobId"), f"{label} attachment jobId")
    if kind in {"gel", "gel-lane", "chromatogram", "chromatogram-trace"} and not job_id:
        raise ValueError(f"A {kind} attachment on {label} must name its analysis jobId")
    lane = item.get("laneIndex")
    if lane is not None and (isinstance(lane, bool) or not isinstance(lane, int) or lane < 0):
        raise ValueError(f"{label} attachment laneIndex must be a non-negative integer")
    if kind == "gel-lane" and lane is None:
        raise ValueError(f"A gel-lane attachment on {label} must name its laneIndex")
    return {
        "id": _required_id(item.get("id"), f"{label} attachment id"),
        "kind": kind,
        "title": str(item.get("title") or ""),
        "notes": str(item.get("notes") or ""),
        "jobId": job_id,
        "sampleId": _optional_text(item.get("sampleId"), f"{label} attachment sampleId"),
        "laneIndex": lane,
        "traceId": _optional_text(item.get("traceId"), f"{label} attachment traceId"),
        "fileName": str(item.get("fileName") or ""),
        "mimeType": str(item.get("mimeType") or ""),
        "dataUrl": str(item.get("dataUrl") or ""),
    }


def _normalize_sample(value: Any) -> dict[str, Any]:
    sample = _object(value, "Sample")
    _reject_unknown(sample, _SAMPLE_KEYS, "Sample")
    sample_id = _required_id(sample.get("id"), "Sample id")
    label = f"Sample {sample_id!r}"
    name = str(sample.get("label") or "").strip()
    if not name:
        raise ValueError(f"{label} needs a label such as 'Clarified lysate'")
    storage = _object(sample.get("storage") or {}, f"{label} storage")
    _reject_unknown(storage, {"location", "temp", "aliquots"}, f"{label} storage")
    aliquots = storage.get("aliquots")
    if aliquots is not None and (isinstance(aliquots, bool) or not isinstance(aliquots, int) or aliquots < 0):
        raise ValueError(f"{label} aliquots must be a non-negative whole number")
    return {
        "id": sample_id,
        "stepId": _required_id(sample.get("stepId"), f"{label} stepId"),
        "label": name,
        "volumeMl": _quantity(sample.get("volumeMl"), f"{label} volumeMl"),
        "concMgMl": _quantity(sample.get("concMgMl"), f"{label} concMgMl"),
        "totalMg": _quantity(sample.get("totalMg"), f"{label} totalMg"),
        "storage": {
            "location": str(storage.get("location") or ""),
            "temp": str(storage.get("temp") or ""),
            "aliquots": aliquots,
        },
        "gelLaneRefs": [dict(_object(ref, f"{label} gel lane ref")) for ref in _list(sample.get("gelLaneRefs"), f"{label} gelLaneRefs")],
        "chromatogramFractionRefs": [dict(_object(ref, f"{label} fraction ref")) for ref in _list(sample.get("chromatogramFractionRefs"), f"{label} chromatogramFractionRefs")],
    }


# ---------------------------------------------------------------------------
# Roadmap importer
# ---------------------------------------------------------------------------


def plan_snapshot(jobs: list[dict[str, Any]], taken_at: str) -> dict[str, Any]:
    """Freeze the protein's planning jobs (deep-copied through JSON on save)."""
    snapshot: dict[str, Any] = {}
    for job in jobs:
        app_type = job.get("appType")
        if app_type in PLAN_APP_TYPES and app_type not in snapshot:
            snapshot[app_type] = {
                "jobId": job.get("id"),
                "name": job.get("name") or "",
                "updatedAt": job.get("updatedAt"),
                "config": job.get("config") or {},
            }
    return {"takenAt": taken_at, "jobs": snapshot}


def roadmap_to_run(
    roadmap_job: dict[str, Any] | None,
    jobs: list[dict[str, Any]],
    *,
    now: str,
    new_id=lambda: str(uuid.uuid4()),
) -> dict[str, Any]:
    """Build "Run 1" from the protein's roadmap board and planning jobs.

    The steps are the board as the scientist sees it: the saved steps in their
    saved order, then any live plan step the saved board does not have yet
    (the same merge as ``mergeSavedSteps`` in lib/roadmap-steps.ts). Step ids
    are kept so gel lanes bound to a roadmap step still resolve.
    """
    snapshot = plan_snapshot(jobs, now)
    configs = {app_type: job["config"] for app_type, job in snapshot["jobs"].items()}
    live = {step_id: _live_step(step_id, kind, title, configs) for step_id, kind, title in LIVE_ROADMAP_STEPS}
    saved_raw = (roadmap_job or {}).get("config", {}).get("steps")
    saved = [item for item in saved_raw if isinstance(item, dict)] if isinstance(saved_raw, list) else []
    warnings: list[str] = []
    steps: list[dict[str, Any]] = []
    seen: set[str] = set()
    for prior in saved:
        step_id = str(prior.get("id") or "").strip() or f"added-{new_id()}"
        if step_id in seen:
            warnings.append(f"Roadmap step id {step_id!r} appeared twice; the second copy was kept as a new step.")
            step_id = f"added-{new_id()}"
        seen.add(step_id)
        steps.append(_imported_step(step_id, prior, live.get(step_id), snapshot, warnings, new_id))
    for step_id, base in live.items():
        if step_id not in seen:
            steps.append(_plan_step(base, snapshot))
    imported_from = {
        "appType": ROADMAP_APP_TYPE,
        "jobId": roadmap_job.get("id") if roadmap_job else None,
        "jobUpdatedAt": roadmap_job.get("updatedAt") if roadmap_job else None,
        "importedAt": now,
    }
    return normalize_run({
        "schemaVersion": SCHEMA_VERSION,
        "status": "planned",
        "startedAt": None,
        "planSnapshot": snapshot,
        "steps": steps,
        "samples": [],
        "importedFrom": imported_from,
        "importWarnings": warnings,
    })


def _live_step(step_id: str, kind: str, title: str, configs: dict[str, dict[str, Any]]) -> dict[str, Any]:
    """Port of ``liveSteps`` ids, titles, readiness and plan details."""
    def cfg(app_type: str) -> dict[str, Any]:
        value = configs.get(app_type)
        return value if isinstance(value, dict) else {}

    expression, vector = cfg("expression-system"), cfg("expression-planning")
    transformation, lysis = cfg("transformation-expression"), cfg("purification-lysis")
    affinity, cleavage = cfg("purification-affinity"), cfg("purification-cleavage")
    subtractive, sec, buffer = cfg("purification-subtractive"), cfg("purification-sec"), cfg("purification-buffer")
    retain = str(cleavage.get("proteaseId") or "") == "retain"
    table = {
        "transformation-expression": (
            bool(expression.get("strainId") or transformation.get("mediaId")),
            [("Host", expression.get("strainName")),
             ("Vector", _first(vector.get("vectorName"), expression.get("projectVectorName"), expression.get("vectorFamilyName"))),
             ("Medium", transformation.get("mediaName"))],
        ),
        "lysis": (bool(lysis.get("methodId")), [("Method", lysis.get("methodName")), ("Buffer", lysis.get("bufferName"))]),
        "affinity": (bool(affinity.get("columnId")), [("Column", affinity.get("columnName")), ("Tag", affinity.get("tag"))]),
        "cleavage": (
            bool(cleavage.get("proteaseId")),
            [("Strategy", _first(cleavage.get("proteaseName"), cleavage.get("proteaseId"))), ("Conditions", cleavage.get("conditions"))],
        ),
        "subtractive": (retain or bool(subtractive.get("columnId")), [("Column", subtractive.get("columnName")), ("Buffer", subtractive.get("bufferName"))]),
        "sec": (
            bool(sec.get("columnId")),
            [("Column", sec.get("columnName")), ("Buffer", sec.get("bufferName")),
             ("Expected mass", f"{sec['expectedMassKDa']} kDa" if sec.get("expectedMassKDa") else "")],
        ),
        "quality-storage": (bool(buffer.get("presetId")), [("Buffer plan", _first(buffer.get("presetName"), buffer.get("presetId")))]),
    }
    ready, rows = table[step_id]
    if step_id == "cleavage" and retain:
        title = "Retain affinity tag"
    details = [f"{name}: {value}" for name, value in rows if value is not None and str(value).strip()]
    return {"id": step_id, "kind": kind, "title": title, "ready": ready, "details": details}


def _plan_step(base: dict[str, Any], snapshot: dict[str, Any]) -> dict[str, Any]:
    kind = base["kind"]
    app_type = KIND_PLAN_APP_TYPE.get(kind)
    return {
        "id": base["id"],
        "kind": kind,
        "title": base["title"],
        "status": "planned",
        "plan": {
            "appType": app_type,
            "jobId": _snapshot_job_id(snapshot, app_type),
            "ready": base["ready"],
            "details": base["details"],
            "buffers": _plan_buffers(kind, snapshot),
            "instruction": "",
            "record": "",
        },
    }


def _imported_step(
    step_id: str,
    prior: dict[str, Any],
    live: dict[str, Any] | None,
    snapshot: dict[str, Any],
    warnings: list[str],
    new_id,
) -> dict[str, Any]:
    title = str(prior.get("title") or (live or {}).get("title") or "Custom purification step").strip()
    if live:
        kind = live["kind"]
        app_type = KIND_PLAN_APP_TYPE.get(kind)
        ready, details = live["ready"], live["details"]
    else:
        template = str(prior.get("title") or "").strip().lower()
        kind = _TEMPLATE_TITLE_KIND.get(template, "custom")
        app_type = KIND_PLAN_APP_TYPE.get(kind)
        legacy_job = str(prior.get("jobId") or "")
        if app_type is None and legacy_job in PLAN_APP_TYPES:
            app_type = legacy_job
        ready = prior.get("ready") is True
        details = [str(item) for item in prior.get("planDetails") or [] if str(item).strip()] if isinstance(prior.get("planDetails"), list) else []
    step = {
        "id": step_id,
        "kind": kind,
        "title": title[:200] or "Custom purification step",
        "status": "planned",
        "plan": {
            "appType": app_type,
            "jobId": _snapshot_job_id(snapshot, app_type),
            "ready": ready,
            "details": details,
            "buffers": _plan_buffers(kind, snapshot),
            "instruction": str(prior.get("instruction") or ""),
            "record": str(prior.get("record") or ""),
        },
        "bench": {"buffersUsed": []},
        "measurementRecords": [],
        "attachments": [],
        "measurements": empty_measurements(),
    }
    components = prior.get("components") if isinstance(prior.get("components"), list) else []
    for component in components:
        if isinstance(component, dict):
            _import_component(step, component, warnings, new_id)
    records = step["measurementRecords"]
    if len(records) == 1:
        step["measurements"] = _measurements_from_record(records[0], title, warnings)
    elif len(records) > 1:
        warnings.append(
            f"Step “{title}” had {len(records)} yield-and-purity records; all are kept under "
            "measurementRecords, but none was chosen as the step's measurement."
        )
    return step


def _import_component(step: dict[str, Any], component: dict[str, Any], warnings: list[str], new_id) -> None:
    kind = str(component.get("type") or "")
    component_id = str(component.get("id") or "").strip() or new_id()
    title, notes = str(component.get("title") or ""), str(component.get("notes") or "")
    if kind == "buffer":
        step["bench"]["buffersUsed"].append({
            "bufferKey": str(component.get("sourceBufferKey") or ""),
            # The board copied the saved planning buffer and could not edit it.
            "mode": "as-planned",
            "title": title,
            "purpose": str(component.get("purpose") or ""),
            "pH": str(component.get("pH") or ""),
            "ingredients": [item for item in component.get("ingredients") or [] if isinstance(item, dict)],
            "sourceJobId": component.get("sourceJobId") or None,
            "notes": notes,
        })
        return
    if kind == "measurement":
        step["measurementRecords"].append({
            "id": component_id, "title": title, "notes": notes,
            "yieldValue": str(component.get("yieldValue") or ""),
            "yieldUnit": str(component.get("yieldUnit") or ""),
            "yieldMethod": str(component.get("yieldMethod") or ""),
            "purityValue": str(component.get("purityValue") or ""),
            "purityMethod": str(component.get("purityMethod") or ""),
        })
        return
    attachment = {
        "id": component_id, "kind": "note", "title": title, "notes": notes,
        "fileName": str(component.get("fileName") or ""),
        "mimeType": str(component.get("mimeType") or ""),
        # Kept even for gels: the board's preview may be the only copy of an
        # earlier gel the single gel-analysis job has since overwritten (R3).
        "dataUrl": str(component.get("dataUrl") or ""),
    }
    if kind in {"gel", "chromatogram"}:
        job_id = str(component.get("sourceJobId") or "").strip()
        if job_id:
            attachment.update(kind=kind, jobId=job_id)
        else:
            warnings.append(f"A {kind} record “{title}” had no linked analysis job and was kept as a note.")
    elif kind == "image":
        attachment["kind"] = "image" if str(attachment["mimeType"]).startswith("image/") or not attachment["mimeType"] else "file"
    elif kind != "note":
        warnings.append(f"Roadmap record “{title}” had an unknown type {kind!r} and was kept as a note.")
    step["attachments"].append(attachment)


def _measurements_from_record(record: dict[str, str], title: str, warnings: list[str]) -> dict[str, Any]:
    values = empty_measurements()
    raw_yield, unit = record["yieldValue"].strip(), record["yieldUnit"].strip()
    if raw_yield:
        amount = _parse_number(raw_yield)
        if amount is None or amount < 0:
            warnings.append(f"Step “{title}”: yield {raw_yield!r} is not a number, so total protein was left empty.")
        elif unit in _YIELD_TO_MG:
            values["totalMg"] = amount * _YIELD_TO_MG[unit]
            values["totalMgMethod"] = record["yieldMethod"]
        else:
            warnings.append(
                f"Step “{title}”: yield {raw_yield} {unit or '(no unit)'} is not a protein mass, "
                "so total protein was left empty; the record keeps the value."
            )
    raw_purity = record["purityValue"].strip()
    if raw_purity:
        purity = _parse_number(raw_purity.rstrip("%").strip())
        if purity is None or not 0 <= purity <= 100:
            warnings.append(f"Step “{title}”: purity {raw_purity!r} is not a percentage from 0 to 100 and was left empty.")
        else:
            values["purityPct"] = purity
            values["purityMethod"] = record["purityMethod"]
    return values


def _plan_buffers(kind: str, snapshot: dict[str, Any]) -> list[str]:
    jobs = snapshot["jobs"]
    designed = (jobs.get("purification-buffer") or {}).get("config", {}).get("steps")
    designed = designed if isinstance(designed, dict) else {}
    keys = [f"purification-buffer:{name}" for name in KIND_BUFFER_STEPS.get(kind, ()) if name in designed]
    selected = {"lysis": "purification-lysis", "clarify": "purification-lysis",
                "reverse-affinity": "purification-subtractive", "sec": "purification-sec"}.get(kind)
    if selected and (jobs.get(selected) or {}).get("config", {}).get("bufferName"):
        keys.append(f"{selected}:selected")
    return keys


def _snapshot_job_id(snapshot: dict[str, Any], app_type: str | None) -> str | None:
    return (snapshot["jobs"].get(app_type) or {}).get("jobId") if app_type else None


# ---------------------------------------------------------------------------
# Small helpers
# ---------------------------------------------------------------------------


def _first(*values: Any) -> str:
    for value in values:
        if value is not None and str(value).strip():
            return str(value)
    return ""


def _parse_number(text: str) -> float | None:
    try:
        value = float(text)
    except ValueError:
        return None
    return value if math.isfinite(value) else None


def _object(value: Any, label: str) -> dict[str, Any]:
    if not isinstance(value, dict):
        raise ValueError(f"{label} must be an object")
    return value


def _list(value: Any, label: str) -> list[Any]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ValueError(f"{label} must be a list")
    return value


def _reject_unknown(value: dict[str, Any], allowed: set[str], label: str) -> None:
    unknown = sorted(set(value) - allowed)
    if unknown:
        raise ValueError(f"{label} has unknown field(s): {', '.join(unknown)}")


def _enum(value: Any, allowed: tuple[str, ...], label: str) -> str:
    if value not in allowed:
        raise ValueError(f"{label} must be one of {', '.join(allowed)} (got {value!r})")
    return value


def _required_id(value: Any, label: str) -> str:
    text = str(value or "").strip() if isinstance(value, (str, int)) and not isinstance(value, bool) else ""
    if not text or len(text) > 200:
        raise ValueError(f"{label} is required (1–200 characters)")
    return text


def _optional_text(value: Any, label: str) -> str | None:
    if value is None or value == "":
        return None
    if not isinstance(value, str):
        raise ValueError(f"{label} must be text")
    return value


def _quantity(value: Any, label: str) -> float | None:
    if value is None or value == "":
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise ValueError(f"{label} must be a number")
    number = float(value)
    if not math.isfinite(number) or number < 0:
        raise ValueError(f"{label} must be a finite number of zero or more")
    return number


def _duplicates(ids) -> str:
    seen: set[str] = set()
    repeated = []
    for value in ids:
        if value in seen and value not in repeated:
            repeated.append(value)
        seen.add(value)
    return ", ".join(repr(value) for value in repeated)


def _unique(items: list[dict[str, Any]], label: str) -> list[dict[str, Any]]:
    ids = [item["id"] for item in items]
    if len(set(ids)) != len(ids):
        raise ValueError(f"{label} ids must be unique: {_duplicates(ids)}")
    return items
