"""Local vector utilities adapted from OpenCloning's sequence model.

The GenBank sequence/source conventions and restriction-enzyme handling in
this module are adapted from OpenCloning backend 1.9.5 (commit
6f49b70bd2d2caf790f5226e4625629fc0eab427), Copyright 2022 Manuel Lera
Ramirez, licensed under the MIT License. Protein Labs keeps the implementation
small and offline while emitting OpenCloning-style source history records.
"""

from __future__ import annotations

from io import BytesIO, StringIO
import base64
import copy
import json
import re
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
import uuid

from Bio.Align import PairwiseAligner
from Bio import SeqIO
from Bio.Restriction import RestrictionBatch
from Bio.Seq import Seq
from Bio.SeqFeature import FeatureLocation, SeqFeature
from Bio.SeqRecord import SeqRecord


COMMON_ENZYMES = [
    "BamHI", "BbsI", "BglII", "BsaI", "EcoRI", "HindIII", "KpnI",
    "NcoI", "NdeI", "NotI", "PstI", "SacI", "SalI", "SmaI", "SpeI",
    "XbaI", "XhoI",
]
IUPAC_DNA = set("ACGTRYSWKMBDHVN")
FEATURE_COLORS = {
    "CDS": "#43A047",
    "promoter": "#EF6C00",
    "terminator": "#8E24AA",
    "rep_origin": "#1E88E5",
    "primer_bind": "#00ACC1",
    "misc_feature": "#607D8B",
}

COMMON_DNA_FEATURES = [
    ("T7 promoter", "promoter", "TAATACGACTCACTATAGGG", "#EF6C00"),
    ("T3 promoter", "promoter", "AATTAACCCTCACTAAAGGG", "#EF6C00"),
    ("SP6 promoter", "promoter", "ATTTAGGTGACACTATAG", "#EF6C00"),
    ("lac operator", "protein_bind", "AATTGTGAGCGGATAACAATT", "#F9A825"),
    ("Kozak consensus", "regulatory", "GCCACCATGG", "#F9A825"),
    ("M13 forward primer site", "primer_bind", "GTAAAACGACGGCCAGT", "#00ACC1"),
    ("M13 reverse primer site", "primer_bind", "CAGGAAACAGCTATGAC", "#00ACC1"),
    ("loxP", "protein_bind", "ATAACTTCGTATAGCATACATTATACGAAGTTAT", "#5E35B1"),
    ("Gateway attB1", "protein_bind", "GGGGACAAGTTTGTACAAAAAAGCAGGCT", "#5E35B1"),
    ("Gateway attB2", "protein_bind", "GGGGACCACTTTGTACAAGAAAGCTGGGT", "#5E35B1"),
    ("T7 terminator", "terminator", "GCTAGTTATTGCTCAGCGG", "#8E24AA"),
    ("BGH poly(A) signal", "polyA_signal", "TAGAAGGCACAGTCGAGG", "#8E24AA"),
    ("SV40 poly(A) signal", "polyA_signal", "AATAAACAAGTTAACAACAACAATTGCATTCATTTTATGTTTCAGGTTC", "#8E24AA"),
]

COMMON_PEPTIDE_FEATURES = [
    ("6xHis tag", "HHHHHH", "#00ACC1"),
    ("FLAG tag", "DYKDDDDK", "#00ACC1"),
    ("HA tag", "YPYDVPDYA", "#00ACC1"),
    ("Myc tag", "EQKLISEEDL", "#00ACC1"),
    ("Strep-tag II", "WSHPQFEK", "#00ACC1"),
    ("TEV cleavage site", "ENLYFQG", "#E53935"),
    ("HRV 3C cleavage site", "LEVLFQGP", "#E53935"),
    ("Thrombin cleavage site", "LVPRGS", "#E53935"),
    ("Enterokinase cleavage site", "DDDDK", "#E53935"),
    ("Factor Xa cleavage site", "IEGR", "#E53935"),
]


