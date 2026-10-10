"""Vector-backbone sources for expression vector design.

A researcher starting a construct needs the real annotated backbone, not a
retyped approximation, so backbones are always loaded from a named source and
every record keeps the provenance it came from:

``ncbi``
    GenBank records from NCBI Nucleotide. Fully open and already annotated.
``addgene``
    Backbones from the Addgene vector database. Sequence only, so these are
    auto-annotated locally after download.
``snapgene``
    Public SnapGene plasmid files. These carry the richest curated
    annotations. One file is fetched per explicit user selection, exactly as
    the download button on the plasmid page does; nothing is bulk harvested
    and no SnapGene library is redistributed with Protein Lab.
``file``
    The researcher's own .gb/.gbk/.fasta/.dna files, handled by the import
    endpoint rather than here.

Indexes are cached in memory for the life of the process so that searching
does not refetch a listing page for every keystroke.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from html import unescape
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen
import base64
import re
import time

from .expression_planner import automatic_annotations, parse_sequence_file

NCBI_EUTILS = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils"
ADDGENE_BASE = "https://www.addgene.org"
SNAPGENE_BASE = "https://www.snapgene.com"
INDEX_TTL_SECONDS = 24 * 60 * 60

SOURCE_LABELS = {
    "ncbi": "NCBI Nucleotide",
    "addgene": "Addgene vector database",
    "snapgene": "SnapGene plasmid files",
    "file": "Your own files",
}


class VectorSourceError(RuntimeError):
    """Raised when a backbone source cannot be searched or fetched."""


@dataclass
class _CachedIndex:
    fetched_at: float = 0.0
    entries: list[dict[str, Any]] = field(default_factory=list)

    def fresh(self) -> bool:
        return bool(self.entries) and (time.time() - self.fetched_at) < INDEX_TTL_SECONDS


_addgene_index = _CachedIndex()
_snapgene_sets: _CachedIndex = _CachedIndex()
_snapgene_set_contents: dict[str, _CachedIndex] = {}


def _user_agent(email: str = "") -> str:
    identity = email.strip() or "local-user"
    return f"ProteinLabs-ExpressionPlanner/0.1 ({identity})"


def _fetch(url: str, *, email: str = "", timeout: float = 45.0) -> bytes:
    request = Request(url, headers={"User-Agent": _user_agent(email)})
    try:
        with urlopen(request, timeout=timeout) as response:
            return response.read()
    except HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")[:200]
        raise VectorSourceError(
            f"The source returned HTTP {error.code}. {detail}".strip()
        ) from error
    except (URLError, TimeoutError, OSError) as error:
        raise VectorSourceError(
            f"Could not reach the sequence source: {error}. "
            "Protein Lab works offline, but loading a backbone needs a connection."
        ) from error


def _fetch_text(url: str, **kwargs: Any) -> str:
    return _fetch(url, **kwargs).decode("utf-8", errors="replace")


def describe_sources() -> list[dict[str, Any]]:
    """Describe every selectable source for the vector library UI."""
    return [
        {
            "id": "snapgene",
            "name": SOURCE_LABELS["snapgene"],
            "summary": "Curated commercial backbones with complete feature annotation.",
            "detail": "Promoters, tags, cleavage sites, resistance markers and the "
                      "multiple cloning site all arrive already annotated.",
            "needsSet": True,
            "annotated": True,
            "attribution": "Plasmid files are provided by SnapGene (Dotmatics).",
        },
        {
            "id": "ncbi",
            "name": SOURCE_LABELS["ncbi"],
            "summary": "Open GenBank records for published vectors and constructs.",
            "detail": "Search by vector name or paste an accession. Annotation "
                      "quality follows whatever the submitter deposited.",
            "needsSet": False,
            "annotated": True,
            "attribution": "Data from NCBI Nucleotide via E-utilities.",
        },
        {
            "id": "addgene",
            "name": SOURCE_LABELS["addgene"],
            "summary": "Backbone sequences from the Addgene vector database.",
            "detail": "Addgene publishes the backbone sequence without features, "
                      "so Protein Lab annotates it locally after download.",
            "needsSet": False,
            "annotated": False,
            "attribution": "Backbone sequences from the Addgene vector database.",
        },
        {
            "id": "file",
            "name": SOURCE_LABELS["file"],
            "summary": "Import GenBank, FASTA or SnapGene files you already have.",
            "detail": "Accepts .gb, .gbk, .genbank, .fasta, .fna and SnapGene .dna files.",
            "needsSet": False,
            "annotated": True,
            "attribution": "",
        },
    ]


# --------------------------------------------------------------------------- #
# NCBI Nucleotide
# --------------------------------------------------------------------------- #

def _ncbi_ids(term: str, limit: int, email: str) -> list[str]:
    search_url = (
        f"{NCBI_EUTILS}/esearch.fcgi?db=nuccore&retmode=json"
        f"&retmax={max(1, min(limit, 50))}&term={quote(term)}"
    )
    payload = _fetch_text(search_url, email=email)
    return re.findall(r'"([0-9]{4,})"', payload.split('"idlist"', 1)[-1])


def _ncbi_search(query: str, limit: int, email: str) -> list[dict[str, Any]]:
    raw = query.strip()
    # An unqualified name matches thousands of cDNA clones that merely mention
    # the vector, so prefer synthetic-construct records of plasmid-like length
    # and only fall back to the bare term when that finds nothing.
    narrowed = (
        f'{raw} AND ("synthetic construct"[Organism] OR vector[Title] '
        f'OR plasmid[Title]) AND 500:300000[Sequence Length]'
    )
    ids = _ncbi_ids(narrowed, limit, email) or _ncbi_ids(raw, limit, email)
    if not ids:
        return []
    summary_url = (
        f"{NCBI_EUTILS}/esummary.fcgi?db=nuccore&retmode=json&id={','.join(ids)}"
    )
    summary = _fetch_text(summary_url, email=email)
    results: list[dict[str, Any]] = []
    for uid in ids:
        block = _json_block(summary, uid)
        if block is None:
            continue
        accession = _json_string(block, "accessionversion") or uid
        results.append({
            "id": accession,
            "name": accession,
            "description": _json_string(block, "title"),
            "lengthBp": _json_number(block, "slen"),
            "topology": "circular" if "circular" in _json_string(block, "topology").lower() else "",
            "source": "ncbi",
        })

    def rank(entry: dict[str, Any]) -> tuple[int, int]:
        description = str(entry.get("description", "")).lower()
        length = int(entry.get("lengthBp") or 0)
        named = any(word in description for word in ("vector", "plasmid", "expression"))
        # Full plasmids first, then anything else, longest first within a group.
        return (0 if named and length >= 2000 else 1 if length >= 2000 else 2, -length)

    return sorted(results, key=rank)


def _json_block(payload: str, uid: str) -> str | None:
    """Pull one esummary record out of the response without a JSON schema."""
    marker = f'"{uid}":{{'
    start = payload.find(marker)
    if start < 0:
        return None
    index = start + len(marker) - 1
    depth = 0
    for position in range(index, len(payload)):
        if payload[position] == "{":
            depth += 1
        elif payload[position] == "}":
            depth -= 1
            if depth == 0:
                return payload[index:position + 1]
    return None


def _json_string(block: str, key: str) -> str:
    match = re.search(rf'"{key}"\s*:\s*"((?:[^"\\]|\\.)*)"', block)
    return unescape(match.group(1).replace('\\"', '"')) if match else ""


def _json_number(block: str, key: str) -> int | None:
    match = re.search(rf'"{key}"\s*:\s*"?(\d+)"?', block)
    return int(match.group(1)) if match else None


def _ncbi_fetch(accession: str, email: str) -> dict[str, Any]:
    identifier = quote(accession.strip())
    url = (
        f"{NCBI_EUTILS}/efetch.fcgi?db=nuccore&id={identifier}"
        "&rettype=gbwithparts&retmode=text"
    )
    content = _fetch_text(url, email=email, timeout=90)
    if "LOCUS" not in content:
        raise VectorSourceError(
            f"NCBI did not return a GenBank record for {accession}."
        )
    parsed = parse_sequence_file(content, f"{accession}.gb")
    parsed["sourceUrl"] = (
        f"https://www.ncbi.nlm.nih.gov/nuccore/{identifier}"
    )
    return parsed


# --------------------------------------------------------------------------- #
# Addgene vector database
# --------------------------------------------------------------------------- #

def _addgene_load_index(email: str) -> list[dict[str, Any]]:
    if _addgene_index.fresh():
        return _addgene_index.entries
    page = _fetch_text(f"{ADDGENE_BASE}/vector-database/", email=email, timeout=60)
    entries = [
        {
            "id": identifier,
            "name": unescape(name.strip()),
            "description": "Addgene vector-database backbone",
            "source": "addgene",
        }
        for identifier, name in re.findall(
            r'href="/vector-database/(\d+)/"[^>]*>\s*([^<]{1,120}?)\s*<', page
        )
    ]
    if not entries:
        raise VectorSourceError(
            "The Addgene vector-database listing could not be read."
        )
    _addgene_index.entries = entries
    _addgene_index.fetched_at = time.time()
    return entries


def _addgene_search(query: str, limit: int, email: str) -> list[dict[str, Any]]:
    entries = _addgene_load_index(email)
    return _rank(entries, query, limit)


def _addgene_fetch(identifier: str, email: str) -> dict[str, Any]:
    clean = re.sub(r"\D", "", identifier)
    if not clean:
        raise VectorSourceError("An Addgene vector-database ID is required.")
    url = f"{ADDGENE_BASE}/browse/sequence_vdb/{clean}/"
    page = _fetch_text(url, email=email, timeout=60)
    match = re.search(
        r'<textarea id="vdb-sequence-value"[^>]*>([^<]+)</textarea>', page
    )
    if not match:
        raise VectorSourceError(
            f"Addgene did not publish a full sequence for vector {clean}."
        )
    sequence = re.sub(r"[^ACGTacgtNn]", "", match.group(1)).upper()
    if not sequence:
        raise VectorSourceError(f"Addgene vector {clean} has an empty sequence.")
    title = re.search(r"<title>([^<]*)</title>", page)
    name = (title.group(1) if title else "").split("-", 1)[-1].strip()
    name = unescape(name) or f"Addgene vector {clean}"
    return {
        "name": name,
        "sequence": sequence,
        "circular": True,
        "features": [],
        "sourceUrl": f"{ADDGENE_BASE}/vector-database/{clean}/",
        "history": [{
            "type": "AddgeneVectorDatabaseSource",
            "input": [],
            "outputName": name,
            "repositoryId": clean,
        }],
    }


# --------------------------------------------------------------------------- #
# SnapGene plasmid files
# --------------------------------------------------------------------------- #

def _snapgene_sets_index(email: str) -> list[dict[str, Any]]:
    if _snapgene_sets.fresh():
        return _snapgene_sets.entries
    page = _fetch_text(f"{SNAPGENE_BASE}/plasmids", email=email, timeout=60)
    slugs = sorted({
        slug for slug in re.findall(r'/plasmids/([a-z0-9_()%,.\-]+)', page)
        if not slug.endswith(")") or "(" in slug
    })
    entries = [
        {"id": slug, "name": _humanize_slug(slug), "source": "snapgene"}
        for slug in slugs
        if slug and "test" not in slug
    ]
    if not entries:
        raise VectorSourceError("The SnapGene plasmid-set listing could not be read.")
    _snapgene_sets.entries = entries
    _snapgene_sets.fetched_at = time.time()
    return entries


def _humanize_slug(slug: str) -> str:
    label = slug.replace("_", " ")
    return label[:1].upper() + label[1:]


def _snapgene_set_index(set_id: str, email: str) -> list[dict[str, Any]]:
    cached = _snapgene_set_contents.get(set_id)
    if cached and cached.fresh():
        return cached.entries
    page = _fetch_text(
        f"{SNAPGENE_BASE}/plasmids/{quote(set_id, safe='_()-,.')}",
        email=email,
        timeout=60,
    )
    names = []
    seen: set[str] = set()
    for filename in re.findall(r'"plasmidFilename":"([^"]+)"', page):
        name = filename[:-4] if filename.endswith(".dna") else filename
        if name in seen:
            continue
        seen.add(name)
        names.append(name)
    if not names:
        raise VectorSourceError(f"No SnapGene plasmids were listed for {set_id}.")
    entries = [
        {
            "id": name,
            "name": name,
            "description": f"SnapGene {_humanize_slug(set_id)}",
            "set": set_id,
            "source": "snapgene",
        }
        for name in names
    ]
    index = _CachedIndex(fetched_at=time.time(), entries=entries)
    _snapgene_set_contents[set_id] = index
    return entries


def _snapgene_search(
    query: str, limit: int, set_id: str, email: str
) -> list[dict[str, Any]]:
    if not set_id:
        return _rank(_snapgene_sets_index(email), query, limit, allow_empty=True)
    return _rank(_snapgene_set_index(set_id, email), query, limit, allow_empty=True)


def _snapgene_fetch(name: str, set_id: str, email: str) -> dict[str, Any]:
    if not set_id:
        raise VectorSourceError("A SnapGene plasmid set is required.")
    url = (
        f"{SNAPGENE_BASE}/local/fetch.php"
        f"?set={quote(set_id, safe='_()-,.')}&plasmid={quote(name, safe='')}"
    )
    raw = _fetch(url, email=email, timeout=90)
    if len(raw) < 64:
        raise VectorSourceError(f"SnapGene returned no plasmid file for {name}.")
    parsed = parse_sequence_file(base64.b64encode(raw).decode("ascii"), f"{name}.dna")
    parsed["name"] = name
    parsed["sourceUrl"] = f"{SNAPGENE_BASE}/plasmids/{set_id}/{quote(name)}"
    parsed["history"] = [{
        "type": "SnapGenePlasmidSource",
        "input": [],
        "outputName": name,
        "plasmidSet": set_id,
        "attribution": "Plasmid file provided by SnapGene (Dotmatics).",
    }]
    return parsed


# --------------------------------------------------------------------------- #
# Shared helpers and the public API
# --------------------------------------------------------------------------- #

def _loose(value: str) -> str:
    """Collapse a vector name for matching.

    Catalogues punctuate the same backbone differently: Addgene lists
    ``pET-28 a (+)`` where SnapGene lists ``pET-28a(+)``, so comparisons ignore
    spacing and punctuation entirely.
    """
    return re.sub(r"[^a-z0-9]", "", value.lower())


def _rank(
    entries: list[dict[str, Any]],
    query: str,
    limit: int,
    *,
    allow_empty: bool = False,
) -> list[dict[str, Any]]:
    needle = query.strip().lower()
    if not needle:
        return entries[:limit] if allow_empty else []
    loose_needle = _loose(needle)
    exact, prefix, contains = [], [], []
    for entry in entries:
        name = str(entry.get("name", "")).lower()
        loose_name = _loose(name)
        if name == needle or loose_name == loose_needle:
            exact.append(entry)
        elif name.startswith(needle) or loose_name.startswith(loose_needle):
            prefix.append(entry)
        elif (
            needle in name
            or (loose_needle and loose_needle in loose_name)
            or needle in str(entry.get("description", "")).lower()
        ):
            contains.append(entry)
    return (exact + prefix + contains)[:limit]


def list_snapgene_sets(email: str = "") -> list[dict[str, Any]]:
    return _snapgene_sets_index(email)


def search_vectors(
    source: str,
    query: str,
    *,
    set_id: str = "",
    limit: int = 25,
    email: str = "",
) -> list[dict[str, Any]]:
    """Search one backbone source and return comparable result rows."""
    limit = max(1, min(int(limit or 25), 100))
    if source == "ncbi":
        if not query.strip():
            return []
        return _ncbi_search(query, limit, email)
    if source == "addgene":
        return _addgene_search(query, limit, email)
    if source == "snapgene":
        return _snapgene_search(query, limit, set_id, email)
    if source == "file":
        return []
    raise VectorSourceError(f"Unknown vector source: {source}")


def fetch_vector(
    source: str,
    identifier: str,
    *,
    set_id: str = "",
    email: str = "",
    annotate: bool = True,
    minimum_orf_amino_acids: int = 50,
) -> dict[str, Any]:
    """Download one backbone and return it as a Protein Lab vector record."""
    if not identifier.strip():
        raise VectorSourceError("A vector identifier is required.")
    if source == "ncbi":
        parsed = _ncbi_fetch(identifier, email)
    elif source == "addgene":
        parsed = _addgene_fetch(identifier, email)
    elif source == "snapgene":
        parsed = _snapgene_fetch(identifier, set_id, email)
    else:
        raise VectorSourceError(f"Unknown vector source: {source}")

    parsed["sourceId"] = identifier
    parsed["sourceName"] = SOURCE_LABELS.get(source, source)
    parsed["source"] = source
    if set_id:
        parsed["sourceSet"] = set_id

    # Addgene publishes sequence without features, and some GenBank submissions
    # carry only a source feature, so annotate locally when nothing usable came
    # back. Curated annotations are never overwritten.
    if annotate and not parsed.get("features"):
        parsed["features"] = automatic_annotations(
            parsed["sequence"],
            include_orfs=True,
            minimum_orf_amino_acids=minimum_orf_amino_acids,
        )
        parsed["annotationReport"] = {
            "method": "Protein Lab motif and ORF annotation",
            "added": len(parsed["features"]),
            "reason": "The source provided sequence without features.",
        }
    return parsed
