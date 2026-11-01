"""Deterministic ¹H–¹⁵N HSQC prediction orchestration."""
from __future__ import annotations

import csv
from io import StringIO
import math
import os
from pathlib import Path
import shlex
import subprocess
import tempfile
from typing import Any

BACKBONE_RMSE_PPM = {
    "ucbshift2": {"H": 0.31, "N": 1.83}, "shiftx2": {"H": 0.17, "N": 1.12},
    "legolas": {"H": None, "N": None}, "random_coil": {"H": None, "N": None},
}
PREDICTOR_DETAILS = {
    "ucbshift2": {"label": "UCBShift 2.0", "reference": "Ptaszek et al., JACS (2024), doi:10.1021/jacs.4c10474", "commandEnv": "PROTEIN_LABS_UCBSHIFT_COMMAND"},
    "legolas": {"label": "LEGOLAS", "reference": "Darrows et al., JCTC (2025), doi:10.1021/acs.jctc.5c00026", "commandEnv": "PROTEIN_LABS_LEGOLAS_COMMAND"},
    "shiftx2": {"label": "SHIFTX2", "reference": "Neal et al., J Biomol NMR (2011), doi:10.1007/s10858-011-9478-4", "commandEnv": "PROTEIN_LABS_SHIFTX2_COMMAND"},
    "random_coil": {"label": "Random-coil fallback", "reference": "Wishart et al., J Biomol NMR (1995), doi:10.1007/BF00227471", "commandEnv": None},
}
# Wishart DS, Bigam CG, Holm A, Hodges RS, Sykes BD, J Biomol NMR 5:67-81 (1995),
# doi:10.1007/BF00227471: backbone amide ¹H / ¹⁵N (ppm, DSS-referenced) of X in
# Ac-GGXAGG-NH2 in 1 M urea, 25 °C, pH 5. Cys is the reduced form. Values as
# tabulated from that paper in UCBShift/CSpred (THGLab/CSpred ucbshifty.py).
RANDOM_COIL = {
    "A": {"H": 8.24, "N": 123.8}, "C": {"H": 8.32, "N": 118.8}, "D": {"H": 8.34, "N": 120.4},
    "E": {"H": 8.42, "N": 120.2}, "F": {"H": 8.30, "N": 120.3}, "G": {"H": 8.33, "N": 108.8},
    "H": {"H": 8.42, "N": 118.2}, "I": {"H": 8.00, "N": 119.9}, "K": {"H": 8.29, "N": 120.4},
    "L": {"H": 8.16, "N": 121.8}, "M": {"H": 8.28, "N": 119.6}, "N": {"H": 8.40, "N": 118.7},
    "Q": {"H": 8.32, "N": 119.8}, "R": {"H": 8.23, "N": 120.5}, "S": {"H": 8.31, "N": 115.7},
    "T": {"H": 8.15, "N": 113.6}, "V": {"H": 8.03, "N": 119.2}, "W": {"H": 8.25, "N": 121.3},
    "Y": {"H": 8.12, "N": 120.3},
}
# Same paper's nearest-neighbour set: X in Ac-GGXPGG-NH2, used when the next residue is proline.
RANDOM_COIL_BEFORE_PROLINE = {
    "A": {"H": 8.19, "N": 125.0}, "C": {"H": 8.30, "N": 119.9}, "D": {"H": 8.31, "N": 121.4},
    "E": {"H": 8.34, "N": 121.7}, "F": {"H": 8.13, "N": 120.9}, "G": {"H": 8.21, "N": 109.1},
    "H": {"H": 8.37, "N": 118.2}, "I": {"H": 8.06, "N": 121.7}, "K": {"H": 8.18, "N": 121.6},
    "L": {"H": 8.14, "N": 122.6}, "M": {"H": 8.25, "N": 120.7}, "N": {"H": 8.37, "N": 119.0},
    "Q": {"H": 8.29, "N": 120.6}, "R": {"H": 8.20, "N": 121.3}, "S": {"H": 8.26, "N": 116.6},
    "T": {"H": 8.15, "N": 116.0}, "V": {"H": 8.02, "N": 120.5}, "W": {"H": 8.09, "N": 122.2},
    "Y": {"H": 8.10, "N": 120.8},
}


def random_coil_shifts(sequence: str, position: int) -> dict[str, float | None]:
    """Wishart 1995 random-coil H/N for the 1-based position, with the preceding-proline correction."""
    residue = sequence[position - 1]
    table = RANDOM_COIL_BEFORE_PROLINE if sequence[position:position + 1] == "P" else RANDOM_COIL
    return dict(table.get(residue, {"H": None, "N": None}))


def _positions(value: Any) -> set[int]:
    return {int(item) for item in (value or []) if isinstance(item, int) or str(item).isdigit()}