def normalize_dna(value: str) -> str:
    sequence = re.sub(r"\s+|\d+", "", value).upper()
    invalid = sorted(set(sequence) - IUPAC_DNA)
    if invalid:
        raise ValueError("DNA sequence contains invalid symbols: " + ", ".join(invalid))
    return sequence


def normalize_features(features: Any, sequence_length: int) -> list[dict[str, Any]]:
    if not isinstance(features, list):
        raise ValueError("Vector features must be a list")
    cleaned: list[dict[str, Any]] = []
    for index, feature in enumerate(features):
        if not isinstance(feature, dict):
            raise ValueError("Every vector feature must be an object")
        start = int(feature.get("start", 0))
        end = int(feature.get("end", 0))
        if start < 0 or end <= start or end > sequence_length:
            raise ValueError(
                f"Feature {index + 1} must use zero-based coordinates within the sequence"
            )
        feature_type = str(feature.get("type") or "misc_feature")[:50]
        raw_qualifiers = feature.get("qualifiers") or {}
        if not isinstance(raw_qualifiers, dict):
            raw_qualifiers = {}
        qualifiers: dict[str, list[str]] = {}
        for key, value in list(raw_qualifiers.items())[:100]:
            values = value if isinstance(value, list) else [value]
            qualifiers[str(key)[:80]] = [str(item)[:5000] for item in values[:50]]
        cleaned.append({
            "id": str(feature.get("id") or f"feature-{index + 1}"),
            "name": str(feature.get("name") or feature_type)[:120],
            "type": feature_type,
            "start": start,
            "end": end,
            "strand": -1 if int(feature.get("strand", 1)) < 0 else 1,
            "color": str(feature.get("color") or FEATURE_COLORS.get(feature_type, "#607D8B")),
            "notes": str(feature.get("notes") or "")[:5000],
            "automatic": bool(feature.get("automatic", False)),
            # Marks the construct of interest, so the vector catalogue can say
            # which insert a saved plasmid carries.
            "isInsert": bool(feature.get("isInsert", False)),
            "qualifiers": qualifiers,
        })
    return cleaned


def restriction_map(
    sequence: str,
    *,
    circular: bool,
    enzyme_names: list[str] | None = None,
) -> list[dict[str, Any]]:
    names = enzyme_names or COMMON_ENZYMES
    try:
        enzymes = RestrictionBatch(names)
    except ValueError as error:
        raise ValueError(f"Unknown restriction enzyme: {error}") from error
    analysis = enzymes.search(Seq(sequence), linear=not circular)
    sites: list[dict[str, Any]] = []
    for enzyme in enzymes:
        for position in analysis.get(enzyme, []):
            sites.append({
                "enzyme": str(enzyme),
                "position": int(position),
                "recognitionSite": str(enzyme.site),
                "cutCount": len(analysis.get(enzyme, [])),
            })
    return sorted(sites, key=lambda site: (site["position"], site["enzyme"]))


