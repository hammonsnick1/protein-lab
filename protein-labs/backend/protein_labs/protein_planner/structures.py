"""Residue-numbering and region algorithms for the Structure Viewer.

All sequence positions exposed here are deliberately one-based.  Missing
construct, UniProt, label_seq_id, or auth_seq_id values remain ``None``; this
module never fills a numbering gap by extrapolation.
"""

from __future__ import annotations

from collections import defaultdict
from io import StringIO
import math
import re
from typing import Any, Iterable

from Bio.Align import PairwiseAligner, substitution_matrices
from Bio.Data.PDBData import protein_letters_3to1
from Bio.PDB.MMCIF2Dict import MMCIF2Dict


DISULFIDE_CUTOFF_ANGSTROM = 2.3
LIGAND_CONTACT_CUTOFF_ANGSTROM = 5.0
LOW_PLDDT_THRESHOLD = 50.0
HYDROPHOBIC_WINDOW = 9
HYDROPHOBIC_THRESHOLD = 1.6
SURFACE_CONTACT_RADIUS_ANGSTROM = 10.0
SURFACE_MAX_CA_NEIGHBORS = 16

KYTE_DOOLITTLE = {
    "I": 4.5, "V": 4.2, "L": 3.8, "F": 2.8, "C": 2.5,
    "M": 1.9, "A": 1.8, "G": -0.4, "T": -0.7, "S": -0.8,
    "W": -0.9, "Y": -1.3, "P": -1.6, "H": -3.2, "E": -3.5,
    "Q": -3.5, "D": -3.5, "N": -3.5, "K": -3.9, "R": -4.5,
}
HYDROPHOBIC_RESIDUES = frozenset("AVILMFWYC")
WATER_IDS = frozenset({"HOH", "DOD", "WAT"})
COMMON_ADDITIVES = frozenset({
    "ACT", "ACY", "BME", "BOG", "BR", "CA", "CD", "CL", "CO", "CU",
    "DMS", "EDO", "EOH", "FMT", "GOL", "IOD", "IPA", "K", "LI", "MG",
    "MN", "MPD", "NA", "NH4", "NO3", "PEG", "PG4", "PO4", "SO4", "TRS",
})


def _list(value: Any) -> list[str]:
    if value is None:
        return []
    if isinstance(value, list):
        return [str(item) for item in value]
    return [str(value)]


def _column(cif: dict[str, Any], key: str, size: int, default: str = "?") -> list[str]:
    values = _list(cif.get(key))
    if not values:
        return [default] * size
    if len(values) == 1 and size > 1:
        return values * size
    return (values + [default] * size)[:size]


def _nullable(value: Any) -> str | None:
    text = str(value or "").strip()
    return None if text in {"", ".", "?"} else text


def _integer(value: Any) -> int | None:
    text = _nullable(value)
    if text is None:
        return None
    try:
        return int(text)
    except ValueError:
        match = re.fullmatch(r"(-?\d+)", text)
        return int(match.group(1)) if match else None


def _float(value: Any) -> float | None:
    text = _nullable(value)
    if text is None:
        return None
    try:
        return float(text)
    except ValueError:
        return None


def _one_letter(comp_id: str) -> str:
    key = comp_id.strip().upper()
    return protein_letters_3to1.get(key, "X")


def _distance(left: tuple[float, float, float], right: tuple[float, float, float]) -> float:
    return math.sqrt(sum((a - b) ** 2 for a, b in zip(left, right)))


