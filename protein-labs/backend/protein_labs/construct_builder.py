"""Insert a target coding sequence into an annotated vector backbone.

This is the part of expression design that a sequence editor has to get right:
the insert must land in the intended place, in frame with whatever tag and
cleavage site the backbone provides, without a stop codon in between. Those
three facts are computed here rather than left to the researcher to eyeball.

Back-translation uses a preferred-codon table per expression host. It is an
honest preferred-codon back-translation, not a CAI or harmonization optimizer,
and the report says so; a researcher ordering a synthesized gene can paste
their own optimized DNA instead and skip it entirely.
"""

from __future__ import annotations

import re
from typing import Any, Iterable

from Bio.Seq import Seq

from .expression_planner import normalize_dna, restriction_map

# Synonymous codons ordered by preference for each host. The first entry is the
# codon used by default; later entries are fallbacks when a codon would create
# a restriction site that must stay unique for cloning.
CODON_PREFERENCES: dict[str, dict[str, list[str]]] = {
    "ecoli": {
        "A": ["GCG", "GCC", "GCA", "GCT"], "R": ["CGT", "CGC", "CGG", "CGA", "AGA", "AGG"],
        "N": ["AAC", "AAT"], "D": ["GAT", "GAC"], "C": ["TGC", "TGT"],
        "Q": ["CAG", "CAA"], "E": ["GAA", "GAG"], "G": ["GGC", "GGT", "GGA", "GGG"],
        "H": ["CAT", "CAC"], "I": ["ATT", "ATC", "ATA"], "L": ["CTG", "TTA", "TTG", "CTC", "CTT", "CTA"],
        "K": ["AAA", "AAG"], "M": ["ATG"], "F": ["TTT", "TTC"],
        "P": ["CCG", "CCA", "CCT", "CCC"], "S": ["AGC", "TCT", "TCC", "TCG", "TCA", "AGT"],
        "T": ["ACC", "ACG", "ACT", "ACA"], "W": ["TGG"], "Y": ["TAT", "TAC"],
        "V": ["GTG", "GTT", "GTC", "GTA"], "*": ["TAA", "TGA", "TAG"],
    },
    "yeast": {
        "A": ["GCT", "GCC", "GCA", "GCG"], "R": ["AGA", "CGT", "AGG", "CGC", "CGA", "CGG"],
        "N": ["AAC", "AAT"], "D": ["GAT", "GAC"], "C": ["TGT", "TGC"],
        "Q": ["CAA", "CAG"], "E": ["GAA", "GAG"], "G": ["GGT", "GGC", "GGA", "GGG"],
        "H": ["CAC", "CAT"], "I": ["ATT", "ATC", "ATA"], "L": ["TTG", "CTA", "CTT", "CTG", "TTA", "CTC"],
        "K": ["AAG", "AAA"], "M": ["ATG"], "F": ["TTC", "TTT"],
        "P": ["CCA", "CCT", "CCC", "CCG"], "S": ["TCT", "TCC", "TCA", "AGT", "TCG", "AGC"],
        "T": ["ACT", "ACC", "ACA", "ACG"], "W": ["TGG"], "Y": ["TAC", "TAT"],
        "V": ["GTT", "GTC", "GTA", "GTG"], "*": ["TAA", "TGA", "TAG"],
    },
    "insect": {
        "A": ["GCC", "GCT", "GCA", "GCG"], "R": ["CGC", "CGT", "AGA", "AGG", "CGA", "CGG"],
        "N": ["AAC", "AAT"], "D": ["GAC", "GAT"], "C": ["TGC", "TGT"],
        "Q": ["CAG", "CAA"], "E": ["GAG", "GAA"], "G": ["GGC", "GGT", "GGA", "GGG"],
        "H": ["CAC", "CAT"], "I": ["ATC", "ATT", "ATA"], "L": ["CTG", "CTC", "TTG", "CTT", "TTA", "CTA"],
        "K": ["AAG", "AAA"], "M": ["ATG"], "F": ["TTC", "TTT"],
        "P": ["CCC", "CCT", "CCA", "CCG"], "S": ["AGC", "TCC", "TCT", "AGT", "TCA", "TCG"],
        "T": ["ACC", "ACT", "ACA", "ACG"], "W": ["TGG"], "Y": ["TAC", "TAT"],
        "V": ["GTC", "GTG", "GTT", "GTA"], "*": ["TAA", "TAG", "TGA"],
    },
    "human": {
        "A": ["GCC", "GCT", "GCA", "GCG"], "R": ["CGC", "AGA", "AGG", "CGG", "CGT", "CGA"],
        "N": ["AAC", "AAT"], "D": ["GAC", "GAT"], "C": ["TGC", "TGT"],
        "Q": ["CAG", "CAA"], "E": ["GAG", "GAA"], "G": ["GGC", "GGA", "GGG", "GGT"],
        "H": ["CAC", "CAT"], "I": ["ATC", "ATT", "ATA"], "L": ["CTG", "CTC", "TTG", "CTT", "TTA", "CTA"],
        "K": ["AAG", "AAA"], "M": ["ATG"], "F": ["TTC", "TTT"],
        "P": ["CCC", "CCT", "CCA", "CCG"], "S": ["AGC", "TCC", "TCT", "AGT", "TCA", "TCG"],
        "T": ["ACC", "ACA", "ACT", "ACG"], "W": ["TGG"], "Y": ["TAC", "TAT"],
        "V": ["GTG", "GTC", "GTT", "GTA"], "*": ["TGA", "TAA", "TAG"],
    },
}

