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

## Random-coil fallback

Without a predictor, and for supplied disordered positions, each residue gets its amino-acid-specific random-coil amide ¹H/¹⁵N from Wishart DS, Bigam CG, Holm A, Hodges RS, Sykes BD, *J Biomol NMR* 5:67–81 (1995), [doi:10.1007/BF00227471](https://doi.org/10.1007/BF00227471): X in Ac-GGXAGG-NH2, 1 M urea, 25 °C, pH 5, DSS-referenced, reduced Cys. The paper's nearest-neighbour set for X in Ac-GGXPGG-NH2 is used when the next residue is proline. Other neighbour effects are not applied. The values were transcribed from that paper as tabulated in the UCBShift/CSpred source (`THGLab/CSpred`, `ucbshifty.py`). `method.randomCoilTable` names the table.

## Predictor numbering

External predictors number residues as the structure file does. Send the structure's residue mapping as `residueMapping`: the `mapping.residues` rows from the structure detail endpoint (`chainId` = author chain, `authSeqId`, `insertionCode`, `constructPosition`, `modeled`). The engine then renumbers each predicted row to a construct position:

- The predictor CSV may carry `CHAIN` and `INS_CODE` columns. An insertion code folded into `SEQ_ID` (for example `52A`) is also read.
- With a chain, `(chain, authSeqId, insertionCode)` must match a modelled mapping row exactly. Without a chain, the author number must resolve to a single construct position across all chains. This is the case for a homo-oligomer whose copies share numbering.
- Rows with no construct position are dropped, and a warning counts them. When several chains predict the same construct position, the first chain in the predictor output is kept, and a warning says so.

Without `residueMapping`, `SEQ_ID` is taken as the construct position (the old behaviour). `method.predictorNumbering` is `renumbered_from_residue_mapping` or `seq_id_is_construct_position`. Once clients send `residueMapping`, they no longer need to withhold structures whose author numbering differs from the construct.

The test fixture `tests/fixtures/nmr/bmrb_5387_hn_v3.1.1.61.csv` is a six-assignment subset selected from BMRB accession 5387, NMR-STAR 3.1.1.61: residues 2–4 (`GLN`, `ILE`, `PHE`), atoms `H` and `N`, with `Seq_ID` used as the one-based API `sequencePosition`. It is sourced from `https://bmrb.io/rest/bmrb/5387/nmr-star3` and checked against the documented 3/3 assignment match and random-coil fallback RMSE of 0.4605 ppm (H) / 3.7443 ppm (N), hand-computed from the Wishart 1995 values below (H errors −0.69, −0.32, −0.24; N errors −3.8, +4.9, +1.9 ppm). This is a fallback scoring fixture, not a claim that random-coil values reproduce folded ubiquitin.
