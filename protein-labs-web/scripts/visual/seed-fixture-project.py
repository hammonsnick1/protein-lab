# Seed a fixture project the visual checks can open without touching the network.
#
#   cd protein-labs/backend
#   .venv/bin/python -m protein_labs.server --port $ENGINE_PORT --database /tmp/visual.sqlite3 &
#   .venv/bin/python ../../protein-labs-web/scripts/visual/seed-fixture-project.py \
#       http://127.0.0.1:$ENGINE_PORT /tmp/visual.sqlite3
#
# Use the backend's own .venv python: system python3 has no Bio, and the engine
# dies on import. The project it creates — "Membrane transporter (fixture)" —
# carries UniProt and PDB matches (space groups P 21 21 21 and C 1 2 1) and the
# first three workflow jobs marked complete, so a job screen can be opened
# directly. Copy the resulting database beside the harness and reuse it.
import json
import sys
import urllib.request

from protein_labs.protein_planner.database import Database

BASE, DB_PATH = sys.argv[1].rstrip("/"), sys.argv[2]
API = f"{BASE}/v1/protein-planner/proteins"

SEQUENCE = (
    "MKTLLLAVAVALSGCSSHHHHHHGLVPRGSMEELWAAIVLGGFLAAVLLLAVGLYRRRRSPEPGSEDKKTAEAPKPAAPSKPEGSPTSGS"
    "EAKPEAKAEPAAKPEGSQRLDDFKALFEKAKAGNDTAIRAMLEHLQKGEPMSAEQLAQLLLEAAVRLGNGEAAQVLAEALL"
)


def call(method, url, body=None):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode() if body is not None else None,
        method=method,
        headers={"Content-Type": "application/json"},
    )
    return json.load(urllib.request.urlopen(request))


protein = call("POST", API, {"name": "Membrane transporter (fixture)", "sequence": SEQUENCE, "organism": "Escherichia coli"})
protein_id = protein["protein"]["id"] if "protein" in protein else protein["id"]

database = Database(DB_PATH)
database.save_uniprot_match(
    protein_id,
    {
        "accession": "P0FIX1",
        "reviewed": True,
        "proteinName": "Membrane transporter fixture",
        "organism": {"scientificName": "Escherichia coli"},
        "transmembraneRegions": [{"type": "Transmembrane", "description": "Helical", "location": {"start": 33, "end": 55}, "evidences": []}],
        "disorderedRegions": [{"type": "Region", "description": "Disordered", "location": {"start": 60, "end": 110}, "evidences": []}],
        "cofactors": [{"name": "Heme b", "chebiId": "", "evidences": []}],
        "source": {"url": "https://www.uniprot.org/uniprotkb/P0FIX1/entry"},
    },
    "fixture",
    {"identity": 0.91},
)
database.save_pdb_match(
    protein_id,
    {
        "pdbId": "1ABC", "entityId": "1", "identity": 0.62, "coverage": 0.8,
        "title": "FIXTURE TRANSPORTER", "entityDescription": "Transporter",
        "method": "X-RAY DIFFRACTION", "experimentalMethods": ["X-RAY DIFFRACTION"],
        "resolution": 2.4, "spaceGroup": "P 21 21 21",
        "crystallizationConditions": {"status": "reported", "crystalGrowth": [{"method": "LIPIDIC CUBIC PHASE", "pH": "6.5", "temp": "293", "pdbx_details": "PEG 400, sodium citrate"}]},
        "source": {"entryUrl": "https://www.rcsb.org/structure/1ABC"},
        "fetchedAt": "2026-10-31T22:00:00+00:00",
    },
)
database.save_pdb_match(
    protein_id,
    {
        "pdbId": "2XYZ", "entityId": "1", "identity": 0.48, "coverage": 0.7,
        "title": "FIXTURE HOMOLOGUE", "entityDescription": "Transporter",
        "method": "X-RAY DIFFRACTION", "experimentalMethods": ["X-RAY DIFFRACTION"],
        "resolution": 3.1, "spaceGroup": "C 1 2 1",
        "source": {"entryUrl": "https://www.rcsb.org/structure/2XYZ"},
        "fetchedAt": "2026-10-31T22:00:00+00:00",
    },
)


def job(app_type, name, config):
    created = call("POST", f"{API}/{protein_id}/jobs", {"name": name, "appType": app_type, "config": {}})
    call("PATCH", f"{API}/{protein_id}/jobs/{created['id']}", {"name": name, "status": "complete", "config": config})


job("database-research", "Sequence research", {"savedSources": ["UniProt", "PDB"], "updatedAt": "2026-10-31T22:01:00Z", "savedByUser": True})
job("reference-match", "Choose reference match", {"selectedAccession": "P0FIX1", "selectedProteinName": "Membrane transporter fixture", "selectedOrganism": "Escherichia coli", "identity": 0.91, "queryCoverage": 0.95, "reviewed": True, "selectedAt": "2026-10-31T22:02:00Z", "savedByUser": True})
job("protein-readiness", "Protein readiness check", {"reviewStatus": "reviewed", "membraneProtein": "Yes", "intrinsicallyDisordered": "Yes", "cofactorRequired": "Yes", "cofactorDetails": "Heme b", "reviewedAt": "2026-10-31T22:03:00Z", "savedByUser": True})

print(protein_id)