HOST_LABELS = {
    "ecoli": "Escherichia coli",
    "yeast": "Saccharomyces cerevisiae / Pichia",
    "insect": "Insect cells (Sf9 / Drosophila)",
    "human": "Human / mammalian",
}

# Feature names that mark where an insert is meant to go, and the tags and
# cleavage sites an insert has to stay in frame with.
# Matched as whole words: a plain substring test makes "lic" match
# "replication" and turns every origin of replication into a cloning site.
INSERTION_HINTS = ("mcs", "multiple cloning site", "cloning site", "insert", "lic", "polylinker")
TAG_HINTS = (
    "his", "gst", "mbp", "sumo", "flag", "strep", "myc", "ha tag", "v5", "s-tag",
    "t7 tag", "halotag", "snap", "trx", "thioredoxin", "nusa", "protein a", "zz",
)
CLEAVAGE_HINTS = ("tev", "thrombin", "3c", "prescission", "enterokinase", "factor xa", "sumo", "tvmv")
STOP_CODONS = {"TAA", "TAG", "TGA"}


def available_hosts() -> list[dict[str, Any]]:
    return [
        {"id": host, "name": label, "codons": len(CODON_PREFERENCES[host])}
        for host, label in HOST_LABELS.items()
    ]


def back_translate(
    protein: str,
    *,
    host: str = "ecoli",
    avoid_enzymes: Iterable[str] = (),
    include_stop: bool = True,
) -> dict[str, Any]:
    """Back-translate a protein using the host's preferred codons.

    When ``avoid_enzymes`` is given, any codon that would complete one of those
    recognition sites is swapped for the next-best synonymous codon so the
    cloning sites stay unique to the backbone.
    """
    table = CODON_PREFERENCES.get(host)
    if table is None:
        raise ValueError(f"No codon table for host {host!r}")
    residues = "".join(protein.split()).upper()
    unknown = sorted(set(residues) - set(table) - {"*"})
    if unknown:
        raise ValueError(
            "Back-translation needs the 20 canonical amino acids; "
            f"unsupported residues: {', '.join(unknown)}"
        )
    if not residues:
        raise ValueError("Enter a protein sequence to back-translate")

    enzymes = [name for name in avoid_enzymes if name]
    codons = [table[residue][0] for residue in residues]
    swaps: list[dict[str, Any]] = []

    if enzymes:
        # A recognition site usually straddles a codon boundary, and the codon
        # that completes it may have no synonym at all (Met and Trp never do).
        # So when a site appears, walk back over the preceding codons too and
        # swap the first one that removes it. The classic case is His-Met at
        # the start of a CDS spelling the NdeI site CATATG.
        for index in range(len(codons)):
            window_start = max(0, index - 3)
            if not _has_site("".join(codons[window_start:index + 1]), enzymes):
                continue
            for position in range(index, max(-1, index - 4), -1):
                original = codons[position]
                replaced = False
                for candidate in table[residues[position]][1:]:
                    codons[position] = candidate
                    if not _has_site("".join(codons[window_start:index + 1]), enzymes):
                        swaps.append({
                            "position": position + 1,
                            "residue": residues[position],
                            "from": original,
                            "to": candidate,
                        })
                        replaced = True
                        break
                if replaced:
                    break
                codons[position] = original

    dna = "".join(codons)
    if include_stop and residues[-1] != "*":
        dna += table["*"][0]

    remaining = sorted({name for name in enzymes if _has_site(dna, [name])}) if enzymes else []
    return {
        "dna": dna,
        "host": host,
        "hostName": HOST_LABELS.get(host, host),
        "aminoAcids": len(residues),
        "codonSwaps": swaps,
        "remainingSites": remaining,
        "method": "Preferred-codon back-translation",
        "limitation": (
            "Codons are the host's most-used choice per amino acid. This is not "
            "a CAI, GC-content or mRNA-structure optimization; paste a "
            "synthesis-house optimized sequence if that is required."
        ),
    }


