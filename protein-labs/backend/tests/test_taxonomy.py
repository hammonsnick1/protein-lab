"""Organism autocomplete: UniProt, NCBI fallback, offline list, and cache."""

from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import sqlite3
from threading import Thread
from urllib.parse import parse_qs, urlparse

import pytest

from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    HttpClient,
    HttpResponse,
    NCBIBlastClient,
    RCSBClient,
    UniProtClient,
)
from protein_labs.protein_planner.service import ProteinPlanner
from protein_labs.protein_planner.taxonomy import COMMON_ORGANISMS, TaxonomyClient
from protein_labs.server import ApiHandler


UNIPROT_MOUSE = {"results": [
    {"scientificName": "Mus", "commonName": "mice", "taxonId": 10088, "rank": "genus"},
    {"scientificName": "Microcebus murinus", "commonName": "Gray mouse lemur", "taxonId": 30608, "rank": "species"},
    {"scientificName": "Mus musculus", "commonName": "Mouse", "taxonId": 10090, "rank": "species"},
    {"scientificName": "mouse metagenome", "taxonId": 1441287, "rank": "species"},
]}

UNIPROT_BL21 = {"results": [
    {"scientificName": "Sphingomonas sp. BL218-1", "taxonId": 89231, "rank": "species"},
    {"scientificName": "Escherichia coli (strain B / BL21-DE3)", "taxonId": 469008, "rank": "strain"},
    {"scientificName": "Escherichia coli (strain B / BL21)", "taxonId": 511693, "rank": "strain"},
]}


class FakeTransport:
    """Records every request; answers from a URL-prefix table, else fails."""

    def __init__(self, routes):
        self.routes = routes
        self.calls = []

    def __call__(self, method, url, *, data, headers):
        self.calls.append(url)
        for prefix, body in self.routes.items():
            if url.startswith(prefix):
                if isinstance(body, Exception):
                    raise body
                if isinstance(body, int):
                    return HttpResponse(body, "unavailable", {})
                return HttpResponse(200, json.dumps(body(url) if callable(body) else body), {})
        raise ConnectionError("network unreachable")


class Clock:
    def __init__(self):
        self.now = 1000.0

    def __call__(self):
        return self.now


def client(routes, **kwargs):
    transport = FakeTransport(routes)
    return TaxonomyClient(HttpClient(transport=transport), **kwargs), transport


def query_of(url):
    return parse_qs(urlparse(url).query)


def test_uniprot_rows_are_ranked_and_curated_matches_lead():
    taxonomy, transport = client({"https://rest.uniprot.org/taxonomy/search": UNIPROT_MOUSE})
    result = taxonomy.search("mouse", limit=5)
    assert result["source"] == "uniprot"
    assert result["offline"] is False
    # Mus musculus is curated with the alias "mouse", so it leads even though
    # UniProt sorts by taxon ID; the remote copy of 10090 is not repeated.
    ids = [row["taxonId"] for row in result["results"]]
    assert ids[0] == 10090
    # Name-prefix matches (mouse metagenome, Mouse-ear cress) outrank the
    # genus that UniProt listed first.
    assert ids.index(1441287) < ids.index(10088) and ids.index(3702) < ids.index(10088)
    assert [row["taxonId"] for row in result["results"]].count(10090) == 1
    assert result["results"][0] == {
        "taxonId": 10090, "scientificName": "Mus musculus", "commonName": "Mouse",
        "rank": "species", "strain": "", "source": "curated",
    }
    params = query_of(transport.calls[0])
    assert params["query"] == ["mouse*"]
    assert params["format"] == ["json"]


def test_uniprot_strain_is_read_from_scientific_name():
    taxonomy, _ = client({"https://rest.uniprot.org/taxonomy/search": {"results": [
        {"scientificName": "Thermus aquaticus (strain ATCC 25104 / YT-1)", "taxonId": 271, "rank": "strain"},
    ]}})
    row = taxonomy.search("thermus aqua")["results"][0]
    assert row["strain"] == "ATCC 25104 / YT-1"
    assert row["source"] == "uniprot"


