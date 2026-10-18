"""Bundled, redistributable expression-vector records.

The sequence payload is generated from the cited INSDC/GenBank accessions.  NCBI
places no restrictions on distribution of GenBank molecular data, while noting
that submitters may retain rights; that exact qualification is exposed in every
catalogue record rather than hidden in application documentation.
"""

from __future__ import annotations

from typing import Any

from .standard_vector_sequences import STANDARD_VECTOR_SEQUENCES


GENBANK_DATA_LICENCE = (
    "NCBI places no restrictions on GenBank data use or distribution; "
    "submitter rights may apply."
)
GENBANK_POLICY_URL = "https://www.ncbi.nlm.nih.gov/genbank/about/"


# Keep provenance and biological metadata human-readable.  The generated
# sequence module contains only sequence/feature payloads fetched from NCBI.
STANDARD_VECTOR_MANIFEST: tuple[dict[str, Any], ...] = (
    {
        "accession": "EF442785.1",
        "name": "pET28a-LIC",
        "notes": "T7 E. coli expression vector with LIC cloning and sacB counter-selection.",
        "metadata": {
            "host": ["Escherichia coli"],
            "promoter": ["T7-lac"],
            "inducer": ["IPTG"],
            "nTags": ["6×His"],
            "cTags": [],
            "proteaseSites": ["Thrombin"],
            "selectionMarker": "Kanamycin",
            "origin": "ColE1/pBR322; f1",
            "copyNumber": "Medium",
            "supplier": "Structural Genomics Consortium",
        },
    },
    {
        "accession": "U13853.1",
        "name": "pGEX-4T-1",
        "notes": "GST fusion vector with a thrombin site and tac promoter.",
        "metadata": {
            "host": ["Escherichia coli"],
            "promoter": ["tac"],
            "inducer": ["IPTG"],
            "nTags": ["GST"],
            "cTags": [],
            "proteaseSites": ["Thrombin"],
            "selectionMarker": "Ampicillin",
            "origin": "pBR322",
            "copyNumber": "High",
            "supplier": "Cytiva (formerly Pharmacia)",
        },
    },
    {
        "accession": "X81837.1",
        "name": "pBAD24",
        "notes": "Arabinose-inducible E. coli expression vector described by Guzman et al.",
        "metadata": {
            "host": ["Escherichia coli"],
            "promoter": ["araBAD"],
            "inducer": ["L-arabinose"],
            "nTags": [],
            "cTags": [],
            "proteaseSites": [],
            "selectionMarker": "Ampicillin",
            "origin": "pBR322; M13",
            "copyNumber": "High",
            "supplier": "Academic deposit",
        },
    },
    {
        "accession": "AF074376.1",
        "name": "pQE30NST",
        "notes": "pQE30-derived bacterial expression vector with an expanded MCS.",
        "metadata": {
            "host": ["Escherichia coli"],
            "promoter": ["T5-lac"],
            "inducer": ["IPTG"],
            "nTags": ["6×His"],
            "cTags": [],
            "proteaseSites": [],
            "selectionMarker": "Ampicillin",
            "origin": "ColE1",
            "copyNumber": "High",
            "supplier": "QIAGEN-derived",
        },
    },
    {
        "accession": "JF327850.1",
        "name": "LIC-pPICZ-LC1",
        "notes": "Pichia expression vector with LIC cassette, infrared reporter, and TEV site.",
        "metadata": {
            "host": ["Komagataella phaffii", "Escherichia coli"],
            "promoter": ["AOX1"],
            "inducer": ["Methanol"],
            "nTags": ["6×His"],
            "cTags": [],
            "proteaseSites": ["TEV"],
            "selectionMarker": "Zeocin",
            "origin": "pBR322",
            "copyNumber": "High in E. coli",
            "supplier": "Invitrogen-derived academic deposit",
        },
    },
    {
        "accession": "LC658350.1",
        "name": "pFastBacMam3",
        "notes": "BacMam transfer/expression vector with CMV and polyhedrin promoters.",
        "metadata": {
            "host": ["Mammalian cells", "Insect cells", "Escherichia coli"],
            "promoter": ["CMV", "Polyhedrin", "T7"],
            "inducer": [],
            "nTags": ["8×His", "FGFP"],
            "cTags": [],
            "proteaseSites": ["3C"],
            "selectionMarker": "Gentamicin; Ampicillin",
            "origin": "pUC; f1; bacmid Tn7",
            "copyNumber": "High in E. coli",
            "supplier": "Academic deposit",
        },
    },
    {
        "accession": "U55762.1",
        "name": "pEGFP-N1",
        "notes": "Mammalian CMV expression vector encoding an N-terminal EGFP fusion.",
        "metadata": {
            "host": ["Mammalian cells", "Escherichia coli"],
            "promoter": ["CMV"],
            "inducer": [],
            "nTags": ["EGFP"],
            "cTags": [],
            "proteaseSites": [],
            "selectionMarker": "Kanamycin; Neomycin",
            "origin": "pUC; f1; SV40",
            "copyNumber": "High in E. coli",
            "supplier": "Clontech-derived",
        },
    },
    {
        "accession": "JF914075.1",
        "name": "pCDF-BIRA",
        "notes": "pCDFDuet-derived T7 co-expression vector carrying E. coli birA.",
        "metadata": {
            "host": ["Escherichia coli"],
            "promoter": ["T7-lac"],
            "inducer": ["IPTG"],
            "nTags": [],
            "cTags": [],
            "proteaseSites": [],
            "selectionMarker": "Streptomycin/Spectinomycin",
            "origin": "CloDF13",
            "copyNumber": "Medium",
            "supplier": "Novagen-derived academic deposit",
        },
    },
)


def _build_standard_vectors() -> tuple[dict[str, Any], ...]:
    records: list[dict[str, Any]] = []
    for item in STANDARD_VECTOR_MANIFEST:
        accession = str(item["accession"])
        payload = STANDARD_VECTOR_SEQUENCES[accession]
        metadata = {
            **item["metadata"],
            "sourceUrl": f"https://www.ncbi.nlm.nih.gov/nuccore/{accession}",
            "license": GENBANK_DATA_LICENCE,
            "licenseUrl": GENBANK_POLICY_URL,
        }
        records.append({
            "id": f"standard-ncbi-{accession.lower()}",
            "name": item["name"],
            "sequence": payload["sequence"],
            "circular": payload["circular"],
            "features": payload["features"],
            "notes": item["notes"],
            "metadata": metadata,
        })
    return tuple(records)


STANDARD_VECTORS = _build_standard_vectors()
