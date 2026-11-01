# ¹H–¹⁵N HSQC predictor API

`POST /v1/nmr/hsqc/predict` returns a per-residue assignment guide, not an acquired-spectrum peak list. The built-in random-coil fallback is deterministic. An external predictor result is explicitly marked non-deterministic because this adapter does not pin its executable, model weights, or random seed.

`auto` tries UCBShift 2.0, LEGOLAS, then SHIFTX2. Set `PROTEIN_LABS_*_COMMAND` to a command template containing the required `{input}` placeholder. It receives a temporary PDB/mmCIF path at that placeholder and must emit CSV with `SEQ_ID,ATOM_TYPE,CHEMICAL_SHIFT`; it runs without a shell and times out after five minutes. A missing `{input}` is rejected, so a constant command cannot be reported as structure-aware.

| Tool | License/runtime note | H / N published RMSE (ppm) |
| --- | --- | --- |
| UCBShift 2.0 | External only; upstream CSpred license permits educational, research, and not-for-profit use, not general commercial use | 0.31 / 1.83 |
| LEGOLAS | External only; MIT-licensed source repository is about 150 MB by GitHub’s reported repository size (checked 2026-10-31); CPU environment includes PyTorch, MDTraj, Biopython | no comparable H/N RMSE in upstream README |
| SHIFTX2 | External-only legacy fallback; no redistributable installation is bundled and its license must be confirmed by the operator before configuration | 0.17 / 1.12 |

The adapter does not install any predictor. At review time, the CSpred/UCBShift source repository was about 320 MB by GitHub’s reported repository size; SHIFTX2 1.13’s Linux archive was 163 MB compressed (download checked 2026-10-31) and requires legacy Python/Java/GCC tooling. This keeps installation and runtime dependencies outside the application process.

References: [UCBShift 2.0](https://doi.org/10.1021/jacs.4c10474), [LEGOLAS](https://doi.org/10.1021/acs.jctc.5c00026), and [SHIFTX2](https://doi.org/10.1007/s10858-011-9478-4).

Proline has no backbone amide proton (`hasHnPeak: false`). Supplied disordered residues use random-coil shifts and flag the crowded 7.8–8.5 ppm region. Ligand adjacency is a flag, not an unvalidated correction. `publishedExpectedRmsePpm` is model error; optional `benchmark.rmsePpm` is calculated against submitted assignments. Without an installed engine, `limited_random_coil_only` explicitly refuses to claim a folded-structure prediction.

The test fixture `tests/fixtures/nmr/bmrb_5387_hn_v3.1.1.61.csv` is a six-assignment subset selected from BMRB accession 5387, NMR-STAR 3.1.1.61: residues 2–4 (`GLN`, `ILE`, `PHE`), atoms `H` and `N`, with `Seq_ID` used as the one-based API `sequencePosition`. It is sourced from `https://bmrb.io/rest/bmrb/5387/nmr-star3` and checked against the documented 3/3 assignment match and random-coil fallback RMSE of 0.5119 ppm (H) / 3.6751 ppm (N). This is a fallback scoring fixture, not a claim that random-coil values reproduce folded ubiquitin.
