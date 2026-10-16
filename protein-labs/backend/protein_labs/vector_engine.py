"""Publication-grade calculations used by the expression-vector workspace.

Coordinates in this module are zero-based, half-open.  Thermodynamic values
are calculated only for the annealing portion of a primer; a 5' cloning tail
does not hybridize during the first PCR cycles and therefore must not inflate
the reported melting temperature.
"""

from __future__ import annotations

import math
import re
from typing import Any, Iterable

from Bio.Restriction import RestrictionBatch
from Bio.Seq import Seq
from Bio.SeqUtils import MeltingTemp


ATTB1 = "GGGGACAAGTTTGTACAAAAAAGCAGGCT"
ATTB2 = "GGGGACCACTTTGTACAAGAAAGCTGGGT"
STANDARD_LADDERS = {
    "1kb": [10000, 8000, 6000, 5000, 4000, 3000, 2500, 2000, 1500, 1000, 750, 500, 250],
    "100bp": [1500, 1200, 1000, 900, 800, 700, 600, 500, 400, 300, 200, 100],
}
METHYLATION_SENSITIVITY = {
    "BclI": ["Dam"],
    "MboI": ["Dam"],
    "DpnI": ["Dam"],
    "DpnII": ["Dam"],
    "Sau3AI": ["Dam"],
    "EcoRII": ["Dcm"],
    "BstNI": ["Dcm"],
    "PspGI": ["Dcm"],
}


def _dna(value: str) -> str:
    sequence = re.sub(r"\s+|\d+", "", str(value)).upper()
    invalid = sorted(set(sequence) - set("ACGT"))
    if invalid:
        raise ValueError(
            "This calculation requires unambiguous DNA; invalid symbols: "
            + ", ".join(invalid)
        )
    return sequence


def nearest_neighbor_tm(
    sequence: str,
    *,
    sodium_mm: float = 50.0,
    magnesium_mm: float = 1.5,
    dntp_mm: float = 0.2,
    primer_nm: float = 500.0,
    template_nm: float = 0.0,
    salt_correction: int = 7,
) -> float:
    """SantaLucia nearest-neighbour Tm with Owczarzy salt correction."""
    sequence = _dna(sequence)
    if len(sequence) < 2:
        raise ValueError("Tm requires at least two unambiguous bases")
    if min(sodium_mm, magnesium_mm, dntp_mm, primer_nm, template_nm) < 0 or primer_nm == 0:
        raise ValueError("Primer and salt concentrations cannot be negative or zero")
    return float(
        MeltingTemp.Tm_NN(
            sequence,
            nn_table=MeltingTemp.DNA_NN3,
            dnac1=primer_nm,
            dnac2=template_nm,
            Na=sodium_mm,
            Mg=magnesium_mm,
            dNTPs=dntp_mm,
            saltcorr=salt_correction,
        )
    )


def _longest_complementary_run(left: str, right: str) -> tuple[int, str]:
    """Return the longest contiguous duplex between two 5'-to-3' oligos."""
    left = _dna(left)
    right_rc = str(Seq(_dna(right)).reverse_complement())
    best = ""
    for offset in range(-len(right_rc) + 1, len(left)):
        run = ""
        for left_index in range(max(0, offset), min(len(left), offset + len(right_rc))):
            right_index = left_index - offset
            if left[left_index] == right_rc[right_index]:
                run += left[left_index]
                if len(run) > len(best):
                    best = run
            else:
                run = ""
    return len(best), best


def _three_prime_complementarity(left: str, right: str) -> int:
    left = _dna(left)
    right_rc = str(Seq(_dna(right)).reverse_complement())
    best = 0
    # Test alignments in which the 3' end of either oligo participates.
    for offset in range(-len(right_rc) + 1, len(left)):
        matched_left_3 = 0
        matched_right_3 = 0
        for left_index in range(max(0, offset), min(len(left), offset + len(right_rc))):
            right_index = left_index - offset
            if left[left_index] != right_rc[right_index]:
                continue
            run = 1
            while (
                left_index - run >= 0
                and right_index - run >= 0
                and left[left_index - run] == right_rc[right_index - run]
            ):
                run += 1
            if left_index == len(left) - 1:
                matched_left_3 = max(matched_left_3, run)
            if right_index == 0:
                matched_right_3 = max(matched_right_3, run)
        best = max(best, matched_left_3, matched_right_3)
    return best


