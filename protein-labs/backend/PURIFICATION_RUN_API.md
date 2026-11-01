# Purification run API

A purification run is one prep of a protein: a frozen snapshot of the plan,
ordered steps with what was done at the bench, measurements, attachments and
samples. It replaces the one-per-protein `purification-roadmap` board
(HOM-381 report §2.2, migration step 3). Code:
`protein_labs/protein_planner/purification_run.py`.

## Storage

Each run is a project job with `appType: "purification-run"`. A protein can
have any number of runs. The run name is the job `name` (for example
"Prep 2 · 2 L TB"); the protein is the job `proteinId`. Neither is repeated
inside `config`.

Runs use the existing job endpoints:

| Method | Path | Notes |
|---|---|---|
| `POST` | `/v1/protein-planner/proteins/{proteinId}/jobs` | `{"appType": "purification-run", "name": "...", "config": {...}}`. `config` is validated; `{}` is a valid empty run. |
| `PUT` | `/v1/protein-planner/proteins/{proteinId}/jobs/{jobId}` | Validated the same way. |
| `DELETE` | `/v1/protein-planner/proteins/{proteinId}/jobs/{jobId}` | |
| `POST` | `/v1/protein-planner/proteins/{proteinId}/purification-runs/import-roadmap` | One-shot importer, below. |
| `POST` | `/v1/protein-planner/proteins/{proteinId}/purification-runs` | `{"name"?: "..."}`. Creates a **new** run job every call: plan snapshot taken now, one `planned` step per live plan step (same ids and details as the importer). The default name is "Run N", where N is one more than both the run count and the highest existing "Run N". A deleted run's number is not reused. The importer names its run "Run 1", or the next free "Run N" if "Run 1" is taken. Returns `201` with the job. |

The UI must create one job per run (`createJob` / the endpoint above) and must
never use `ensureProjectJob` for runs, which reuses the first job of an
appType (report R2/R3).

### For the UI (`lib/purification-run.ts`)

- A run in the UI is `{id: job.id, proteinId: job.proteinId, name: job.name, ...job.config}`.
  When saving, send `id`/`proteinId`/`name` as job fields, **not** inside `config`.
  Unknown config keys are rejected with a 400.
- Not measured is `null`. A real measured `0` is allowed. Strings in numeric
  fields are rejected.
- `order` is rewritten from list position on save. Reducers may leave it stale.
- Removing a step must also remove or retarget everything that points at it.
  Otherwise the save is rejected. That covers:
  - its samples, and those samples' ids in other steps' `bench.inputSampleId`
    and `attachments[].sampleId`;
  - `decision.createdStepId`;
  - `repeatOfStepId`.
- Step templates, per-kind bench field lists and the reducers (insert, move,
  remove, update, decide) are UI-owned. `bench.parameters` is a free-form JSON
  object keyed however the UI's bench field list defines it.

Saved runs come back in the protein bundle's `projectJobs`, like every job.

An invalid config gets `400 {"error": "<reason>"}` and nothing is saved. The
validator **rejects unknown keys** rather than dropping them. If the UI needs a
new field, add it here and in `purification_run.py` first.

## Run config (`schemaVersion: 1`)

```jsonc
{
  "schemaVersion": 1,
  "status": "planned",            // planned | running | done | abandoned
  "startedAt": null,              // ISO text or null
  "planSnapshot": {
    "takenAt": "2026-11-01T…Z",
    "jobs": {                     // planning appTypes only (list below)
      "purification-affinity": { "jobId": "…", "name": "…", "updatedAt": "…", "config": { … } }
    }
  },
  "steps": [RunStep],
  "samples": [Sample],
  "importedFrom": null,           // set by the importer, below
  "importWarnings": []            // plain-language notes from the importer
}
```

Planning appTypes allowed in `planSnapshot.jobs`: `expression-system`,
`expression-planning`, `transformation-expression`, `purification-lysis`,
`purification-affinity`, `purification-cleavage`, `purification-subtractive`,
`purification-sec`, `purification-buffer`, `purification-workflow`.

### RunStep