def construct_reference_alignment(
    construct_sequence: str, reference_sequence: str
) -> dict[str, Any]:
    """Map construct residues onto a reference without forcing terminal tags.

    The global alignment has free terminal gaps.  Aligned substitutions are
    retained and marked as mismatches; insertions remain explicitly unmapped.
    """
    construct = re.sub(r"\s+", "", construct_sequence).upper()
    reference = re.sub(r"\s+", "", reference_sequence).upper()
    if not construct or not reference:
        return {
            "constructToUniProt": {position: None for position in range(1, len(construct) + 1)},
            "uniprotToConstruct": {},
            "mismatches": [],
        }
    aligner = PairwiseAligner()
    aligner.mode = "global"
    aligner.substitution_matrix = substitution_matrices.load("BLOSUM62")
    aligner.open_gap_score = -10
    aligner.extend_gap_score = -0.5
    aligner.end_gap_score = 0
    alignment = aligner.align(construct, reference)[0]
    construct_to_reference: dict[int, int | None] = {
        position: None for position in range(1, len(construct) + 1)
    }
    reference_to_construct: dict[int, int] = {}
    mismatches: list[dict[str, Any]] = []
    construct_blocks, reference_blocks = alignment.aligned
    for (c_start, c_end), (r_start, r_end) in zip(construct_blocks, reference_blocks):
        # PairwiseAligner aligned blocks contain only ungapped, equal-length runs.
        for offset in range(min(c_end - c_start, r_end - r_start)):
            construct_position = int(c_start + offset + 1)
            reference_position = int(r_start + offset + 1)
            construct_to_reference[construct_position] = reference_position
            reference_to_construct[reference_position] = construct_position
            if construct[construct_position - 1] != reference[reference_position - 1]:
                mismatches.append({
                    "constructPosition": construct_position,
                    "uniprotPosition": reference_position,
                    "constructResidue": construct[construct_position - 1],
                    "uniprotResidue": reference[reference_position - 1],
                })
    return {
        "constructToUniProt": construct_to_reference,
        "uniprotToConstruct": reference_to_construct,
        "mismatches": mismatches,
    }