def test_lab_alias_finds_expression_strain():
    taxonomy, transport = client({"https://rest.uniprot.org/taxonomy/search": UNIPROT_BL21})
    rows = taxonomy.search("BL21(DE3)")["results"]
    assert rows[0]["taxonId"] == 469008
    assert rows[0]["strain"] == "BL21(DE3)"
    assert [row["taxonId"] for row in rows].count(469008) == 1
    # Lucene punctuation is stripped before it reaches UniProt.
    assert query_of(transport.calls[0])["query"] == ["BL21 AND DE3*"]


def test_numeric_query_searches_by_taxon_id():
    taxonomy, transport = client({"https://rest.uniprot.org/taxonomy/search": {"results": [
        {"scientificName": "Homo sapiens", "commonName": "Human", "taxonId": 9606, "rank": "species"},
    ]}})
    rows = taxonomy.search("9606")["results"]
    assert query_of(transport.calls[0])["query"] == ["tax_id:9606"]
    assert {row["taxonId"] for row in rows} == {9606}
    # Curated human and HEK293 rows share the taxon; UniProt's copy is dropped.
    assert [row["strain"] for row in rows] == ["", "HEK293 cells"]


def test_ncbi_is_used_when_uniprot_fails():
    def summary(url):
        assert query_of(url)["id"] == ["7108"]
        return {"result": {"uids": ["7108"], "7108": {
            "uid": "7108", "status": "active", "rank": "species",
            "scientificname": "Spodoptera frugiperda", "commonname": "fall armyworm", "taxid": 7108,
        }}}

    taxonomy, transport = client({
        "https://rest.uniprot.org/taxonomy/search": 503,
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi": {"esearchresult": {"idlist": ["7108"]}},
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi": summary,
    }, email="lab@example.org")
    result = taxonomy.search("spodoptera frug")
    assert result["source"] == "ncbi"
    assert result["results"][0]["taxonId"] == 7108
    assert result["results"][0]["source"] == "curated"
    search = query_of(transport.calls[1])
    assert search["term"] == ["spodoptera frug*"]
    assert search["tool"] == ["protein-labs"] and search["email"] == ["lab@example.org"]


def test_offline_fallback_uses_bundled_list_and_backs_off():
    clock = Clock()
    taxonomy, transport = client({}, clock=clock, retry_after=60)
    result = taxonomy.search("pichia")
    assert result["source"] == "offline"
    assert result["offline"] is True
    assert "bundled list" in result["message"]
    assert {row["taxonId"] for row in result["results"]} >= {460519, 4922, 644223}
    assert all(row["source"] == "curated" for row in result["results"])
    assert len(transport.calls) == 2  # UniProt, then NCBI esearch

    # While offline, keystrokes do not wait on the network again.
    taxonomy.search("pichia p")
    assert len(transport.calls) == 2
    clock.now += 61
    taxonomy.search("pichia pa")
    assert len(transport.calls) == 4


def test_offline_results_are_not_cached():
    clock = Clock()
    routes = {}
    taxonomy, transport = client(routes, clock=clock, retry_after=1)
    assert taxonomy.search("zebrafish")["source"] == "offline"
    clock.now += 2
    routes["https://rest.uniprot.org/taxonomy/search"] = {"results": [
        {"scientificName": "Danio rerio", "commonName": "Zebrafish", "taxonId": 7955, "rank": "species"},
    ]}
    assert taxonomy.search("zebrafish")["source"] == "uniprot"


def test_results_are_cached_by_query_and_expire():
    clock = Clock()
    taxonomy, transport = client(
        {"https://rest.uniprot.org/taxonomy/search": UNIPROT_MOUSE}, clock=clock, cache_ttl=100,
    )
    first = taxonomy.search("Mouse")
    second = taxonomy.search("  mouse ")
    assert len(transport.calls) == 1
    assert first["cached"] is False and second["cached"] is True
    assert second["results"] == first["results"]
    clock.now += 101
    taxonomy.search("mouse")
    assert len(transport.calls) == 2