def simulate_restriction_digest(
    sequence: str,
    *,
    circular: bool,
    enzyme_names: list[str],
) -> dict[str, Any]:
    """Return physical fragment sizes for a complete restriction digest.

    Biopython reports cut sites as one-based positions.  Fragment boundaries
    below are zero-based positions between bases, which makes the returned
    sizes add exactly to the input molecule length for both linear and
    circular molecules.
    """
    sequence = normalize_dna(sequence)
    if not sequence:
        raise ValueError("A DNA sequence is required for digest simulation")
    names = [str(name).strip() for name in enzyme_names if str(name).strip()]
    if not names:
        raise ValueError("Select at least one restriction enzyme")
    sites = restriction_map(sequence, circular=circular, enzyme_names=names)
    cut_coordinates = sorted({max(0, min(len(sequence), int(site["position"]) - 1)) for site in sites})
    fragments: list[dict[str, Any]] = []
    if circular:
        if not cut_coordinates:
            fragments.append({"start": 0, "end": len(sequence), "length": len(sequence), "wraps": True})
        elif len(cut_coordinates) == 1:
            fragments.append({
                "start": cut_coordinates[0],
                "end": cut_coordinates[0],
                "length": len(sequence),
                "wraps": True,
            })
        else:
            for index, start in enumerate(cut_coordinates):
                end = cut_coordinates[(index + 1) % len(cut_coordinates)]
                wraps = index == len(cut_coordinates) - 1
                size = end - start if not wraps else len(sequence) - start + end
                fragments.append({"start": start, "end": end, "length": size, "wraps": wraps})
    else:
        boundaries = [0, *[cut for cut in cut_coordinates if 0 < cut < len(sequence)], len(sequence)]
        for start, end in zip(boundaries, boundaries[1:]):
            if end > start:
                fragments.append({"start": start, "end": end, "length": end - start, "wraps": False})
    fragments_by_size = sorted(fragments, key=lambda item: (-item["length"], item["start"]))
    return {
        "circular": circular,
        "sequenceLength": len(sequence),
        "enzymes": names,
        "cutCount": len(cut_coordinates),
        "cuts": sites,
        "fragments": fragments_by_size,
        "fragmentCount": len(fragments_by_size),
    }


def align_dna_sequences(reference: str, query: str) -> dict[str, Any]:
    """Create a deterministic global DNA alignment and summary statistics."""
    reference = normalize_dna(reference)
    query = normalize_dna(query)
    if not reference or not query:
        raise ValueError("Both sequences are required for alignment")
    if max(len(reference), len(query)) > 100_000:
        raise ValueError("Interactive alignments are limited to 100,000 bases")
    aligner = PairwiseAligner()
    aligner.mode = "global"
    aligner.match_score = 2
    aligner.mismatch_score = -1
    aligner.open_gap_score = -5
    aligner.extend_gap_score = -0.5
    alignment = aligner.align(reference, query)[0]
    coordinates = alignment.coordinates
    reference_parts: list[str] = []
    query_parts: list[str] = []
    for index in range(coordinates.shape[1] - 1):
        ref_start, ref_end = int(coordinates[0, index]), int(coordinates[0, index + 1])
        query_start, query_end = int(coordinates[1, index]), int(coordinates[1, index + 1])
        ref_size, query_size = ref_end - ref_start, query_end - query_start
        if ref_size and query_size:
            reference_parts.append(reference[ref_start:ref_end])
            query_parts.append(query[query_start:query_end])
        elif ref_size:
            reference_parts.append(reference[ref_start:ref_end])
            query_parts.append("-" * ref_size)
        elif query_size:
            reference_parts.append("-" * query_size)
            query_parts.append(query[query_start:query_end])
    aligned_reference = "".join(reference_parts)
    aligned_query = "".join(query_parts)
    matches = sum(
        1 for left, right in zip(aligned_reference, aligned_query)
        if left == right and left != "-"
    )
    mismatches = sum(
        1 for left, right in zip(aligned_reference, aligned_query)
        if left != right and left != "-" and right != "-"
    )
    gaps = sum(
        1 for left, right in zip(aligned_reference, aligned_query)
        if left == "-" or right == "-"
    )
    alignment_length = len(aligned_reference)
    return {
        "score": round(float(alignment.score), 3),
        "alignmentLength": alignment_length,
        "matches": matches,
        "mismatches": mismatches,
        "gaps": gaps,
        "identityPercent": round(100 * matches / alignment_length, 3),
        "referenceAligned": aligned_reference,
        "queryAligned": aligned_query,
    }


def _longest_overlap(left: str, right: str, minimum: int) -> int:
    maximum = min(len(left), len(right))
    for size in range(maximum, minimum - 1, -1):
        if left[-size:] == right[:size]:
            return size
    return 0