def secondary_structure(left: str, right: str | None = None) -> dict[str, Any]:
    """Screen contiguous complementarity, emphasizing extendable 3' ends.

    This is a deterministic screening check, not a free-energy folding model.
    The response names that limitation so a UI cannot present it as a dG value.
    """
    other = left if right is None else right
    run, motif = _longest_complementary_run(left, other)
    three_prime = _three_prime_complementarity(left, other)
    severe = three_prime >= 4 or run >= 8
    caution = three_prime >= 3 or run >= 6
    return {
        "longestComplementaryRun": run,
        "complementaryMotif": motif,
        "threePrimeComplementarity": three_prime,
        "risk": "high" if severe else "moderate" if caution else "low",
        "method": "contiguous complementarity screen",
        "limitation": "Screening heuristic; no secondary-structure free energy is calculated.",
    }


def primer_metrics(
    annealing_sequence: str,
    *,
    overhang: str = "",
    sodium_mm: float = 50.0,
    magnesium_mm: float = 1.5,
    dntp_mm: float = 0.2,
    primer_nm: float = 500.0,
) -> dict[str, Any]:
    annealing = _dna(annealing_sequence)
    tail = _dna(overhang) if overhang else ""
    gc_count = annealing.count("G") + annealing.count("C")
    return {
        "length": len(annealing),
        "totalLength": len(tail) + len(annealing),
        "gcPercent": round(100 * gc_count / len(annealing), 2),
        "tmCelsius": round(
            nearest_neighbor_tm(
                annealing,
                sodium_mm=sodium_mm,
                magnesium_mm=magnesium_mm,
                dntp_mm=dntp_mm,
                primer_nm=primer_nm,
            ),
            2,
        ),
        "tmMethod": "SantaLucia 1997 nearest-neighbor; Owczarzy 2008 salt correction",
        "conditions": {
            "sodiumMm": float(sodium_mm),
            "magnesiumMm": float(magnesium_mm),
            "dntpMm": float(dntp_mm),
            "primerNm": float(primer_nm),
        },
        "hairpin": secondary_structure(tail + annealing),
    }


def _choose_primer(
    candidates: Iterable[tuple[str, int]],
    *,
    target_tm: float,
    min_gc: float,
    max_gc: float,
    conditions: dict[str, float],
) -> tuple[str, int, dict[str, Any]]:
    ranked = []
    for sequence, length in candidates:
        metrics = primer_metrics(sequence, **conditions)
        gc_penalty = 0.0
        if metrics["gcPercent"] < min_gc:
            gc_penalty = min_gc - metrics["gcPercent"]
        elif metrics["gcPercent"] > max_gc:
            gc_penalty = metrics["gcPercent"] - max_gc
        ranked.append((abs(metrics["tmCelsius"] - target_tm) + gc_penalty * 2, sequence, length, metrics))
    if not ranked:
        raise ValueError("No primer candidate fits inside the selected PCR region")
    _, sequence, length, metrics = min(ranked, key=lambda item: (item[0], item[2]))
    return sequence, length, metrics


