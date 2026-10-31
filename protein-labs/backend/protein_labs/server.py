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

from .protein_planner.conservation import ConSurfDbClient
from .protein_planner.database import Database, ProteinNotFoundError
from .protein_planner.integrations import (
    AlphaFoldDBClient,
    HttpClient,
    NCBIBlastClient,
    PDBeSIFTSClient,
    RCSBClient,
    RemoteServiceError,
    UniProtClient,
)
from .protein_planner.protparam import SequenceValidationError
from .protein_planner.service import ProteinPlanner
from .gel_analysis import analyze_gel
from .chromatography import analyze_chromatogram, calibrate_sec, create_chromatography_run
from .nmr import predict_hsqc
from .vector_sources import VectorSourceError


def parse_vector_library_search(
    query: dict[str, list[str]], facet_names: dict[str, str], *,
    include_vector_controls: bool = False,
) -> dict[str, Any]:
    """Translate URL query values into the stable catalogue service contract."""
    filters = {
        facet: [
            item.strip()
            for value in query.get(facet, [])
            for item in value.split(",")
            if item.strip()
        ]
        for facet in facet_names
        if query.get(facet)
    }
    favorite_value = (query.get("favorite") or [""])[0].lower()
    if favorite_value not in {"", "true", "false"}:
        raise ValueError("favorite must be true or false")
    favorite = (
        True if favorite_value == "true"
        else False if favorite_value == "false"
        else None
    )
    request = {
        "query": (query.get("q") or query.get("query") or [""])[0],
        "filters": filters,
        "favorite": favorite,
        "limit": int((query.get("limit") or ["100"])[0]),
        "offset": int((query.get("offset") or ["0"])[0]),
    }
    # Keep the established parser contract byte-for-byte for old callers;
    # only pass new controls when the client actually supplied them.
    if include_vector_controls and any(key in query for key in ("view", "collection", "tag", "sort", "order")):
        request.update({
            "view": (query.get("view") or ["all"])[0],
            "collection": (query.get("collection") or [""])[0] or None,
            "tags": [item.strip() for item in query.get("tag", []) if item.strip()],
            "sort": (query.get("sort") or ["name"])[0],
            "order": (query.get("order") or ["asc"])[0],
        })
    return request