def _run_configured_predictor(kind: str, structure_text: str, structure_format: str) -> list[dict[str, Any]] | None:
    """Run an explicitly configured CSV-producing command without a shell."""
    template = os.environ.get(PREDICTOR_DETAILS[kind]["commandEnv"] or "")
    if not template or not structure_text.strip():
        return None
    if "{input}" not in template:
        raise ValueError(
            f"{PREDICTOR_DETAILS[kind]['label']} command must include the {{input}} placeholder"
        )
    suffix = ".pdb" if structure_format.lower() == "pdb" else ".cif"
    with tempfile.TemporaryDirectory(prefix="protein-labs-nmr-") as directory:
        source = Path(directory) / f"structure{suffix}"
        source.write_text(structure_text, encoding="utf-8")
        # Plain substitution so other braces in the command (e.g. awk programs) stay literal.
        command = [part.replace("{input}", str(source)) for part in shlex.split(template)]
        completed = subprocess.run(command, text=True, capture_output=True, timeout=300, check=True)
    rows = list(csv.DictReader(StringIO(completed.stdout)))
    if not rows:
        raise ValueError(f"{PREDICTOR_DETAILS[kind]['label']} returned no CSV rows")
    return rows


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _split_seq_id(text: str) -> tuple[str, str]:
    """`52A` -> (`52`, `A`): predictors often fold the insertion code into the residue number."""
    digits = text.rstrip("ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz")
    return digits, text[len(digits):].upper()


def _renumberer(mapping: list[dict[str, Any]]) -> Any:
    """Map a predictor's (author chain, auth_seq_id, insertion code) to a construct position."""
    by_chain: dict[tuple[str, str, str], int] = {}
    by_number: dict[tuple[str, str], set[int]] = {}
    for item in mapping:
        position = item.get("constructPosition") if isinstance(item, dict) else None
        if not isinstance(position, int) or isinstance(position, bool) or item.get("modeled") is False or _text(item.get("authSeqId")) == "":
            continue
        number, code = _text(item.get("authSeqId")), _text(item.get("insertionCode")).upper()
        by_chain[(_text(item.get("chainId")), number, code)] = position
        by_number.setdefault((number, code), set()).add(position)

    def lookup(chain: str, seq_id: str, code: str) -> int | None:
        number, folded = _split_seq_id(seq_id)
        code = code.upper() or folded
        if chain:
            return by_chain.get((chain, number, code))
        positions = by_number.get((number, code), set())
        return next(iter(positions)) if len(positions) == 1 else None
    return lookup


def _normalise_rows(rows: list[dict[str, Any]], mapping: list[dict[str, Any]] | None = None) -> tuple[dict[int, dict[str, float]], list[dict[str, Any]], list[str]]:
    backbone: dict[int, dict[str, float]] = {}
    extra: list[dict[str, Any]] = []
    lookup = _renumberer(mapping) if mapping is not None else None
    unmapped: set[tuple[str, str, str]] = set()
    sources: dict[int, str] = {}
    duplicates: set[int] = set()
    for row in rows:
        atom = str(row.get("ATOM_TYPE") or row.get("atomType") or row.get("atom") or "").upper()
        position_text = row.get("SEQ_ID") or row.get("sequencePosition") or row.get("residueNumber")
        value_text = row.get("CHEMICAL_SHIFT") or row.get("chemicalShiftPpm") or row.get("shift")
        try:
            value = float(str(value_text))
            if lookup is None:
                position = int(str(position_text))
        except (TypeError, ValueError):
            continue
        if lookup is not None:
            chain = _text(row.get("CHAIN") or row.get("chainId") or row.get("chain"))
            code = _text(row.get("INS_CODE") or row.get("insertionCode"))
            found = lookup(chain, _text(position_text), code)
            if found is None:
                unmapped.add((chain, _text(position_text), code))
                continue
            # A homo-oligomer predicts every copy; the first chain seen for a position is kept.
            if sources.setdefault(found, chain) != chain:
                duplicates.add(found)
                continue
            position = found
        if atom in {"H", "HN", "N"}:
            backbone.setdefault(position, {})["H" if atom in {"H", "HN"} else "N"] = value
        elif atom in {"NE2", "ND2", "NE1", "HE21", "HE22", "HD21", "HD22", "HE1"}:
            extra.append({"sequencePosition": position, "atomType": atom, "chemicalShiftPpm": value})
    notes = []
    if unmapped:
        notes.append(f"{len(unmapped)} predicted structure residue(s) have no construct position in residueMapping and were dropped.")
    if duplicates:
        notes.append(f"{len(duplicates)} construct position(s) were predicted on more than one chain; the first chain in the predictor output was used.")
    return backbone, extra, notes