def parse_mmcif_structure(text: str) -> dict[str, Any]:
    """Parse polymer residues, atoms, and individual ligand instances."""
    cif = MMCIF2Dict(StringIO(text))
    atom_ids = _list(cif.get("_atom_site.label_atom_id"))
    size = len(atom_ids)
    groups = _column(cif, "_atom_site.group_PDB", size, "ATOM")
    label_chains = _column(cif, "_atom_site.label_asym_id", size)
    auth_chains = _column(cif, "_atom_site.auth_asym_id", size)
    label_seq_ids = _column(cif, "_atom_site.label_seq_id", size)
    auth_seq_ids = _column(cif, "_atom_site.auth_seq_id", size)
    insertion_codes = _column(cif, "_atom_site.pdbx_PDB_ins_code", size)
    comp_ids = _column(cif, "_atom_site.label_comp_id", size)
    xs = _column(cif, "_atom_site.Cartn_x", size)
    ys = _column(cif, "_atom_site.Cartn_y", size)
    zs = _column(cif, "_atom_site.Cartn_z", size)
    bfactors = _column(cif, "_atom_site.B_iso_or_equiv", size)
    sifts_accessions = _column(cif, "_atom_site.pdbx_sifts_xref_db_acc", size)
    sifts_numbers = _column(cif, "_atom_site.pdbx_sifts_xref_db_num", size)
    chem_ids = _list(cif.get("_chem_comp.id"))
    chem_names = _column(cif, "_chem_comp.name", len(chem_ids), "")
    chemical_names = {
        comp_id.upper(): (_nullable(name) or comp_id.upper())
        for comp_id, name in zip(chem_ids, chem_names)
    }

    residues: dict[tuple[str, int], dict[str, Any]] = {}
    ligands: dict[tuple[str, str | None, str | None, str], dict[str, Any]] = {}
    for index, atom_name in enumerate(atom_ids):
        coordinate_values = (_float(xs[index]), _float(ys[index]), _float(zs[index]))
        coordinate = (
            tuple(value for value in coordinate_values if value is not None)
            if all(value is not None for value in coordinate_values)
            else None
        )
        group = groups[index].upper()
        label_seq_id = _integer(label_seq_ids[index])
        label_chain = _nullable(label_chains[index]) or _nullable(auth_chains[index]) or "?"
        auth_chain = _nullable(auth_chains[index]) or label_chain
        auth_seq = _nullable(auth_seq_ids[index])
        insertion = _nullable(insertion_codes[index])
        comp_id = comp_ids[index].upper()
        is_polymer = group == "ATOM" or (
            group == "HETATM" and label_seq_id is not None and _one_letter(comp_id) != "X"
        )
        if is_polymer and label_seq_id is not None:
            key = (label_chain, label_seq_id)
            residue = residues.setdefault(key, {
                "chainId": auth_chain,
                "labelChainId": label_chain,
                "labelSeqId": label_seq_id,
                "authSeqId": auth_seq,
                "insertionCode": insertion,
                "structureResidue": _one_letter(comp_id),
                "compId": comp_id,
                "modeled": True,
                "atoms": {},
                "plddt": None,
                "uniprotPosition": None,
                "uniprotAccession": None,
            })
            if coordinate is not None:
                residue["atoms"][atom_name] = coordinate
            if atom_name == "CA":
                residue["plddt"] = _float(bfactors[index])
            sifts_number = _integer(sifts_numbers[index])
            if sifts_number is not None:
                residue["uniprotPosition"] = sifts_number
                residue["uniprotAccession"] = _nullable(sifts_accessions[index])
        elif group == "HETATM":
            key = (auth_chain, auth_seq, insertion, comp_id)
            ligand = ligands.setdefault(key, {
                "ccdId": comp_id,
                "name": chemical_names.get(comp_id, comp_id),
                "chainId": auth_chain,
                "labelChainId": label_chain,
                "authSeqId": auth_seq,
                "insertionCode": insertion,
                "atoms": [],
                "classification": (
                    "water" if comp_id in WATER_IDS
                    else "common_additive" if comp_id in COMMON_ADDITIVES
                    else "ligand"
                ),
            })
            if coordinate is not None:
                ligand["atoms"].append(coordinate)

    # The scheme includes residues absent from atom_site and therefore preserves
    # auth numbering and insertion codes across unmodelled gaps.
    scheme_seq = _list(cif.get("_pdbx_poly_seq_scheme.seq_id"))
    scheme_size = len(scheme_seq)
    if scheme_size:
        scheme_label_chain = _column(cif, "_pdbx_poly_seq_scheme.asym_id", scheme_size)
        scheme_auth_chain = _column(cif, "_pdbx_poly_seq_scheme.pdb_strand_id", scheme_size)
        scheme_auth_seq = _column(cif, "_pdbx_poly_seq_scheme.auth_seq_num", scheme_size)
        scheme_insertion = _column(cif, "_pdbx_poly_seq_scheme.pdb_ins_code", scheme_size)
        scheme_comp = _column(cif, "_pdbx_poly_seq_scheme.mon_id", scheme_size, "UNK")
        for index, raw_seq in enumerate(scheme_seq):
            label_seq_id = _integer(raw_seq)
            if label_seq_id is None:
                continue
            label_chain = _nullable(scheme_label_chain[index]) or "?"
            key = (label_chain, label_seq_id)
            residues.setdefault(key, {
                "chainId": _nullable(scheme_auth_chain[index]) or label_chain,
                "labelChainId": label_chain,
                "labelSeqId": label_seq_id,
                "authSeqId": _nullable(scheme_auth_seq[index]),
                "insertionCode": _nullable(scheme_insertion[index]),
                "structureResidue": _one_letter(scheme_comp[index]),
                "compId": scheme_comp[index].upper(),
                "modeled": False,
                "atoms": {},
                "plddt": None,
                "uniprotPosition": None,
                "uniprotAccession": None,
            })
    return {
        "residues": sorted(residues.values(), key=lambda item: (item["labelChainId"], item["labelSeqId"])),
        "ligands": list(ligands.values()),
    }


def summarize_structure(text: str) -> dict[str, Any]:
    parsed = parse_mmcif_structure(text)
    chain_rows: dict[tuple[str, str], list[dict[str, Any]]] = defaultdict(list)
    for residue in parsed["residues"]:
        chain_rows[(residue["chainId"], residue["labelChainId"])].append(residue)
    return {
        "chains": [{
            "chainId": chain_id,
            "labelChainId": label_chain,
            "residueCount": len(rows),
            "modeledResidueCount": sum(bool(row["modeled"]) for row in rows),
        } for (chain_id, label_chain), rows in sorted(chain_rows.items())],
        "ligands": [{
            key: ligand[key]
            for key in ("ccdId", "name", "chainId", "labelChainId", "authSeqId", "insertionCode", "classification")
        } for ligand in parsed["ligands"]],
    }