def design_primers(
    sequence: str,
    start: int,
    end: int,
    *,
    target_tm: float = 60.0,
    min_length: int = 18,
    max_length: int = 30,
    min_gc: float = 35.0,
    max_gc: float = 65.0,
    sodium_mm: float = 50.0,
    magnesium_mm: float = 1.5,
    dntp_mm: float = 0.2,
    primer_nm: float = 500.0,
    forward_overhang: str = "",
    reverse_overhang: str = "",
    cloning_method: str = "pcr",
) -> list[dict[str, Any]]:
    sequence = _dna(sequence)
    if start < 0 or end <= start or end > len(sequence):
        raise ValueError("PCR region coordinates are outside the vector")
    if min_length < 15 or max_length > 60 or min_length > max_length:
        raise ValueError("Primer length range must be within 15 to 60 bases")
    if not (0 <= min_gc <= max_gc <= 100):
        raise ValueError("Primer GC limits must be between 0 and 100 percent")
    if end - start < min_length:
        raise ValueError("The PCR region is shorter than the minimum primer length")

    method = cloning_method.lower().replace("_", "-")
    if method in {"gibson", "in-fusion", "infusion"}:
        for label, value in (("forward", forward_overhang), ("reverse", reverse_overhang)):
            if not 15 <= len(_dna(value)) <= 40:
                raise ValueError(f"{label.capitalize()} overlap must be 15 to 40 bases")
    elif method in {"gateway", "gateway-attb"}:
        forward_overhang = ATTB1 + _dna(forward_overhang)
        reverse_overhang = ATTB2 + _dna(reverse_overhang)

    conditions = {
        "sodium_mm": sodium_mm,
        "magnesium_mm": magnesium_mm,
        "dntp_mm": dntp_mm,
        "primer_nm": primer_nm,
    }
    maximum = min(max_length, end - start)
    forward, forward_length, forward_metrics = _choose_primer(
        ((sequence[start : start + length], length) for length in range(min_length, maximum + 1)),
        target_tm=target_tm,
        min_gc=min_gc,
        max_gc=max_gc,
        conditions=conditions,
    )
    reverse, reverse_length, reverse_metrics = _choose_primer(
        (
            (str(Seq(sequence[end - length : end]).reverse_complement()), length)
            for length in range(min_length, maximum + 1)
        ),
        target_tm=target_tm,
        min_gc=min_gc,
        max_gc=max_gc,
        conditions=conditions,
    )
    forward_overhang = _dna(forward_overhang) if forward_overhang else ""
    reverse_overhang = _dna(reverse_overhang) if reverse_overhang else ""
    primers = [
        {
            "id": f"primer-forward-{start}-{end}",
            "name": "PCR forward",
            "sequence": forward_overhang + forward,
            "annealingSequence": forward,
            "overhang": forward_overhang,
            "start": start,
            "end": start + forward_length,
            "strand": 1,
            "cloningMethod": method,
            **{**forward_metrics, "totalLength": len(forward_overhang) + forward_length},
        },
        {
            "id": f"primer-reverse-{start}-{end}",
            "name": "PCR reverse",
            "sequence": reverse_overhang + reverse,
            "annealingSequence": reverse,
            "overhang": reverse_overhang,
            "start": end - reverse_length,
            "end": end,
            "strand": -1,
            "cloningMethod": method,
            **{**reverse_metrics, "totalLength": len(reverse_overhang) + reverse_length},
        },
    ]
    heterodimer = secondary_structure(primers[0]["sequence"], primers[1]["sequence"])
    for primer in primers:
        primer["selfDimer"] = secondary_structure(primer["sequence"])
        primer["heteroDimer"] = heterodimer
        primer["targetTmCelsius"] = float(target_tm)
        primer["tmDeltaCelsius"] = round(primer["tmCelsius"] - target_tm, 2)
        primer["withinGcLimits"] = min_gc <= primer["gcPercent"] <= max_gc
    return primers


def _sticky_end(enzyme: Any) -> dict[str, str]:
    if enzyme.is_blunt():
        return {"polarity": "blunt", "sequence": ""}
    left = min(int(enzyme.fst5), len(enzyme.site) + int(enzyme.fst3))
    right = max(int(enzyme.fst5), len(enzyme.site) + int(enzyme.fst3))
    return {"polarity": "5-prime" if enzyme.is_5overhang() else "3-prime", "sequence": enzyme.site[left:right]}


def enzyme_analysis(
    backbone_sequence: str,
    *,
    insert_sequence: str = "",
    enzyme_names: Iterable[str],
    mcs_start: int | None = None,
    mcs_end: int | None = None,
    supplier: str | None = None,
    circular: bool = True,
) -> dict[str, Any]:
    backbone = _dna(backbone_sequence)
    insert = _dna(insert_sequence) if insert_sequence else ""
    names = [str(name) for name in enzyme_names]
    try:
        batch = RestrictionBatch(names)
    except ValueError as error:
        raise ValueError(f"Unknown restriction enzyme: {error}") from error
    backbone_hits = batch.search(Seq(backbone), linear=not circular)
    insert_hits = batch.search(Seq(insert), linear=True) if insert else {}
    entries = []
    for enzyme in batch:
        positions = [int(value) for value in backbone_hits.get(enzyme, [])]
        insert_positions = [int(value) for value in insert_hits.get(enzyme, [])]
        supplier_codes = list(enzyme.suppl)
        if supplier and supplier not in supplier_codes:
            continue
        entries.append({
            "enzyme": str(enzyme),
            "recognitionSite": str(enzyme.site),
            "cutPositions": positions,
            "cutCount": len(positions),
            "insertCutCount": len(insert_positions),
            "uniqueCutter": len(positions) == 1,
            "twoCutter": len(positions) == 2,
            "absentFromInsert": not insert_positions,
            "mcsFlanking": bool(
                mcs_start is not None
                and mcs_end is not None
                and any(position <= mcs_start + 1 for position in positions)
                and any(position >= mcs_end + 1 for position in positions)
            ),
            "suppliers": supplier_codes,
            "methylationSensitive": METHYLATION_SENSITIVITY.get(str(enzyme), []),
            "end": _sticky_end(enzyme),
        })
    entries.sort(key=lambda item: (item["enzyme"]))
    return {
        "enzymes": entries,
        "sets": {
            "uniqueCutters": [item["enzyme"] for item in entries if item["uniqueCutter"]],
            "twoCutters": [item["enzyme"] for item in entries if item["twoCutter"]],
            "mcsFlanking": [item["enzyme"] for item in entries if item["mcsFlanking"]],
            "absentFromInsert": [item["enzyme"] for item in entries if item["absentFromInsert"]],
        },
        "supplierFilter": supplier,
    }


