# Project Trees API

Project trees are stored in the same SQLite database as Protein Planner. All
routes use the `/v1/protein-planner/project-trees` base path and JSON bodies.

## Tree and link routes

| Method | Path | Body / result |
| --- | --- | --- |
| `GET` | `/project-trees` | `{ "trees": Tree[] }` |
| `GET` | `/project-trees/{treeId}` | `Tree` |
| `POST` | `/project-trees` | `{ "name", "rootProjectId" }` → `Tree` |
| `PATCH` | `/project-trees/{treeId}` | `{ "name" }` → `Tree` |
| `DELETE` | `/project-trees/{treeId}` | `{ "deleted": treeId }` |
| `POST` | `/project-trees/{treeId}/links` | `{ "fromProjectId", "toProjectId", "changeType"?, "description"? }` → `TreeLink` |
| `PATCH` | `/project-trees/{treeId}/links/{linkId}` | Any link fields; changing either endpoint re-parents it → `TreeLink` |
| `DELETE` | `/project-trees/{treeId}/links/{linkId}` | `{ "deleted": linkId }` |
| `GET` | `/project-trees/diff?fromProjectId=...&toProjectId=...` | `ProjectDiff` |
| `POST` | `/project-trees/{treeId}/branches` | `{ "fromProjectId", "toProjectId", "note"? }` → updated `Tree` |
| `PATCH` | `/project-trees/{treeId}/branches/{branchId}` | `{ "fromProjectId"?, "toProjectId"?, "note"? }` → updated `Tree` |
| `DELETE` | `/project-trees/{treeId}/branches/{branchId}` | updated `Tree` |
| `GET` | `/project-diff?from=...&to=...` | compact UI `ProjectDiff` |

The `branches` routes and `/project-diff` are presentation aliases used by the
Lineage UI. The original `links` routes and detailed diff stay stable for
existing clients.

Links are directed. The service rejects self-links, duplicate directed links,
cycles, and new links to projects that do not exist. A project deleted after a
link was created remains in the tree as `{ "project": null, "missing": true }`;
the last computed branch summary remains available.

## Stable response shapes

```json
{
  "id": "tree-id",
  "name": "Construct lineage",
  "rootProjectId": "project-1",
  "nodes": [
    {
      "projectId": "project-1",
      "project": { "id": "project-1", "name": "Wild type" },
      "missing": false
    }
  ],
  "links": [
    {
      "id": "link-id",
      "fromProjectId": "project-1",
      "toProjectId": "project-2",
      "changeType": "Construct change",
      "description": "Optional user note",
      "diffSummary": "K73A · Vector: pET-28a → pMAL-c5X",
      "changeCategories": ["sequence", "vector"],
      "changeCount": 2,
      "createdAt": "2026-10-20T12:00:00+00:00",
      "updatedAt": "2026-10-20T12:00:00+00:00"
    }
  ],
  "relationships": ["compatibility alias containing the same link objects"],
  "branches": [
    {
      "id": "link-id",
      "fromProjectId": "project-1",
      "toProjectId": "project-2",
      "summary": "K73A · Vector: pET-28a → pMAL-c5X",
      "categories": ["sequence", "vector"],
      "changeCount": 2,
      "note": "Optional user note"
    }
  ],
  "createdAt": "2026-10-20T12:00:00+00:00",
  "updatedAt": "2026-10-20T12:00:00+00:00"
}
```

Every item in `ProjectDiff.changes` contains `category`, `kind`, `before`,
`after`, `summary`, and `details`. Categories appear in experimental order:
`sequence`, `construct`, `vector`, `host`, `purification`, `assay`, `protparam`,
then `metadata`. IDs and timestamps inside job configuration are excluded.

Sequence edits come from a Needleman–Wunsch global alignment with affine gap
penalties (match `2`, mismatch `-1`, gap-open `-4`, gap-extend `-0.5`). Public
residue coordinates and summaries are 1-based. `sequenceAlignment` includes the
aligned before/after strings and a match bar for the branch diff panel.

The compact `/project-diff` response maps `construct` to the UI category `tag`
and `metadata` to `notes`; unknown future categories map to `other`. Its
`sequence.alignedBefore` and `sequence.alignedAfter` are equal-length gapped
strings, and every item in `sequence.edits` has a 1-based parent-sequence
`position`. Its stable shape is:

```json
{
  "fromProjectId": "project-1",
  "toProjectId": "project-2",
  "summary": "K73A · Vector: pET-28a → pMAL-c5X",
  "categories": ["sequence", "vector"],
  "changes": [
    {
      "id": "sequence:substitution:0",
      "category": "sequence",
      "field": "Amino-acid sequence",
      "before": "K",
      "after": "A",
      "summary": "K73A"
    }
  ],
  "sequence": {
    "identityPercent": 99.9,
    "lengthBefore": 1000,
    "lengthAfter": 1000,
    "alignedBefore": "...K...",
    "alignedAfter": "...A...",
    "edits": [
      {
        "kind": "substitution",
        "position": 73,
        "before": "K",
        "after": "A",
        "label": "K73A"
      }
    ]
  },
  "protparam": []
}
```

`sequence` is `null` when the amino-acid sequences are identical. UI category
values are `sequence`, `vector`, `host`, `tag`, `purification`, `assay`,
`protparam`, `notes`, or `other`.

## One-time localStorage import

`POST /project-trees/import` accepts the exact v1 browser shape:

```json
{
  "sourceKey": "protein-labs-project-trees-v1",
  "trees": [
    {
      "id": "legacy-tree-id",
      "name": "Construct lineage",
      "rootProjectId": "project-1",
      "relationships": [
        {
          "id": "legacy-link-id",
          "fromProjectId": "project-1",
          "toProjectId": "project-2",
          "changeType": "Construct change",
          "description": "K73A"
        }
      ],
      "createdAt": "2025-01-01T00:00:00Z",
      "updatedAt": "2025-01-01T00:00:00Z"
    }
  ]
}
```

`sourceKey` may be omitted; it defaults to
`protein-labs-project-trees-v1`. The response is:

```json
{
  "confirmed": true,
  "importedTreeIds": ["legacy-tree-id"],
  "existingTreeIds": [],
  "imported": 1,
  "skipped": 0,
  "trees": []
}
```

The import is one transaction and idempotent by `sourceKey` plus legacy tree
ID. Replays never overwrite later database edits. Missing historical projects
are imported as missing nodes so lineage is not discarded. The UI must keep the
original localStorage value until it receives a successful response with
`confirmed: true`; it must retain that value after any network or validation
error.
