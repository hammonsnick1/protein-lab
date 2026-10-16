import base64

from Bio.Seq import Seq

from protein_labs.construct_builder import CODON_PREFERENCES
from protein_labs.expression_planner import export_sequence, parse_sequence_file
from protein_labs.vector_engine import (
    ATTB1,
    ATTB2,
    compatible_ends,
    design_primers,
    enzyme_analysis,
    gateway_preview,
    nearest_neighbor_tm,
    optimize_codons,
    restriction_ligation_preview,
    simulate_gel,
)


def test_nearest_neighbor_tm_matches_biopython_published_example():
    # Biopython's documented Allawi/SantaLucia example is 60.32 C at 50 mM
    # Na and 25 nM of each strand with salt correction 5.
    value = nearest_neighbor_tm(
        "CGTTCCAAAGATGTGGGCATGAGCTTAC",
        sodium_mm=50,
        magnesium_mm=0,
        dntp_mm=0,
        primer_nm=25,
        template_nm=25,
        salt_correction=5,
    )
    assert round(value, 2) == 60.32


def test_primer_design_targets_tm_and_excludes_gateway_tails_from_tm():
    template = "ATGCGCGATCGATCGTTAGCGATGCTAGCTAGGCTAACGATCGATCGCGCAT"
    plain = design_primers(template, 0, len(template), target_tm=60, min_length=18, max_length=26)
    gateway = design_primers(
        template,
        0,
        len(template),
        target_tm=60,
        min_length=18,
        max_length=26,
        cloning_method="gateway",
    )

    assert abs(plain[0]["tmCelsius"] - 60) < 3
    assert gateway[0]["sequence"].startswith(ATTB1)
    assert gateway[1]["sequence"].startswith(ATTB2)
    assert gateway[0]["tmCelsius"] == plain[0]["tmCelsius"]
    assert gateway[0]["conditions"]["primerNm"] == 500.0
    assert gateway[0]["hairpin"]["method"] == "contiguous complementarity screen"
    assert gateway[0]["heteroDimer"]["risk"] in {"low", "moderate", "high"}


def test_gibson_overlap_lengths_are_enforced():
    template = "ACGT" * 20
    try:
        design_primers(
            template,
            0,
            len(template),
            cloning_method="gibson",
            forward_overhang="ACGT",
            reverse_overhang="ACGT" * 5,
        )
    except ValueError as error:
        assert "15 to 40" in str(error)
    else:  # pragma: no cover - protects the biological constraint
        raise AssertionError("Short Gibson overlaps must be rejected")


def test_enzyme_sets_report_cut_meaning_compatibility_and_methylation():
    sequence = "GAATTC" + "A" * 20 + "GGATCC" + "C" * 20 + "GGATCC"
    report = enzyme_analysis(
        sequence,
        insert_sequence="ATGAAATAA",
        enzyme_names=["EcoRI", "BamHI", "MboI"],
        mcs_start=10,
        mcs_end=30,
        circular=False,
    )

    assert "EcoRI" in report["sets"]["uniqueCutters"]
    assert "BamHI" in report["sets"]["twoCutters"]
    assert set(report["sets"]["absentFromInsert"]) == {"BamHI", "EcoRI", "MboI"}
    mbo = next(item for item in report["enzymes"] if item["enzyme"] == "MboI")
    assert mbo["methylationSensitive"] == ["Dam"]
    assert compatible_ends("BamHI", "BglII")["compatible"] is True
    assert compatible_ends("BamHI", "EcoRI")["compatible"] is False


def test_restriction_ligation_rejects_incompatible_ends_before_product():
    backbone = {"sequence": "AAAAGGATCCCCCCGAATTCTTTT", "circular": False, "features": []}
    insert = {"sequence": "GGGGGGATCCATGAAATAACTGCAGCCCC", "features": []}
    preview = restriction_ligation_preview(
        backbone,
        insert,
        backbone_enzymes=["BamHI", "EcoRI"],
        insert_enzymes=["BamHI", "PstI"],
    )

    assert preview["product"] is None
    assert any(warning["code"] == "incompatible_end" for warning in preview["warnings"])