def compatible_ends(left_enzyme: str, right_enzyme: str) -> dict[str, Any]:
    try:
        enzymes = list(RestrictionBatch([left_enzyme, right_enzyme]))
    except ValueError as error:
        raise ValueError(f"Unknown restriction enzyme: {error}") from error
    by_name = {str(enzyme): enzyme for enzyme in enzymes}
    left = _sticky_end(by_name[left_enzyme])
    right = _sticky_end(by_name[right_enzyme])
    compatible = left["polarity"] == right["polarity"] and left["sequence"] == right["sequence"]
    return {"compatible": compatible, "left": left, "right": right}


def restriction_ligation_preview(
    backbone: dict[str, Any],
    insert: dict[str, Any],
    *,
    backbone_enzymes: list[str],
    insert_enzymes: list[str] | None = None,
) -> dict[str, Any]:
    """Preview directional double-digest cloning and verify both junctions."""
    if len(backbone_enzymes) != 2:
        raise ValueError("Restriction cloning requires two backbone enzymes")
    insert_enzymes = insert_enzymes or backbone_enzymes
    if len(insert_enzymes) != 2:
        raise ValueError("Restriction cloning requires two insert enzymes")
    backbone_sequence = _dna(backbone.get("sequence", ""))
    insert_sequence = _dna(insert.get("sequence", ""))

    def cuts(sequence: str, names: list[str], circular: bool) -> tuple[list[int], list[dict[str, str]]]:
        batch = RestrictionBatch(names)
        hits = batch.search(Seq(sequence), linear=not circular)
        coordinates = []
        warnings = []
        for name in names:
            enzyme = next(enzyme for enzyme in batch if str(enzyme) == name)
            positions = [int(position) - 1 for position in hits.get(enzyme, [])]
            if len(positions) != 1:
                warnings.append({
                    "code": "internal_sites" if len(positions) > 1 else "missing_site",
                    "message": f"{name} cuts {len(positions)} times; exactly one site is required.",
                })
            coordinates.append(positions[0] if positions else -1)
        return coordinates, warnings

    backbone_cuts, warnings = cuts(
        backbone_sequence, backbone_enzymes, bool(backbone.get("circular", True))
    )
    insert_cuts, insert_warnings = cuts(insert_sequence, insert_enzymes, False)
    warnings.extend(insert_warnings)
    left_compatibility = compatible_ends(backbone_enzymes[0], insert_enzymes[0])
    right_compatibility = compatible_ends(backbone_enzymes[1], insert_enzymes[1])
    if not left_compatibility["compatible"]:
        warnings.append({"code": "incompatible_end", "message": "The left insert and backbone ends cannot ligate."})
    if not right_compatibility["compatible"]:
        warnings.append({"code": "incompatible_end", "message": "The right insert and backbone ends cannot ligate."})
    can_assemble = (
        all(coordinate >= 0 for coordinate in [*backbone_cuts, *insert_cuts])
        and left_compatibility["compatible"]
        and right_compatibility["compatible"]
    )
    if not can_assemble:
        return {
            "method": "restriction-ligation",
            "product": None,
            "junctions": [left_compatibility, right_compatibility],
            "warnings": warnings,
        }

    backbone_left, backbone_right = sorted(backbone_cuts)
    insert_left, insert_right = sorted(insert_cuts)
    payload = insert_sequence[insert_left:insert_right]
    product = backbone_sequence[:backbone_left] + payload + backbone_sequence[backbone_right:]
    delta = len(payload) - (backbone_right - backbone_left)
    features = []
    lost = []
    for feature in backbone.get("features") or []:
        item = dict(feature)
        if int(item["end"]) <= backbone_left:
            features.append(item)
        elif int(item["start"]) >= backbone_right:
            item["start"] = int(item["start"]) + delta
            item["end"] = int(item["end"]) + delta
            features.append(item)
        else:
            lost.append(str(item.get("name") or item.get("type") or "feature"))
    for feature in insert.get("features") or []:
        if int(feature["start"]) >= insert_left and int(feature["end"]) <= insert_right:
            item = dict(feature)
            item["start"] = backbone_left + int(item["start"]) - insert_left
            item["end"] = backbone_left + int(item["end"]) - insert_left
            features.append(item)
    warnings.extend(assembly_warnings(product, features))
    warnings.extend(
        {"code": "lost_feature", "message": f"Digest removes backbone feature: {name}."}
        for name in lost
    )
    return {
        "method": "restriction-ligation",
        "product": {"sequence": product, "circular": True, "features": features},
        "junctions": [
            {"position": backbone_left, **left_compatibility},
            {"position": backbone_left + len(payload), **right_compatibility},
        ],
        "warnings": warnings,
        "lostFeatures": lost,
    }