def assemble_by_overlap(
    vectors: list[dict[str, Any]],
    *,
    minimum_overlap: int = 20,
    circular: bool = False,
) -> dict[str, Any]:
    """Assemble ordered DNA molecules using exact terminal overlaps.

    This models the sequence bookkeeping used by Gibson-like overlap
    assembly. It intentionally requires exact overlaps so that the desktop
    result is deterministic and does not silently invent junction bases.
    """
    if len(vectors) < 2:
        raise ValueError("Overlap assembly requires at least two vectors")
    if minimum_overlap < 6 or minimum_overlap > 500:
        raise ValueError("Minimum overlap must be between 6 and 500 bases")
    sequences = [normalize_dna(str(vector.get("sequence") or "")) for vector in vectors]
    if any(not sequence for sequence in sequences):
        raise ValueError("Every assembly input must contain a DNA sequence")
    assembled = sequences[0]
    assembled_features = copy.deepcopy(vectors[0].get("features") or [])
    junctions: list[dict[str, Any]] = []
    for index, sequence in enumerate(sequences[1:], start=1):
        overlap = _longest_overlap(assembled, sequence, minimum_overlap)
        if overlap == 0:
            raise ValueError(
                f"No exact overlap of at least {minimum_overlap} bases joins "
                f"{vectors[index - 1].get('name', index)} to {vectors[index].get('name', index + 1)}"
            )
        old_length = len(assembled)
        offset = old_length - overlap
        assembled += sequence[overlap:]
        junctions.append({
            "leftVectorId": vectors[index - 1].get("id"),
            "rightVectorId": vectors[index].get("id"),
            "overlapLength": overlap,
            "junction": old_length,
        })
        for feature in copy.deepcopy(vectors[index].get("features") or []):
            feature["id"] = f"assembly-{index}-{feature.get('id', len(assembled_features) + 1)}"
            feature["start"] = offset + int(feature["start"])
            feature["end"] = offset + int(feature["end"])
            if feature["end"] <= len(assembled):
                assembled_features.append(feature)

    closing_overlap = 0
    if circular:
        # Find a proper suffix-to-prefix overlap; the full sequence matching
        # itself is not a physical circularization junction.
        for size in range(len(assembled) - 1, minimum_overlap - 1, -1):
            if assembled[-size:] == assembled[:size]:
                closing_overlap = size
                break
        if closing_overlap == 0:
            raise ValueError(
                f"The final and first fragments do not share an exact {minimum_overlap}-base overlap"
            )
        assembled = assembled[:-closing_overlap]
        revised: list[dict[str, Any]] = []
        for feature in assembled_features:
            feature["end"] = min(int(feature["end"]), len(assembled))
            if int(feature["start"]) < int(feature["end"]):
                revised.append(feature)
        assembled_features = revised

    deduplicated: list[dict[str, Any]] = []
    seen_features: set[tuple[str, int, int, int]] = set()
    for feature in assembled_features:
        key = (
            str(feature.get("name")),
            int(feature.get("start", 0)),
            int(feature.get("end", 0)),
            int(feature.get("strand", 1)),
        )
        if key not in seen_features:
            seen_features.add(key)
            deduplicated.append(feature)
    return {
        "sequence": assembled,
        "circular": circular,
        "features": deduplicated,
        "primers": [],
        "junctions": junctions,
        "closingOverlapLength": closing_overlap,
    }


def vector_preview(vector: dict[str, Any]) -> dict[str, Any]:
    sequence = str(vector.get("sequence") or "")
    gc = 0.0 if not sequence else 100 * (sequence.count("G") + sequence.count("C")) / len(sequence)
    return {
        **vector,
        "length": len(sequence),
        "gcPercent": round(gc, 3),
        "restrictionSites": restriction_map(
            sequence,
            circular=bool(vector.get("circular", True)),
            enzyme_names=vector.get("enzymeNames") or COMMON_ENZYMES,
        ) if sequence else [],
        "orfs": find_orfs(
            sequence,
            min_amino_acids=int(vector.get("minimumOrfAminoAcids") or 50),
        ) if sequence else [],
    }


