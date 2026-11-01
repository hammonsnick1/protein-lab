"""Known-answer checks for 2D ligand depictions against real PDB records.

Fixtures in ``tests/fixtures/ligands`` (all CC0 1.0, downloaded 2026-10-31):

- ``ccd_{HEM,ATP,IBP,RET}.cif``: unchanged PDB Chemical Component Dictionary
  records from https://files.rcsb.org/ligands/download/{ID}.cif
- ``1A6M_HEM.cif``, ``1ATP_ATP.cif``, ``2BXG_IBP.cif``, ``1C3W_RET.cif``: the
  ``_atom_site`` HETATM rows for that component, copied unchanged from
  https://files.rcsb.org/download/{entry}.cif (myoglobin heme, PKA-bound ATP,
  four ibuprofen instances in serum albumin, bacteriorhodopsin retinal).

Expected stereochemistry is the published configuration of each molecule
(adenosine ribose 1'R,2'R,3'S,4'R; (S)-ibuprofen; all-trans retinal), which
also matches each CCD's ``pdbx_stereo_config``.
"""

from pathlib import Path

import pytest

from protein_labs.protein_planner.integrations import HttpClient, HttpResponse, RCSBClient, RemoteServiceError
from protein_labs.protein_planner.ligand_depiction import (
    LigandDepictionError,
    render_ligand_depiction,
)
from protein_labs.protein_planner.service import ProteinPlanner
from protein_labs.protein_planner.structures import parse_mmcif_structure

FIXTURES = Path(__file__).parent / "fixtures" / "ligands"


def _ccd(component: str) -> str:
    return (FIXTURES / f"ccd_{component}.cif").read_text()


def _ligands(entry: str, component: str) -> list[dict]:
    return parse_mmcif_structure((FIXTURES / f"{entry}_{component}.cif").read_text())["ligands"]


def _render(entry: str, component: str) -> dict:
    return render_ligand_depiction(_ccd(component), _ligands(entry, component)[0])


def _cip_by_name(result: dict) -> dict[str, str]:
    names = result["atomIndexToPdbAtomName"]
    return {names[index]: label for index, label in result["stereo"]["cipLabels"].items()}


def _ez_by_names(result: dict) -> dict[tuple[str, ...], str]:
    bonds = result["bondIndexToPdbAtomNames"]
    return {tuple(bonds[index]): label for index, label in result["stereo"]["doubleBondLabels"].items()}


def test_heme_maps_all_43_heavy_atoms_and_has_no_false_stereocentres():
    result = _render("1A6M", "HEM")

    # C34 Fe N4 O4: hydrogens are not deposited and are drawn implicitly.
    assert len(result["atomIndexToPdbAtomName"]) == 43
    assert {"FE", "NA", "NB", "NC", "ND", "CHA", "O1A"} <= set(result["atomIndexToPdbAtomName"].values())
    # Heme is achiral; raw 3D perception would otherwise call the iron a centre.
    assert result["stereo"]["cipLabels"] == {}
    assert result["stereo"]["doubleBondLabels"] == {}
    assert result["svg"].startswith("<?xml")


def test_atp_ribose_configuration_and_wedges_come_from_deposited_coordinates():
    result = _render("1ATP", "ATP")

    assert len(result["atomIndexToPdbAtomName"]) == 31
    # Non-bridging phosphate oxygens are resonance-equivalent, so PA/PB are
    # deliberately not labelled even though the CCD lists them.
    assert _cip_by_name(result) == {"C1'": "R", "C2'": "R", "C3'": "S", "C4'": "R"}
    assert {bond["from"] for bond in result["stereo"]["wedgeBonds"]} == {"C1'", "C2'", "C3'", "C4'"}
    assert {bond["style"] for bond in result["stereo"]["wedgeBonds"]} <= {"wedge", "hash"}
    assert result["stereo"]["ccdDisagreements"] == []


def test_ibuprofen_is_s_in_every_one_of_the_four_albumin_instances():
    ligands = _ligands("2BXG", "IBP")
    assert [(item["chainId"], item["authSeqId"]) for item in ligands] == [
        ("A", "2001"), ("A", "2002"), ("B", "2001"), ("B", "2002"),
    ]
    for ligand in ligands:
        result = render_ligand_depiction(_ccd("IBP"), ligand)
        assert len(result["atomIndexToPdbAtomName"]) == 15
        assert _cip_by_name(result) == {"C6": "S"}
        assert [bond["from"] for bond in result["stereo"]["wedgeBonds"]] == ["C6"]


