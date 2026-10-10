"""ProtParam-compatible calculations for a canonical protein sequence."""

from __future__ import annotations

from collections import Counter
from datetime import datetime, timezone
import hashlib
import re
from typing import Any

from Bio.SeqUtils.ProtParam import ProteinAnalysis


AMINO_ACIDS = "ACDEFGHIKLMNPQRSTVWY"
THREE_LETTER = {
    "A": "Ala", "R": "Arg", "N": "Asn", "D": "Asp", "C": "Cys",
    "Q": "Gln", "E": "Glu", "G": "Gly", "H": "His", "I": "Ile",
    "L": "Leu", "K": "Lys", "M": "Met", "F": "Phe", "P": "Pro",
    "S": "Ser", "T": "Thr", "W": "Trp", "Y": "Tyr", "V": "Val",
}

# Elemental composition of the free, unmodified amino acids. A peptide loses
# H2O for each peptide bond, so (length - 1) waters are removed below.
FREE_AMINO_ACID_ATOMS: dict[str, dict[str, int]] = {
    "A": {"C": 3, "H": 7, "N": 1, "O": 2},
    "R": {"C": 6, "H": 14, "N": 4, "O": 2},
    "N": {"C": 4, "H": 8, "N": 2, "O": 3},
    "D": {"C": 4, "H": 7, "N": 1, "O": 4},
    "C": {"C": 3, "H": 7, "N": 1, "O": 2, "S": 1},
    "Q": {"C": 5, "H": 10, "N": 2, "O": 3},
    "E": {"C": 5, "H": 9, "N": 1, "O": 4},
    "G": {"C": 2, "H": 5, "N": 1, "O": 2},
    "H": {"C": 6, "H": 9, "N": 3, "O": 2},
    "I": {"C": 6, "H": 13, "N": 1, "O": 2},
    "L": {"C": 6, "H": 13, "N": 1, "O": 2},
    "K": {"C": 6, "H": 14, "N": 2, "O": 2},
    "M": {"C": 5, "H": 11, "N": 1, "O": 2, "S": 1},
    "F": {"C": 9, "H": 11, "N": 1, "O": 2},
    "P": {"C": 5, "H": 9, "N": 1, "O": 2},
    "S": {"C": 3, "H": 7, "N": 1, "O": 3},
    "T": {"C": 4, "H": 9, "N": 1, "O": 3},
    "W": {"C": 11, "H": 12, "N": 2, "O": 2},
    "Y": {"C": 9, "H": 11, "N": 1, "O": 3},
    "V": {"C": 5, "H": 11, "N": 1, "O": 2},
}

# ProtParam N-end-rule estimates. Values are deliberately strings because the
# source reports inequalities and an unknown E. coli value for proline.
HALF_LIFE = {
    "A": ("4.4 hours", ">20 hours", ">10 hours"),
    "R": ("1 hour", "2 minutes", "2 minutes"),
    "N": ("1.4 hours", "3 minutes", ">10 hours"),
    "D": ("1.1 hours", "3 minutes", ">10 hours"),
    "C": ("1.2 hours", ">20 hours", ">10 hours"),
    "Q": ("0.8 hours", "10 minutes", ">10 hours"),
    "E": ("1 hour", "30 minutes", ">10 hours"),
    "G": ("30 hours", ">20 hours", ">10 hours"),
    "H": ("3.5 hours", "10 minutes", ">10 hours"),
    "I": ("20 hours", "30 minutes", ">10 hours"),
    "L": ("5.5 hours", "3 minutes", "2 minutes"),
    "K": ("1.3 hours", "3 minutes", "2 minutes"),
    "M": ("30 hours", ">20 hours", ">10 hours"),
    "F": ("1.1 hours", "3 minutes", "2 minutes"),
    "P": (">20 hours", ">20 hours", "unknown"),
    "S": ("1.9 hours", ">20 hours", ">10 hours"),
    "T": ("7.2 hours", ">20 hours", ">10 hours"),
    "W": ("2.8 hours", "3 minutes", "2 minutes"),
    "Y": ("2.8 hours", "10 minutes", "2 minutes"),
    "V": ("100 hours", ">20 hours", ">10 hours"),
}


class SequenceValidationError(ValueError):
    """Raised when exact ProtParam calculations cannot be made."""


def normalize_sequence(raw: str) -> str:
    """Accept raw or FASTA text and return one canonical protein sequence."""
    if not isinstance(raw, str):
        raise SequenceValidationError("Protein sequence must be text")
    lines = [line.strip() for line in raw.strip().splitlines()]
    sequence_lines = [line for line in lines if line and not line.startswith(">")]
    sequence = re.sub(r"[\s\d]", "", "".join(sequence_lines)).upper()
    if sequence.endswith("*"):
        sequence = sequence[:-1]
    if not sequence:
        raise SequenceValidationError("Enter at least one amino-acid residue")
    invalid = sorted(set(sequence) - set(AMINO_ACIDS))
    if invalid:
        raise SequenceValidationError(
            "Exact ProtParam calculations require the 20 canonical amino acids; "
            f"unsupported residues: {', '.join(invalid)}"
        )
    return sequence