def _all_occurrences(sequence: str, motif: str) -> list[int]:
    starts: list[int] = []
    cursor = 0
    while True:
        found = sequence.find(motif, cursor)
        if found < 0:
            return starts
        starts.append(found)
        cursor = found + 1


def find_orfs(sequence: str, min_amino_acids: int = 50) -> list[dict[str, Any]]:
    """Find ATG-to-stop ORFs in all six frames using zero-based coordinates."""
    sequence = normalize_dna(sequence)
    if min_amino_acids < 5 or min_amino_acids > 10_000:
        raise ValueError("Minimum ORF length must be between 5 and 10,000 amino acids")
    result: list[dict[str, Any]] = []
    for strand, oriented in ((1, sequence), (-1, str(Seq(sequence).reverse_complement()))):
        for frame in range(3):
            open_start: int | None = None
            for position in range(frame, len(oriented) - 2, 3):
                codon = oriented[position : position + 3]
                if open_start is None and codon == "ATG":
                    open_start = position
                if open_start is not None and codon in {"TAA", "TAG", "TGA"}:
                    end = position + 3
                    amino_acids = (end - open_start) // 3 - 1
                    if amino_acids >= min_amino_acids:
                        if strand == 1:
                            start_out, end_out = open_start, end
                        else:
                            start_out, end_out = len(sequence) - end, len(sequence) - open_start
                        translated = str(Seq(oriented[open_start:end]).translate(to_stop=True))
                        result.append({
                            "id": f"orf-{strand}-{frame}-{start_out}-{end_out}",
                            "name": f"ORF {amino_acids} aa",
                            "start": start_out,
                            "end": end_out,
                            "strand": strand,
                            "frame": frame + 1 if strand == 1 else -(frame + 1),
                            "aminoAcids": amino_acids,
                            "translation": translated,
                        })
                    open_start = None
    return sorted(result, key=lambda item: (-item["aminoAcids"], item["start"]))


def automatic_annotations(
    sequence: str,
    *,
    include_orfs: bool = True,
    minimum_orf_amino_acids: int = 50,
) -> list[dict[str, Any]]:
    sequence = normalize_dna(sequence)
    annotations: list[dict[str, Any]] = []
    seen: set[tuple[str, int, int, int]] = set()

    def add(name: str, feature_type: str, start: int, end: int, strand: int, color: str, note: str) -> None:
        key = (name, start, end, strand)
        if key in seen:
            return
        seen.add(key)
        annotations.append({
            "id": f"auto-{len(annotations) + 1}-{start}-{end}",
            "name": name,
            "type": feature_type,
            "start": start,
            "end": end,
            "strand": strand,
            "color": color,
            "notes": note,
            "automatic": True,
        })

    for name, feature_type, motif, color in COMMON_DNA_FEATURES:
        for start in _all_occurrences(sequence, motif):
            add(name, feature_type, start, start + len(motif), 1, color, "Exact curated motif match")
        reverse = str(Seq(motif).reverse_complement())
        if reverse != motif:
            for start in _all_occurrences(sequence, reverse):
                add(name, feature_type, start, start + len(motif), -1, color, "Exact curated motif match")

    for strand, oriented in ((1, sequence), (-1, str(Seq(sequence).reverse_complement()))):
        for frame in range(3):
            usable = oriented[frame : len(oriented) - ((len(oriented) - frame) % 3)]
            translated = str(Seq(usable).translate()) if usable else ""
            for name, peptide, color in COMMON_PEPTIDE_FEATURES:
                for amino_start in _all_occurrences(translated, peptide):
                    oriented_start = frame + amino_start * 3
                    oriented_end = oriented_start + len(peptide) * 3
                    if strand == 1:
                        start, end = oriented_start, oriented_end
                    else:
                        start, end = len(sequence) - oriented_end, len(sequence) - oriented_start
                    add(name, "mat_peptide", start, end, strand, color, "Translated peptide motif match")

    if include_orfs:
        for orf in find_orfs(sequence, minimum_orf_amino_acids):
            add(
                orf["name"],
                "CDS",
                orf["start"],
                orf["end"],
                orf["strand"],
                "#43A047",
                f"Predicted frame {orf['frame']}; {orf['aminoAcids']} amino acids",
            )
    return sorted(annotations, key=lambda item: (item["start"], item["end"]))


