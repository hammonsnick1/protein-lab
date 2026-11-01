# Crystallization assessment API

`GET /v1/protein-planner/proteins/{proteinId}/crystallization` and
`POST /v1/protein-planner/proteins/{proteinId}/crystallization/assess` return a
read-only evidence assessment. It is a screen-planning aid, never a guarantee.

`score.value` is a crystallization probability only after validated predictor
scores actually run. Today it is `null`, `score.status` is `unavailable`, and
`uncertainty.status` is `not_quantified`; the backend does not manufacture a
probability or range. `predictors` contains one cited record for Shoebill, the
PLM predictor, and MASCL, including each availability reason. The response also
contains `facts` already saved from UniProtKB, PDB homologues/crystal forms, and
AlphaFold, `explanations` in plain language, and `spaceGroupSuggestions` only
when a saved PDB homologue reports a group.

Each explanation and the `recommendation` carry citation ids
(`explanations[].citations`, `recommendationCitations`) from the app's
registry in `protein-labs-web/lib/citations.ts`; the UI renders them as
numbered references and ignores ids it does not know. Homologue counts are per
PDB entry and count only entries whose saved record names a space group, the
same rule the Space groups tab uses. An X-ray entry without a saved group is
reported as missing evidence, not as a crystal form.

## Availability and references

Shoebill is not shipped: its public checkout was audited 2026-10-31, contains
no `LICENSE` file, and requires AlphaFold2 plus external feature binaries. Its
model is about 35 kB, but size does not resolve the license/dependency issue.
PLM and MASCL code/weights are also not bundled, so their records honestly say
they were not run.

- Shoebill: <https://github.com/KJ-Liao/Shoebill>
- PLM predictor: <https://doi.org/10.1038/s41598-025-86519-5>
- MASCL: <https://doi.org/10.1002/prot.26844>
- PDB: <https://www.rcsb.org/>; UniProtKB: <https://www.uniprot.org/>
