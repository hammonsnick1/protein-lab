"""Automatic annotation of the house expression construct.

The web construct designer builds `M–His–DYDIPTT–ENLYFQ(G/S)–GA–target`, so the
same parts have to be recognisable when that construct comes back as DNA.
"""

from Bio.Seq import Seq

from protein_labs.expression_planner import automatic_annotations

# One unambiguous codon per residue, so the translation is exact.
CODONS = {
    "A": "GCT", "C": "TGT", "D": "GAT", "E": "GAA", "F": "TTT", "G": "GGT",
    "H": "CAT", "I": "ATT", "K": "AAA", "L": "CTG", "M": "ATG", "N": "AAT",
    "P": "CCT", "Q": "CAA", "R": "CGT", "S": "TCT", "T": "ACT", "V": "GTT",
    "W": "TGG", "Y": "TAT",
}


def back_translate(peptide: str) -> str:
    return "".join(CODONS[residue] for residue in peptide)


HOUSE_CONSTRUCT = "MHHHHHHDYDIPTTENLYFQGGA"


def annotated_peptides(dna: str) -> dict[str, tuple[int, int, int]]:
    features = automatic_annotations(dna, include_orfs=False)
    return {
        feature["name"]: (feature["start"], feature["end"], feature["strand"])
        for feature in features
        if feature["type"] == "mat_peptide"
    }


def test_house_his_construct_annotates_tag_linker_and_tev_site():
    dna = back_translate(HOUSE_CONSTRUCT) + back_translate("GSSKQEWTR") + "TAA"
    found = annotated_peptides(dna)

    assert "6xHis tag" in found
    assert "DYDIPTT linker" in found
    assert "TEV cleavage site" in found

    # Coordinates are DNA offsets, three bases per residue, in construct order.
    assert found["6xHis tag"] == (3, 21, 1)
    assert found["DYDIPTT linker"] == (21, 42, 1)
    assert found["TEV cleavage site"] == (42, 63, 1)

    # The annotated stretch really does translate to the peptide it names.
    assert str(Seq(dna[21:42]).translate()) == "DYDIPTT"
    assert str(Seq(dna[42:63]).translate()) == "ENLYFQG"


def test_tev_site_is_annotated_with_a_serine_at_p1_prime():
    dna = back_translate("MHHHHHHDYDIPTTENLYFQSGA") + "TAA"
    found = annotated_peptides(dna)

    assert "TEV cleavage site" in found
    assert found["TEV cleavage site"] == (42, 63, 1)
    assert str(Seq(dna[42:63]).translate()) == "ENLYFQS"


def test_linker_is_also_found_on_the_reverse_strand():
    forward = back_translate(HOUSE_CONSTRUCT) + "TAA"
    reverse = str(Seq(forward).reverse_complement())
    found = annotated_peptides(reverse)

    assert found["DYDIPTT linker"][2] == -1
    # The reverse-strand coordinates still bracket the same codons.
    start, end, _ = found["DYDIPTT linker"]
    assert str(Seq(reverse[start:end]).reverse_complement().translate()) == "DYDIPTT"