def test_mirrored_coordinates_invert_the_label_and_are_flagged_against_the_ccd():
    ligand = _ligands("2BXG", "IBP")[0]
    mirrored = {**ligand, "atomCoordinatesByName": {
        name: (-x, y, z) for name, (x, y, z) in ligand["atomCoordinatesByName"].items()
    }}

    result = render_ligand_depiction(_ccd("IBP"), mirrored)

    assert _cip_by_name(result) == {"C6": "R"}
    assert result["stereo"]["ccdDisagreements"] == [{"pdbAtomName": "C6", "deposited": "R", "ccd": "S"}]


def test_all_trans_retinal_reports_e_on_each_ccd_stereo_double_bond():
    result = _render("1C3W", "RET")

    # O1 is a CCD leaving atom: the Schiff-base link to Lys216 replaces it,
    # so it is legitimately absent from the deposited instance.
    assert "O1" not in result["atomIndexToPdbAtomName"].values()
    assert len(result["atomIndexToPdbAtomName"]) == 20
    assert _ez_by_names(result) == {
        ("C7", "C8"): "E", ("C9", "C10"): "E", ("C11", "C12"): "E", ("C13", "C14"): "E",
    }


def test_missing_deposited_heavy_atom_is_explicit_not_guessed():
    ligand = _ligands("1A6M", "HEM")[0]
    coordinates = dict(ligand["atomCoordinatesByName"])
    del coordinates["C1A"]

    with pytest.raises(LigandDepictionError, match=r"HEM A 154 is missing deposited coordinates.*C1A"):
        render_ligand_depiction(_ccd("HEM"), {**ligand, "atomCoordinatesByName": coordinates})


class _FakeRCSB:
    def __init__(self, records: dict[str, str]):
        self.records = records

    def fetch_chemical_component(self, ccd_id: str) -> str:
        if ccd_id not in self.records:
            raise RemoteServiceError("RCSB Chemical Component Dictionary", "not found", status=404)
        return self.records[ccd_id]


def _planner(records: dict[str, str]) -> ProteinPlanner:
    planner = object.__new__(ProteinPlanner)
    planner.rcsb = _FakeRCSB(records)
    text = (FIXTURES / "2BXG_IBP.cif").read_text()
    planner.get_structure = lambda protein_id, source, structure_id: {
        "structure": {"id": structure_id.upper()}, "structureText": text,
    }
    return planner


def test_service_selects_one_instance_of_a_multi_ligand_entry():
    result = _planner({"IBP": _ccd("IBP")}).get_ligand_depiction(
        "p1", "pdb", "2bxg", chain_id="B", auth_seq_id="2002", ccd_id="ibp",
    )

    assert (result["ligand"]["chainId"], result["ligand"]["authSeqId"]) == ("B", "2002")
    assert result["structureId"] == "2BXG"
    assert "PDB Chemical Component Dictionary" in {reference["label"] for reference in result["references"]}


def test_service_errors_name_the_problem():
    planner = _planner({})
    with pytest.raises(LookupError, match="No ligand instance matches"):
        planner.get_ligand_depiction("p1", "pdb", "2BXG", chain_id="C", auth_seq_id="2001", ccd_id="IBP")
    with pytest.raises(LookupError, match="no definition for IBP"):
        planner.get_ligand_depiction("p1", "pdb", "2BXG", chain_id="A", auth_seq_id="2001", ccd_id="IBP")
    with pytest.raises(ValueError, match="AlphaFold DB models contain no ligands"):
        planner.get_ligand_depiction("p1", "alphafold_db", "AF-1", chain_id="A", auth_seq_id="1", ccd_id="IBP")


def test_rcsb_client_fetches_ccd_records_from_the_ligands_download_path():
    requested: list[str] = []

    def transport(method, url, *, data, headers):
        requested.append(url)
        return HttpResponse(200, _ccd("ATP"), {})

    text = RCSBClient(HttpClient(transport=transport)).fetch_chemical_component(" atp ")

    # https://files.rcsb.org/download/ligands/download/ATP.cif is a 404 for
    # every component; the CCD lives at /ligands/download/ on the same host.
    assert requested == ["https://files.rcsb.org/ligands/download/ATP.cif"]
    assert text.startswith("data_ATP")
