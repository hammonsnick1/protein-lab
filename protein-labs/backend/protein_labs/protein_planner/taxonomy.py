"""Organism lookup for the Protein sequence job.

Suggestions come from the UniProt taxonomy REST API first and NCBI Taxonomy
(E-utilities) second.  When neither answers, a bundled list of common
expression hosts and model organisms keeps the field useful offline.  Every
response says where its rows came from so the UI never presents the short
offline list as a full taxonomy search.
"""

from __future__ import annotations

from collections import OrderedDict
import re
import threading
import time
from typing import Any, Callable

from .integrations import HttpClient, RemoteServiceError


# Taxon IDs checked against UniProt taxonomy (rest.uniprot.org/taxonomy).
# ``strain`` holds a strain or cell line when the row names one; cell lines
# share their species' taxon ID because NCBI Taxonomy has no cell-line nodes.
COMMON_ORGANISMS: tuple[dict[str, Any], ...] = (
    {"taxonId": 562, "scientificName": "Escherichia coli", "commonName": "", "rank": "species", "strain": "", "aliases": ["e. coli", "e coli"]},
    {"taxonId": 83333, "scientificName": "Escherichia coli (strain K12)", "commonName": "", "rank": "strain", "strain": "K-12", "aliases": ["e. coli k-12", "e coli k12"]},
    {"taxonId": 511145, "scientificName": "Escherichia coli str. K-12 substr. MG1655", "commonName": "", "rank": "no rank", "strain": "K-12 MG1655", "aliases": ["mg1655"]},
    {"taxonId": 469008, "scientificName": "Escherichia coli (strain B / BL21-DE3)", "commonName": "", "rank": "strain", "strain": "BL21(DE3)", "aliases": ["bl21(de3)", "bl21 de3", "e. coli bl21(de3)"]},
    {"taxonId": 511693, "scientificName": "Escherichia coli (strain B / BL21)", "commonName": "", "rank": "strain", "strain": "BL21", "aliases": ["bl21", "e. coli bl21"]},
    {"taxonId": 4932, "scientificName": "Saccharomyces cerevisiae", "commonName": "Baker's yeast", "rank": "species", "strain": "", "aliases": ["s. cerevisiae", "yeast", "budding yeast"]},
    {"taxonId": 559292, "scientificName": "Saccharomyces cerevisiae (strain ATCC 204508 / S288c)", "commonName": "Baker's yeast", "rank": "strain", "strain": "S288C", "aliases": ["s288c"]},
    {"taxonId": 460519, "scientificName": "Komagataella phaffii", "commonName": "", "rank": "species", "strain": "", "aliases": ["pichia pastoris", "p. pastoris", "k. phaffii", "pichia"]},
    {"taxonId": 644223, "scientificName": "Komagataella phaffii (strain GS115 / ATCC 20864)", "commonName": "", "rank": "strain", "strain": "GS115", "aliases": ["gs115", "pichia pastoris gs115"]},
    {"taxonId": 4922, "scientificName": "Komagataella pastoris", "commonName": "", "rank": "species", "strain": "", "aliases": ["pichia pastoris", "p. pastoris"]},
    {"taxonId": 4896, "scientificName": "Schizosaccharomyces pombe", "commonName": "Fission yeast", "rank": "species", "strain": "", "aliases": ["s. pombe"]},
    {"taxonId": 7108, "scientificName": "Spodoptera frugiperda", "commonName": "Fall armyworm", "rank": "species", "strain": "Sf9 / Sf21 cells", "aliases": ["sf9", "sf21", "s. frugiperda", "insect cells"]},
    {"taxonId": 7111, "scientificName": "Trichoplusia ni", "commonName": "Cabbage looper", "rank": "species", "strain": "High Five (BTI-Tn-5B1-4) cells", "aliases": ["t. ni", "high five", "hi5", "tn5"]},
    {"taxonId": 9606, "scientificName": "Homo sapiens", "commonName": "Human", "rank": "species", "strain": "", "aliases": ["human", "h. sapiens"]},
    {"taxonId": 9606, "scientificName": "Homo sapiens", "commonName": "Human", "rank": "species", "strain": "HEK293 cells", "aliases": ["hek293", "hek 293", "hek", "293", "expi293"]},
    {"taxonId": 10029, "scientificName": "Cricetulus griseus", "commonName": "Chinese hamster", "rank": "species", "strain": "CHO cells", "aliases": ["cho", "chinese hamster ovary", "expicho"]},
    {"taxonId": 10090, "scientificName": "Mus musculus", "commonName": "Mouse", "rank": "species", "strain": "", "aliases": ["mouse", "house mouse", "m. musculus"]},
    {"taxonId": 10116, "scientificName": "Rattus norvegicus", "commonName": "Rat", "rank": "species", "strain": "", "aliases": ["rat", "r. norvegicus"]},
    {"taxonId": 7955, "scientificName": "Danio rerio", "commonName": "Zebrafish", "rank": "species", "strain": "", "aliases": ["zebrafish", "d. rerio"]},
    {"taxonId": 7227, "scientificName": "Drosophila melanogaster", "commonName": "Fruit fly", "rank": "species", "strain": "", "aliases": ["fruit fly", "d. melanogaster", "drosophila"]},
    {"taxonId": 6239, "scientificName": "Caenorhabditis elegans", "commonName": "", "rank": "species", "strain": "", "aliases": ["c. elegans", "worm", "nematode"]},
    {"taxonId": 3702, "scientificName": "Arabidopsis thaliana", "commonName": "Mouse-ear cress", "rank": "species", "strain": "", "aliases": ["a. thaliana", "arabidopsis", "thale cress"]},
    {"taxonId": 4100, "scientificName": "Nicotiana benthamiana", "commonName": "", "rank": "species", "strain": "", "aliases": ["n. benthamiana", "tobacco"]},
    {"taxonId": 1423, "scientificName": "Bacillus subtilis", "commonName": "", "rank": "species", "strain": "", "aliases": ["b. subtilis"]},
    {"taxonId": 224308, "scientificName": "Bacillus subtilis (strain 168)", "commonName": "", "rank": "strain", "strain": "168", "aliases": ["b. subtilis 168"]},
    {"taxonId": 1358, "scientificName": "Lactococcus lactis", "commonName": "", "rank": "species", "strain": "", "aliases": ["l. lactis"]},
    {"taxonId": 287, "scientificName": "Pseudomonas aeruginosa", "commonName": "", "rank": "species", "strain": "", "aliases": ["p. aeruginosa"]},
    {"taxonId": 208964, "scientificName": "Pseudomonas aeruginosa (strain ATCC 15692 / DSM 22644 / CIP 104116 / JCM 14847 / LMG 12228 / 1C / PRS 101 / PAO1)", "commonName": "", "rank": "strain", "strain": "PAO1", "aliases": ["pao1"]},
    {"taxonId": 83332, "scientificName": "Mycobacterium tuberculosis (strain ATCC 25618 / H37Rv)", "commonName": "", "rank": "strain", "strain": "H37Rv", "aliases": ["m. tuberculosis", "h37rv", "tuberculosis"]},
    {"taxonId": 1280, "scientificName": "Staphylococcus aureus", "commonName": "", "rank": "species", "strain": "", "aliases": ["s. aureus"]},
    {"taxonId": 300852, "scientificName": "Thermus thermophilus (strain ATCC 27634 / DSM 579 / HB8)", "commonName": "", "rank": "strain", "strain": "HB8", "aliases": ["t. thermophilus", "hb8"]},
    {"taxonId": 8355, "scientificName": "Xenopus laevis", "commonName": "African clawed frog", "rank": "species", "strain": "", "aliases": ["x. laevis", "xenopus", "frog"]},
    {"taxonId": 9031, "scientificName": "Gallus gallus", "commonName": "Chicken", "rank": "species", "strain": "", "aliases": ["chicken"]},
    {"taxonId": 9913, "scientificName": "Bos taurus", "commonName": "Bovine", "rank": "species", "strain": "", "aliases": ["cow", "cattle", "bovine"]},
    {"taxonId": 9823, "scientificName": "Sus scrofa", "commonName": "Pig", "rank": "species", "strain": "", "aliases": ["pig", "porcine"]},
    {"taxonId": 3055, "scientificName": "Chlamydomonas reinhardtii", "commonName": "", "rank": "species", "strain": "", "aliases": ["c. reinhardtii", "chlamydomonas"]},
    {"taxonId": 44689, "scientificName": "Dictyostelium discoideum", "commonName": "Social amoeba", "rank": "species", "strain": "", "aliases": ["d. discoideum", "dictyostelium"]},
    {"taxonId": 2697049, "scientificName": "Severe acute respiratory syndrome coronavirus 2", "commonName": "", "rank": "no rank", "strain": "", "aliases": ["sars-cov-2", "sars cov 2", "covid"]},
)