def _benchmark(observed: list[dict[str, Any]], predictions: list[dict[str, Any]]) -> dict[str, Any] | None:
    if not observed:
        return None
    indexed = {(int(row["sequencePosition"]), str(row["atomType"]).upper()): float(row["chemicalShiftPpm"]) for row in observed if row.get("sequencePosition") is not None and row.get("atomType") and row.get("chemicalShiftPpm") is not None}
    errors: dict[str, list[float]] = {"H": [], "N": []}
    for row in predictions:
        for atom in ("H", "N"):
            actual, predicted = indexed.get((row["sequencePosition"], atom)), row.get(f"{atom.lower()}ShiftPpm")
            if actual is not None and predicted is not None:
                errors[atom].append(float(predicted) - actual)
    return {"matchedAssignments": {atom: len(values) for atom, values in errors.items()}, "rmsePpm": {atom: round(math.sqrt(sum(error * error for error in values) / len(values)), 4) if values else None for atom, values in errors.items()}}


def predict_hsqc(request: dict[str, Any]) -> dict[str, Any]:
    """Return a renderable guide; a missing model never masquerades as one."""
    sequence = "".join(str(request.get("sequence") or "").upper().split())
    if not sequence or any(residue not in RANDOM_COIL and residue != "P" for residue in sequence):
        raise ValueError("sequence must contain only the 20 standard amino-acid one-letter codes")
    structure_text, structure_format = str(request.get("structureText") or ""), str(request.get("structureFormat") or "cif")
    requested = str(request.get("predictor") or "auto").lower()
    candidates = [requested] if requested != "auto" else ["ucbshift2", "legolas", "shiftx2"]
    chosen, raw_rows, failures = "random_coil", None, []
    for candidate in candidates:
        if candidate not in {"ucbshift2", "legolas", "shiftx2"}:
            continue
        try:
            candidate_rows = _run_configured_predictor(candidate, structure_text, structure_format)
        except (OSError, subprocess.SubprocessError, ValueError) as error:
            failures.append(f"{candidate}: {error}")
            continue
        if candidate_rows is not None:
            chosen, raw_rows = candidate, candidate_rows
            break
    mapping = request.get("residueMapping")
    if mapping is not None and not isinstance(mapping, list):
        raise ValueError("residueMapping must be a list of structure residue mapping rows")
    model_rows, extra_peaks, numbering_notes = _normalise_rows(raw_rows or [], mapping)
    disorder, ligand_adjacent = _positions(request.get("disorderedPositions")), _positions(request.get("ligandAdjacentPositions"))
    residues = []
    for position, residue in enumerate(sequence, 1):
        proline, disordered = residue == "P", position in disorder
        shifts = random_coil_shifts(sequence, position) if (disordered or chosen == "random_coil") else model_rows.get(position, {})
        h_shift, n_shift = shifts.get("H"), shifts.get("N")
        residues.append({"sequencePosition": position, "residue": residue, "hShiftPpm": h_shift, "nShiftPpm": n_shift, "hasHnPeak": not proline, "flags": {"prolineNoHnPeak": proline, "disordered": disordered, "ligandAdjacent": position in ligand_adjacent, "collapsedAmideRegion": bool(disordered and h_shift is not None and 7.8 <= h_shift <= 8.5), "structurePredictionUnavailable": bool(not disordered and chosen == "random_coil")}})
    detail = PREDICTOR_DETAILS[chosen]
    structure_aware = chosen != "random_coil"
    result = {"predictionStatus": "structure_aware" if structure_aware else "limited_random_coil_only", "predictor": {"id": chosen, "label": detail["label"], "reference": detail["reference"], "publishedExpectedRmsePpm": BACKBONE_RMSE_PPM[chosen]}, "residues": residues, "sideChainPeaks": extra_peaks, "warnings": failures + (numbering_notes if structure_aware else []) + (["No configured structure-aware predictor was available; folded residues are shown only as a random-coil guide, not a structural assignment prediction."] if not structure_aware else ["External predictor command output is not asserted reproducible by this adapter; rerun before using it as a quantitative reference."]), "method": {"deterministic": not structure_aware, "determinismScope": "Built-in random-coil fallback is deterministic." if not structure_aware else "External command determinism is unknown; command version, model weights, and seed are not controlled by this adapter.", "disorderTreatment": "Random-coil shifts are used for supplied disordered positions.", "ligandContactTreatment": "Supplied ligand-adjacent positions are flagged; their shifts are not corrected.", "randomCoilTable": "Wishart et al. 1995 Ac-GGXAGG-NH2 amide H/N, with the Ac-GGXPGG-NH2 set for residues before proline.", "predictorNumbering": "renumbered_from_residue_mapping" if mapping is not None else "seq_id_is_construct_position"}}
    benchmark = _benchmark(list(request.get("observedAssignments") or []), residues)
    if benchmark is not None:
        result["benchmark"] = benchmark
    return result