def primer_metrics(sequence: str) -> dict[str, Any]:
    sequence = normalize_dna(sequence)
    if not sequence:
        raise ValueError("Primer sequence cannot be empty")
    gc_count = sequence.count("G") + sequence.count("C")
    at_count = sequence.count("A") + sequence.count("T")
    return {
        "length": len(sequence),
        "gcPercent": round(100 * gc_count / len(sequence), 2),
        "tmCelsius": round(4 * gc_count + 2 * at_count, 1),
    }


def normalize_primers(primers: Any, sequence_length: int) -> list[dict[str, Any]]:
    if not isinstance(primers, list):
        raise ValueError("Vector primers must be a list")
    cleaned: list[dict[str, Any]] = []
    for index, primer in enumerate(primers):
        if not isinstance(primer, dict):
            raise ValueError("Every primer must be an object")
        primer_sequence = normalize_dna(str(primer.get("sequence") or ""))
        start = int(primer.get("start", 0))
        end = int(primer.get("end", start + len(primer_sequence)))
        if not primer_sequence or start < 0 or end <= start or end > sequence_length:
            raise ValueError(f"Primer {index + 1} has invalid sequence coordinates")
        cleaned.append({
            "id": str(primer.get("id") or f"primer-{index + 1}"),
            "name": str(primer.get("name") or f"Primer {index + 1}")[:120],
            "sequence": primer_sequence,
            "start": start,
            "end": end,
            "strand": -1 if int(primer.get("strand", 1)) < 0 else 1,
            "overhang": normalize_dna(str(primer.get("overhang") or "")),
            "notes": str(primer.get("notes") or "")[:5000],
            **primer_metrics(primer_sequence),
        })
    return cleaned


def design_pcr_primers(
    sequence: str,
    start: int,
    end: int,
    primer_length: int = 20,
) -> list[dict[str, Any]]:
    sequence = normalize_dna(sequence)
    if start < 0 or end <= start or end > len(sequence):
        raise ValueError("PCR region coordinates are outside the vector")
    if primer_length < 15 or primer_length > 60 or end - start < primer_length:
        raise ValueError("Primer length must be 15 to 60 bases and fit within the PCR region")
    forward = sequence[start : start + primer_length]
    reverse_binding = sequence[end - primer_length : end]
    reverse = str(Seq(reverse_binding).reverse_complement())
    return [
        {
            "id": f"primer-forward-{start}-{end}",
            "name": "PCR forward",
            "sequence": forward,
            "start": start,
            "end": start + primer_length,
            "strand": 1,
            **primer_metrics(forward),
        },
        {
            "id": f"primer-reverse-{start}-{end}",
            "name": "PCR reverse",
            "sequence": reverse,
            "start": end - primer_length,
            "end": end,
            "strand": -1,
            **primer_metrics(reverse),
        },
    ]


