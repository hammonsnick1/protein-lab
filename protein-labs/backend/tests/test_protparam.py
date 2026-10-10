import pytest

from protein_labs.protein_planner.protparam import (
    SequenceValidationError,
    analyze_sequence,
    normalize_sequence,
)


def test_normalize_fasta_and_terminal_stop():
    assert normalize_sequence(">example\nACD 12\nEFG*\n") == "ACDEFG"


def test_rejects_ambiguous_residues_for_exact_calculations():
    with pytest.raises(SequenceValidationError, match="unsupported residues: X"):
        normalize_sequence("ACDX")


def test_complete_protparam_result():
    result = analyze_sequence("ACDEFGHIKLMNPQRSTVWY")
    assert result["sequence"]["length"] == 20
    assert result["aminoAcidComposition"]["A"]["percent"] == pytest.approx(5.0)
    assert result["chemicalFormula"] == "C107H159N29O30S2"
    assert result["molecularWeightDa"] == pytest.approx(2395.72, rel=1e-3)
    assert 0 <= result["secondaryStructureFraction"]["helix"] <= 1
    assert result["stabilityPrediction"] in {"stable", "unstable"}
    assert result["extinctionCoefficient280"]["reducedMolarM1Cm1"] == 6990


def test_cystine_extinction_has_reduced_and_oxidized_values():
    result = analyze_sequence("CC")
    extinction = result["extinctionCoefficient280"]
    assert extinction["reducedMolarM1Cm1"] == 0
    assert extinction["oxidizedMolarM1Cm1"] == 125
    assert result["chemicalFormula"] == "C6H12N2O3S2"