```jsonc
{
  "id": "affinity",               // unique in the run; roadmap ids are kept
  "kind": "capture",              // expression | harvest | lysis | clarify | capture | wash-elute |
                                  // buffer-exchange | cleavage | reverse-affinity | iex | hic | sec |
                                  // concentrate | qc | formulate-store | custom
  "title": "Affinity capture",    // 1–200 characters
  "order": 3,                     // always rewritten to the 1-based list position
  "status": "planned",            // planned | in-progress | done | skipped | failed
  "plan": {
    "appType": "purification-affinity",   // planning job this step reads, or null
    "jobId": "…",                          // that job's id from the snapshot, or null
    "ready": true,                          // planning choices were saved
    "details": ["Column: HisTrap HP 5 mL", "Tag: His6"],
    "buffers": ["purification-buffer:binding", "purification-buffer:elution"],
    "instruction": "", "record": ""
  },
  "bench": {
    "date": null, "operator": "",
    "inputSampleId": null,        // must be a sample from an earlier step
    "parameters": {},             // free-form per kind (CV, flow, fractions…)
    "buffersUsed": [{
      "id": null, "bufferKey": "purification-buffer:binding", "mode": "as-planned",   // or "edited"
      "title": "", "purpose": "", "pH": "",
      "ingredients": [{"name": "", "concentration": "", "unit": "", "role": ""}],
      "sourceJobId": null, "notes": ""
    }],
    "deviations": "", "notes": ""
  },
  "outputs": ["pool"],            // ids of samples whose stepId is this step
  "measurements": {               // numbers are finite and >= 0, or null
    "volumeMl": null, "a280": null, "concMgMl": null, "totalMg": null,
    "totalMgMethod": "", "purityPct": null /* 0–100 */, "purityMethod": "",
    "activity": null              // or {"value": 120, "unit": "U/mg"}
  },
  "measurementRecords": [],       // roadmap yield/purity records, kept as typed (strings)
  "attachments": [{
    "id": "g-1",
    "kind": "gel",                // gel | gel-lane | chromatogram | chromatogram-trace | image | file | note
    "title": "", "notes": "",
    "jobId": "…",                 // required for gel, gel-lane, chromatogram, chromatogram-trace
    "sampleId": null, "laneIndex": null /* required for gel-lane */, "traceId": null,
    "fileName": "", "mimeType": "", "dataUrl": ""
  }],
  "decision": null,               // or {"outcome": proceed|repeat|insert|stop, "reason": "", "createdStepId": null}
  "repeatOfStepId": null
}
```

### Sample

```jsonc
{
  "id": "pool", "stepId": "affinity", "label": "E2–E4 pool",
  "volumeMl": null, "concMgMl": null, "totalMg": null,
  "storage": {"location": "", "temp": "", "aliquots": null},
  "gelLaneRefs": [], "chromatogramFractionRefs": []
}
```

### Integrity rules

The validator enforces these rules:

- Step, sample and attachment ids are unique.
- Every sample's `stepId` is a step in the run.
- A step's `outputs` are samples of that step.
- `bench.inputSampleId` comes from a step earlier in the run.
- `attachments[].sampleId`, `decision.createdStepId` and `repeatOfStepId` point
  at things that exist.

## Importer: roadmap → "Run 1"

`POST …/purification-runs/import-roadmap` (no body) returns
`{"created": true, "run": ProjectJob}` with status `201`. If the protein
already has a run imported from its roadmap, it returns that run as
`{"created": false, "run": …}` with status `200`. The importer is idempotent
and safe to call on every open. The `purification-roadmap` job is only read.
It is never changed or deleted.

How the importer maps the board:

| Roadmap | Run |
|---|---|
| Saved `steps[]` in board order, then any live plan step the board never saved (the same merge as `mergeSavedSteps`) | `steps[]`. Ids are kept, so gel-lane `stageId` bindings still resolve. |
| Fixed step id (`lysis`, `affinity`, …) or a template title for added steps | `kind`. A renamed custom step becomes `custom`. |
| `ready` | `plan.ready`. Every step's `status` is `planned`. |
| Cleavage → subtractive job (R8) | `plan.appType` is set from the kind: cleavage reads `purification-cleavage`. QC/storage reads `purification-sec`, which holds the final storage buffer (`finalStorageBuffer`). |
| Live step text | `plan.record` keeps the static "what to record" text. `plan.instruction` is left empty for live steps, because the board fills it with placeholder prose for unsaved choices (R9). |
| Step title over 200 characters | Shortened to 200, with the full title in `importWarnings`. |
| `buffer` component | `bench.buffersUsed[]`, `mode: "as-planned"` |
| `measurement` component | `measurementRecords[]` (verbatim). If a step has exactly one record, it also fills `measurements`: yield in mg/µg becomes `totalMg`, and purity 0–100 % becomes `purityPct`. |
| `gel` / `chromatogram` with `sourceJobId` | An attachment of that kind. A gel preview `dataUrl` is kept, because it may be the only copy of a gel that was later overwritten (R3). |
| `image` | An `image` attachment, or `file` if the item is not an image. |
| `note`, or a gel or chromatogram with no linked job | A `note` attachment. |
| — | `samples: []`. The roadmap had no samples. |

The importer does not turn every value into a number. When a value is not
converted, the original text stays in `measurementRecords` and a plain-language
line is added to `importWarnings`. This happens when:

- a yield is in "% recovery", "mg/L culture" or "Other";
- a number is not readable, for example `12,4`;
- a purity is above 100;
- one step has more than one yield/purity record;
- a gel or chromatogram has no linked job.

`importedFrom` is set to:

```json
{"appType": "purification-roadmap", "jobId": "<roadmap job id or null>", "jobUpdatedAt": "…", "importedAt": "…"}
```

`importedFrom` is fixed once set: a `PUT` that clears or changes it keeps the
stored value, so a later import cannot create a second "Run 1".

`jobId` is `null` when the protein had no saved board. In that case the run is
built from the live plan.
