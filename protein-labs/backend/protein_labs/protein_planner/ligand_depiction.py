"""RDKit-backed 2D depictions for individual PDB ligand instances.

Chemical connectivity is always read from the PDB Chemical Component
Dictionary (CCD); deposited ligand coordinates are used solely to perceive
the stereochemistry present in that *particular* instance.
"""

from __future__ import annotations

from io import StringIO
from typing import Any

from Bio.PDB.MMCIF2Dict import MMCIF2Dict


class LigandDepictionError(ValueError):
    """A ligand cannot be depicted without making an unsafe inference."""


def _values(cif: dict[str, Any], key: str) -> list[str]:
    value = cif.get(key)
    if value is None:
        return []
    return [str(item) for item in (value if isinstance(value, list) else [value])]


def _column(cif: dict[str, Any], key: str, size: int, default: str = "?") -> list[str]:
    values = _values(cif, key)
    return (values + [default] * size)[:size]


def _bond_type(value: str, Chem: Any) -> Any:
    orders = {
        "SING": Chem.BondType.SINGLE,
        "DOUB": Chem.BondType.DOUBLE,
        "TRIP": Chem.BondType.TRIPLE,
        "AROM": Chem.BondType.AROMATIC,
    }
    try:
        return orders[value.upper()]
    except KeyError as error:
        raise LigandDepictionError(f"CCD contains unsupported bond order {value!r}") from error


def render_ligand_depiction(ccd_text: str, ligand: dict[str, Any]) -> dict[str, Any]:
    """Return an SVG and PDB-atom-name map for one parsed ligand instance.

    All CCD heavy atoms must have deposited coordinates.  Drawing a partially
    observed ligand would make the reported three-dimensional stereochemistry
    ambiguous, so it is reported clearly instead of guessed.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Draw, rdDepictor
        from rdkit.Geometry import Point3D
    except ImportError as error:  # pragma: no cover - dependency declaration covers normal use
        raise RuntimeError("RDKit is required for ligand depictions but is not installed") from error

    cif = MMCIF2Dict(StringIO(ccd_text))
    atom_names = _values(cif, "_chem_comp_atom.atom_id")
    elements = _column(cif, "_chem_comp_atom.type_symbol", len(atom_names))
    charges = _column(cif, "_chem_comp_atom.charge", len(atom_names), "0")
    if not atom_names:
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has no atoms")
    if len(set(atom_names)) != len(atom_names):
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has duplicate atom names")

    coordinates = ligand.get("atomCoordinatesByName") or {}
    missing = [name for name in atom_names if name not in coordinates]
    if missing:
        shown = ", ".join(missing[:8])
        suffix = " …" if len(missing) > 8 else ""
        raise LigandDepictionError(
            f"Ligand {ligand.get('ccdId', '?')} {ligand.get('chainId', '?')} "
            f"{ligand.get('authSeqId', '?')} is missing deposited coordinates for CCD atom(s): {shown}{suffix}."
        )

    molecule = Chem.RWMol()
    atom_index: dict[str, int] = {}
    for name, element, charge in zip(atom_names, elements, charges):
        # CCD element symbols are conventionally uppercase (for example FE
        # and CL), while RDKit expects conventional capitalization.
        normalized_element = element.strip().capitalize()
        try:
            atom = Chem.Atom(normalized_element)
        except RuntimeError as error:
            raise LigandDepictionError(f"CCD has an invalid element {element!r} for atom {name}") from error
        try:
            atom.SetFormalCharge(int(charge if charge not in {"?", "."} else "0"))
        except ValueError as error:
            raise LigandDepictionError(f"CCD has an invalid formal charge for atom {name}") from error
        atom.SetProp("pdbAtomName", name)
        atom_index[name] = molecule.AddAtom(atom)

    bond_left = _values(cif, "_chem_comp_bond.atom_id_1")
    bond_right = _column(cif, "_chem_comp_bond.atom_id_2", len(bond_left))
    bond_orders = _column(cif, "_chem_comp_bond.value_order", len(bond_left))
    if not bond_left:
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has no bonds")
    for left, right, order in zip(bond_left, bond_right, bond_orders):
        if left not in atom_index or right not in atom_index:
            raise LigandDepictionError("CCD bond references an atom missing from its atom table")
        molecule.AddBond(atom_index[left], atom_index[right], _bond_type(order, Chem))
    mol = molecule.GetMol()
    for bond in mol.GetBonds():
        if bond.GetBondType() == Chem.BondType.AROMATIC:
            bond.SetIsAromatic(True)
            mol.GetAtomWithIdx(bond.GetBeginAtomIdx()).SetIsAromatic(True)
            mol.GetAtomWithIdx(bond.GetEndAtomIdx()).SetIsAromatic(True)
    try:
        # CCD protonation records can intentionally retain a formal charge on
        # a protonated atom (HEM is one example).  Do not reject an otherwise
        # drawable deposited component solely on RDKit's strict valence check.
        Chem.SanitizeMol(
            mol,
            sanitizeOps=Chem.SanitizeFlags.SANITIZE_ALL ^ Chem.SanitizeFlags.SANITIZE_PROPERTIES,
        )
    except Exception as error:
        raise LigandDepictionError(f"CCD definition could not be sanitized: {error}") from error

    conformer = Chem.Conformer(mol.GetNumAtoms())
    conformer.Set3D(True)
    for name, index in atom_index.items():
        x, y, z = coordinates[name]
        conformer.SetAtomPosition(index, Point3D(float(x), float(y), float(z)))
    mol.AddConformer(conformer, assignId=True)
    # The CCD supplies graph connectivity; the deposited coordinates determine
    # which enantiomer/geometric isomer the viewer is looking at.
    Chem.AssignAtomChiralTagsFromStructure(mol, confId=0, replaceExistingTags=True)
    Chem.AssignStereochemistryFrom3D(mol, confId=0, replaceExistingTags=True)
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)

    rdDepictor.Compute2DCoords(mol)
    prepared = Draw.PrepareMolForDrawing(mol, wedgeBonds=True)
    drawer = Draw.MolDraw2DSVG(500, 350)
    options = drawer.drawOptions()
    options.addStereoAnnotation = True
    options.includeMetadata = False
    drawer.DrawMolecule(prepared)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    return {
        "svg": svg,
        "atomIndexToPdbAtomName": {str(index): name for name, index in atom_index.items()},
        "stereo": {
            "method": "CCD connectivity with stereochemistry perceived from deposited 3D coordinates",
            "cipLabels": {
                str(atom.GetIdx()): atom.GetProp("_CIPCode")
                for atom in mol.GetAtoms() if atom.HasProp("_CIPCode")
            },
            "doubleBondLabels": {
                str(bond.GetIdx()): str(bond.GetStereo()).removeprefix("STEREO")
                for bond in mol.GetBonds()
                if bond.GetBondType() == Chem.BondType.DOUBLE and bond.GetStereo() in {Chem.BondStereo.STEREOE, Chem.BondStereo.STEREOZ}
            },
        },
    }