def simulate_gel(lanes: list[dict[str, Any]], *, ladder: str = "1kb") -> dict[str, Any]:
    if ladder not in STANDARD_LADDERS:
        raise ValueError(f"Unknown ladder {ladder!r}")
    output_lanes = [{
        "id": "ladder",
        "name": f"{ladder} ladder",
        "kind": "ladder",
        "bands": [{"sizeBp": size, "relativeMass": 1.0} for size in STANDARD_LADDERS[ladder]],
    }]
    for index, lane in enumerate(lanes):
        sizes = lane.get("bandSizes")
        if sizes is None:
            sizes = [fragment.get("length") for fragment in (lane.get("fragments") or [])]
        cleaned = sorted((int(size) for size in sizes if int(size) > 0), reverse=True)
        output_lanes.append({
            "id": str(lane.get("id") or f"lane-{index + 1}"),
            "name": str(lane.get("name") or f"Lane {index + 1}"),
            "kind": "sample",
            "bands": [{"sizeBp": size, "relativeMass": round(size / sum(cleaned), 4)} for size in cleaned],
        })
    return {
        "ladder": ladder,
        "lanes": output_lanes,
        "migrationModel": "distance proportional to -log10(base pairs)",
        "sizeUnit": "bp",
    }


def assembly_warnings(product: str, features: list[dict[str, Any]]) -> list[dict[str, str]]:
    warnings = []
    for feature in features:
        if str(feature.get("type")) != "CDS":
            continue
        start, end = int(feature.get("start", 0)), int(feature.get("end", 0))
        if (end - start) % 3:
            warnings.append({"code": "frame_loss", "message": f"{feature.get('name', 'CDS')} is not a multiple of three bases."})
        if 0 <= start < end <= len(product):
            coding = product[start:end]
            coding = coding[: len(coding) - (len(coding) % 3)]
            translated = str(Seq(coding).translate()) if coding else ""
            if "*" in translated[:-1]:
                warnings.append({"code": "internal_stop", "message": f"{feature.get('name', 'CDS')} contains an internal stop codon."})
    return warnings


def gateway_preview(
    backbone: dict[str, Any],
    insert: dict[str, Any],
    *,
    reaction: str,
    backbone_start: int,
    backbone_end: int,
    insert_start: int = 0,
    insert_end: int | None = None,
) -> dict[str, Any]:
    reaction = reaction.upper()
    if reaction not in {"BP", "LR"}:
        raise ValueError("Gateway reaction must be BP or LR")
    backbone_sequence = _dna(backbone.get("sequence", ""))
    insert_sequence = _dna(insert.get("sequence", ""))
    insert_end = len(insert_sequence) if insert_end is None else insert_end
    if not (0 <= backbone_start <= backbone_end <= len(backbone_sequence)):
        raise ValueError("Gateway destination coordinates are outside the backbone")
    if not (0 <= insert_start < insert_end <= len(insert_sequence)):
        raise ValueError("Gateway insert coordinates are outside the insert")
    payload = insert_sequence[insert_start:insert_end]
    product = backbone_sequence[:backbone_start] + payload + backbone_sequence[backbone_end:]
    delta = len(payload) - (backbone_end - backbone_start)
    kept = []
    lost = []
    for feature in backbone.get("features") or []:
        item = dict(feature)
        if int(item["end"]) <= backbone_start:
            kept.append(item)
        elif int(item["start"]) >= backbone_end:
            item["start"] = int(item["start"]) + delta
            item["end"] = int(item["end"]) + delta
            kept.append(item)
        else:
            lost.append(str(item.get("name") or item.get("type") or "feature"))
    insert_features = []
    for feature in insert.get("features") or []:
        if int(feature["start"]) >= insert_start and int(feature["end"]) <= insert_end:
            item = dict(feature)
            item["start"] = backbone_start + int(item["start"]) - insert_start
            item["end"] = backbone_start + int(item["end"]) - insert_start
            insert_features.append(item)
    features = [*kept, *insert_features]
    warnings = assembly_warnings(product, features)
    warnings.extend({"code": "lost_feature", "message": f"Replaced destination feature: {name}."} for name in lost)
    return {
        "method": f"gateway-{reaction.lower()}",
        "product": {"sequence": product, "circular": bool(backbone.get("circular", True)), "features": features},
        "junctions": [
            {"position": backbone_start, "siteBefore": "attB" if reaction == "BP" else "attL", "siteAfter": "attL" if reaction == "BP" else "attB"},
            {"position": backbone_start + len(payload), "siteBefore": "attB" if reaction == "BP" else "attL", "siteAfter": "attL" if reaction == "BP" else "attB"},
        ],
        "warnings": warnings,
        "lostFeatures": lost,
    }