def _has_site(sequence: str, enzymes: list[str]) -> bool:
    try:
        hits = restriction_map(sequence, circular=False, enzyme_names=enzymes)
    except Exception:  # pragma: no cover - unknown enzyme name
        return False
    return bool(hits)


def _feature_text(feature: dict[str, Any]) -> str:
    return " ".join(
        str(feature.get(key) or "") for key in ("name", "label", "type", "notes")
    ).lower()


def _matches(feature: dict[str, Any], hints: Iterable[str]) -> bool:
    text = _feature_text(feature)
    return any(
        re.search(rf"(?<![a-z]){re.escape(hint)}(?![a-z])", text)
        for hint in hints
    )


def insertion_sites(vector: dict[str, Any], *, enzymes: Iterable[str] = ()) -> list[dict[str, Any]]:
    """Describe the annotated places a target CDS can be inserted.

    Each site reports the reading frame it would join, so the UI can say
    plainly whether an insert lands in frame with the backbone's tag.
    """
    sequence = normalize_dna(str(vector.get("sequence") or ""))
    features = [feature for feature in (vector.get("features") or []) if isinstance(feature, dict)]
    sites: list[dict[str, Any]] = []

    def context(position: int, strand: int) -> dict[str, str]:
        upstream = sequence[max(0, position - 30):position]
        downstream = sequence[position:position + 30]
        if strand < 0:
            upstream, downstream = (
                str(Seq(sequence[position:position + 30]).reverse_complement()),
                str(Seq(sequence[max(0, position - 30):position]).reverse_complement()),
            )
        return {"upstream": upstream, "downstream": downstream}

    for feature in features:
        if not _matches(feature, INSERTION_HINTS):
            continue
        start, end = int(feature.get("start", 0)), int(feature.get("end", 0))
        strand = -1 if int(feature.get("strand", 1)) < 0 else 1
        reference = _reading_frame_reference(sequence, features, start, end, strand)
        sites.append({
            "id": f"site-{start}-{end}",
            "kind": "cloning-site",
            "label": str(feature.get("name") or "Cloning site"),
            "featureType": str(feature.get("type") or "misc_feature"),
            "start": start,
            "end": end,
            "strand": strand,
            "replaceRegion": True,
            "recommended": True,
            "reason": "Annotated cloning site: the insert replaces the polylinker.",
            "frame": reference,
            **context(start if strand > 0 else end, strand),
        })

    # Immediately after a tag or cleavage site is where a fusion construct
    # normally begins, so offer those junctions as in-frame insertion points.
    for feature in features:
        if not (_matches(feature, TAG_HINTS) or _matches(feature, CLEAVAGE_HINTS)):
            continue
        start, end = int(feature.get("start", 0)), int(feature.get("end", 0))
        strand = -1 if int(feature.get("strand", 1)) < 0 else 1
        junction = end if strand > 0 else start
        label = str(feature.get("name") or "tag")
        reference = _reading_frame_reference(sequence, features, start, end, strand)
        sites.append({
            "id": f"junction-{junction}-{strand}",
            "kind": "fusion-junction",
            "label": f"Directly after {label}",
            "featureType": str(feature.get("type") or "CDS"),
            "start": junction,
            "end": junction,
            "strand": strand,
            "replaceRegion": False,
            "recommended": _matches(feature, CLEAVAGE_HINTS),
            "reason": (
                "Downstream of the cleavage site, so the tag can be removed from the target."
                if _matches(feature, CLEAVAGE_HINTS)
                else f"Fuses the target directly to {label}."
            ),
            "frame": reference,
            **context(junction, strand),
        })

    enzyme_names = [name for name in enzymes if name]
    if enzyme_names:
        for hit in restriction_map(
            sequence, circular=bool(vector.get("circular")), enzyme_names=enzyme_names
        ):
            # Biopython reports the 1-based base after the cut.
            cut = max(0, int(hit["position"]) - 1)
            inside = next(
                (site for site in sites if site["kind"] == "cloning-site"
                 and site["start"] <= cut <= site["end"]),
                None,
            )
            sites.append({
                "id": f"enzyme-{hit['enzyme']}-{hit['position']}",
                "kind": "restriction-site",
                "label": f"{hit['enzyme']} site",
                "featureType": "restriction_site",
                "start": int(hit["position"]),
                "end": int(hit["position"]),
                "strand": 1,
                "replaceRegion": False,
                "recommended": bool(inside),
                "reason": (
                    f"{hit['enzyme']} cuts inside {inside['label']}."
                    if inside else f"{hit['enzyme']} cuts the backbone here."
                ),
                "enzyme": str(hit["enzyme"]),
                "frame": _reading_frame_reference(
                    sequence, features, cut, cut, inside["strand"] if inside else 1
                ),
                **context(cut, 1),
            })

    sites.sort(key=lambda site: (not site["recommended"], site["start"]))
    return sites


