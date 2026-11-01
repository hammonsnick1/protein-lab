"""Structure evidence for the protein readiness check.

The readiness check asks whether the construct is likely to be intrinsically
disordered.  When the project holds a predicted model, per-residue pLDDT is
far better evidence than a sequence-composition window, so this module turns
the saved model and the latest ConSurf run into construct-numbered evidence.

Numbering: every position is one-based.  ``model*`` positions count along the
first polymer chain of the model (for an AlphaFold DB entry this equals the
UniProt position); ``construct*`` positions count along the user's construct.
A model position that does not align to the construct is reported with a
``None`` construct position, never guessed.
"""

from __future__ import annotations

from typing import Any, Iterable

from .integrations import parse_structure_geometry
from .structures import LOW_PLDDT_THRESHOLD, _one_letter, construct_reference_alignment


# Shorter low-confidence runs are usually loop or terminus fraying rather than
# a disordered region worth planning around.
MINIMUM_DISORDER_RUN = 10

SOURCE_PRIORITY = ("AlphaFold Server",)


def low_confidence_runs(
    plddt: list[float | None], *, threshold: float = LOW_PLDDT_THRESHOLD
) -> list[tuple[int, int]]:
    """Return one-based inclusive runs of residues whose pLDDT is below ``threshold``."""
    runs: list[tuple[int, int]] = []
    start: int | None = None
    for index, value in enumerate(plddt, 1):
        low = value is not None and value < threshold
        if low and start is None:
            start = index
        elif not low and start is not None:
            runs.append((start, index - 1))
            start = None
    if start is not None:
        runs.append((start, len(plddt)))
    return runs


def model_confidence_evidence(
    construct_sequence: str,
    model_sequence: str,
    plddt: list[float | None],
    *,
    threshold: float = LOW_PLDDT_THRESHOLD,
    minimum_run: int = MINIMUM_DISORDER_RUN,
) -> dict[str, Any]:
    """Summarise per-residue model confidence against the construct."""
    if len(model_sequence) != len(plddt):
        raise ValueError("Model sequence and pLDDT values must have the same length")
    alignment = construct_reference_alignment(construct_sequence, model_sequence)
    model_to_construct: dict[int, int] = alignment["uniprotToConstruct"]
    construct_to_model: dict[int, int | None] = alignment["constructToUniProt"]
    values = [value for value in plddt if value is not None]
    runs = low_confidence_runs(plddt, threshold=threshold)
    regions = []
    for start, end in runs:
        if end - start + 1 < minimum_run:
            continue
        mapped = [model_to_construct[p] for p in range(start, end + 1) if p in model_to_construct]
        segment = [plddt[p - 1] for p in range(start, end + 1) if plddt[p - 1] is not None]
        regions.append({
            "modelStart": start,
            "modelEnd": end,
            "length": end - start + 1,
            "constructStart": min(mapped) if mapped else None,
            "constructEnd": max(mapped) if mapped else None,
            "meanPlddt": round(sum(segment) / len(segment), 2),
        })
    unmodelled = [position for position, model in construct_to_model.items() if model is None]
    return {
        "threshold": threshold,
        "minimumRunLength": minimum_run,
        "meanPlddt": round(sum(values) / len(values), 2) if values else None,
        "modelResidueCount": len(model_sequence),
        "lowConfidenceResidueCount": sum(1 for value in values if value < threshold),
        "lowConfidenceRegions": regions,
        "shortLowConfidenceRuns": sum(1 for start, end in runs if end - start + 1 < minimum_run),
        "constructResiduesNotInModel": _ranges(unmodelled),
        "mismatches": len(alignment["mismatches"]),
    }


def conservation_grades_by_construct(
    construct_sequence: str, residues: Iterable[dict[str, Any]]
) -> str:
    """Return one ConSurf grade character per construct residue.

    ``1``-``9`` is the ConSurf grade; ``.`` marks a construct residue with no
    aligned ConSurf row or a row flagged as insufficient data.  ConSurf rows
    are numbered along their own sequence, so they are aligned to the
    construct rather than indexed by position.
    """
    rows = [row for row in residues if isinstance(row, dict)]
    construct = "".join(construct_sequence.split()).upper()
    sequence = "".join(str(row.get("residue") or "X")[:1].upper() for row in rows)
    alignment = construct_reference_alignment(construct, sequence)
    grades = []
    for position in range(1, len(construct) + 1):
        row_position = alignment["constructToUniProt"].get(position)
        row = rows[row_position - 1] if row_position else None
        grade = row.get("grade") if row else None
        usable = isinstance(grade, int) and 1 <= grade <= 9 and not row.get("insufficientData")
        grades.append(str(grade) if usable else ".")
    return "".join(grades)


def _ranges(positions: list[int]) -> list[dict[str, int]]:
    ranges: list[dict[str, int]] = []
    for position in sorted(positions):
        if ranges and position == ranges[-1]["end"] + 1:
            ranges[-1]["end"] = position
        else:
            ranges.append({"start": position, "end": position})
    return ranges


def model_sequence_and_plddt(structure_text: str, file_format: str) -> tuple[str, list[float | None]]:
    """Read the first chain's C-alpha sequence and pLDDT (B-factor) column."""
    points = parse_structure_geometry(structure_text, file_format)["points"]
    chain = points[0]["chain"]
    first = [point for point in points if point["chain"] == chain]
    return (
        "".join(_one_letter(str(point["name"])) for point in first),
        [point.get("plddt") for point in first],
    )


def choose_model(models: list[dict[str, Any]], reference_accession: str) -> dict[str, Any] | None:
    """Pick the model that best represents the construct.

    AlphaFold Server models are predicted from the construct itself, so they
    come first; then an AlphaFold DB model of the selected reference; then the
    most recently imported model.  ``models`` arrive newest first.
    """
    for model in models:
        if model.get("source") in SOURCE_PRIORITY:
            return model
    if reference_accession:
        for model in models:
            if model.get("accession") == reference_accession:
                return model
    return models[0] if models else None


def choose_conservation(jobs: list[dict[str, Any]]) -> dict[str, Any] | None:
    for job in jobs:
        if job.get("status") == "complete" and job.get("residues"):
            return job
    return None