UNIPROT_TAXONOMY_URL = "https://rest.uniprot.org/taxonomy/search"
NCBI_ESEARCH_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi"
NCBI_ESUMMARY_URL = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi"

_RANK_ORDER = {"species": 0, "strain": 1, "subspecies": 1, "isolate": 1, "varietas": 1, "forma": 1, "serotype": 2, "genus": 2}
_STRAIN = re.compile(r"\((?:strain|str\.)\s+([^)]+)\)", re.IGNORECASE)
_QUERY_UNSAFE = re.compile(r"[\\/+\-!(){}\[\]^\"~*?:&|]+")


class TaxonomyClient:
    """Search organisms by name or taxon ID with an in-memory TTL cache."""

    def __init__(
        self,
        http: HttpClient,
        *,
        email: str = "",
        timeout: float = 6.0,
        cache_ttl: float = 24 * 3600,
        cache_size: int = 256,
        retry_after: float = 60.0,
        clock: Callable[[], float] = time.monotonic,
    ):
        self.http = http
        self.email = email.strip()
        self.timeout = timeout
        self.cache_ttl = cache_ttl
        self.cache_size = cache_size
        self.retry_after = retry_after
        self.clock = clock
        self._cache: OrderedDict[tuple[str, int], tuple[float, dict[str, Any]]] = OrderedDict()
        self._offline_until = 0.0
        self._lock = threading.Lock()

    def search(self, query: str, limit: int = 10) -> dict[str, Any]:
        text = " ".join(str(query or "").split())[:100]
        limit = max(1, min(int(limit), 25))
        curated = _rank(_curated_matches(text), text)
        if len(text) < 2:
            return _response(text, curated[:limit], "curated")
        key = (text.lower(), limit)
        now = self.clock()
        with self._lock:
            cached = self._cache.get(key)
            if cached and now - cached[0] < self.cache_ttl:
                self._cache.move_to_end(key)
                return {**cached[1], "cached": True}
            if now < self._offline_until:
                return _response(text, curated[:limit], "offline", _OFFLINE_MESSAGE)
        try:
            remote, source = self._uniprot(text), "uniprot"
        except RemoteServiceError:
            try:
                remote, source = self._ncbi(text), "ncbi"
            except RemoteServiceError:
                with self._lock:
                    self._offline_until = self.clock() + self.retry_after
                return _response(text, curated[:limit], "offline", _OFFLINE_MESSAGE)
        # Curated rows that clearly match (by name or a lab alias such as
        # "HEK293" or "BL21(DE3)") are merged in and everything is re-ranked,
        # because UniProt orders hits by taxon ID, not relevance: "mouse"
        # would otherwise not show Mus musculus.  Ties keep curated rows first.
        strong = [row for row in curated if _score(row, text) <= 2]
        merged = _dedupe(_rank(strong + remote, text))[:limit]
        value = _response(text, merged, source)
        with self._lock:
            self._cache[key] = (self.clock(), value)
            self._cache.move_to_end(key)
            while len(self._cache) > self.cache_size:
                self._cache.popitem(last=False)
        return value

    def _uniprot(self, text: str) -> list[dict[str, Any]]:
        if text.isdigit():
            query = f"tax_id:{text}"
        else:
            words = _QUERY_UNSAFE.sub(" ", text).split()
            if not words:
                return []
            if len(words[-1]) >= 2:
                words[-1] += "*"
            query = " AND ".join(words)
        raw = self.http.json(
            "GET",
            UNIPROT_TAXONOMY_URL,
            params={
                "query": query,
                "format": "json",
                "size": 50,
                "fields": "id,scientific_name,common_name,rank",
            },
            service="UniProt taxonomy",
            timeout=self.timeout,
        )
        rows = []
        for item in raw.get("results") or []:
            if not isinstance(item, dict) or not isinstance(item.get("taxonId"), int):
                continue
            rows.append(_row(
                item["taxonId"], item.get("scientificName"), item.get("commonName"),
                item.get("rank"), "uniprot",
            ))
        return rows

    def _ncbi(self, text: str) -> list[dict[str, Any]]:
        identity = {"tool": "protein-labs", **({"email": self.email} if self.email else {})}
        term = text if text.isdigit() else f"{_QUERY_UNSAFE.sub(' ', text).strip()}*"
        found = self.http.json(
            "GET",
            NCBI_ESEARCH_URL,
            params={"db": "taxonomy", "term": term, "retmode": "json", "retmax": 30, **identity},
            service="NCBI Taxonomy",
            timeout=self.timeout,
        )
        ids = [str(value) for value in (found.get("esearchresult") or {}).get("idlist") or []]
        if not ids:
            return []
        summary = self.http.json(
            "GET",
            NCBI_ESUMMARY_URL,
            params={"db": "taxonomy", "id": ",".join(ids), "retmode": "json", **identity},
            service="NCBI Taxonomy",
            timeout=self.timeout,
        )
        result = summary.get("result") or {}
        rows = []
        for uid in result.get("uids") or ids:
            item = result.get(str(uid))
            if not isinstance(item, dict) or item.get("status", "active") != "active":
                continue
            try:
                taxon_id = int(item.get("taxid") or uid)
            except (TypeError, ValueError):
                continue
            rows.append(_row(
                taxon_id, item.get("scientificname"), str(item.get("commonname") or "").capitalize(),
                item.get("rank"), "ncbi",
            ))
        return rows


