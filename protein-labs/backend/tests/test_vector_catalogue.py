"""Regression and known-answer tests for the expression-vector catalogue."""

import base64
import hashlib
from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
import sqlite3
from struct import pack
from threading import Thread

import pytest

from protein_labs.server import ApiHandler, parse_vector_library_search
from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    HttpClient,
    NCBIBlastClient,
    RCSBClient,
    UniProtClient,
)
from protein_labs.protein_planner.service import ProteinPlanner
from protein_labs.protein_planner.standard_vectors import STANDARD_VECTORS


def planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(
        Database(tmp_path / "planner.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
    )


def project(service, name="Vector project"):
    return service.create_protein({"name": name, "sequence": "ACDE"})["protein"]


@pytest.fixture
def catalogue_api(tmp_path):
    service = planner(tmp_path)
    handler = type("CatalogueApiHandler", (ApiHandler,), {"planner": service})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(method, path, body=None):
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        encoded = None if body is None else json.dumps(body).encode("utf-8")
        headers = {"Content-Type": "application/json"} if encoded else {}
        connection.request(method, path, body=encoded, headers=headers)
        response = connection.getresponse()
        payload = json.loads(response.read().decode("utf-8"))
        connection.close()
        return response.status, payload

    try:
        yield service, request
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def snapgene_base64(sequence):
    """Build the smallest valid SnapGene binary around a known DNA sequence."""
    def packet(packet_type, data):
        return bytes([packet_type]) + pack(">I", len(data)) + data

    cookie = pack(">8sHHH", b"SnapGene", 1, 1, 1)
    dna = bytes([1]) + sequence.encode("ascii")  # circular topology flag
    features = (
        '<Features><Feature name="Test CDS" type="CDS" directionality="1">'
        '<Segment range="1-9"/></Feature></Features>'
    ).encode("utf-8")
    content = packet(0x09, cookie) + packet(0x00, dna) + packet(0x0A, features)
    return base64.b64encode(content).decode("ascii")


def write_legacy_database(path):
    """Create the last pre-catalogue-metadata schema with a real source link."""
    standard = next(
        vector for vector in STANDARD_VECTORS if vector["name"] == "pET28a-LIC"
    )
    sequence = standard["sequence"]
    fingerprint = hashlib.sha256(sequence.upper().encode("utf-8")).hexdigest()
    timestamp = "2025-01-02T03:04:05+00:00"
    with sqlite3.connect(path) as connection:
        connection.executescript(
            """
            CREATE TABLE proteins (
                id TEXT PRIMARY KEY,
                name TEXT NOT NULL,
                sequence TEXT NOT NULL,
                organism TEXT NOT NULL DEFAULT '',
                gene_name TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '',
                expression_system TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                tags_json TEXT NOT NULL DEFAULT '[]',
                external_ids_json TEXT NOT NULL DEFAULT '{}',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE expression_vectors (
                id TEXT PRIMARY KEY,
                protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                sequence TEXT NOT NULL,
                circular INTEGER NOT NULL DEFAULT 1,
                features_json TEXT NOT NULL DEFAULT '[]',
                primers_json TEXT NOT NULL DEFAULT '[]',
                enzyme_names_json TEXT NOT NULL DEFAULT '[]',
                minimum_orf_amino_acids INTEGER NOT NULL DEFAULT 50,
                history_json TEXT NOT NULL DEFAULT '[]',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE vector_library (
                id TEXT PRIMARY KEY,
                fingerprint TEXT NOT NULL UNIQUE,
                name TEXT NOT NULL,
                sequence TEXT NOT NULL,
                circular INTEGER NOT NULL DEFAULT 1,
                features_json TEXT NOT NULL DEFAULT '[]',
                insert_name TEXT NOT NULL DEFAULT '',
                notes TEXT NOT NULL DEFAULT '',
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );
            CREATE TABLE vector_library_uses (
                library_id TEXT NOT NULL REFERENCES vector_library(id) ON DELETE CASCADE,
                protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                vector_id TEXT NOT NULL,
                first_used_at TEXT NOT NULL,
                last_used_at TEXT NOT NULL,
                PRIMARY KEY (library_id, protein_id)
            );
            """
        )
        connection.execute(
            """
            INSERT INTO proteins (
                id, name, sequence, created_at, updated_at
            ) VALUES ('legacy-protein', 'Legacy project', 'ACDE', ?, ?)
            """,
            (timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO vector_library (
                id, fingerprint, name, sequence, circular, features_json,
                insert_name, notes, created_at, updated_at
            ) VALUES (
                'legacy-library', ?, 'Legacy collision', ?, 1, '[]',
                'stale insert', 'stale notes', ?, ?
            )
            """,
            (fingerprint, sequence, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO expression_vectors (
                id, protein_id, name, sequence, circular, features_json,
                primers_json, enzyme_names_json, minimum_orf_amino_acids,
                history_json, created_at, updated_at
            ) VALUES (
                'legacy-vector', 'legacy-protein', 'Project copy', ?, 1,
                '[]', '[]', '[]', 50, '[]', ?, ?
            )
            """,
            (sequence, timestamp, timestamp),
        )
        connection.execute(
            """
            INSERT INTO vector_library_uses (
                library_id, protein_id, vector_id, first_used_at, last_used_at
            ) VALUES (
                'legacy-library', 'legacy-protein', 'legacy-vector', ?, ?
            )
            """,
            (timestamp, timestamp),
        )
    return standard


def test_edit_keeps_source_catalogue_link_without_creating_a_version(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    original_sequence = "ATG" + "GCT" * 20 + "TAA"
    created = service.save_expression_vector(protein["id"], {
        "name": "Stable source",
        "sequence": original_sequence,
    })
    source_id = created["libraryId"]
    before_ids = {item["id"] for item in service.list_library_vectors()}

    edited = service.save_expression_vector(protein["id"], {
        **created,
        "sequence": original_sequence[:-3] + "GGT" + "TAA",
    }, created["id"])

    assert edited["libraryId"] == source_id
    assert {item["id"] for item in service.list_library_vectors()} == before_ids
    assert service.get_library_vector(source_id)["sequence"] == original_sequence


def test_deleting_project_vector_removes_its_catalogue_usage(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    vector = service.save_expression_vector(protein["id"], {
        "name": "Disposable project copy",
        "sequence": "ATG" + "GAA" * 20 + "TAA",
    })

    service.database.delete_expression_vector(protein["id"], vector["id"])

    source = service.get_library_vector(vector["libraryId"])
    assert source["projectCount"] == 0
    assert source["projects"] == []


def test_project_rename_does_not_rename_catalogue_source(tmp_path):
    service = planner(tmp_path)
    protein = project(service)
    created = service.save_expression_vector(protein["id"], {
        "name": "Catalogue name",
        "sequence": "ATG" + "CAA" * 20 + "TAA",
    })

    renamed = service.save_expression_vector(protein["id"], {
        **created,
        "name": "Project-only name",
    }, created["id"])

    assert renamed["name"] == "Project-only name"
    assert service.get_library_vector(created["libraryId"])["name"] == "Catalogue name"


def test_fresh_database_loads_attributed_standard_collection(tmp_path):
    service = planner(tmp_path)
    standards = [
        vector for vector in service.list_library_vectors()
        if vector["isStandard"]
    ]

    assert len(standards) == 8
    assert {vector["name"] for vector in standards} >= {
        "pET28a-LIC", "pGEX-4T-1", "pBAD24", "pFastBacMam3"
    }
    pet = next(vector for vector in standards if vector["name"] == "pET28a-LIC")
    assert pet["sizeBp"] == 7328  # GenBank EF442785.1 known length.
    assert pet["sourceUrl"].endswith("/EF442785.1")
    assert "no restrictions" in pet["license"]


def test_upgrade_backfills_source_link_and_canonicalizes_seed_collision(tmp_path):
    database_path = tmp_path / "legacy.sqlite3"
    standard = write_legacy_database(database_path)

    database = Database(database_path)

    project_copy = database.get_expression_vector("legacy-protein", "legacy-vector")
    source = database.get_library_vector("legacy-library")
    assert project_copy["libraryId"] == "legacy-library"
    assert source["id"] == "legacy-library"  # Preserve referenced identity.
    assert source["name"] == standard["name"]
    assert source["sequence"] == standard["sequence"]
    assert source["features"] == standard["features"]
    assert source["insertName"] == ""
    assert source["notes"] == standard["notes"]
    assert source["isStandard"] is True
    assert source["projectCount"] == 1


def test_standard_delete_is_rejected_and_survives_restart_with_usage(tmp_path):
    service = planner(tmp_path)
    standard = next(
        vector for vector in service.list_library_vectors()
        if vector["name"] == "pET28a-LIC"
    )
    protein = project(service, "Standard-vector project")
    project_copy = service.copy_library_vector(protein["id"], standard["id"])

    with pytest.raises(ValueError, match="standard vectors cannot be deleted"):
        service.delete_library_vector(standard["id"])

    reopened = Database(tmp_path / "planner.sqlite3")
    source = reopened.get_library_vector(standard["id"])
    assert source["projectCount"] == 1
    assert source["projects"][0]["vectorId"] == project_copy["id"]
    assert reopened.get_expression_vector(
        protein["id"], project_copy["id"]
    )["libraryId"] == standard["id"]


def test_search_filters_facets_favorites_and_recent_usage(tmp_path):
    service = planner(tmp_path)

    result = service.search_library_vectors(
        query="T7",
        filters={"host": ["Escherichia coli"], "nTag": ["6×His"]},
    )
    assert [vector["name"] for vector in result["vectors"]] == ["pET28a-LIC"]
    assert result["facets"]["nTag"] == [
        {"value": "6×His", "count": 1},
        {"value": "8×His", "count": 1},
        {"value": "FGFP", "count": 1},
    ]
    assert result["facets"]["host"] == [
        {"value": "Escherichia coli", "count": 1}
    ]

    vector_id = result["vectors"][0]["id"]
    favorite = service.set_library_favorite(vector_id, {"favorite": True})
    assert favorite["favorite"] is True
    assert service.search_library_vectors(favorite=True)["vectors"][0]["id"] == vector_id

    protein = project(service, "Recent project")
    service.copy_library_vector(protein["id"], vector_id)
    recent = service.list_recent_library_vectors()
    assert recent[0]["id"] == vector_id
    assert recent[0]["lastUsedAt"]


def test_search_library_vectors_requires_each_query_token_and_normalizes_tag_x(tmp_path):
    service = planner(tmp_path)

    # His and TEV are separate library metadata fields on this known vector.
    # The query must therefore use token AND semantics rather than substring
    # matching the literal phrase "His TEV".
    his_tev = service.search_library_vectors(query="His TEV")
    assert [vector["name"] for vector in his_tev["vectors"]] == ["LIC-pPICZ-LC1"]

    # Scientists often use ASCII x for a repeat count although the catalogue
    # renders tags using the multiplication sign.
    ascii_tag = service.search_library_vectors(query="6xHis")
    assert {vector["name"] for vector in ascii_tag["vectors"]} == {
        "LIC-pPICZ-LC1",
        "pET28a-LIC",
        "pQE30NST",
    }


def test_vector_library_api_query_contract(tmp_path):
    service = planner(tmp_path)
    request = parse_vector_library_search(
        {
            "q": ["GST"],
            "host": ["Escherichia coli"],
            "promoter": ["tac,T7-lac"],
            "favorite": ["false"],
            "limit": ["25"],
        },
        service.database.VECTOR_LIBRARY_FACETS,
    )

    assert request == {
        "query": "GST",
        "filters": {
            "host": ["Escherichia coli"],
            "promoter": ["tac", "T7-lac"],
        },
        "favorite": False,
        "limit": 25,
        "offset": 0,
    }
    payload = service.search_library_vectors(**request)
    assert [vector["name"] for vector in payload["vectors"]] == ["pGEX-4T-1"]
    assert payload["total"] == 1
    assert "host" in payload["facets"]


def test_catalogue_export_route_preserves_provenance(catalogue_api):
    service, request = catalogue_api
    vector = next(
        item for item in service.list_library_vectors()
        if item["name"] == "pET28a-LIC"
    )

    status, exported = request(
        "GET",
        f"/v1/protein-planner/vector-library/{vector['id']}/export?format=genbank",
    )

    assert status == 200
    assert exported["filename"] == "pET28a-LIC.gb"
    assert exported["format"] == "genbank"
    assert "LOCUS" in exported["content"]
    assert "COMMENT" in exported["content"]
    assert vector["supplier"] in exported["content"]
    assert vector["sourceUrl"] in exported["content"]
    assert "no restrictions" in exported["content"]

    status, fasta = request(
        "GET",
        f"/v1/protein-planner/vector-library/{vector['id']}/export?format=fasta",
    )
    assert status == 200
    assert fasta["filename"] == "pET28a-LIC.fasta"
    assert fasta["content"].startswith(">pET28a-LIC")

    status, missing = request(
        "GET", "/v1/protein-planner/vector-library/not-a-vector/export"
    )
    assert status == 404
    assert "not-a-vector" in missing["error"]


def test_catalogue_import_route_reads_snapgene_and_deduplicates(catalogue_api):
    service, request = catalogue_api
    sequence = "ATGGCCGCTTAA"
    initial_total = service.search_library_vectors()["total"]
    body = {
        "filename": "my_vector.dna",
        "content": snapgene_base64(sequence),
    }

    status, imported = request(
        "POST", "/v1/protein-planner/vector-library/import", body
    )

    assert status == 201
    assert imported["name"] == "my_vector"
    assert imported["sequence"] == sequence
    assert imported["circular"] is True
    assert imported["features"][0] == {
        "id": "feature-1",
        "name": "Test CDS",
        "type": "CDS",
        "start": 0,
        "end": 9,
        # The public feature contract always exposes a normalized part list so
        # map and sequence views can render origin-spanning features without
        # inferring segments from coordinates.
        "wrapsOrigin": False,
        "parts": [{"start": 0, "end": 9}],
        "strand": 1,
        "color": "#43A047",
        "notes": "",
        "automatic": False,
        "isInsert": False,
        "qualifiers": {"label": ["Test CDS"]},
    }
    assert imported["isStandard"] is False
    assert imported["supplier"] == ""
    assert imported["license"] == ""
    assert imported["projects"] == []

    stored = service.get_library_vector(imported["id"])
    assert imported == stored

    status, duplicate = request(
        "POST", "/v1/protein-planner/vector-library/import", body
    )
    assert status == 201
    assert duplicate["id"] == imported["id"]
    assert duplicate["duplicate"] is True
    assert service.search_library_vectors()["total"] == initial_total + 1

    status, invalid = request(
        "POST",
        "/v1/protein-planner/vector-library/import",
        {"filename": "broken.dna", "content": "%%%%"},
    )
    assert status == 400
    assert "Could not read snapgene sequence" in invalid["error"]
