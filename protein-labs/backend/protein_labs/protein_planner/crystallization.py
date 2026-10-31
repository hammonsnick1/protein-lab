"""Evidence-first crystallization screening recommendations.

This module deliberately does *not* turn an unavailable research model into a
made-up probability. It collects facts already saved by Protein Planner and
reports the availability and provenance of Shoebill, the 2025 PLM predictor,
and MASCL separately. A numeric combined probability is emitted only when
validated scores from those predictors are available.
"""

from __future__ import annotations

from collections import Counter
from typing import Any


SHOEBILL_REFERENCE = {"label": "Shoebill upstream repository", "url": "https://github.com/KJ-Liao/Shoebill"}
PLM_REFERENCE = {"label": "PLM crystallization predictor (Scientific Reports, 2025)", "url": "https://doi.org/10.1038/s41598-025-86519-5"}
MASCL_REFERENCE = {"label": "MASCL space-group predictor (Proteins, 2025)", "url": "https://doi.org/10.1002/prot.26844"}


def _location_length(region: dict[str, Any]) -> int:
    location = region.get("location") or {}
    try:
        start, end = int(location.get("start")), int(location.get("end"))
    except (TypeError, ValueError):
        return 0
    return max(0, end - start + 1)


def _record_value(record: dict[str, Any], *keys: str) -> Any:
    """Read a deliberately small set of common, saved PDB record shapes."""
    for key in keys:
        if record.get(key) not in (None, ""):
            return record[key]
    metadata = record.get("metadata") or record.get("entryMetadata") or {}
    if isinstance(metadata, dict):
        for key in keys:
            if metadata.get(key) not in (None, ""):
                return metadata[key]
    return None


def protein_facts(bundle: dict[str, Any]) -> dict[str, Any]:
    """Normalize existing project evidence without asking the user again."""
    protein = bundle["protein"]
    matches = sorted(bundle.get("uniprotMatches") or [], key=lambda item: item.get("identity") or -1, reverse=True)
    record = (matches[0].get("record") or {}) if matches else {}
    transmembrane = record.get("transmembraneRegions") or []
    disorder = record.get("disorderedRegions") or []
    length = max(1, len(protein.get("sequence") or ""))
    pdb_hits = bundle.get("pdbMatches") or []
    crystal_forms: list[dict[str, Any]] = []
    for hit in pdb_hits:
        method = _record_value(hit, "experimentalMethod", "experimentalMethods", "method")
        space_group = _record_value(hit, "spaceGroup", "space_group")
        if method or space_group:
            crystal_forms.append({"pdbId": hit.get("pdbId"), "method": method, "spaceGroup": space_group, "identity": hit.get("identity"), "source": hit.get("sourceUrl") or ((hit.get("source") or {}).get("entryUrl")) or (f"https://www.rcsb.org/structure/{hit.get('pdbId')}" if hit.get("pdbId") else "")})
    return {
        "sequenceLength": length, "membraneProtein": bool(transmembrane), "transmembraneRegions": transmembrane,
        "disorderResidues": sum(_location_length(region) for region in disorder),
        "disorderFraction": sum(_location_length(region) for region in disorder) / length,
        "cofactors": record.get("cofactors") or [],
        "pdbHomologues": [{"pdbId": hit.get("pdbId"), "identity": hit.get("identity"), "source": hit.get("sourceUrl") or ""} for hit in pdb_hits],
        "crystalForms": crystal_forms, "alphaFoldModels": len(bundle.get("alphaFoldModels") or []),
        "sources": [{"kind": "protein", "label": "Protein Labs project", "id": protein["id"]}, *([{"kind": "uniprot", "label": "Saved UniProtKB match", "url": (record.get("source") or {}).get("url", "")}] if record else []), *([{"kind": "pdb", "label": "Saved PDB homologue search", "url": "https://www.rcsb.org/"}] if pdb_hits else [])],
    }


