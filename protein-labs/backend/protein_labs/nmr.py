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
    "ucbshift2": {"label": "UCBShift 2.0", "reference": "Ptaszek et al., JACS (2024), doi:10.1021/jacs.3c10895", "commandEnv": "PROTEIN_LABS_UCBSHIFT_COMMAND"},
    "legolas": {"label": "LEGOLAS", "reference": "Darrows et al., JCTC (2025), doi:10.1021/acs.jctc.5c00026", "commandEnv": "PROTEIN_LABS_LEGOLAS_COMMAND"},
    "shiftx2": {"label": "SHIFTX2", "reference": "Neal et al., J Biomol NMR (2011), doi:10.1007/s10858-011-9478-4", "commandEnv": "PROTEIN_LABS_SHIFTX2_COMMAND"},
    "random_coil": {"label": "Random-coil fallback", "reference": "Wishart et al., J Biomol NMR (1995), doi:10.1007/BF00172291", "commandEnv": None},
}
RANDOM_COIL = {residue: {"H": 8.20, "N": 120.0} for residue in "ACDEFGHIKLMNQRSTVWY"}
RANDOM_COIL.update({"G": {"H": 8.32, "N": 109.8}, "S": {"H": 8.26, "N": 115.7}})


def _positions(value: Any) -> set[int]:
    return {int(item) for item in (value or []) if isinstance(item, int) or str(item).isdigit()}


def _run_configured_predictor(kind: str, structure_text: str, structure_format: str) -> list[dict[str, Any]] | None:
    """Run an explicitly configured CSV-producing command without a shell."""
    template = os.environ.get(PREDICTOR_DETAILS[kind]["commandEnv"] or "")
    if not template or not structure_text.strip():
        return None
    suffix = ".pdb" if structure_format.lower() == "pdb" else ".cif"
    with tempfile.TemporaryDirectory(prefix="protein-labs-nmr-") as directory:
        source = Path(directory) / f"structure{suffix}"
        source.write_text(structure_text, encoding="utf-8")
        command = [part.format(input=str(source)) for part in shlex.split(template)]
        completed = subprocess.run(command, text=True, capture_output=True, timeout=300, check=True)
    rows = list(csv.DictReader(StringIO(completed.stdout)))
    if not rows:
        raise ValueError(f"{PREDICTOR_DETAILS[kind]['label']} returned no CSV rows")
    return rows


def _normalise_rows(rows: list[dict[str, Any]]) -> tuple[dict[int, dict[str, float]], list[dict[str, Any]]]:
    backbone: dict[int, dict[str, float]] = {}
    extra: list[dict[str, Any]] = []
    for row in rows:
        atom = str(row.get("ATOM_TYPE") or row.get("atomType") or row.get("atom") or "").upper()
        position_text = row.get("SEQ_ID") or row.get("sequencePosition") or row.get("residueNumber")
        value_text = row.get("CHEMICAL_SHIFT") or row.get("chemicalShiftPpm") or row.get("shift")
        try:
            position, value = int(str(position_text)), float(str(value_text))
        except (TypeError, ValueError):
            continue
        if atom in {"H", "HN", "N"}:
            backbone.setdefault(position, {})["H" if atom in {"H", "HN"} else "N"] = value
        elif atom in {"NE2", "ND2", "NE1", "HE21", "HE22", "HD21", "HD22", "HE1"}:
            extra.append({"sequencePosition": position, "atomType": atom, "chemicalShiftPpm": value})
    return backbone, extra


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
    model_rows, extra_peaks = _normalise_rows(raw_rows or [])
    disorder, ligand_adjacent = _positions(request.get("disorderedPositions")), _positions(request.get("ligandAdjacentPositions"))
    residues = []
    for position, residue in enumerate(sequence, 1):
        proline, disordered = residue == "P", position in disorder
        shifts = RANDOM_COIL.get(residue, {"H": None, "N": None}) if (disordered or chosen == "random_coil") else model_rows.get(position, {})
        h_shift, n_shift = shifts.get("H"), shifts.get("N")
        residues.append({"sequencePosition": position, "residue": residue, "hShiftPpm": h_shift, "nShiftPpm": n_shift, "hasHnPeak": not proline, "flags": {"prolineNoHnPeak": proline, "disordered": disordered, "ligandAdjacent": position in ligand_adjacent, "collapsedAmideRegion": bool(disordered and h_shift is not None and 7.8 <= h_shift <= 8.5), "structurePredictionUnavailable": bool(not disordered and chosen == "random_coil")}})
    detail = PREDICTOR_DETAILS[chosen]
    result = {"predictionStatus": "structure_aware" if chosen != "random_coil" else "limited_random_coil_only", "predictor": {"id": chosen, "label": detail["label"], "reference": detail["reference"], "publishedExpectedRmsePpm": BACKBONE_RMSE_PPM[chosen]}, "residues": residues, "sideChainPeaks": extra_peaks, "warnings": failures + (["No configured structure-aware predictor was available; folded residues are shown only as a random-coil guide, not a structural assignment prediction."] if chosen == "random_coil" else []), "method": {"deterministic": True, "disorderTreatment": "Random-coil shifts are used for supplied disordered positions.", "ligandContactTreatment": "Supplied ligand-adjacent positions are flagged; their shifts are not corrected."}}
    benchmark = _benchmark(list(request.get("observedAssignments") or []), residues)
    if benchmark is not None:
        result["benchmark"] = benchmark
    return result
