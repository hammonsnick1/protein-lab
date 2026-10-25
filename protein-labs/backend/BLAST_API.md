# BLAST job API

`POST /v1/protein-planner/proteins/{proteinId}/blast` submits a BLASTP job;
`GET /v1/protein-planner/blast/{rid}` returns the persisted job and polls the
remote provider. `POST /v1/protein-planner/blast/{rid}/cancel` stops local
polling (neither NCBI nor EMBL-EBI has a compatible remote deletion API).

The existing `status` values remain backward compatible: `waiting`, `complete`,
`failed`, `unknown`, and `canceled`. New clients should render `stageId` for
progress: `submitted`, `queued`, `running`, `parsing`, `done`, `failed`, or
`cancelled`. `stage` is the existing human-readable explanation. Every response
includes `submittedAt`, `updatedAt`, `querySequence` (or `null` for jobs saved
before this field existed), `results`, and a stable `parameters` object.

Each result is one hit. Its historic summary fields describe HSP 1. `hsps` is
the complete viewer data, one object per HSP:

```json
{
  "queryFrom": 1, "queryTo": 147,
  "hitFrom": 1, "hitTo": 147,
  "qseq": "MVHL...", "hseq": "MVHL...", "midline": "MVHL...",
  "identity": 1.0, "positives": 147, "gaps": 0,
  "alignLength": 147, "evalue": 0.0, "bitScore": 300.0
}
```

Positions are BLAST's 1-based inclusive query/hit positions. They are not
construct, UniProt, label-sequence, or author-residue coordinates. Hit-level
metadata includes `accession`, `uniprotAccession`, `description`,
`scientificName`, `taxonId`, and `hitLength` (with `length` retained for XML2
and EMBL-EBI compatibility). Missing alignment strings from historical provider
responses are returned as empty strings; no positions are inferred.
