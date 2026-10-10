"""Local REST API for the Protein Labs suite and Protein Planner."""

from __future__ import annotations

import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
from pathlib import Path
import re
import sys
import traceback
from typing import Any
from urllib.parse import parse_qs, urlparse

from .protein_planner.database import Database, ProteinNotFoundError
from .protein_planner.integrations import (
    AlphaFoldDBClient,
    HttpClient,
    NCBIBlastClient,
    RCSBClient,
    RemoteServiceError,
    UniProtClient,
)
from .protein_planner.protparam import SequenceValidationError
from .protein_planner.service import ProteinPlanner
from .gel_analysis import analyze_gel
from .vector_sources import VectorSourceError


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "ProteinLabs/0.1"
    planner: ProteinPlanner

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PATCH, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self) -> None:
        try:
            path, query = self._path_and_query()
            if path == "/v1/health":
                self._send(200, {
                    "service": "protein-labs",
                    "version": 1,
                    "apps": [
                        "protein-planner",
                        "chromatogram-studio",
                        "gel-densitometry",
                    ],
                    "database": str(self.planner.database.path),
                })
                return
            if path == "/v1/protein-planner/proteins":
                self._send(200, {"proteins": self.planner.database.list_proteins()})
                return
            if path == "/v1/protein-planner/construct-hosts":
                self._send(200, self.planner.list_construct_hosts())
                return
            if path == "/v1/protein-planner/vector-library":
                self._send(200, {"vectors": self.planner.list_library_vectors()})
                return
            match = re.fullmatch(r"/v1/protein-planner/vector-library/([^/]+)", path)
            if match:
                self._send(200, self.planner.get_library_vector(match.group(1)))
                return
            if path == "/v1/protein-planner/vector-sources":
                self._send(200, self.planner.describe_vector_sources())
                return
            if path == "/v1/protein-planner/vector-sources/sets":
                self._send(200, self.planner.list_vector_source_sets(
                    (query.get("source") or ["snapgene"])[0]
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors", path
            )
            if match:
                self._send(200, {
                    "vectors": self.planner.list_expression_vectors(match.group(1))
                })
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/([^/]+)/export",
                path,
            )
            if match:
                self._send(200, self.planner.export_expression_vector(
                    match.group(1), match.group(2), query.get("format", ["genbank"])[0]
                ))
                return
            match = re.fullmatch(r"/v1/protein-planner/proteins/([^/]+)", path)
            if match:
                self._send(200, self.planner.database.get_bundle(match.group(1)))
                return
            match = re.fullmatch(r"/v1/protein-planner/blast/([^/]+)", path)
            if match:
                fetch = query.get("fetchUniProt", ["true"])[0].lower() != "false"
                self._send(200, self.planner.poll_blast(match.group(1), fetch_uniprot=fetch))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/alphafold/models/([^/]+)",
                path,
            )
            if match:
                self._send(
                    200, self.planner.get_alphafold_model(match.group(1), match.group(2))
                )
                return
            self._send(404, {"error": "Endpoint not found"})
        except Exception as error:
            self._handle_error(error)

    def do_POST(self) -> None:
        try:
            path, _ = self._path_and_query()
            body = self._read_json()
            cancel = re.fullmatch(r"/v1/protein-planner/blast/([^/]+)/cancel", path)
            if cancel:
                self._send(200, self.planner.cancel_blast(cancel.group(1)))
                return
            if path == "/v1/protein-planner/proteins":
                self._send(201, self.planner.create_protein(body))
                return
            if path == "/v1/gel/analyze":
                self._send(200, analyze_gel(body))
                return
            if path == "/v1/protein-planner/back-translate":
                self._send(200, self.planner.back_translate_target(body))
                return
            if path == "/v1/protein-planner/vector-sources/search":
                self._send(200, self.planner.search_vector_sources(body))
                return
            if path == "/v1/protein-planner/analyze-sequence":
                self._send(200, {"result": self.planner.analyze_raw_sequence(
                    str(body.get("sequence") or "")
                )})
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors", path
            )
            if match:
                self._send(201, self.planner.save_expression_vector(
                    match.group(1), body
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/library/([^/]+)", path
            )
            if match:
                self._send(201, self.planner.copy_library_vector(
                    match.group(1), match.group(2)
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/load", path
            )
            if match:
                self._send(201, self.planner.load_vector_from_source(
                    match.group(1), body
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/import", path
            )
            if match:
                self._send(201, self.planner.import_expression_vector(
                    match.group(1),
                    str(body.get("filename") or "sequence.gb"),
                    str(body.get("content") or ""),
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/assemble", path
            )
            if match:
                self._send(201, self.planner.assemble_expression_vectors(
                    match.group(1), body
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/([^/]+)/"
                r"(auto-annotate|primers|edit|digest|align|insertion-sites|insert)",
                path,
            )
            if match:
                protein_id, vector_id, action = match.groups()
                if action == "insertion-sites":
                    value = self.planner.expression_vector_insertion_sites(
                        protein_id, vector_id, body
                    )
                elif action == "insert":
                    value = self.planner.insert_into_expression_vector(
                        protein_id, vector_id, body
                    )
                elif action == "auto-annotate":
                    value = self.planner.auto_annotate_expression_vector(
                        protein_id, vector_id, body
                    )
                elif action == "primers":
                    value = self.planner.design_expression_primers(
                        protein_id, vector_id, body
                    )
                elif action == "digest":
                    value = self.planner.digest_expression_vector(
                        protein_id, vector_id, body
                    )
                elif action == "align":
                    value = self.planner.align_expression_vectors(
                        protein_id, vector_id, body
                    )
                else:
                    value = self.planner.edit_expression_vector_sequence(
                        protein_id, vector_id, body
                    )
                self._send(200, value)
                return
            route = self._protein_action(path)
            if route:
                protein_id, action = route
                if action == "analyze":
                    self._send(200, {"result": self.planner.analyze(protein_id)})
                elif action == "blast":
                    self._send(202, self.planner.submit_blast(
                        protein_id,
                        database=str(body.get("database") or "swissprot"),
                        hitlist_size=int(body.get("hitlistSize", 25)),
                        purpose=str(body.get("purpose") or "blast"),
                    ))
                elif action == "uniprot/search":
                    query = str(body.get("query") or "").strip()
                    if not query:
                        raise ValueError("A UniProt query is required")
                    self._send(200, {"matches": self.planner.search_uniprot(
                        protein_id, query, size=int(body.get("size", 10))
                    )})
                elif action == "uniprot/fetch":
                    accession = str(body.get("accession") or "").strip()
                    if not accession:
                        raise ValueError("A UniProt accession is required")
                    self._send(200, {"match": self.planner.fetch_uniprot(protein_id, accession)})
                elif action == "uniprot/match":
                    self._send(200, {"matches": self.planner.match_uniprot_sequence(
                        protein_id, size=int(body.get("size", 25))
                    )})
                elif action == "pdb/search":
                    self._send(200, {"matches": self.planner.search_pdb(
                        protein_id,
                        identity_cutoff=float(body.get("identityCutoff", 0.3)),
                        evalue_cutoff=float(body.get("evalueCutoff", 1e-3)),
                        limit=int(body.get("limit", 10)),
                    )})
                elif action == "alphafold/db":
                    self._send(200, self.planner.fetch_alphafold_db(
                        protein_id, str(body.get("accession") or "")
                    ))
                elif action == "alphafold/server-job":
                    self._send(201, self.planner.prepare_alphafold_server_job(protein_id))
                elif action == "alphafold/import":
                    source_path = str(body.get("path") or "").strip()
                    if not source_path:
                        raise ValueError("An AlphaFold result file path is required")
                    self._send(201, self.planner.import_alphafold_result(
                        protein_id, source_path
                    ))
                elif action == "jobs":
                    self._send(201, self.planner.create_project_job(protein_id, body))
                elif action == "notebook":
                    self._send(200, self.planner.save_project_notebook(protein_id, body))
                elif action == "research":
                    self._send(202, self.planner.start_research(
                        protein_id,
                        blast_database=str(body.get("blastDatabase") or "swissprot"),
                        blast_hits=int(body.get("blastHits", 25)),
                        pdb_hits=int(body.get("pdbHits", 10)),
                        identity_cutoff=float(body.get("identityCutoff", 0.3)),
                        evalue_cutoff=float(body.get("evalueCutoff", 1e-3)),
                    ))
                else:
                    self._send(404, {"error": "Endpoint not found"})
                return
            self._send(404, {"error": "Endpoint not found"})
        except Exception as error:
            self._handle_error(error)

    def do_PATCH(self) -> None:
        try:
            path, _ = self._path_and_query()
            job_match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/jobs/([^/]+)", path
            )
            if job_match:
                self._send(200, self.planner.update_project_job(
                    job_match.group(1), job_match.group(2), self._read_json()
                ))
                return
            library_match = re.fullmatch(
                r"/v1/protein-planner/vector-library/([^/]+)", path
            )
            if library_match:
                self.planner.delete_library_vector(library_match.group(1))
                self._send(200, {"deleted": library_match.group(1)})
                return
            vector_match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/([^/]+)", path
            )
            if vector_match:
                self._send(200, self.planner.save_expression_vector(
                    vector_match.group(1), self._read_json(), vector_match.group(2)
                ))
                return
            match = re.fullmatch(r"/v1/protein-planner/proteins/([^/]+)", path)
            if not match:
                self._send(404, {"error": "Endpoint not found"})
                return
            self._send(200, self.planner.update_protein(match.group(1), self._read_json()))
        except Exception as error:
            self._handle_error(error)

    def do_DELETE(self) -> None:
        try:
            path, _ = self._path_and_query()
            job_match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/jobs/([^/]+)", path
            )
            if job_match:
                self.planner.delete_project_job(
                    job_match.group(1), job_match.group(2)
                )
                self._send(200, {"deleted": job_match.group(2)})
                return
            vector_match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/([^/]+)", path
            )
            if vector_match:
                self.planner.database.delete_expression_vector(
                    vector_match.group(1), vector_match.group(2)
                )
                self._send(200, {"deleted": vector_match.group(2)})
                return
            match = re.fullmatch(r"/v1/protein-planner/proteins/([^/]+)", path)
            if not match:
                self._send(404, {"error": "Endpoint not found"})
                return
            self.planner.database.delete_protein(match.group(1))
            self._send(200, {"deleted": match.group(1)})
        except Exception as error:
            self._handle_error(error)

    @staticmethod
    def _protein_action(path: str) -> tuple[str, str] | None:
        match = re.fullmatch(
            r"/v1/protein-planner/proteins/([^/]+)/(analyze|blast|research|pdb/search|uniprot/search|uniprot/fetch|uniprot/match|alphafold/db|alphafold/server-job|alphafold/import|jobs|notebook)",
            path,
        )
        return (match.group(1), match.group(2)) if match else None

    def _path_and_query(self) -> tuple[str, dict[str, list[str]]]:
        parsed = urlparse(self.path)
        return parsed.path.rstrip("/") or "/", parse_qs(parsed.query)

    def _read_json(self) -> dict[str, Any]:
        length = int(self.headers.get("Content-Length", "0"))
        if length < 0 or length > 50_000_000:
            raise ValueError("Request body is too large")
        if length == 0:
            return {}
        value = json.loads(self.rfile.read(length).decode("utf-8"))
        if not isinstance(value, dict):
            raise ValueError("The request body must be a JSON object")
        return value

    def _handle_error(self, error: Exception) -> None:
        if isinstance(error, (SequenceValidationError, ValueError, TypeError, json.JSONDecodeError)):
            self._send(400, {"error": str(error), "type": error.__class__.__name__})
        elif isinstance(error, (ProteinNotFoundError, LookupError)):
            self._send(404, {"error": str(error), "type": error.__class__.__name__})
        elif isinstance(error, VectorSourceError):
            self._send(502, {"error": str(error), "type": "VectorSourceError"})
        elif isinstance(error, RemoteServiceError):
            self._send(502, {
                "error": str(error),
                "type": "RemoteServiceError",
                "service": error.service,
                "upstreamStatus": error.status,
            })
        else:  # pragma: no cover - defensive API boundary
            traceback.print_exc(file=sys.stderr)
            self._send(500, {"error": f"Unexpected backend error: {error}"})

    def _send(self, status: int, value: dict[str, Any]) -> None:
        encoded = json.dumps(value, allow_nan=False, separators=(",", ":")).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self._cors_headers()
        self.end_headers()
        self.wfile.write(encoded)

    def _cors_headers(self) -> None:
        origin = self.headers.get("Origin", "")
        if origin in ("", "null"):
            allowed = "*"
        else:
            allowed = origin if origin.startswith(("http://127.0.0.1", "http://localhost")) else "http://127.0.0.1"
        self.send_header("Access-Control-Allow-Origin", allowed)
        self.send_header("Vary", "Origin")

    def log_message(self, format_string: str, *args: object) -> None:
        message = format_string % args
        if " 200 " in message and (
            '"GET /v1/health ' in message
            or re.search(r'"GET /v1/protein-planner/proteins/[^ /]+ ', message)
        ):
            return
        print(f"[protein-labs] {message}", file=sys.stderr)


def make_planner(database_path: str | Path, email: str = "") -> ProteinPlanner:
    http = HttpClient(email=email)
    return ProteinPlanner(
        Database(database_path),
        NCBIBlastClient(http, email=email),
        UniProtClient(http),
        RCSBClient(http),
        AlphaFoldDBClient(http),
        email=email,
    )


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8770)
    default_database = Path(__file__).resolve().parents[2] / "data" / "protein_labs.sqlite3"
    parser.add_argument(
        "--database",
        default=os.environ.get("PROTEIN_LABS_DATABASE", str(default_database)),
    )
    parser.add_argument(
        "--email",
        default=os.environ.get("PROTEIN_LABS_EMAIL", ""),
        help="Contact email sent to NCBI in accordance with API etiquette",
    )
    args = parser.parse_args()
    ApiHandler.planner = make_planner(args.database, args.email)
    server = ThreadingHTTPServer((args.host, args.port), ApiHandler)
    print(
        f"Protein Labs backend listening on http://{args.host}:{args.port}\n"
        f"Database: {ApiHandler.planner.database.path}",
        file=sys.stderr,
    )
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
