# ¹H–¹⁵N HSQC predictor API

`POST /v1/nmr/hsqc/predict` returns a deterministic per-residue assignment guide, not an acquired-spectrum peak list.

`auto` tries UCBShift 2.0, LEGOLAS, then SHIFTX2. Set `PROTEIN_LABS_*_COMMAND` to a command template containing `{input}`. It receives a temporary PDB/mmCIF path and must emit CSV with `SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT`; it runs without a shell and times out after five minutes.

| Tool | License/runtime note | H / N published RMSE (ppm) |
| --- | --- | --- |
| UCBShift 2.0 | Confirm availability with the licensor; external only | 0.31 / 1.83 |
| LEGOLAS | MIT; current source checkout ~70 MB; CPU env includes PyTorch, MDTraj, Biopython | no comparable H/N RMSE in upstream README |
| SHIFTX2 | external legacy fallback; confirm redistribution terms | 0.17 / 1.12 |

References: [UCBShift 2.0](https://doi.org/10.1021/jacs.3c10895), [LEGOLAS](https://doi.org/10.1021/acs.jctc.5c00026), and [SHIFTX2](https://doi.org/10.1007/s10858-011-9478-4).

Proline has no backbone amide proton (`hasHnPeak: false`). Supplied disordered residues use random-coil shifts and flag the crowded 7.8–8.5 ppm region. Ligand adjacency is a flag, not an unvalidated correction. `publishedExpectedRmsePpm` is model error; optional `benchmark.rmsePpm` is calculated against submitted assignments. Without an installed engine, `limited_random_coil_only` explicitly refuses to claim a folded-structure prediction.