def _atomic_composition(sequence: str) -> dict[str, int]:
    atoms = Counter({"C": 0, "H": 0, "N": 0, "O": 0, "S": 0})
    for residue in sequence:
        atoms.update(FREE_AMINO_ACID_ATOMS[residue])
    atoms["H"] -= 2 * (len(sequence) - 1)
    atoms["O"] -= len(sequence) - 1
    return {element: atoms[element] for element in ("C", "H", "N", "O", "S")}


def _formula(atoms: dict[str, int]) -> str:
    return "".join(
        f"{element}{count if count != 1 else ''}"
        for element, count in atoms.items()
        if count
    )


def analyze_sequence(raw_sequence: str) -> dict[str, Any]:
    """Return the complete ProtParam set plus useful planning extensions."""
    sequence = normalize_sequence(raw_sequence)
    analysis = ProteinAnalysis(sequence)
    monoisotopic = ProteinAnalysis(sequence, monoisotopic=True)
    counts = Counter(sequence)
    length = len(sequence)
    molecular_weight = analysis.molecular_weight()
    reduced_extinction = counts["W"] * 5500 + counts["Y"] * 1490
    oxidized_extinction = reduced_extinction + (counts["C"] // 2) * 125
    atoms = _atomic_composition(sequence)
    helix, turn, sheet = analysis.secondary_structure_fraction()
    mammalian, yeast, ecoli = HALF_LIFE[sequence[0]]
    instability = analysis.instability_index()
    percentages = {
        residue: counts[residue] * 100.0 / length for residue in AMINO_ACIDS
    }
    # Ikai's aliphatic index, expressed using residue mole percentages. Keeping
    # the formula here avoids depending on a version-specific Biopython helper.
    aliphatic_index = (
        percentages["A"]
        + 2.9 * percentages["V"]
        + 3.9 * (percentages["I"] + percentages["L"])
    )

    return {
        "algorithm": {
            "name": "Protein Labs ProtParam",
            "version": "1.0",
            "compatibility": "ExPASy ProtParam definitions with Biopython ProtParam tables",
            "analyzedAt": datetime.now(timezone.utc).isoformat(),
        },
        "sequence": {
            "length": length,
            "nTerminus": sequence[0],
            "cTerminus": sequence[-1],
            "sha256": hashlib.sha256(sequence.encode("ascii")).hexdigest(),
        },
        "molecularWeightDa": molecular_weight,
        "monoisotopicMassDa": monoisotopic.molecular_weight(),
        "theoreticalPI": analysis.isoelectric_point(),
        "aminoAcidComposition": {
            residue: {
                "name": THREE_LETTER[residue],
                "count": counts[residue],
                "percent": percentages[residue],
            }
            for residue in AMINO_ACIDS
        },
        "atomicComposition": atoms,
        "chemicalFormula": _formula(atoms),
        "totalAtoms": sum(atoms.values()),
        "chargedResidues": {
            "negativeAspGlu": counts["D"] + counts["E"],
            "positiveArgLys": counts["R"] + counts["K"],
            "predictedChargeAtPH7": analysis.charge_at_pH(7.0),
        },
        "extinctionCoefficient280": {
            "oxidizedMolarM1Cm1": oxidized_extinction,
            "reducedMolarM1Cm1": reduced_extinction,
            "oxidizedAbsorbance01Percent": oxidized_extinction / molecular_weight,
            "reducedAbsorbance01Percent": reduced_extinction / molecular_weight,
        },
        "estimatedHalfLife": {
            "nTerminalResidue": THREE_LETTER[sequence[0]],
            "mammalianReticulocytesInVitro": mammalian,
            "yeastInVivo": yeast,
            "ecoliInVivo": ecoli,
            "warning": "N-end-rule estimate; not valid for an N-terminally modified protein.",
        },
        "instabilityIndex": instability,
        "stabilityPrediction": "stable" if instability < 40 else "unstable",
        "aliphaticIndex": aliphatic_index,
        "gravy": analysis.gravy(),
        "aromaticity": analysis.aromaticity(),
        "secondaryStructureFraction": {
            "helix": helix,
            "turn": turn,
            "sheet": sheet,
        },
        "assumptions": [
            "The sequence is an unmodified monomer.",
            "No post-translational modification mass is included.",
            "Extinction coefficients assume either all possible cystines or all reduced cysteines.",
        ],
    }