_OFFLINE_MESSAGE = (
    "UniProt and NCBI Taxonomy could not be reached. "
    "Showing the bundled list of common organisms."
)


def _response(query: str, results: list[dict[str, Any]], source: str, message: str = "") -> dict[str, Any]:
    return {
        "query": query,
        "source": source,
        "offline": source == "offline",
        "message": message,
        "results": [{key: value for key, value in row.items() if key != "aliases"} for row in results],
        "cached": False,
    }


def _row(taxon_id: int, scientific: Any, common: Any, rank: Any, source: str) -> dict[str, Any]:
    name = str(scientific or "").strip()
    match = _STRAIN.search(name)
    return {
        "taxonId": taxon_id,
        "scientificName": name,
        "commonName": str(common or "").strip(),
        "rank": str(rank or "").strip(),
        "strain": match.group(1).strip() if match else "",
        "source": source,
    }


def _curated_matches(text: str) -> list[dict[str, Any]]:
    rows = [{**row, "source": "curated"} for row in COMMON_ORGANISMS]
    if not text:
        # The short default list: one row per familiar host, no strain rows.
        return [row for row in rows if row["rank"] == "species"]
    return [row for row in rows if _score(row, text) < 4]


def _names(row: dict[str, Any]) -> list[str]:
    return [
        str(value).lower()
        for value in (row["scientificName"], row.get("commonName"), row.get("strain"), *row.get("aliases", ()))
        if value
    ]


