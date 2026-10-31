# Conservation (ConSurf) API

Per-residue evolutionary conservation under the existing Protein Planner v1
API. Sequence positions are one-based positions in the project's own sequence.
A value that is not available is JSON `null` or `""`; clients must never infer
one from a neighbouring residue.

The Structure Viewer's conservation colouring reads this contract, so the
per-residue shape below is the stable part of it.

## How a run is produced

ConSurf has no documented job-submission API. The `consurf.tau.ac.il` server is
a web form: a submission is an undocumented multipart POST with a CSRF token
and roughly forty fields, answered with a run number that is then watched on a
progress page. Protein Lab does not drive it. New runs follow the same shape as
AlphaFold Server submissions:

1. `POST .../conservation/consurf-job` writes the input files and records a
   `prepared` job with the steps for the user.
2. The user completes the run in their browser and downloads the
   "Amino Acid Conservation Scores" file (and the MSA if they want it kept).
3. `POST .../conservation/import` parses that file into the job.

ConSurf-DB *does* answer programmatically, through the endpoints its own pages
call (`find_chains`, `get_identical_chain`, `check_seq`, `Get_Score_File`,
`Show_Fasta`). `POST .../conservation/consurf-db` uses them for a
pre-calculated lookup. None of them is documented or version-guaranteed, so
treat that route as best-effort: a failure is reported as a `502` and the
prepared-upload flow above remains the dependable path.

## Prepare a submission

`POST /v1/protein-planner/proteins/{proteinId}/conservation/consurf-job` → `201`

Writes `<database dir>/consurf_submissions/<name>_consurf.fasta`, plus
`<name>_consurf_model.{cif,pdb}` when the project already has a predicted
model. Returns a job (below) with `status: "prepared"` and, in `metadata`:

| Field | Meaning |
| --- | --- |
| `serverUrl` | `https://consurf.tau.ac.il/` |
| `files[]` | `{kind: "fasta" \| "structure", path, label, bytes}`; a structure entry also carries `modelId`, `chain` and `chains` |
| `submissionDirectory` | Directory holding the prepared files |
| `steps[]` | Ordered instructions for the user, adapted to whether a model was written |
| `colors` | The published ConSurf palette (see below) |

`400` when the project has no amino-acid sequence yet.

## Pre-calculated ConSurf-DB lookup

`POST /v1/protein-planner/proteins/{proteinId}/conservation/consurf-db` → `200`

```json
{"pdbId": "1UBQ", "chain": "A"}
```

Both fields are optional. With no `pdbId`, the project's best saved PDB match
is used; with no saved PDB match at all, the sequence is looked up directly.
With a `pdbId` and no `chain`, the first chain ConSurf-DB lists is used.

ConSurf-DB stores one representative chain per set of identical chains, so the
chain asked for and the chain the grades came from can differ. Both are
recorded: `metadata.requestedPdbId` / `requestedChain` and
`metadata.identicalPdbId` / `identicalChain`, with `metadata.matchedBy` set to
`"pdb"` or `"sequence"`. `502` when ConSurf-DB is unreachable or holds no
entry; `404` when a named PDB entry has no chains there.

## Import a downloaded result

`POST /v1/protein-planner/proteins/{proteinId}/conservation/import` → `201`

```json
{"gradesPath": "/home/me/Downloads/consurf_grades.txt", "msaPath": "", "jobId": ""}
```

`gradesPath` is required and may be either layout in circulation: the ConSurf
server's `consurf_grades.txt` / `*.grades`, or ConSurf-DB's
`consurf_summary.txt`. `msaPath` is an optional FASTA alignment. `jobId`
completes a previously prepared job in place instead of creating a second run.

`400` with a specific explanation when the file is empty, is not a ConSurf
grades file, has a header but no readable rows, has grades outside the 1–9
scale, or when `msaPath` is not FASTA.

## Read a run

`GET /v1/protein-planner/proteins/{proteinId}/conservation` → `200`

```json
{"proteinId": "...", "jobs": [ /* summaries, no residues */ ], "colors": {}}
```

`GET /v1/protein-planner/proteins/{proteinId}/conservation/{jobId}` → `200`

The same job with its full `residues` array. The project bundle
(`GET /v1/protein-planner/proteins/{proteinId}`) carries the same summaries
under `conservationJobs`, again without `residues`, so loading a project with
several long runs stays one small response.

`DELETE /v1/protein-planner/proteins/{proteinId}/conservation/{jobId}` → `200`
`{"deleted": "<jobId>"}`.

### Job shape

```json
{
  "id": "4f1c…",
  "proteinId": "…",
  "method": "consurf",
  "source": "consurf-db | consurf-server | consurf-server-import",
  "status": "prepared | complete",
  "stage": "Pre-calculated ConSurf-DB analysis of 6Q00 chain A",
  "pdbId": "1UBQ",
  "chain": "A",
  "querySequence": "MQIFVKT…",
  "residueCount": 76,
  "error": "",
  "createdAt": "2026-10-31T17:00:00Z",
  "updatedAt": "2026-10-31T17:00:00Z",
  "metadata": { },
  "residues": [ ],
  "colors": { }
}
```