def apply_sequence_operation(vector: dict[str, Any], operation: dict[str, Any]) -> dict[str, Any]:
    """Apply an edit while preserving or clipping mapped features and primers."""
    output = copy.deepcopy(vector)
    sequence = str(output["sequence"])
    op = str(operation.get("operation") or "")
    start = int(operation.get("start", 0))
    end = int(operation.get("end", len(sequence)))
    replacement = normalize_dna(str(operation.get("replacement") or ""))
    if start < 0 or end < start or end > len(sequence):
        raise ValueError("Edit coordinates are outside the vector")

    if op == "reverse_complement":
        if start == 0 and end == len(sequence):
            output["sequence"] = str(Seq(sequence).reverse_complement())
            for collection_name in ("features", "primers"):
                for item in output.get(collection_name) or []:
                    old_start, old_end = int(item["start"]), int(item["end"])
                    item["start"], item["end"] = len(sequence) - old_end, len(sequence) - old_start
                    item["strand"] = -int(item.get("strand", 1))
        else:
            output["sequence"] = sequence[:start] + str(Seq(sequence[start:end]).reverse_complement()) + sequence[end:]
    elif op in {"insert", "delete", "replace"}:
        if op == "insert":
            end = start
        elif op == "delete":
            replacement = ""
        output["sequence"] = sequence[:start] + replacement + sequence[end:]
        delta = len(replacement) - (end - start)
        for collection_name in ("features", "primers"):
            revised: list[dict[str, Any]] = []
            for item in output.get(collection_name) or []:
                item_start, item_end = int(item["start"]), int(item["end"])
                if item_end <= start:
                    revised.append(item)
                elif item_start >= end:
                    item["start"], item["end"] = item_start + delta, item_end + delta
                    revised.append(item)
                elif item_start < start and item_end > end:
                    item["end"] = item_end + delta
                    revised.append(item)
                elif item_start < start < item_end:
                    item["end"] = start
                    if item["end"] > item["start"]:
                        revised.append(item)
                elif item_start < end < item_end:
                    item["start"], item["end"] = start + len(replacement), item_end + delta
                    if item["end"] > item["start"]:
                        revised.append(item)
            output[collection_name] = revised
    else:
        raise ValueError("Unsupported sequence operation")

    output.setdefault("history", []).append({
        "type": "SequenceEditSource",
        "operation": op,
        "start": start,
        "end": end,
        "insertedBases": len(replacement),
        "outputName": output.get("name"),
    })
    return output


def parse_sequence_file(content: str, filename: str) -> dict[str, Any]:
    lowered = filename.lower()
    if lowered.endswith((".dna", ".prot")):
        file_format = "snapgene"
    elif lowered.endswith((".gb", ".gbk", ".genbank", ".ape")):
        file_format = "genbank"
    else:
        file_format = "fasta"
    try:
        if file_format == "snapgene":
            # SnapGene files are binary, so the client sends them base64 encoded.
            record = SeqIO.read(BytesIO(base64.b64decode(content)), "snapgene")
        else:
            record = SeqIO.read(StringIO(content), file_format)
    except Exception as error:
        raise ValueError(f"Could not read {file_format} sequence: {error}") from error
    sequence = normalize_dna(str(record.seq))
    features: list[dict[str, Any]] = []
    for index, feature in enumerate(record.features):
        if feature.type == "source":
            continue
        start = int(feature.location.start)
        end = int(feature.location.end)
        if end <= start or end > len(sequence):
            continue
        qualifiers = feature.qualifiers
        name_values = (
            qualifiers.get("label")
            or qualifiers.get("gene")
            or qualifiers.get("product")
            or [feature.type]
        )
        features.append({
            "id": f"feature-{index + 1}",
            "name": str(name_values[0]),
            "type": feature.type,
            "start": start,
            "end": end,
            "strand": -1 if feature.location.strand == -1 else 1,
            "color": FEATURE_COLORS.get(feature.type, "#607D8B"),
            "notes": str((qualifiers.get("note") or [""])[0]),
            "automatic": False,
            "qualifiers": {
                str(key): [str(value) for value in values]
                for key, values in qualifiers.items()
            },
        })
    topology = str(record.annotations.get("topology") or "").lower()
    return {
        "name": record.name if record.name and record.name != "<unknown name>" else filename.rsplit(".", 1)[0],
        "sequence": sequence,
        "circular": topology == "circular",
        "features": features,
        "history": [{
            "type": "UploadedFileSource",
            "input": [],
            "outputName": record.name,
            "fileName": filename,
            "fileFormat": file_format,
        }],
    }