def _score(row: dict[str, Any], text: str) -> int:
    """0 exact, 1 scientific prefix, 2 other name prefix, 3 word prefix, 4 none."""
    needle = text.lower()
    if needle.isdigit():
        return 0 if str(row["taxonId"]) == needle else 4
    names = _names(row)
    if needle in names:
        return 0
    if row["scientificName"].lower().startswith(needle):
        return 1
    if any(name.startswith(needle) for name in names):
        return 2
    if any(f" {needle}" in f" {name}" or f"({needle}" in name for name in names):
        return 3
    return 4


def _rank(rows: list[dict[str, Any]], text: str) -> list[dict[str, Any]]:
    return [
        row for _, row in sorted(
            enumerate(rows),
            key=lambda pair: (
                _score(pair[1], text),
                _RANK_ORDER.get(pair[1]["rank"], 3),
                len(pair[1]["scientificName"]),
                pair[0],
            ),
        )
    ]


def _dedupe(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    # Curated rows may share a taxon (human and HEK293 cells); a remote row
    # is dropped once its taxon is already listed.
    seen: set[tuple[int, str]] = set()
    seen_ids: set[int] = set()
    unique = []
    for row in rows:
        key = (row["taxonId"], row["strain"].lower())
        if key in seen or (row["source"] != "curated" and row["taxonId"] in seen_ids):
            continue
        seen.add(key)
        seen_ids.add(row["taxonId"])
        unique.append(row)
    return unique