def _reading_frame_reference(
    sequence: str,
    features: list[dict[str, Any]],
    start: int,
    end: int,
    strand: int,
    *,
    allow_flip: bool = True,
) -> dict[str, Any] | None:
    """Find the tag or start codon an insert at this position must match.

    Returns the reference feature and the offset of the insertion point within
    its reading frame, which is what decides whether a fusion is in frame.

    A polylinker is often annotated on the opposite strand to the expression
    cassette that drives it, so when nothing is found in the given orientation
    the other one is tried before giving up.
    """
    found = _frame_in_orientation(features, start, end, strand)
    if found is None and allow_flip:
        found = _frame_in_orientation(features, start, end, -strand)
    return found


def _frame_in_orientation(
    features: list[dict[str, Any]],
    start: int,
    end: int,
    strand: int,
) -> dict[str, Any] | None:
    candidates = [
        feature for feature in features
        if (-1 if int(feature.get("strand", 1)) < 0 else 1) == strand
        and (_matches(feature, TAG_HINTS) or str(feature.get("type")) == "CDS"
             or "start codon" in _feature_text(feature))
    ]
    if not candidates:
        return None

    junction = start if strand > 0 else end
    if strand > 0:
        upstream = [f for f in candidates if int(f.get("end", 0)) <= junction]
        reference = max(upstream, key=lambda f: int(f.get("end", 0))) if upstream else None
        if reference is None:
            return None
        offset = (junction - int(reference.get("start", 0))) % 3
    else:
        downstream = [f for f in candidates if int(f.get("start", 0)) >= junction]
        reference = min(downstream, key=lambda f: int(f.get("start", 0))) if downstream else None
        if reference is None:
            return None
        offset = (int(reference.get("end", 0)) - junction) % 3

    return {
        "referenceName": str(reference.get("name") or reference.get("type") or "upstream CDS"),
        "referenceStart": int(reference.get("start", 0)),
        "referenceEnd": int(reference.get("end", 0)),
        "strand": strand,
        "offset": offset,
        "inFrame": offset == 0,
        "padding": (3 - offset) % 3,
    }