def export_sequence(vector: dict[str, Any], file_format: str) -> str:
    sequence = Seq(str(vector["sequence"]))
    name = str(vector.get("name") or "vector")
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", name).strip("_") or "vector"
    record = SeqRecord(
        sequence,
        id=safe_name,
        name=safe_name[:16],
        description=name,
    )
    record.annotations["molecule_type"] = "DNA"
    record.annotations["topology"] = "circular" if vector.get("circular") else "linear"
    for feature in vector.get("features") or []:
        qualifiers = {
            str(key): [str(value) for value in values]
            for key, values in (feature.get("qualifiers") or {}).items()
        }
        qualifiers["label"] = [str(feature.get("name") or "feature")]
        if str(feature.get("notes") or ""):
            qualifiers["note"] = [str(feature.get("notes"))]
        record.features.append(
            SeqFeature(
                FeatureLocation(
                    int(feature["start"]),
                    int(feature["end"]),
                    strand=int(feature.get("strand", 1)),
                ),
                type=str(feature.get("type") or "misc_feature"),
                qualifiers=qualifiers,
            )
        )
    for primer in vector.get("primers") or []:
        record.features.append(
            SeqFeature(
                FeatureLocation(
                    int(primer["start"]),
                    int(primer["end"]),
                    strand=int(primer.get("strand", 1)),
                ),
                type="primer_bind",
                qualifiers={
                    "label": [str(primer.get("name") or "primer")],
                    "sequence": [str(primer.get("sequence") or "")],
                    "note": [str(primer.get("notes") or "")],
                },
            )
        )
    output = StringIO()
    SeqIO.write(record, output, "genbank" if file_format == "genbank" else "fasta")
    return output.getvalue()


def annotate_with_plannotate(
    vector: dict[str, Any],
    service_url: str,
    *,
    timeout: float = 60,
) -> dict[str, Any]:
    """Call an optional pLannotate sidecar using its documented file API.

    OpenCloning uses the same ``POST multipart(file=<GenBank>)`` contract. The
    sidecar is opt-in because pLannotate carries its own GPL application,
    executables, and annotation databases.
    """
    url = service_url.strip()
    if not url:
        raise ValueError("A pLannotate service URL is required")
    if not url.rstrip("/").endswith("annotate"):
        url = url.rstrip("/") + "/annotate"
    content = export_sequence(vector, "genbank")
    filename = f"{str(vector.get('name') or 'vector').replace(' ', '_')}.gb"
    boundary = f"protein-labs-{uuid.uuid4().hex}"
    body = (
        f"--{boundary}\r\n"
        f'Content-Disposition: form-data; name="file"; filename="{filename}"\r\n'
        "Content-Type: text/plain\r\n\r\n"
        f"{content}\r\n"
        f"--{boundary}--\r\n"
    ).encode("utf-8")
    request = Request(
        url,
        data=body,
        headers={
            "Content-Type": f"multipart/form-data; boundary={boundary}",
            "Accept": "application/json",
        },
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            payload = json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"pLannotate returned HTTP {error.code}: {detail[:500]}") from error
    except (URLError, TimeoutError) as error:
        raise RuntimeError(f"Could not reach the pLannotate sidecar: {error}") from error
    if not isinstance(payload, dict) or not isinstance(payload.get("gb_file"), str):
        raise RuntimeError("pLannotate returned an invalid response")
    parsed = parse_sequence_file(payload["gb_file"], filename)
    for feature in parsed["features"]:
        feature["automatic"] = True
        if not feature.get("notes"):
            feature["notes"] = "pLannotate database match"
    return {
        "features": parsed["features"],
        "report": payload.get("report") if isinstance(payload.get("report"), list) else [],
        "version": str(payload.get("version") or "unknown"),
    }