def test_cache_is_bounded():
    taxonomy, _ = client({"https://rest.uniprot.org/taxonomy/search": {"results": []}}, cache_size=2)
    for text in ("aa", "bb", "cc"):
        taxonomy.search(text)
    assert [key[0] for key in taxonomy._cache] == ["bb", "cc"]


def test_short_query_lists_common_organisms_without_network():
    taxonomy, transport = client({})
    result = taxonomy.search("", limit=25)
    assert transport.calls == []
    assert result["source"] == "curated"
    assert result["offline"] is False
    assert all(row["rank"] == "species" for row in result["results"])
    assert len(result["results"]) == 25


def test_bundled_list_covers_required_hosts():
    ids = {row["taxonId"] for row in COMMON_ORGANISMS}
    assert {562, 83333, 469008, 4932, 460519, 7108, 7111, 9606, 10029, 10090,
            10116, 7955, 7227, 6239, 3702, 1423} <= ids
    for row in COMMON_ORGANISMS:
        assert row["scientificName"] and isinstance(row["taxonId"], int)


def planner(tmp_path, routes):
    http = HttpClient(transport=FakeTransport(routes))
    return ProteinPlanner(
        Database(tmp_path / "taxonomy.sqlite3"), NCBIBlastClient(http), UniProtClient(http), RCSBClient(http),
    )


def test_endpoint_serves_search(tmp_path):
    service = planner(tmp_path, {"https://rest.uniprot.org/taxonomy/search": UNIPROT_MOUSE})
    handler = type("TaxonomyHandler", (ApiHandler,), {"planner": service})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        connection.request("GET", "/v1/taxonomy/search?q=mouse&limit=3")
        response = connection.getresponse()
        body = json.loads(response.read().decode())
        connection.close()
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)
    assert response.status == 200
    assert body["source"] == "uniprot"
    assert len(body["results"]) == 3
    assert body["results"][0]["scientificName"] == "Mus musculus"


def test_protein_stores_taxon_id_and_clears_it_on_retyped_organism(tmp_path):
    service = planner(tmp_path, {})
    bundle = service.create_protein({
        "name": "HBB", "sequence": "MVHLTPEEK", "organism": "Homo sapiens", "organismTaxonId": 9606,
    })
    protein_id = bundle["protein"]["id"]
    assert bundle["protein"]["organismTaxonId"] == 9606
    # Saving other fields keeps the taxon.
    assert service.update_protein(protein_id, {"notes": "x"})["protein"]["organismTaxonId"] == 9606
    # Free text with no taxon stays valid and drops the stale ID.
    updated = service.update_protein(protein_id, {"organism": "my lab strain"})["protein"]
    assert updated["organism"] == "my lab strain"
    assert updated["organismTaxonId"] is None
    chosen = service.update_protein(protein_id, {"organism": "Mus musculus", "organismTaxonId": "10090"})
    assert chosen["protein"]["organismTaxonId"] == 10090
    with pytest.raises(ValueError):
        service.update_protein(protein_id, {"organismTaxonId": -4})
    with pytest.raises(ValueError):
        service.update_protein(protein_id, {"organismTaxonId": "9606abc"})


def test_saved_projects_without_taxon_column_still_load(tmp_path):
    path = tmp_path / "legacy.sqlite3"
    connection = sqlite3.connect(path)
    connection.execute(
        """CREATE TABLE proteins (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, sequence TEXT NOT NULL,
            organism TEXT NOT NULL DEFAULT '', gene_name TEXT NOT NULL DEFAULT '',
            description TEXT NOT NULL DEFAULT '', expression_system TEXT NOT NULL DEFAULT '',
            notes TEXT NOT NULL DEFAULT '', tags_json TEXT NOT NULL DEFAULT '[]',
            external_ids_json TEXT NOT NULL DEFAULT '{}', created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL)"""
    )
    connection.execute(
        "INSERT INTO proteins (id, name, sequence, organism, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        ("legacy", "Old", "MKV", "E. coli lab isolate", "2026-01-01", "2026-01-01"),
    )
    connection.commit()
    connection.close()
    protein = Database(path).get_protein("legacy")
    assert protein["organism"] == "E. coli lab isolate"
    assert protein["organismTaxonId"] is None