def _predictors() -> list[dict[str, Any]]:
    return [
        {"id": "shoebill", "name": "Shoebill", "score": None, "status": "unavailable", "source": SHOEBILL_REFERENCE, "reason": "Not run. The public repository contains no license file and the workflow requires an AlphaFold2 result plus external feature-extraction binaries."},
        {"id": "plm", "name": "Protein-language-model predictor", "score": None, "status": "unavailable", "source": PLM_REFERENCE, "reason": "Not run. No redistributable implementation and model weights are bundled with this offline backend."},
        {"id": "mascl", "name": "MASCL space-group predictor", "score": None, "status": "unavailable", "source": MASCL_REFERENCE, "spaceGroups": [], "reason": "Not run. A redistributable MASCL implementation/model has not been added to this backend."},
    ]


def _explanations(facts: dict[str, Any]) -> list[dict[str, Any]]:
    output: list[dict[str, Any]] = []
    if facts["membraneProtein"]:
        output.append({"direction": "caution", "summary": "A saved UniProt annotation has transmembrane region(s); membrane-protein crystallization usually needs specialized detergent, lipidic-cubic-phase, or related screening.", "source": "Saved UniProtKB match"})
    if facts["disorderFraction"] >= 0.1:
        output.append({"direction": "caution", "summary": f"Saved disorder annotations cover {facts['disorderFraction']:.0%} of the sequence; consider a construct boundary screen.", "source": "Saved UniProtKB match"})
    if facts["cofactors"]:
        names = ", ".join(str(item.get("name") or "cofactor") for item in facts["cofactors"][:3])
        output.append({"direction": "action", "summary": f"Saved UniProt evidence lists {names}; test the relevant ligand or cofactor condition alongside apo protein.", "source": "Saved UniProtKB match"})
    if facts["crystalForms"]:
        output.append({"direction": "support", "summary": f"{len(facts['crystalForms'])} saved PDB homologue record(s) include experimental crystal-form metadata.", "source": "Saved PDB homologue search"})
    return output or [{"direction": "missing_evidence", "summary": "No saved membrane, disorder, ligand/cofactor, or PDB crystal-form evidence was found. This is missing evidence, not evidence that the protein will crystallize.", "source": "Protein Labs project"}]


def crystallization_assessment(bundle: dict[str, Any]) -> dict[str, Any]:
    """Return a transparent assessment, never a certainty or fabricated score."""
    facts = protein_facts(bundle)
    forms = Counter(form["spaceGroup"] for form in facts["crystalForms"] if form.get("spaceGroup"))
    recommendation = "Start with a small sparse-matrix screen and record outcomes. No validated predictor score is available in this installation, so this is a screening suggestion rather than a crystallization forecast."
    if facts["membraneProtein"]:
        recommendation = "Prioritize a membrane-protein crystallization workflow and record detergent/lipid conditions; do not interpret this as a success prediction."
    return {
        "proteinId": bundle["protein"]["id"],
        "method": {"name": "Protein Labs crystallization evidence combiner", "version": "1.0", "plainLanguage": "This combines facts already known about your protein with any available crystallization predictors. It cannot guarantee crystals.", "references": [SHOEBILL_REFERENCE, PLM_REFERENCE, MASCL_REFERENCE]},
        "score": {"value": None, "scale": "probability 0–1", "status": "unavailable", "plainLanguage": "A crystallization probability is unavailable because no validated Shoebill or PLM score was run in this installation."},
        "uncertainty": {"lower": None, "upper": None, "status": "not_quantified", "plainLanguage": "There is no calibrated uncertainty interval without executed, validated predictor scores."},
        "predictors": _predictors(),
        "spaceGroupSuggestions": [{"spaceGroup": group, "homologueCount": count, "source": "Saved PDB homologue crystal forms"} for group, count in forms.most_common()],
        "facts": facts, "explanations": _explanations(facts), "recommendation": recommendation,
    }