def insert_target_sequence(
    vector: dict[str, Any],
    *,
    insert_dna: str,
    start: int,
    end: int | None = None,
    strand: int = 1,
    name: str = "Target CDS",
    keep_frame: bool = True,
    color: str = "#35B99A",
) -> dict[str, Any]:
    """Place an insert into the backbone and report what it produced.

    Existing annotations are shifted by the length change so the backbone stays
    correctly annotated, and the result records the frame and stop-codon checks
    for the junction that was created.
    """
    sequence = normalize_dna(str(vector.get("sequence") or ""))
    fragment = normalize_dna(insert_dna)
    if not fragment:
        raise ValueError("The insert has no DNA sequence")
    stop = int(end if end is not None else start)
    start = max(0, min(int(start), len(sequence)))
    stop = max(start, min(stop, len(sequence)))

    features = [dict(feature) for feature in (vector.get("features") or []) if isinstance(feature, dict)]
    reference = _reading_frame_reference(sequence, features, start, stop, strand)

    padding = ""
    if keep_frame and reference and reference["padding"]:
        # One or two G bases restore the codon boundary. They merge with the
        # surrounding bases into a real codon, so the junction still
        # translates, and the report states how many were added.
        padding = "G" * reference["padding"]

    oriented = fragment if strand > 0 else str(Seq(fragment).reverse_complement())
    insert = padding + oriented if strand > 0 else oriented + padding
    removed = stop - start
    delta = len(insert) - removed

    updated = sequence[:start] + insert + sequence[stop:]

    shifted: list[dict[str, Any]] = []
    for feature in features:
        feature_start, feature_end = int(feature.get("start", 0)), int(feature.get("end", 0))
        if feature_end <= start:
            shifted.append(feature)
            continue
        if feature_start >= stop:
            feature["start"] = feature_start + delta
            feature["end"] = feature_end + delta
            shifted.append(feature)
            continue
        # The replaced region overlapped this annotation, so it no longer
        # describes the sequence and is dropped rather than silently moved.
        continue

    insert_feature = {
        "id": f"target-{start}-{start + len(insert)}",
        "name": name,
        "type": "CDS",
        "start": start,
        "end": start + len(insert),
        "strand": 1 if strand > 0 else -1,
        "color": color,
        "notes": "Target coding sequence inserted by Protein Lab",
        "automatic": False,
        "isInsert": True,
    }
    shifted.append(insert_feature)
    shifted.sort(key=lambda feature: (int(feature["start"]), int(feature["end"])))

    translation = str(Seq(oriented[: len(oriented) // 3 * 3]).translate())
    internal_stops = [
        index for index, residue in enumerate(translation[:-1]) if residue == "*"
    ]

    return {
        "sequence": updated,
        "features": shifted,
        "insertFeature": insert_feature,
        "report": {
            "insertedBases": len(insert),
            "removedBases": removed,
            "paddingBases": len(padding),
            "lengthChange": delta,
            "frame": reference,
            "inFrame": bool(reference["inFrame"]) if reference else None,
            "framePadded": bool(padding),
            "internalStopCodons": internal_stops,
            "translation": translation,
            "startsWithMet": translation.startswith("M"),
            "endsWithStop": translation.endswith("*"),
        },
        "history": [{
            "type": "ProteinLabsInsertSource",
            "input": [str(vector.get("id") or "")],
            "outputName": name,
            "start": start,
            "end": stop,
            "insertedBases": len(insert),
        }],
    }
