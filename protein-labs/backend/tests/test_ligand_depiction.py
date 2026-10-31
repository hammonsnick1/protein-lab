"""Known-component checks for the ligand depiction contract.

The component IDs and atom names below are from the PDB Chemical Component
Dictionary (CC0): HEM, ATP and IBP, accessed from files.rcsb.org on 2026-10-31.
The reduced definitions isolate the API's CCD-to-PDB atom-name mapping; the
full CCD records are exercised against live records during release validation.
"""

import pytest

from protein_labs.protein_planner.ligand_depiction import (
    LigandDepictionError,
    render_ligand_depiction,
)


def _ccd(component: str, left: str, right: str) -> str:
    return f"""data_{component}
_chem_comp.id {component}
loop_
_chem_comp_atom.atom_id
_chem_comp_atom.type_symbol
_chem_comp_atom.charge
{left} C 0
{right} O 0
loop_
_chem_comp_bond.atom_id_1
_chem_comp_bond.atom_id_2
_chem_comp_bond.value_order
{left} {right} SING
"""


@pytest.mark.parametrize(
    ("component", "left", "right"),
    [("HEM", "CHA", "C1A"), ("ATP", "PG", "O1G"), ("IBP", "C1", "O1")],
)
def test_real_ccd_ligand_atom_names_survive_into_2d_index_map(component, left, right):
    result = render_ligand_depiction(_ccd(component, left, right), {
        "ccdId": component,
        "chainId": "A",
        "authSeqId": "401",
        "atomCoordinatesByName": {left: (0.0, 0.0, 0.0), right: (1.2, 0.0, 0.0)},
    })

    assert result["svg"].startswith("<?xml")
    assert set(result["atomIndexToPdbAtomName"].values()) == {left, right}


def test_missing_deposited_ccd_atom_is_explicit_not_guessed():
    with pytest.raises(LigandDepictionError, match="missing deposited coordinates.*C1A"):
        render_ligand_depiction(_ccd("HEM", "CHA", "C1A"), {
            "ccdId": "HEM", "chainId": "A", "authSeqId": "401",
            "atomCoordinatesByName": {"CHA": (0.0, 0.0, 0.0)},
        })


def test_3d_stereochemistry_produces_cip_and_ez_labels():
    ccd = """data_STE
loop_
_chem_comp_atom.atom_id
_chem_comp_atom.type_symbol
_chem_comp_atom.charge
C C 0
F F 0
CL Cl 0
BR Br 0
I I 0
C1 C 0
C2 C 0
O O 0
N N 0
loop_
_chem_comp_bond.atom_id_1
_chem_comp_bond.atom_id_2
_chem_comp_bond.value_order
C F SING
C CL SING
C BR SING
C I SING
C1 C2 DOUB
C1 O SING
C2 N SING
"""
    result = render_ligand_depiction(ccd, {
        "ccdId": "STE", "chainId": "A", "authSeqId": "1",
        "atomCoordinatesByName": {
            "C": (0, 0, 0), "F": (1, 1, 1), "CL": (-1, -1, 1),
            "BR": (-1, 1, -1), "I": (1, -1, -1),
            "C1": (0, 0, 3), "C2": (1.3, 0, 3), "O": (0, 1, 3), "N": (1.3, -1, 3),
        },
    })

    assert set(result["stereo"]["cipLabels"].values()) <= {"R", "S"}
    assert result["stereo"]["cipLabels"]
    assert set(result["stereo"]["doubleBondLabels"].values()) <= {"E", "Z"}
    assert result["stereo"]["doubleBondLabels"]
