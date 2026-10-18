#!/usr/bin/env python3
"""Regenerate bundled standard-vector sequences from NCBI GenBank records."""

from __future__ import annotations

import argparse
import base64
from io import StringIO
import json
from pathlib import Path
import urllib.parse
import urllib.request
import zlib

from Bio import SeqIO


ACCESSIONS = (
    "EF442785.1",
    "U13853.1",
    "X81837.1",
    "AF074376.1",
    "JF327850.1",
    "LC658350.1",
    "U55762.1",
    "JF914075.1",
)


def _feature_name(feature) -> str:
    for key in (
        "label",
        "gene",
        "product",
        "standard_name",
        "regulatory_class",
        "bound_moiety",
        "note",
    ):
        values = feature.qualifiers.get(key)
        if values:
            return str(values[0])[:120]
    return feature.type


def fetch_records() -> dict[str, dict]:
    query = urllib.parse.urlencode({
        "db": "nuccore",
        "id": ",".join(ACCESSIONS),
        "rettype": "gb",
        "retmode": "text",
        "tool": "protein-labs-standard-vector-builder",
    })
    request = urllib.request.Request(
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/efetch.fcgi?" + query,
        headers={"User-Agent": "Protein-Labs/0.1 standard-vector-builder"},
    )
    with urllib.request.urlopen(request, timeout=30) as response:
        text = response.read().decode("utf-8")
    records: dict[str, dict] = {}
    for record in SeqIO.parse(StringIO(text), "genbank"):
        features = []
        for index, feature in enumerate(record.features):
            if feature.type == "source":
                continue
            start = int(feature.location.start)
            end = int(feature.location.end)
            qualifiers = {
                str(key): [str(value) for value in values[:50]]
                for key, values in list(feature.qualifiers.items())[:100]
            }
            features.append({
                "id": f"{record.id}-feature-{index}",
                "name": _feature_name(feature),
                "type": feature.type,
                "start": start,
                "end": end,
                "strand": -1 if feature.location.strand == -1 else 1,
                "qualifiers": qualifiers,
            })
        records[record.id] = {
            "sequence": str(record.seq).upper(),
            "circular": record.annotations.get("topology") == "circular",
            "features": features,
        }
    missing = set(ACCESSIONS) - set(records)
    if missing:
        raise RuntimeError("NCBI did not return: " + ", ".join(sorted(missing)))
    return records


def render(records: dict[str, dict]) -> str:
    packed = base64.b85encode(
        zlib.compress(json.dumps(records, separators=(",", ":")).encode("utf-8"), 9)
    ).decode("ascii")
    chunks = "\n".join(
        f'    "{packed[index:index + 100]}"'
        for index in range(0, len(packed), 100)
    )
    return f'''"""Generated GenBank sequence payload; do not edit by hand.

Regenerate with ``python scripts/update_standard_vectors.py``.
"""

from __future__ import annotations

import base64
import json
import zlib


_PACKED = (\n{chunks}\n)

STANDARD_VECTOR_SEQUENCES = json.loads(
    zlib.decompress(base64.b85decode(_PACKED)).decode("utf-8")
)
'''


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output",
        type=Path,
        default=Path(__file__).parents[1]
        / "protein_labs"
        / "protein_planner"
        / "standard_vector_sequences.py",
    )
    args = parser.parse_args()
    args.output.write_text(render(fetch_records()), encoding="utf-8")


if __name__ == "__main__":
    main()