def apply_sifts_segments(
    residues: list[dict[str, Any]], segments: Iterable[dict[str, Any]], accession: str
) -> None:
    """Apply only explicit SIFTS segments; positions outside them stay unmapped."""
    accession = accession.upper()
    for segment in segments:
        if str(segment.get("accession") or "").upper() != accession:
            continue
        label_chain = str(segment.get("structAsymId") or "")
        auth_chain = str(segment.get("chainId") or "")
        start = _integer((segment.get("start") or {}).get("residueNumber"))
        end = _integer((segment.get("end") or {}).get("residueNumber"))
        uniprot_start = _integer(segment.get("uniprotStart"))
        uniprot_end = _integer(segment.get("uniprotEnd"))
        if None in {start, end, uniprot_start, uniprot_end}:
            continue
        assert start is not None and end is not None and uniprot_start is not None
        if (end - start) != (int(uniprot_end) - uniprot_start):
            # A range with an internal gap is not safe to extrapolate.
            continue
        for residue in residues:
            chain_matches = (
                (label_chain and residue["labelChainId"] == label_chain)
                or (not label_chain and auth_chain and residue["chainId"] == auth_chain)
            )
            label_seq_id = residue["labelSeqId"]
            if chain_matches and start <= label_seq_id <= end:
                residue["uniprotPosition"] = uniprot_start + label_seq_id - start
                residue["uniprotAccession"] = accession


