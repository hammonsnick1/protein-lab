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


def _is_resonance_phosphorus(atom: Any) -> bool:
    """Phosphorus with two or more terminal oxygens is not a real stereocentre.

    Non-bridging phosphate oxygens are equivalent by resonance and their
    deposited names (O1A/O2A, ...) are interchangeable, so any R/S assigned
    there would describe naming, not chemistry.
    """
    if atom.GetSymbol() != "P":
        return False
    terminal = [n for n in atom.GetNeighbors() if n.GetSymbol() == "O" and n.GetDegree() == 1]
    return len(terminal) >= 2


def render_ligand_depiction(ccd_text: str, ligand: dict[str, Any]) -> dict[str, Any]:
    """Return an SVG and PDB-atom-name map for one parsed ligand instance.

    Every non-leaving CCD heavy atom must have deposited coordinates.  Drawing a partially
    observed ligand would make the reported three-dimensional stereochemistry
    ambiguous, so it is reported clearly instead of guessed.
    """
    try:
        from rdkit import Chem
        from rdkit.Chem import Draw, rdCIPLabeler, rdDepictor
        from rdkit.Geometry import Point3D
    except ImportError as error:  # pragma: no cover - dependency declaration covers normal use
        raise RuntimeError("RDKit is required for ligand depictions but is not installed") from error

    cif = MMCIF2Dict(StringIO(ccd_text))
    all_names = _values(cif, "_chem_comp_atom.atom_id")
    all_elements = _column(cif, "_chem_comp_atom.type_symbol", len(all_names))
    all_charges = _column(cif, "_chem_comp_atom.charge", len(all_names), "0")
    leaving = _column(cif, "_chem_comp_atom.pdbx_leaving_atom_flag", len(all_names), "N")
    ccd_atom_stereo = dict(zip(all_names, _column(cif, "_chem_comp_atom.pdbx_stereo_config", len(all_names), "?")))
    if not all_names:
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has no atoms")
    if len(set(all_names)) != len(all_names):
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has duplicate atom names")

    coordinates = ligand.get("atomCoordinatesByName") or {}
    # Crystal structures rarely model hydrogens, so the drawing is built from
    # CCD heavy atoms only; RDKit restores implicit hydrogens from valence.
    # CCD "leaving" atoms (for example a phosphate oxygen lost on linkage) may
    # legitimately be absent from a deposited instance and are then omitted.
    kept = [
        (name, element, charge)
        for name, element, charge, leaves in zip(all_names, all_elements, all_charges, leaving)
        if element.strip().upper() not in {"H", "D"}
        and not (leaves.strip().upper() == "Y" and name not in coordinates)
    ]
    atom_names = [name for name, _, _ in kept]
    elements = [element for _, element, _ in kept]
    charges = [charge for _, _, charge in kept]
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
    bond_configs = _column(cif, "_chem_comp_bond.pdbx_stereo_config", len(bond_left), "N")
    stereo_bonds = {
        frozenset((left, right))
        for left, right, config in zip(bond_left, bond_right, bond_configs)
        if config.upper() in {"E", "Z"}
    }
    if not bond_left:
        raise LigandDepictionError("The PDB Chemical Component Dictionary definition has no bonds")
    for left, right, order in zip(bond_left, bond_right, bond_orders):
        if left not in all_names or right not in all_names:
            raise LigandDepictionError("CCD bond references an atom missing from its atom table")
        if left not in atom_index or right not in atom_index:
            continue  # bond to an omitted hydrogen or leaving atom
        molecule.AddBond(atom_index[left], atom_index[right], _bond_type(order, Chem))
    mol = molecule.GetMol()
    for bond in mol.GetBonds():
        if bond.GetBondType() == Chem.BondType.AROMATIC:
            bond.SetIsAromatic(True)
            mol.GetAtomWithIdx(bond.GetBeginAtomIdx()).SetIsAromatic(True)
            mol.GetAtomWithIdx(bond.GetEndAtomIdx()).SetIsAromatic(True)
    try:
        Chem.SanitizeMol(mol)
    except Exception:
        # Metal coordination is recorded as covalent CCD bonds (HEM's iron to
        # its four pyrrole nitrogens), which exceeds RDKit's strict valence
        # model.  Keep the deposited chemistry and skip only that check.
        mol = molecule.GetMol()
        for bond in mol.GetBonds():
            if bond.GetBondType() == Chem.BondType.AROMATIC:
                bond.SetIsAromatic(True)
                mol.GetAtomWithIdx(bond.GetBeginAtomIdx()).SetIsAromatic(True)
                mol.GetAtomWithIdx(bond.GetEndAtomIdx()).SetIsAromatic(True)
        try:
            mol.UpdatePropertyCache(strict=False)
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
    # Only the stereocentres and stereo double bonds the CCD declares are
    # labelled; the deposited geometry decides R/S or E/Z at each of them.
    # Without this, 3D perception also "finds" centres that are not real
    # stereochemistry, such as heme iron or phosphate phosphorus.
    stereo_atoms = {
        atom_index[name] for name, config in ccd_atom_stereo.items()
        if name in atom_index and config.upper() in {"R", "S"}
        and not _is_resonance_phosphorus(mol.GetAtomWithIdx(atom_index[name]))
    }
    for atom in mol.GetAtoms():
        if atom.GetIdx() not in stereo_atoms:
            atom.SetChiralTag(Chem.ChiralType.CHI_UNSPECIFIED)
    for bond in mol.GetBonds():
        names = {atom_names[bond.GetBeginAtomIdx()], atom_names[bond.GetEndAtomIdx()]}
        if frozenset(names) not in stereo_bonds:
            bond.SetStereo(Chem.BondStereo.STEREONONE)
    Chem.AssignStereochemistry(mol, cleanIt=True, force=True)
    # The new CIP labeller implements the full 2013 IUPAC rules; RDKit's
    # legacy ``_CIPCode`` is an approximation that can mislabel ring atoms.
    rdCIPLabeler.AssignCIPLabels(mol)

    rdDepictor.Compute2DCoords(mol)
    prepared = Draw.PrepareMolForDrawing(mol, wedgeBonds=True)
    drawer = Draw.MolDraw2DSVG(500, 350)
    options = drawer.drawOptions()
    options.addStereoAnnotation = True
    options.includeMetadata = False
    drawer.DrawMolecule(prepared)
    drawer.FinishDrawing()
    svg = drawer.GetDrawingText()
    # PrepareMolForDrawing keeps existing atom indices and may only append
    # hydrogens on stereocentres, so indices below match atomIndexToPdbAtomName.
    def _name(index: int) -> str:
        return atom_names[index] if index < len(atom_names) else "H"

    wedge_styles = {Chem.BondDir.BEGINWEDGE: "wedge", Chem.BondDir.BEGINDASH: "hash"}
    wedge_bonds = [
        {"from": _name(bond.GetBeginAtomIdx()), "to": _name(bond.GetEndAtomIdx()), "style": wedge_styles[bond.GetBondDir()]}
        for bond in prepared.GetBonds() if bond.GetBondDir() in wedge_styles
    ]
    cip_labels = {
        atom.GetIdx(): atom.GetProp("_CIPCode")
        for atom in mol.GetAtoms() if atom.HasProp("_CIPCode") and atom.GetProp("_CIPCode") in {"R", "S"}
    }
    # A deposited instance whose geometry contradicts its CCD definition is a
    # modelling issue worth showing, not something to silently "correct".
    ccd_disagreements = [
        {"pdbAtomName": atom_names[index], "deposited": cip_labels.get(index), "ccd": ccd_atom_stereo[atom_names[index]].upper()}
        for index in sorted(stereo_atoms)
        if cip_labels.get(index) != ccd_atom_stereo[atom_names[index]].upper()
    ]
    return {
        "svg": svg,
        "atomIndexToPdbAtomName": {str(index): name for name, index in atom_index.items()},
        "bondIndexToPdbAtomNames": {
            str(bond.GetIdx()): [atom_names[bond.GetBeginAtomIdx()], atom_names[bond.GetEndAtomIdx()]]
            for bond in mol.GetBonds()
        },
        "stereo": {
            "method": "CCD connectivity; R/S and E/Z perceived from deposited 3D coordinates at CCD-declared stereocentres and stereo double bonds",
            "cipLabels": {str(index): label for index, label in cip_labels.items()},
            "doubleBondLabels": {
                str(bond.GetIdx()): bond.GetProp("_CIPCode")
                for bond in mol.GetBonds()
                if bond.GetBondType() == Chem.BondType.DOUBLE and bond.HasProp("_CIPCode") and bond.GetProp("_CIPCode") in {"E", "Z"}
            },
            "wedgeBonds": wedge_bonds,
            "ccdDisagreements": ccd_disagreements,
        },
    }
