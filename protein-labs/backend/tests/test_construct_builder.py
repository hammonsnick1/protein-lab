import pytest

from Bio.Seq import Seq

from protein_labs.construct_builder import (
    back_translate,
    insert_target_sequence,
    insertion_sites,
)


def test_back_translation_round_trips_to_the_original_protein():
    protein = "MKWVTFISLLLLFSSAYSRG"
    result = back_translate(protein, host="ecoli")
    assert result["dna"].startswith("ATG")
    assert str(Seq(result["dna"]).translate()) == f"{protein}*"


def test_back_translation_rejects_non_canonical_residues():
    with pytest.raises(ValueError, match="unsupported residues: X"):
        back_translate("MKX", host="ecoli")


def test_back_translation_avoids_a_site_completed_by_a_codon_with_no_synonym():
    # His-Met spells the NdeI site CATATG with preferred codons. Met has no
    # synonym, so avoidance only works by going back and respelling the His.
    plain = back_translate("MHMK", host="ecoli")
    assert "CATATG" in plain["dna"]

    avoided = back_translate("MHMK", host="ecoli", avoid_enzymes=["NdeI"])
    assert "CATATG" not in avoided["dna"]
    assert avoided["remainingSites"] == []
    assert [swap["residue"] for swap in avoided["codonSwaps"]] == ["H"]
    assert str(Seq(avoided["dna"]).translate()) == "MHMK*"


def _vector():
    """A small backbone: ATG start, 6xHis, TEV site, then a polylinker."""
    tag = "ATG" + "CATCATCATCATCATCAT" + "GAAAACCTGTATTTTCAG"
    mcs = "GGATCCGAATTCCTCGAG"
    sequence = tag + mcs + "TAA" + "GCTAGCTAGCTAGCTAGC"
    return {
        "name": "test backbone",
        "sequence": sequence,
        "circular": True,
        "features": [
            {"id": "f1", "name": "6xHis tag", "type": "CDS", "start": 3, "end": 21, "strand": 1},
            {"id": "f2", "name": "TEV site", "type": "CDS", "start": 21, "end": 39, "strand": 1},
            {"id": "f3", "name": "MCS", "type": "misc_feature", "start": 39, "end": 57, "strand": 1},
        ],
    }


def test_insertion_sites_report_the_frame_of_each_candidate():
    sites = insertion_sites(_vector(), enzymes=["BamHI", "EcoRI", "XhoI"])
    kinds = {site["kind"] for site in sites}
    assert {"cloning-site", "fusion-junction", "restriction-site"} <= kinds

    mcs = next(site for site in sites if site["label"] == "MCS")
    assert mcs["replaceRegion"] is True
    assert mcs["recommended"] is True
    assert mcs["frame"]["inFrame"] is True

    junction = next(site for site in sites if "TEV site" in site["label"])
    assert junction["frame"]["inFrame"] is True


def test_origin_of_replication_is_not_treated_as_a_cloning_site():
    # "replication" contains "lic", which must not match the LIC cloning hint.
    vector = _vector()
    vector["features"].append({
        "id": "f4", "name": "ori", "type": "rep_origin",
        "start": 60, "end": 72, "strand": 1,
        "notes": "high-copy-number origin of replication",
    })
    labels = [site["label"] for site in insertion_sites(vector) if site["kind"] == "cloning-site"]
    assert "ori" not in labels


def test_insert_replaces_the_polylinker_and_shifts_later_annotations():
    vector = _vector()
    original = vector["sequence"]
    insert = back_translate("WYC", host="ecoli")["dna"]

    result = insert_target_sequence(
        vector, insert_dna=insert, start=39, end=57, strand=1, name="Target CDS",
    )

    assert result["sequence"][39:39 + len(insert)] == insert
    # Everything downstream of the replaced region is preserved, just moved.
    assert result["sequence"][39 + len(insert):] == original[57:]
    assert result["report"]["removedBases"] == 18
    assert result["report"]["insertedBases"] == len(insert)
    assert result["report"]["inFrame"] is True
    assert result["report"]["internalStopCodons"] == []

    # The overlapped MCS annotation is dropped; the upstream tags are untouched.
    names = {feature["name"] for feature in result["features"]}
    assert "MCS" not in names
    assert {"6xHis tag", "TEV site", "Target CDS"} <= names
    tag = next(f for f in result["features"] if f["name"] == "6xHis tag")
    assert (tag["start"], tag["end"]) == (3, 21)


def test_out_of_frame_insert_is_padded_back_into_frame():
    vector = _vector()
    insert = back_translate("WYC", host="ecoli")["dna"]
    # Position 40 is one base into the polylinker, so the junction is +1 out.
    result = insert_target_sequence(
        vector, insert_dna=insert, start=40, end=40, strand=1, name="Target CDS",
    )
    assert result["report"]["paddingBases"] == 2
    assert result["report"]["framePadded"] is True
    # Padding exists to put the insert itself back on the upstream codon
    # boundary, which is measured from the reference feature's start.
    reference_start = result["report"]["frame"]["referenceStart"]
    insert_start = result["insertFeature"]["start"] + result["report"]["paddingBases"]
    assert (insert_start - reference_start) % 3 == 0