class ApiHandler(BaseHTTPRequestHandler):
    server_version = "ProteinLabs/0.1"
    planner: ProteinPlanner

    def do_OPTIONS(self) -> None:
        self.send_response(204)
        self._cors_headers()
        self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, PATCH, DELETE, OPTIONS")
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
            if path == "/v1/protein-planner/project-trees":
                self._send(200, {"trees": self.planner.project_trees.list_trees()})
                return
            if path == "/v1/protein-planner/project-trees/diff":
                from_id = (query.get("fromProjectId") or [""])[0]
                to_id = (query.get("toProjectId") or [""])[0]
                if not from_id or not to_id:
                    raise ValueError(
                        "fromProjectId and toProjectId query parameters are required"
                    )
                self._send(200, self.planner.project_trees.project_diff(
                    from_id, to_id
                ))
                return
            if path == "/v1/protein-planner/project-diff":
                from_id = (query.get("from") or [""])[0]
                to_id = (query.get("to") or [""])[0]
                if not from_id or not to_id:
                    raise ValueError("from and to query parameters are required")
                self._send(200, self.planner.project_trees.project_diff_for_ui(
                    from_id, to_id
                ))
                return
            tree_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)", path
            )
            if tree_match:
                self._send(200, self.planner.project_trees.get_tree(
                    tree_match.group(1)
                ))
                return
            if path == "/v1/taxonomy/search":
                self._send(200, self.planner.search_taxonomy(
                    (query.get("q") or [""])[0],
                    int((query.get("limit") or ["10"])[0]),
                ))
                return
            if path == "/v1/protein-planner/construct-hosts":
                self._send(200, self.planner.list_construct_hosts())
                return
            if path == "/v1/protein-planner/vector-library":
                search = parse_vector_library_search(
                    query, self.planner.database.VECTOR_LIBRARY_FACETS,
                    include_vector_controls=True,
                )
                self._send(200, self.planner.search_library_vectors(**search))
                return
            if path == "/v1/protein-planner/protein-library":
                search = parse_vector_library_search(
                    query, self.planner.database.PROTEIN_LIBRARY_FACETS
                )
                self._send(200, self.planner.search_library_proteins(**search))
                return
            protein_library_match = re.fullmatch(
                r"/v1/protein-planner/protein-library/([^/]+)", path
            )
            if protein_library_match:
                self._send(200, self.planner.get_library_protein(
                    protein_library_match.group(1)
                ))
                return
            if path == "/v1/protein-planner/vector-library/recent":
                self._send(200, {
                    "vectors": self.planner.list_recent_library_vectors(
                        int((query.get("limit") or ["10"])[0])
                    )
                })
                return
            if path == "/v1/protein-planner/vector-library/collections":
                self._send(200, self.planner.list_library_collections())
                return
            if path == "/v1/protein-planner/vector-library/tags":
                self._send(200, {"tags": self.planner.list_library_tags()})
                return
            match = re.fullmatch(
                r"/v1/protein-planner/vector-library/([^/]+)/export", path
            )
            if match:
                self._send(200, self.planner.export_library_vector(
                    match.group(1), query.get("format", ["genbank"])[0]
                ))
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
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/structures", path
            )
            if match:
                self._send(200, self.planner.list_structures(
                    match.group(1), limit=int((query.get("limit") or ["10"])[0])
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/structures/(alphafold_db|pdb)/([^/]+)/regions",
                path,
            )
            if match:
                self._send(200, self.planner.get_structure_regions(*match.groups()))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/structures/(alphafold_db|pdb)/([^/]+)/ligand-depiction",
                path,
            )
            if match:
                required = {
                    key: (query.get(key) or [""])[0].strip()
                    for key in ("chainId", "authSeqId", "ccdId")
                }
                if not all(required.values()):
                    raise ValueError("chainId, authSeqId, and ccdId query parameters are required")
                self._send(200, self.planner.get_ligand_depiction(
                    *match.groups(),
                    chain_id=required["chainId"], auth_seq_id=required["authSeqId"], ccd_id=required["ccdId"],
                    insertion_code=(query.get("insertionCode") or [None])[0],
                ))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/structures/(alphafold_db|pdb)/([^/]+)",
                path,
            )
            if match:
                self._send(200, self.planner.get_structure(*match.groups()))
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
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/conservation", path
            )
            if match:
                self._send(200, self.planner.list_conservation(match.group(1)))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/conservation/([^/]+)/msa", path
            )
            if match:
                self._send(200, self.planner.get_conservation_msa(*match.groups()))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/conservation/([^/]+)", path
            )
            if match:
                self._send(200, self.planner.get_conservation(*match.groups()))
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/crystallization", path
            )
            if match:
                self._send(200, self.planner.crystallization_assessment(match.group(1)))
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
            if path == "/v1/protein-planner/project-trees":
                self._send(201, self.planner.project_trees.create_tree(body))
                return
            if path == "/v1/protein-planner/project-trees/import":
                self._send(200, self.planner.project_trees.import_local_trees(body))
                return
            tree_link_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/links", path
            )
            if tree_link_match:
                self._send(201, self.planner.project_trees.create_link(
                    tree_link_match.group(1), body
                ))
                return
            tree_branch_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/branches", path
            )
            if tree_branch_match:
                tree_id = tree_branch_match.group(1)
                fields = dict(body)
                if "note" in fields and "description" not in fields:
                    fields["description"] = fields["note"]
                self.planner.project_trees.create_link(tree_id, fields)
                self._send(201, self.planner.project_trees.get_tree(tree_id))
            if path == "/v1/chromatogram/calibrate-sec":
                self._send(200, calibrate_sec(body))
                return
            if path == "/v1/chromatogram/analyze":
                self._send(200, analyze_chromatogram(body))
                return
            if path == "/v1/chromatogram/run":
                self._send(200, create_chromatography_run(body))
                return
            if path == "/v1/gel/analyze":
                self._send(200, analyze_gel(body))
                return
            if path == "/v1/nmr/hsqc/predict":
                self._send(200, predict_hsqc(body))
                return
            if path == "/v1/protein-planner/back-translate":
                self._send(200, self.planner.back_translate_target(body))
                return
            if path == "/v1/protein-planner/codon-optimize":
                self._send(200, self.planner.optimize_target_codons(body))
                return
            if path == "/v1/protein-planner/vector-sources/search":
                self._send(200, self.planner.search_vector_sources(body))
                return
            if path == "/v1/protein-planner/analyze-sequence":
                self._send(200, {"result": self.planner.analyze_raw_sequence(
                    str(body.get("sequence") or "")
                )})
                return
            if path == "/v1/protein-planner/vector-library/import":
                self._send(201, self.planner.import_library_vector(
                    str(body.get("filename") or "sequence.gb"),
                    str(body.get("content") or ""),
                ))
                return
            if path == "/v1/protein-planner/protein-library":
                self._send(201, self.planner.create_library_protein(body))
                return
            protein_library_event_match = re.fullmatch(
                r"/v1/protein-planner/protein-library/([^/]+)/events", path
            )
            if protein_library_event_match:
                self._send(201, self.planner.add_library_protein_event(
                    protein_library_event_match.group(1), body
                ))
                return
            if path == "/v1/protein-planner/vector-library/import/preview":
                self._send(200, self.planner.preview_library_import(body))
                return
            if path == "/v1/protein-planner/vector-library/import/commit":
                self._send(201, self.planner.commit_library_import(body))
                return
            if path == "/v1/protein-planner/vector-library/collections":
                self._send(201, self.planner.create_library_collection(body))
                return
            if path == "/v1/protein-planner/vector-library/bulk":
                self._send(200, self.planner.bulk_library_action(body))
                return
            if path == "/v1/protein-planner/vector-library/collections/order":
                self._send(200, self.planner.reorder_library_collections(body))
                return
            export_match = re.fullmatch(r"/v1/protein-planner/vector-library/([^/]+)/duplicate", path)
            if export_match:
                self._send(201, self.planner.duplicate_library_vector(export_match.group(1)))
                return
            restore_match = re.fullmatch(r"/v1/protein-planner/vector-library/([^/]+)/restore", path)
            if restore_match:
                self._send(200, self.planner.restore_library_vector(restore_match.group(1)))
                return
            # Vector Workbench: work on a construct without a project.
            if path == "/v1/protein-planner/vector-library":
                self._send(201, self.planner.create_library_vector(body))
                return
            contents_match = re.fullmatch(r"/v1/protein-planner/vector-library/([^/]+)/contents", path)
            if contents_match:
                self._send(200, self.planner.replace_library_vector(contents_match.group(1), body))
                return
            if path == "/v1/vector-workbench/parse":
                self._send(200, self.planner.parse_workbench_file(
                    str(body.get("filename") or "sequence.gb"), str(body.get("content") or "")
                ))
                return
            if path == "/v1/vector-workbench/export":
                self._send(200, self.planner.export_workbench_vector(body))
                return
            if path == "/v1/vector-workbench/analyze":
                self._send(200, self.planner.analyze_workbench_vector(body))
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
                r"/v1/protein-planner/proteins/([^/]+)/vectors/(cloning-preview|gel)",
                path,
            )
            if match:
                protein_id, action = match.groups()
                value = (
                    self.planner.simulate_expression_cloning(protein_id, body)
                    if action == "cloning-preview"
                    else self.planner.simulate_expression_vector_gel(protein_id, body)
                )
                self._send(200, value)
                return
            match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/vectors/([^/]+)/"
                r"(auto-annotate|primers|edit|digest|enzyme-sets|align|insertion-sites|insert)",
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
                elif action == "enzyme-sets":
                    value = self.planner.analyze_expression_vector_enzymes(
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
                elif action == "conservation/consurf-job":
                    self._send(201, self.planner.prepare_consurf_job(protein_id))
                elif action == "conservation/consurf-db":
                    self._send(200, self.planner.lookup_consurf_db(
                        protein_id,
                        str(body.get("pdbId") or ""),
                        str(body.get("chain") or ""),
                    ))
                elif action == "conservation/import":
                    grades_path = str(body.get("gradesPath") or "").strip()
                    if not grades_path:
                        raise ValueError("A ConSurf grades file path is required")
                    self._send(201, self.planner.import_consurf_result(
                        protein_id,
                        grades_path,
                        str(body.get("msaPath") or ""),
                        str(body.get("jobId") or ""),
                    ))
                elif action == "crystallization/assess":
                    self._send(200, self.planner.crystallization_assessment(protein_id))
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
            tree_link_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/links/([^/]+)", path
            )
            collection_match = re.fullmatch(r"/v1/protein-planner/vector-library/collections/([^/]+)", path)
            if collection_match:
                self._send(200, self.planner.update_library_collection(collection_match.group(1), self._read_json()))
                return
            tag_match = re.fullmatch(r"/v1/protein-planner/vector-library/tags/([^/]+)", path)
            if tag_match:
                self._send(200, self.planner.rename_library_tag(tag_match.group(1), self._read_json()))
                return
            if tree_link_match:
                self._send(200, self.planner.project_trees.update_link(
                    tree_link_match.group(1),
                    tree_link_match.group(2),
                    self._read_json(),
                ))
                return
            tree_branch_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/branches/([^/]+)",
                path,
            )
            if tree_branch_match:
                tree_id, branch_id = tree_branch_match.groups()
                fields = self._read_json()
                if "note" in fields and "description" not in fields:
                    fields["description"] = fields["note"]
                self.planner.project_trees.update_link(
                    tree_id, branch_id, fields
                )
                self._send(200, self.planner.project_trees.get_tree(tree_id))
                return
            tree_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)", path
            )
            if tree_match:
                self._send(200, self.planner.project_trees.rename_tree(
                    tree_match.group(1), self._read_json()
                ))
                return
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
                self._send(200, self.planner.update_library_vector(library_match.group(1), self._read_json()))
                return
            protein_library_match = re.fullmatch(
                r"/v1/protein-planner/protein-library/([^/]+)", path
            )
            if protein_library_match:
                self._send(200, self.planner.update_library_protein(
                    protein_library_match.group(1), self._read_json()
                ))
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

    def do_PUT(self) -> None:
        try:
            path, _ = self._path_and_query()
            if path == "/v1/protein-planner/vector-library/collections/order":
                self._send(200, self.planner.reorder_library_collections(self._read_json()))
                return
            self._send(404, {"error": "Endpoint not found"})
        except Exception as error:
            self._handle_error(error)

    def do_DELETE(self) -> None:
        try:
            path, _ = self._path_and_query()
            tree_link_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/links/([^/]+)", path
            )
            collection_match = re.fullmatch(r"/v1/protein-planner/vector-library/collections/([^/]+)", path)
            if collection_match:
                self._send(200, self.planner.delete_library_collection(collection_match.group(1)))
                return
            if tree_link_match:
                self.planner.project_trees.delete_link(
                    tree_link_match.group(1), tree_link_match.group(2)
                )
                self._send(200, {"deleted": tree_link_match.group(2)})
                return
            tree_branch_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)/branches/([^/]+)",
                path,
            )
            if tree_branch_match:
                tree_id, branch_id = tree_branch_match.groups()
                self.planner.project_trees.delete_link(tree_id, branch_id)
                self._send(200, self.planner.project_trees.get_tree(tree_id))
                return
            tree_match = re.fullmatch(
                r"/v1/protein-planner/project-trees/([^/]+)", path
            )
            if tree_match:
                self.planner.project_trees.delete_tree(tree_match.group(1))
                self._send(200, {"deleted": tree_match.group(1)})
                return
            library_match = re.fullmatch(
                r"/v1/protein-planner/vector-library/([^/]+)", path
            )
            if library_match:
                self._send(200, self.planner.delete_library_vector(library_match.group(1)))
                return
            protein_library_match = re.fullmatch(
                r"/v1/protein-planner/protein-library/([^/]+)", path
            )
            if protein_library_match:
                self.planner.delete_library_protein(protein_library_match.group(1))
                self._send(200, {"deleted": protein_library_match.group(1)})
                return
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
            conservation_match = re.fullmatch(
                r"/v1/protein-planner/proteins/([^/]+)/conservation/([^/]+)", path
            )
            if conservation_match:
                self._send(200, self.planner.delete_conservation(
                    *conservation_match.groups()
                ))
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
            r"/v1/protein-planner/proteins/([^/]+)/(analyze|blast|research|pdb/search|uniprot/search|uniprot/fetch|uniprot/match|alphafold/db|alphafold/server-job|alphafold/import|conservation/consurf-job|conservation/consurf-db|conservation/import|crystallization/assess|jobs|notebook)",
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
        if isinstance(error, PermissionError):
            self._send(403, {"error": "read_only", "type": error.__class__.__name__})
        elif isinstance(error, (SequenceValidationError, ValueError, TypeError, json.JSONDecodeError)):
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
        PDBeSIFTSClient(http),
        ConSurfDbClient(http),
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