def test_gateway_preview_reports_lost_features_and_frame_loss():
    preview = gateway_preview(
        {
            "sequence": "A" * 30,
            "circular": True,
            "features": [
                {"name": "ccdB", "type": "CDS", "start": 9, "end": 21, "strand": 1}
            ],
        },
        {
            "sequence": "ATGAAAAAATAG",
            "features": [
                {"name": "target", "type": "CDS", "start": 0, "end": 11, "strand": 1}
            ],
        },
        reaction="LR",
        backbone_start=9,
        backbone_end=21,
    )

    assert preview["method"] == "gateway-lr"
    assert preview["lostFeatures"] == ["ccdB"]
    assert preview["product"]["sequence"][9:21] == "ATGAAAAAATAG"
    assert {warning["code"] for warning in preview["warnings"]} >= {"lost_feature", "frame_loss"}


def test_gel_returns_exact_digest_bands_with_a_standard_ladder():
    gel = simulate_gel(
        [{"id": "digest", "name": "EcoRI digest", "bandSizes": [4361, 2390, 1174]}],
        ladder="1kb",
    )

    assert gel["lanes"][0]["kind"] == "ladder"
    assert [band["sizeBp"] for band in gel["lanes"][1]["bands"]] == [4361, 2390, 1174]
    assert round(sum(band["relativeMass"] for band in gel["lanes"][1]["bands"]), 3) == 1.0
    assert gel["sizeUnit"] == "bp"


def test_codon_optimisation_preserves_protein_and_reports_targets():
    protein = "MKWVTFISLLLLFSSAYSRG"
    result = optimize_codons(
        protein,
        preferences=CODON_PREFERENCES["ecoli"],
        target_gc=55,
        min_gc=40,
        max_gc=65,
        avoid_motifs=["GAATTC", "GGATCC"],
    )

    assert str(Seq(result["dna"]).translate()) == protein
    assert result["report"]["cai"] > 0.5
    assert result["report"]["remainingAvoidedMotifs"] == []
    assert 40 <= result["report"]["gcPercent"] <= 65


def test_genbank_round_trip_preserves_an_origin_spanning_feature():
    vector = {
        "name": "origin-span",
        "sequence": "ACGT" * 10,
        "circular": True,
        "features": [{
            "name": "wrap CDS",
            "type": "CDS",
            "start": 32,
            "end": 8,
            "wrapsOrigin": True,
            "strand": 1,
            "qualifiers": {"gene": ["wrapped"]},
        }],
    }
    parsed = parse_sequence_file(export_sequence(vector, "genbank"), "origin-span.gb")

    assert parsed["sequence"] == vector["sequence"]
    assert parsed["circular"] is True
    assert parsed["features"][0]["wrapsOrigin"] is True
    assert (parsed["features"][0]["start"], parsed["features"][0]["end"]) == (32, 8)
    assert parsed["features"][0]["qualifiers"]["gene"] == ["wrapped"]


def test_snapgene_binary_round_trip_preserves_sequence_features_and_topology():
    vector = {
        "name": "pRoundTrip",
        "sequence": "ACGT" * 10,
        "circular": True,
        "features": [{
            "name": "origin feature",
            "type": "rep_origin",
            "start": 32,
            "end": 8,
            "wrapsOrigin": True,
            "strand": -1,
            "qualifiers": {"note": ["crosses zero"]},
        }],
    }
    encoded = export_sequence(vector, "snapgene")
    assert base64.b64decode(encoded).startswith(b"\t\x00\x00\x00\x0eSnapGene")

    parsed = parse_sequence_file(encoded, "pRoundTrip.dna")
    feature = parsed["features"][0]
    assert parsed["sequence"] == vector["sequence"]
    assert parsed["circular"] is True
    assert parsed["name"] == "pRoundTrip"
    assert feature["wrapsOrigin"] is True
    assert (feature["start"], feature["end"], feature["strand"]) == (32, 8, -1)
