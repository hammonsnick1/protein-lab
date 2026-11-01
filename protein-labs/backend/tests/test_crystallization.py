from __future__ import annotations

from protein_labs.protein_planner.crystallization import crystallization_assessment
from protein_labs.protein_planner.database import Database


def test_assessment_reuses_known_facts_without_inventing_model_scores(tmp_path):
    database = Database(tmp_path / "crystallization.sqlite3")
    protein = database.create_protein({"name": "Known facts"}, "ACDEFGHIKL")
    database.save_uniprot_match(protein["id"], {
        "accession": "P00001",
        "transmembraneRegions": [{"location": {"start": 2, "end": 4}}],
        "disorderedRegions": [{"location": {"start": 7, "end": 9}}],
        "cofactors": [{"name": "heme"}],
        "source": {"url": "https://www.uniprot.org/uniprotkb/P00001/entry"},
    }, "fixture", {"identity": 1.0})
    database.save_pdb_match(protein["id"], {
        "pdbId": "1ABC", "entityId": "1", "identity": 0.60,
        # This mirrors RCSBClient's persisted record shape, including the
        # entry-level provenance used by the UI beside the group.
        "method": "X-RAY DIFFRACTION", "spaceGroup": "P 21 21 21",
        "source": {"entryUrl": "https://www.rcsb.org/structure/1ABC"},
    })

    assessment = crystallization_assessment(database.get_bundle(protein["id"]))

    # Hand-checked: residues 7–9 are 3 of the 10 input residues (30%).
    assert assessment["facts"]["membraneProtein"] is True
    assert assessment["facts"]["disorderResidues"] == 3
    assert assessment["facts"]["disorderFraction"] == 0.3
    assert assessment["spaceGroupSuggestions"] == [{
        "spaceGroup": "P 21 21 21", "homologueCount": 1,
        "source": "Saved PDB homologue crystal forms",
    }]
    assert assessment["facts"]["crystalForms"][0]["source"] == "https://www.rcsb.org/structure/1ABC"
    assert assessment["score"]["value"] is None
    assert assessment["uncertainty"]["status"] == "not_quantified"
    assert {item["id"] for item in assessment["predictors"]} == {"shoebill", "plm", "mascl"}
    assert all(item["score"] is None for item in assessment["predictors"])
    assert "membrane-protein" in assessment["recommendation"]
    assert assessment["recommendationCitations"] == ["caffrey2015"]
    assert [item["citations"] for item in assessment["explanations"]] == [
        ["uniprot2023", "caffrey2015"], ["uniprot2023", "dale2003"],
        ["uniprot2023", "hassell2007"], ["pdb2000"],
    ]
    assert assessment["explanations"][-1]["summary"] == "1 saved PDB homologue entry records a crystal space group (P 21 21 21)."


def test_x_ray_homologues_without_a_saved_group_are_missing_evidence(tmp_path):
    # The CA2 project's homologues were saved before the engine recorded
    # space groups: an X-ray method on every entry, no group on any. The
    # Space groups tab says no homologue records a group, so the advice must
    # not call these crystal forms.
    database = Database(tmp_path / "crystallization.sqlite3")
    protein = database.create_protein({"name": "Carbonic anhydrase II"}, "ACDEFGHIKL")
    for pdb_id, entity in (("1CA2", "1"), ("2CBA", "1"), ("2CBA", "2")):
        database.save_pdb_match(protein["id"], {"pdbId": pdb_id, "entityId": entity, "identity": 0.99, "method": "X-RAY DIFFRACTION"})

    assessment = crystallization_assessment(database.get_bundle(protein["id"]))

    assert assessment["spaceGroupSuggestions"] == []
    assert assessment["recommendationCitations"] == ["jancarik1991"]
    assert assessment["explanations"] == [{
        "direction": "missing_evidence",
        "summary": "2 saved PDB homologue entries were solved by X-ray crystallography, but no saved record includes its space group. Run the PDB search in Sequence research again to fetch it.",
        "source": "Saved PDB homologue search", "citations": ["pdb2000"],
    }]


def test_space_groups_count_pdb_entries_not_entity_records(tmp_path):
    database = Database(tmp_path / "crystallization.sqlite3")
    protein = database.create_protein({"name": "Two-entity entry"}, "ACDEFGHIKL")
    for entity in ("1", "2"):
        database.save_pdb_match(protein["id"], {"pdbId": "1ABC", "entityId": entity, "method": "X-RAY DIFFRACTION", "spaceGroup": "C 1 2 1"})

    assessment = crystallization_assessment(database.get_bundle(protein["id"]))

    assert assessment["spaceGroupSuggestions"] == [{"spaceGroup": "C 1 2 1", "homologueCount": 1, "source": "Saved PDB homologue crystal forms"}]
    assert assessment["explanations"][0]["summary"] == "1 saved PDB homologue entry records a crystal space group (C 1 2 1)."