def build_residue_mapping(
    construct_sequence: str,
    reference_sequence: str,
    structure_text: str,
    *,
    accession: str,
    source: str,
    sifts_segments: Iterable[dict[str, Any]] = (),
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    parsed = parse_mmcif_structure(structure_text)
    residues = parsed["residues"]
    if source == "alphafold_db":
        for residue in residues:
            label_seq_id = residue["labelSeqId"]
            if 1 <= label_seq_id <= len(reference_sequence):
                residue["uniprotPosition"] = label_seq_id
                residue["uniprotAccession"] = accession
    else:
        apply_sifts_segments(residues, sifts_segments, accession)
    sequence_map = construct_reference_alignment(construct_sequence, reference_sequence)
    reference_to_construct = sequence_map["uniprotToConstruct"]
    mapped_construct: set[int] = set()
    output: list[dict[str, Any]] = []
    for residue in residues:
        uniprot_position = residue.get("uniprotPosition")
        construct_position = reference_to_construct.get(uniprot_position)
        if construct_position is not None:
            mapped_construct.add(construct_position)
        construct_residue = (
            construct_sequence[construct_position - 1]
            if construct_position is not None and construct_position <= len(construct_sequence)
            else None
        )
        uniprot_residue = (
            reference_sequence[uniprot_position - 1]
            if isinstance(uniprot_position, int) and uniprot_position <= len(reference_sequence)
            else None
        )
        output.append({
            "constructPosition": construct_position,
            "uniprotPosition": uniprot_position,
            "chainId": residue["chainId"],
            "labelChainId": residue["labelChainId"],
            "labelSeqId": residue["labelSeqId"],
            "authSeqId": residue["authSeqId"],
            "insertionCode": residue["insertionCode"],
            "constructResidue": construct_residue,
            "uniprotResidue": uniprot_residue,
            "structureResidue": residue["structureResidue"],
            "modeled": residue["modeled"],
            "mismatch": bool(
                uniprot_residue and (
                    (construct_residue and construct_residue != uniprot_residue)
                    or residue["structureResidue"] != uniprot_residue
                )
            ),
        })
    # Tags and construct insertions have no structure numbering.  Keeping them
    # in the response makes absence explicit to the viewer.
    for construct_position in range(1, len(construct_sequence) + 1):
        if construct_position in mapped_construct:
            continue
        uniprot_position = sequence_map["constructToUniProt"].get(construct_position)
        output.append({
            "constructPosition": construct_position,
            "uniprotPosition": uniprot_position,
            "chainId": None,
            "labelChainId": None,
            "labelSeqId": None,
            "authSeqId": None,
            "insertionCode": None,
            "constructResidue": construct_sequence[construct_position - 1],
            "uniprotResidue": (
                reference_sequence[uniprot_position - 1]
                if isinstance(uniprot_position, int) and uniprot_position <= len(reference_sequence)
                else None
            ),
            "structureResidue": None,
            "modeled": False,
            "mismatch": bool(
                isinstance(uniprot_position, int)
                and construct_sequence[construct_position - 1] != reference_sequence[uniprot_position - 1]
            ),
        })
    output.sort(key=lambda item: (
        item["chainId"] is None,
        item["chainId"] or "",
        item["labelSeqId"] if item["labelSeqId"] is not None else 10**9,
        item["constructPosition"] or 10**9,
    ))
    return output, parsed


def _public_residue(mapping_row: dict[str, Any]) -> dict[str, Any]:
    return {
        key: mapping_row.get(key)
        for key in (
            "constructPosition", "uniprotPosition", "chainId", "labelChainId",
            "labelSeqId", "authSeqId", "insertionCode", "constructResidue",
            "uniprotResidue", "structureResidue", "modeled", "mismatch",
        )
    }


def _contiguous(values: Iterable[int]) -> list[list[int]]:
    groups: list[list[int]] = []
    for value in sorted(set(values)):
        if not groups or value != groups[-1][-1] + 1:
            groups.append([value])
        else:
            groups[-1].append(value)
    return groups


def _mapped_positions(mapping: list[dict[str, Any]], positions: Iterable[int]) -> list[dict[str, Any]]:
    wanted = set(positions)
    return [
        _public_residue(row)
        for row in mapping
        if row.get("uniprotPosition") in wanted and row.get("modeled")
    ]


def compute_regions(
    mapping: list[dict[str, Any]],
    parsed: dict[str, Any],
    reference_sequence: str,
    reference_record: dict[str, Any],
    *,
    model_confidence: bool = False,
) -> dict[str, Any]:
    """Compute UI regions with parameters included in the response."""
    by_structure_key = {
        (row["labelChainId"], row["labelSeqId"]): row
        for row in mapping if row.get("labelChainId") is not None
    }
    parsed_by_key = {
        (row["labelChainId"], row["labelSeqId"]): row
        for row in parsed["residues"]
    }
    groups: list[dict[str, Any]] = []

    cysteines = [row for row in mapping if row.get("structureResidue") == "C" and row.get("modeled")]
    if cysteines:
        groups.append({
            "id": "cysteines",
            "type": "cysteines",
            "label": f"Cysteines ({len(cysteines)})",
            "description": "Modelled cysteine residues in the selected structure.",
            "defaultVisible": True,
            "residues": [_public_residue(row) for row in cysteines],
            "metadata": {},
        })

    sg_rows: list[tuple[dict[str, Any], tuple[float, float, float]]] = []
    for key, residue in parsed_by_key.items():
        coordinate = residue["atoms"].get("SG")
        mapped = by_structure_key.get(key)
        if coordinate is not None and mapped is not None:
            sg_rows.append((mapped, coordinate))
    for left_index, (left, left_coordinate) in enumerate(sg_rows):
        for right, right_coordinate in sg_rows[left_index + 1:]:
            distance = _distance(left_coordinate, right_coordinate)
            if distance <= DISULFIDE_CUTOFF_ANGSTROM:
                groups.append({
                    "id": f"disulfide:{left['chainId']}:{left['authSeqId']}:{right['chainId']}:{right['authSeqId']}",
                    "type": "disulfide",
                    "label": f"Likely disulfide {left['chainId']} {left['authSeqId']}–{right['chainId']} {right['authSeqId']}",
                    "description": f"Cysteine SG–SG distance {distance:.2f} Å (cutoff ≤ {DISULFIDE_CUTOFF_ANGSTROM:.1f} Å).",
                    "defaultVisible": True,
                    "residues": [_public_residue(left), _public_residue(right)],
                    "metadata": {"sgDistanceAngstrom": round(distance, 3)},
                })

    half_window = HYDROPHOBIC_WINDOW // 2
    hydrophobic_centers: list[int] = []
    scores: dict[int, float] = {}
    for index in range(0, max(0, len(reference_sequence) - HYDROPHOBIC_WINDOW + 1)):
        window = reference_sequence[index:index + HYDROPHOBIC_WINDOW]
        if any(residue not in KYTE_DOOLITTLE for residue in window):
            continue
        score = sum(KYTE_DOOLITTLE[residue] for residue in window) / HYDROPHOBIC_WINDOW
        center = index + half_window + 1
        scores[center] = score
        if score >= HYDROPHOBIC_THRESHOLD:
            hydrophobic_centers.append(center)
    for number, centers in enumerate(_contiguous(hydrophobic_centers), 1):
        positions = range(max(1, centers[0] - half_window), min(len(reference_sequence), centers[-1] + half_window) + 1)
        residues = _mapped_positions(mapping, positions)
        if residues:
            groups.append({
                "id": f"hydrophobic-sequence:{number}",
                "type": "hydrophobic_sequence",
                "label": f"Hydrophobic sequence {min(positions)}–{max(positions)}",
                "description": f"Kyte–Doolittle mean ≥ {HYDROPHOBIC_THRESHOLD:.1f} in a {HYDROPHOBIC_WINDOW}-residue window.",
                "defaultVisible": False,
                "residues": residues,
                "metadata": {"maxWindowScore": round(max(scores[position] for position in centers), 3)},
            })

    surface_candidates: list[dict[str, Any]] = []
    ca_rows = [
        (by_structure_key[key], residue["atoms"].get("CA"))
        for key, residue in parsed_by_key.items()
        if key in by_structure_key and residue["atoms"].get("CA") is not None
    ]
    for row, coordinate in ca_rows:
        if row.get("structureResidue") not in HYDROPHOBIC_RESIDUES:
            continue
        neighbor_count = sum(
            1 for _, other in ca_rows
            if other is not coordinate and _distance(coordinate, other) <= SURFACE_CONTACT_RADIUS_ANGSTROM
        )
        if neighbor_count <= SURFACE_MAX_CA_NEIGHBORS:
            surface_candidates.append(row)
    if surface_candidates:
        groups.append({
            "id": "hydrophobic-surface-patches",
            "type": "hydrophobic_surface",
            "label": f"Surface hydrophobic candidates ({len(surface_candidates)})",
            "description": "Hydrophobic residues with no more than 16 Cα neighbours within 10 Å; a fast exposure proxy, not solvent-accessible surface area.",
            "defaultVisible": False,
            "residues": [_public_residue(row) for row in surface_candidates],
            "metadata": {"method": "ca_neighbor_proxy"},
        })

    for number, feature in enumerate(reference_record.get("disorderedRegions") or [], 1):
        location = feature.get("location") or {}
        start, end = _integer(location.get("start")), _integer(location.get("end"))
        if start is None or end is None:
            continue
        residues = _mapped_positions(mapping, range(start, end + 1))
        if residues:
            groups.append({
                "id": f"uniprot-disorder:{number}",
                "type": "disorder_uniprot",
                "label": feature.get("description") or f"UniProt disorder {start}–{end}",
                "description": "Disordered region annotated by UniProt; separate from model confidence.",
                "defaultVisible": False,
                "residues": residues,
                "metadata": {"source": "UniProt", "location": {"start": start, "end": end}},
            })

    low_confidence = []
    if model_confidence:
        for key, residue in parsed_by_key.items():
            mapped = by_structure_key.get(key)
            if mapped and residue.get("plddt") is not None and residue["plddt"] < LOW_PLDDT_THRESHOLD:
                low_confidence.append(mapped)
    if low_confidence:
        groups.append({
            "id": "low-plddt",
            "type": "disorder_low_plddt",
            "label": f"Low model confidence ({len(low_confidence)})",
            "description": f"AlphaFold residues with pLDDT < {LOW_PLDDT_THRESHOLD:.0f}; this is not a UniProt disorder annotation.",
            "defaultVisible": False,
            "residues": [_public_residue(row) for row in low_confidence],
            "metadata": {"source": "AlphaFold pLDDT"},
        })

    polymer_atoms: list[tuple[dict[str, Any], tuple[float, float, float]]] = []
    for key, residue in parsed_by_key.items():
        mapped = by_structure_key.get(key)
        if mapped:
            polymer_atoms.extend((mapped, coordinate) for coordinate in residue["atoms"].values())
    for ligand_index, ligand in enumerate(parsed["ligands"], 1):
        contacts: dict[tuple[Any, ...], dict[str, Any]] = {}
        minimum_distance: float | None = None
        for ligand_atom in ligand["atoms"]:
            for row, protein_atom in polymer_atoms:
                distance = _distance(ligand_atom, protein_atom)
                if distance <= LIGAND_CONTACT_CUTOFF_ANGSTROM:
                    key = (row["labelChainId"], row["labelSeqId"])
                    contacts[key] = row
                    minimum_distance = distance if minimum_distance is None else min(minimum_distance, distance)
        classification = ligand["classification"]
        groups.append({
            "id": f"ligand:{ligand['chainId']}:{ligand['authSeqId']}:{ligand['insertionCode'] or ''}:{ligand['ccdId']}:{ligand_index}",
            "type": "ligand_binding_site",
            "label": f"{ligand['ccdId']} {ligand['chainId']} {ligand['authSeqId']}",
            "description": f"Protein residues within {LIGAND_CONTACT_CUTOFF_ANGSTROM:.1f} Å of this ligand instance.",
            "defaultVisible": classification == "ligand",
            "residues": [_public_residue(row) for row in contacts.values()],
            "metadata": {
                key: ligand[key]
                for key in ("name", "ccdId", "chainId", "labelChainId", "authSeqId", "insertionCode", "classification")
            } | {"minimumDistanceAngstrom": None if minimum_distance is None else round(minimum_distance, 3)},
        })

    feature_sources = (
        ("postTranslationalModifications", "reference_ptm"),
        ("bindingSites", "reference_binding_site"),
        ("domains", "reference_domain"),
        ("transmembraneRegions", "reference_transmembrane"),
    )
    for source_key, region_type in feature_sources:
        for feature_index, feature in enumerate(reference_record.get(source_key) or [], 1):
            location = feature.get("location") or {}
            start, end = _integer(location.get("start")), _integer(location.get("end"))
            if start is None:
                continue
            end = end or start
            residues = _mapped_positions(mapping, range(start, end + 1))
            if not residues:
                continue
            description = str(feature.get("description") or feature.get("type") or source_key)
            groups.append({
                "id": f"{region_type}:{feature_index}",
                "type": region_type,
                "label": description,
                "description": f"UniProt {feature.get('type') or source_key} annotation at {start}–{end}.",
                "defaultVisible": False,
                "residues": residues,
                "metadata": {"source": "UniProt", "feature": feature},
            })

    return {
        "parameters": {
            "disulfideSgCutoffAngstrom": DISULFIDE_CUTOFF_ANGSTROM,
            "ligandContactCutoffAngstrom": LIGAND_CONTACT_CUTOFF_ANGSTROM,
            "lowPlddtThreshold": LOW_PLDDT_THRESHOLD,
            "hydrophobicity": {
                "scale": "Kyte-Doolittle",
                "window": HYDROPHOBIC_WINDOW,
                "threshold": HYDROPHOBIC_THRESHOLD,
            },
            "surfaceHydrophobicity": {
                "method": "ca_neighbor_proxy",
                "contactRadiusAngstrom": SURFACE_CONTACT_RADIUS_ANGSTROM,
                "maxNeighbors": SURFACE_MAX_CA_NEIGHBORS,
            },
        },
        "groups": groups,
    }