### Per-residue shape

One object per row of the grades file, in file order.

```json
{
  "position": 1,
  "residue": "M",
  "grade": 9,
  "score": -1.527,
  "insufficientData": false,
  "confidenceInterval": [-1.736, -1.428],
  "confidenceGrades": [9, 9],
  "alignedSequences": 159,
  "totalSequences": 300,
  "msaData": "159/300",
  "burialState": "e",
  "functionalState": "f",
  "residueVariety": "M 88%, L  5%, V  3%, I  3%, R <1%",
  "varietyResidues": [{"residue": "M", "percent": 88.0, "belowOnePercent": false}],
  "atomLabel": "MET:1:A",
  "pdbResidueNumber": "1",
  "pdbChain": "A",
  "modelled": true
}
```

| Field | Notes |
| --- | --- |
| `position` | One-based position in the sequence ConSurf was given, which is `querySequence`. Not a PDB author number. |
| `grade` | `1`–`9`; `9` most conserved, `1` most variable. Never outside that range: a file that breaks it is refused. |
| `score` | ConSurf's normalized conservation score. More negative is more conserved. |
| `insufficientData` | `true` for the sites ConSurf marks with `*`: fewer than six non-gapped homologues, or a confidence interval spanning four or more grades. The grade is still reported, because it is the *confidence* that is in question, but it must be shown as low-confidence rather than as a result. |
| `confidenceInterval` | `[low, high]` score bounds, or `null`. |
| `confidenceGrades` | `[low, high]` grade bounds, or `null`. |
| `alignedSequences` / `totalSequences` | The MSA fraction behind this site, or `null`. |
| `burialState` | `"b"` buried, `"e"` exposed, `""` not reported. |
| `functionalState` | `"f"` functional, `"s"` structural, `""` not reported. |
| `varietyResidues` | Parsed `residueVariety`. `percent` is `null` when the file lists residues without percentages; `belowOnePercent` carries ConSurf's own `<1%`. |
| `pdbResidueNumber` / `pdbChain` | Author residue number and chain from the ATOM column, as strings so insertion codes survive. Empty when the residue is absent from the model. |
| `modelled` | `false` for a residue the grades file shows as `-`: graded from the alignment, with no coordinates to colour. |

Consumers colouring a structure must key on `pdbResidueNumber` + `pdbChain`,
not on `position`, and must skip residues where `modelled` is `false`.

### Run metadata

| Field | Meaning |
| --- | --- |
| `layout` | `"consurf-db"`, `"consurf-server"` or `"unknown"` — which file layout was read |
| `columns[]` | Column names exactly as the file's header gave them |
| `gradeScale[]` | `{grade, from, to}` score windows, highest grade first, when the file states them |
| `chains[]` | Chain identifiers seen in the ATOM column |
| `residueCount` / `gradedCount` / `insufficientDataCount` | Totals; `gradedCount` excludes insufficient-data sites |
| `meanGrade` | Mean grade over `gradedCount` sites only, or `null` |
| `skippedRowCount` | Data rows that could not be read. Normally `0`; a non-zero value is worth showing. |
| `sequenceMatch` | `{compared, queryLength, gradedLength, identical, matchingResidues, coverage}` against the project's sequence |
| `gradedSequence` | The residue letters as the grades file gave them |
| `msa` | `{available, sequenceCount, alignmentLength, queryId, ids}` summary |
| `colors` | The palette below |

## The MSA

`GET /v1/protein-planner/proteins/{proteinId}/conservation/{jobId}/msa` → `200`

```json
{"proteinId": "…", "jobId": "…", "fasta": ">…", "available": true,
 "sequenceCount": 300, "alignmentLength": 118, "queryId": "Input_seq_SEQRES_A",
 "ids": ["…"]}
```

The alignment is kept whole but served from its own endpoint, because it is
often far larger than the grades themselves. `fasta` is `""` when the run had
no alignment. `ids` is capped at the first 25 names.

## Colours

`colors` is ConSurf's published scale, so every surface in the app and every
exported figure says the same thing:

| Grade | Hex | | Grade | Hex |
| --- | --- | --- | --- | --- |
| 9 (conserved) | `#A02560` | | 4 | `#EAFFFF` |
| 8 | `#F07DAB` | | 3 | `#D7FFFF` |
| 7 | `#FAC9DE` | | 2 | `#8CFFFF` |
| 6 | `#FCEDF4` | | 1 (variable) | `#10C8D1` |
| 5 | `#FFFFFF` | | insufficient data | `#FFFF96` |

Grades 3–7 are close to white and are indistinguishable in greyscale, so any
surface using them must also carry the grade as a number, a shape or a label.

## Lifecycle

Conservation grades are indexed by position in the sequence they were
calculated for, so changing a project's sequence deletes its runs. Renaming or
re-describing a project keeps them. Deleting a project deletes its runs.
