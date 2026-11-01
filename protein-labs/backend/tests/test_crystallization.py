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