def codon_adaptation_index(sequence: str, preferences: dict[str, list[str]]) -> float:
    sequence = _dna(sequence)
    weights = {}
    for codons in preferences.values():
        for index, codon in enumerate(codons):
            weights[codon] = max(0.1, 1.0 - index * (0.9 / max(1, len(codons) - 1)))
    codons = [sequence[index : index + 3] for index in range(0, len(sequence) - 2, 3)]
    if not codons:
        return 0.0
    return math.exp(sum(math.log(weights.get(codon, 0.1)) for codon in codons) / len(codons))


def optimize_codons(
    protein: str,
    *,
    preferences: dict[str, list[str]],
    target_gc: float = 55.0,
    min_gc: float = 40.0,
    max_gc: float = 65.0,
    avoid_motifs: Iterable[str] = (),
    max_homopolymer: int = 6,
) -> dict[str, Any]:
    residues = "".join(str(protein).split()).upper()
    if not residues or any(residue not in preferences for residue in residues):
        raise ValueError("Codon optimisation requires canonical amino acids supported by the host")
    if not (0 <= min_gc <= target_gc <= max_gc <= 100):
        raise ValueError("GC targets must satisfy 0 <= minimum <= target <= maximum <= 100")
    avoided = [_dna(motif) for motif in avoid_motifs if motif]
    output = ""
    choices = []
    for index, residue in enumerate(residues):
        scored = []
        for rank, codon in enumerate(preferences[residue]):
            candidate = output + codon
            gc = 100 * (candidate.count("G") + candidate.count("C")) / len(candidate)
            creates_motif = any(motif in candidate[-(len(motif) + 2) :] for motif in avoided)
            homopolymer = bool(re.search(rf"([ACGT])\1{{{max_homopolymer},}}", candidate[-(max_homopolymer + 3) :]))
            score = rank * 2 + abs(gc - target_gc) / 10 + creates_motif * 1000 + homopolymer * 500
            scored.append((score, codon, creates_motif, homopolymer))
        _, codon, creates_motif, homopolymer = min(scored)
        output += codon
        choices.append({"residue": residue, "codon": codon, "position": index, "motifRisk": creates_motif, "repeatRisk": homopolymer})
    gc = 100 * (output.count("G") + output.count("C")) / len(output)
    remaining_motifs = [motif for motif in avoided if motif in output]
    repeat_matches = [match.group(0) for match in re.finditer(rf"([ACGT])\1{{{max_homopolymer},}}", output)]
    cai = codon_adaptation_index(output, preferences)
    warnings = []
    if not min_gc <= gc <= max_gc:
        warnings.append(f"Final GC content {gc:.2f}% is outside the requested {min_gc:.2f}-{max_gc:.2f}% range.")
    if remaining_motifs:
        warnings.append("Some avoided motifs could not be removed without changing the protein.")
    return {
        "dna": output,
        "protein": residues,
        "report": {
            "cai": round(cai, 4),
            "caiModel": "geometric mean of host codon-preference rank weights",
            "gcPercent": round(gc, 2),
            "targetGcPercent": float(target_gc),
            "gcRangePercent": [float(min_gc), float(max_gc)],
            "remainingAvoidedMotifs": remaining_motifs,
            "homopolymerRuns": repeat_matches,
            "maxHomopolymer": int(max_homopolymer),
            "choices": choices,
            "warnings": warnings,
        },
    }
