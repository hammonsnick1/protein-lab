"""Known-answer coverage for physical purified-protein inventory."""

from http.client import HTTPConnection
from http.server import ThreadingHTTPServer
import json
from threading import Thread

import pytest

from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import HttpClient, NCBIBlastClient, RCSBClient, UniProtClient
from protein_labs.protein_planner.service import ProteinPlanner
from protein_labs.server import ApiHandler


def planner(tmp_path):
    http = HttpClient(transport=lambda *args, **kwargs: None)
    return ProteinPlanner(Database(tmp_path / "protein-library.sqlite3"), NCBIBlastClient(http), UniProtClient(http), RCSBClient(http))


@pytest.fixture
def api(tmp_path):
    service = planner(tmp_path)
    handler = type("ProteinLibraryHandler", (ApiHandler,), {"planner": service})
    server = ThreadingHTTPServer(("127.0.0.1", 0), handler)
    thread = Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def request(method, path, body=None):
        connection = HTTPConnection("127.0.0.1", server.server_port, timeout=5)
        payload = None if body is None else json.dumps(body).encode()
        connection.request(method, path, payload, {"Content-Type": "application/json"} if payload else {})
        response = connection.getresponse()
        result = response.status, json.loads(response.read().decode())
        connection.close()
        return result

    try:
        yield request
    finally:
        server.shutdown()
        server.server_close()
        thread.join(timeout=5)


def batch(name="TEV-cleaved kinase", **overrides):
    value = {
        "name": name, "geneName": "KIN1", "organism": "E. coli",
        "constructName": "KIN1-His6", "tags": ["His6"],
        "purificationMethod": "Ni-NTA", "concentrationValue": 2.5,
        "concentrationUnit": "mg/mL", "yieldValue": 8.0, "yieldUnit": "mg",
        "purityPercent": 95.0, "buffer": "20 mM Tris, 150 mM NaCl",
        "storageDate": "2026-10-21", "storageTemperature": "-80 C",
        "locationPath": "F1/S2/R3/B4/A1", "freezer": "F1", "shelf": "S2",
        "rack": "R3", "box": "B4", "position": "A1", "aliquotCount": 3,
        "aliquotVolume": 50, "aliquotUnit": "uL", "status": "stored",
    }
    return {**value, **overrides}


def test_schema_has_inventory_and_custody_tables(tmp_path):
    database = Database(tmp_path / "schema.sqlite3")
    with database.connect() as connection:
        tables = {row["name"] for row in connection.execute("SELECT name FROM sqlite_master WHERE type = 'table'")}
        columns = {row["name"] for row in connection.execute("PRAGMA table_info(protein_library)")}
    assert {"protein_library", "protein_library_events"} <= tables
    assert {"aliquot_count", "storage_temperature", "location_path", "status", "favorite"} <= columns


def test_crud_search_facets_and_paging(tmp_path):
    service = planner(tmp_path)
    first = service.create_library_protein(batch())
    second = service.create_library_protein(batch("GST phosphatase", tags=["GST"], purificationMethod="GSTrap", storageTemperature="4 C", locationPath="Cold room"))
    updated = service.update_library_protein(first["id"], {"favorite": True, "notes": "QC passed"})
    assert updated["favorite"] is True
    assert updated["notes"] == "QC passed"

    result = service.search_library_proteins(filters={"tag": ["his6"]}, limit=1, offset=0)
    assert result["total"] == 1
    assert result["proteins"][0]["id"] == first["id"]
    # Facets retain all temperatures only when their own dimension is relaxed;
    # the active His6 tag correctly excludes the GST batch here.
    assert result["facets"]["temperature"] == [{"value": "-80 C", "count": 1}]
    assert service.search_library_proteins(query="phosphatase", limit=10)["proteins"][0]["id"] == second["id"]
    service.delete_library_protein(second["id"])
    assert service.search_library_proteins(limit=10)["total"] == 1


def test_aliquot_events_decrement_and_auto_update_status(tmp_path):
    service = planner(tmp_path)
    record = service.create_library_protein(batch(aliquotCount=2))
    low = service.add_library_protein_event(record["id"], {"eventType": "aliquot_used", "aliquotsUsed": 1, "notes": "assay"})
    assert (low["aliquotCount"], low["status"]) == (1, "low")
    empty = service.add_library_protein_event(record["id"], {"eventType": "aliquot_used", "aliquotsUsed": 1})
    assert (empty["aliquotCount"], empty["status"]) == (0, "used_up")
    assert [event["eventType"] for event in empty["events"]] == ["aliquot_used", "aliquot_used"]
    with pytest.raises(ValueError, match="cannot exceed"):
        service.add_library_protein_event(record["id"], {"eventType": "aliquot_used", "aliquotsUsed": 1})


def test_http_contract_supports_create_filter_event_and_delete(api):
    status, created = api("POST", "/v1/protein-planner/protein-library", batch())
    assert status == 201
    protein_id = created["id"]
    status, listing = api("GET", "/v1/protein-planner/protein-library?temperature=-80%20C&tag=His6&limit=10")
    assert status == 200
    assert listing["total"] == 1
    status, after_event = api("POST", f"/v1/protein-planner/protein-library/{protein_id}/events", {"eventType": "moved", "toLocation": "F2/S1"})
    assert status == 201
    assert after_event["locationPath"] == "F2/S1"
    assert after_event["events"][0]["eventType"] == "moved"
    status, deleted = api("DELETE", f"/v1/protein-planner/protein-library/{protein_id}")
    assert (status, deleted) == (200, {"deleted": protein_id})
