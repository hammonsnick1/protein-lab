"""Evidence-linked clients for BLAST, UniProt, PDB, and AlphaFold DB."""

from __future__ import annotations

from dataclasses import dataclass
import copy
from io import StringIO
import json
import re
import time
from typing import Any, Callable
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen
from xml.etree import ElementTree

from Bio.Align import PairwiseAligner, substitution_matrices
from Bio.PDB.MMCIF2Dict import MMCIF2Dict


class RemoteServiceError(RuntimeError):
    def __init__(self, service: str, message: str, status: int | None = None):
        super().__init__(f"{service}: {message}")
        self.service = service
        self.status = status


@dataclass(frozen=True)
class HttpResponse:
    status: int
    text: str
    headers: dict[str, str]


class HttpClient:
    """Small injectable HTTP client with an identifiable scientific user-agent."""

    def __init__(
        self,
        email: str = "",
        timeout: float = 45.0,
        transport: Callable[..., HttpResponse] | None = None,
    ):
        identity = email.strip() or "local-user"
        self.user_agent = f"ProteinLabs-ProteinPlanner/0.1 ({identity})"
        self.timeout = timeout
        self.transport = transport

    def request(
        self,
        method: str,
        url: str,
        *,
        params: dict[str, Any] | None = None,
        form: dict[str, Any] | None = None,
        json_body: dict[str, Any] | None = None,
        accept: str = "application/json",
        service: str = "Remote service",
        timeout: float | None = None,
        retry_attempts: int = 0,
    ) -> HttpResponse:
        if params:
            url = f"{url}?{urlencode(params, doseq=True)}"
        headers = {"Accept": accept, "User-Agent": self.user_agent}
        data: bytes | None = None
        if form is not None:
            data = urlencode(form).encode("utf-8")
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        elif json_body is not None:
            data = json.dumps(json_body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        # The default deliberately makes one request.  Some shared-client POST
        # callers submit remote jobs, so retry is opt-in and only used by RCSB
        # read/search traffic, whose requests are safe to repeat.
        retries = max(0, min(int(retry_attempts), 2))
        for attempt in range(retries + 1):
            response: HttpResponse | None = None
            try:
                if self.transport is not None:
                    response = self.transport(method, url, data=data, headers=headers)
                else:
                    request = Request(url, data=data, headers=headers, method=method)
                    with urlopen(request, timeout=timeout or self.timeout) as remote_response:
                        charset = remote_response.headers.get_content_charset() or "utf-8"
                        response = HttpResponse(
                            status=remote_response.status,
                            text=remote_response.read().decode(charset, errors="replace"),
                            headers=dict(remote_response.headers.items()),
                        )
                if 200 <= response.status < 300:
                    return response
                detail = response.text.strip()[:500]
                if response.status == 429:
                    detail = detail or "rate limited; please try again shortly"
                error = RemoteServiceError(service, detail or f"HTTP {response.status}", response.status)
            except HTTPError as caught:
                detail = caught.read().decode("utf-8", errors="replace")[:500]
                error = RemoteServiceError(service, detail or str(caught.reason), caught.code)
            except URLError as caught:
                error = RemoteServiceError(service, str(caught.reason))
            except (TimeoutError, ConnectionError, OSError) as caught:
                error = RemoteServiceError(service, str(caught))
            if error.status not in {None, 429, 500, 502, 503, 504} or attempt == retries:
                raise error
            retry_after = _number(response.headers.get("Retry-After")) if response else None
            time.sleep(min(4.0, retry_after if retry_after is not None else 0.25 * (2 ** attempt)))
        raise AssertionError("unreachable")  # pragma: no cover

    def json(self, method: str, url: str, **kwargs: Any) -> dict[str, Any]:
        response = self.request(method, url, **kwargs)
        try:
            value = json.loads(response.text)
        except json.JSONDecodeError as error:
            raise RemoteServiceError(
                str(kwargs.get("service", "Remote service")), "returned invalid JSON"
            ) from error
        if not isinstance(value, dict):
            raise RemoteServiceError(
                str(kwargs.get("service", "Remote service")),
                "returned an unexpected response",
            )
        return value


class NCBIBlastClient:
    endpoint = "https://blast.ncbi.nlm.nih.gov/Blast.cgi"
    ebi_base_url = "https://www.ebi.ac.uk/Tools/services/rest/ncbiblast"

    def __init__(self, http: HttpClient, email: str = ""):
        self.http = http
        self.email = email.strip()

    def submit(
        self, sequence: str, *, database: str = "swissprot", hitlist_size: int = 25
    ) -> dict[str, Any]:
        # EMBL-EBI rejects placeholder or local-only addresses. Fall back to
        # NCBI's public URL API when the desktop has no valid contact email.
        if self.email and re.fullmatch(r"[^@\s]+@[^@\s]+\.[^@\s]+", self.email):
            return self._submit_ebi(
                sequence, database=database, hitlist_size=hitlist_size
            )
        form: dict[str, Any] = {
            "CMD": "Put",
            "PROGRAM": "blastp",
            "DATABASE": database,
            "QUERY": sequence,
            "EXPECT": 10.0,
            "HITLIST_SIZE": max(1, min(int(hitlist_size), 100)),
            # NCBI now packages completed XML2 results as a ZIP archive.  The
            # classic XML response is still a documented URL-API format and is
            # returned as ordinary text, which keeps the desktop client small
            # and works with both queued and completed requests.
            "FORMAT_TYPE": "XML",
        }
        response = self.http.request(
            "POST", self.endpoint, form=form, accept="text/plain", service="NCBI BLAST"
        )
        rid = _match_line(response.text, "RID")
        rtoe = _match_line(response.text, "RTOE")
        if not rid:
            raise RemoteServiceError("NCBI BLAST", "submission did not return a request ID")
        return {
            "rid": rid,
            "estimatedSeconds": int(rtoe) if rtoe and rtoe.isdigit() else None,
            "database": database,
            "hitlistSize": form["HITLIST_SIZE"],
            "provider": "ncbi-url-api",
        }

    def poll(self, rid: str) -> dict[str, Any]:
        if rid.startswith("ncbiblast-"):
            return self._poll_ebi(rid)
        result_response = self.http.request(
            "GET",
            self.endpoint,
            params={"CMD": "Get", "RID": rid, "FORMAT_TYPE": "XML"},
            accept="application/xml",
            service="NCBI BLAST",
        )
        status_match = re.search(r"Status=(\w+)", result_response.text)
        status = status_match.group(1).upper() if status_match else ""
        if status == "WAITING":
            return {"rid": rid, "status": "waiting", "results": None}
        if status in {"FAILED", "UNKNOWN"}:
            return {
                "rid": rid,
                "status": status.lower(),
                "results": None,
                "error": "NCBI could not complete or find this BLAST request.",
            }
        text = result_response.text.strip()
        if not text or text.startswith("<!DOCTYPE html") or text.startswith("<html"):
            raise RemoteServiceError(
                "NCBI BLAST", "returned an unexpected result page without a job status"
            )
        return {
            "rid": rid,
            "status": "complete",
            "results": parse_blast_xml(result_response.text),
        }

    def _submit_ebi(
        self, sequence: str, *, database: str, hitlist_size: int
    ) -> dict[str, Any]:
        allowed_sizes = (5, 10, 20, 50, 100, 150)
        result_size = min(
            allowed_sizes, key=lambda value: abs(value - max(1, hitlist_size))
        )
        ebi_database = (
            "uniprotkb_swissprot" if database == "swissprot" else database
        )
        response = self.http.request(
            "POST",
            f"{self.ebi_base_url}/run",
            form={
                "email": self.email,
                "title": "Protein Labs sequence search",
                "program": "blastp",
                "stype": "protein",
                "sequence": sequence,
                "database": ebi_database,
                "alignments": result_size,
                "scores": result_size,
                "exp": 10,
            },
            accept="text/plain",
            service="EMBL-EBI NCBI BLAST",
        )
        rid = response.text.strip()
        if not rid.startswith("ncbiblast-"):
            raise RemoteServiceError(
                "EMBL-EBI NCBI BLAST", "submission did not return a job ID"
            )
        return {
            "rid": rid,
            "estimatedSeconds": 5,
            "database": ebi_database,
            "hitlistSize": result_size,
            "provider": "ebi-ncbiblast",
        }

    def _poll_ebi(self, rid: str) -> dict[str, Any]:
        response = self.http.request(
            "GET",
            f"{self.ebi_base_url}/status/{rid}",
            accept="text/plain",
            service="EMBL-EBI NCBI BLAST",
        )
        status = response.text.strip().upper()
        if status in {"PENDING", "RUNNING", "QUEUED"}:
            return {"rid": rid, "status": "waiting", "results": None}
        if status != "FINISHED":
            return {
                "rid": rid,
                "status": "failed",
                "results": None,
                "error": f"EMBL-EBI NCBI BLAST ended with status {status or 'UNKNOWN'}.",
            }
        raw = self.http.json(
            "GET",
            f"{self.ebi_base_url}/result/{rid}/json",
            service="EMBL-EBI NCBI BLAST",
        )
        return {
            "rid": rid,
            "status": "complete",
            "results": parse_ebi_blast_json(raw),
        }


class UniProtClient:
    base_url = "https://rest.uniprot.org/uniprotkb"
    peptide_search_url = "https://peptidesearch.uniprot.org/asyncrest/"

    def __init__(self, http: HttpClient):
        self.http = http

    def fetch(self, accession: str) -> dict[str, Any]:
        accession = accession.strip().upper()
        raw = self.http.json(
            "GET", f"{self.base_url}/{accession}.json", service="UniProt"
        )
        return normalize_uniprot(raw)

    def search(self, query: str, size: int = 10) -> list[dict[str, Any]]:
        raw = self.http.json(
            "GET",
            f"{self.base_url}/search",
            params={"query": query, "format": "json", "size": max(1, min(size, 50))},
            service="UniProt",
        )
        return [normalize_uniprot(item) for item in raw.get("results", [])]

    def fetch_many(self, accessions: list[str]) -> list[dict[str, Any]]:
        records: list[dict[str, Any]] = []
        unique = list(dict.fromkeys(accession.upper() for accession in accessions))
        for start in range(0, len(unique), 40):
            chunk = unique[start : start + 40]
            if not chunk:
                continue
            query = "(" + " OR ".join(
                f"accession:{accession}" for accession in chunk
            ) + ")"
            records.extend(self.search(query, size=len(chunk)))
        return records

    def find_sequence_matches(
        self, sequence: str, *, size: int = 25, hint: str = ""
    ) -> list[dict[str, Any]]:
        """Find reviewed candidates by peptide, then rank full-length alignments."""
        try:
            accessions = self._peptide_candidates(sequence)
        except RemoteServiceError:
            accessions = []
        records: list[dict[str, Any]] = []
        records.extend(self.fetch_many(accessions[:100]))
        if not records:
            words = [
                word
                for word in re.findall(r"[A-Za-z][A-Za-z0-9_-]+", hint)
                if word.lower()
                not in {"untitled", "protein", "construct", "sequence", "sample"}
            ][:5]
            if words:
                minimum = max(1, round(len(sequence) * 0.75))
                maximum = max(minimum, round(len(sequence) * 1.25))
                text_query = " AND ".join(words)
                records = self.search(
                    f"({text_query}) AND reviewed:true AND length:[{minimum} TO {maximum}]",
                    size=50,
                )
        scored: list[tuple[float, dict[str, Any]]] = []
        for record in records:
            target = str((record.get("sequence") or {}).get("value") or "")
            metrics = global_sequence_metrics(sequence, target)
            if metrics["identity"] < 0.3 or metrics["queryCoverage"] < 0.5:
                continue
            record["sequenceMatch"] = {
                **metrics,
                "method": "UniProt peptide candidates plus global pairwise alignment",
            }
            scored.append(
                (metrics["identity"] * metrics["queryCoverage"], record)
            )
        scored.sort(key=lambda item: item[0], reverse=True)
        return [record for _, record in scored[: max(1, min(size, 50))]]

    def _peptide_candidates(self, sequence: str) -> list[str]:
        peptides = representative_peptides(sequence)
        if not peptides:
            return []
        response = self.http.request(
            "POST",
            self.peptide_search_url,
            form={"peps": ",".join(peptides), "lEQi": "on", "spOnly": "on"},
            accept="application/json",
            service="UniProt peptide search",
            timeout=8,
        )
        location = next(
            (
                value
                for key, value in response.headers.items()
                if key.lower() == "location"
            ),
            "",
        ).replace("http://", "https://", 1)
        if not location:
            raise RemoteServiceError(
                "UniProt peptide search", "submission did not return a job location"
            )
        for _ in range(8):
            result = self.http.request(
                "GET",
                location,
                accept="application/json",
                service="UniProt peptide search",
                timeout=8,
            )
            if result.status == 200:
                return [
                    value.strip().upper()
                    for value in result.text.strip().strip('"').split(",")
                    if re.fullmatch(r"[A-Za-z0-9]{6,10}(?:-\d+)?", value.strip())
                ][:100]
            if result.status not in {202, 303}:
                raise RemoteServiceError(
                    "UniProt peptide search",
                    f"job returned HTTP {result.status}",
                    result.status,
                )
            time.sleep(1)
        raise RemoteServiceError(
            "UniProt peptide search", "candidate search did not finish in 8 seconds"
        )


class RCSBClient:
    search_url = "https://search.rcsb.org/rcsbsearch/v2/query"
    data_url = "https://data.rcsb.org/rest/v1/core"
    files_url = "https://files.rcsb.org/download"

    def __init__(self, http: HttpClient):
        self.http = http
        self._cache: dict[str, tuple[float, Any]] = {}

    def _cached(self, key: str) -> Any | None:
        item = self._cache.get(key)
        if item is None or item[0] <= time.monotonic():
            self._cache.pop(key, None)
            return None
        return copy.deepcopy(item[1])

    def _store(self, key: str, value: Any, ttl_seconds: float = 900) -> Any:
        self._cache[key] = (time.monotonic() + ttl_seconds, copy.deepcopy(value))
        return value

    def entry_ids_for_accession(self, accession: str, *, limit: int = 20) -> list[str]:
        """Return experimental entries cross-referenced to a UniProt accession."""
        accession = accession.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,19}", accession):
            raise ValueError("A valid UniProt accession is required")
        limit = max(1, min(int(limit), 50))
        key = f"accession:{accession}:{limit}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        raw = self.http.json(
            "POST",
            self.search_url,
            json_body={
                "query": {
                    "type": "terminal",
                    "service": "text",
                    "parameters": {
                        "attribute": "rcsb_polymer_entity_container_identifiers.reference_sequence_identifiers.database_accession",
                        "operator": "exact_match",
                        "value": accession,
                    },
                },
                "return_type": "entry",
                "request_options": {
                    "paginate": {"start": 0, "rows": limit},
                    "results_content_type": ["experimental"],
                    "sort": [{"sort_by": "score", "direction": "desc"}],
                },
            },
            service="RCSB PDB accession search",
            timeout=10,
        )
        identifiers = [
            str(result.get("identifier") or "").upper()
            for result in raw.get("result_set") or []
            if re.fullmatch(r"[0-9A-Za-z]{4}", str(result.get("identifier") or ""))
        ]
        return self._store(key, identifiers)

    def entry_metadata(self, pdb_id: str) -> dict[str, Any]:
        pdb_id = pdb_id.strip().upper()
        if not re.fullmatch(r"[0-9A-Z]{4}", pdb_id):
            raise ValueError("A valid four-character PDB ID is required")
        key = f"entry:{pdb_id}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        entry = self.http.json(
            "GET",
            f"{self.data_url}/entry/{pdb_id}",
            service="RCSB PDB data",
            timeout=10,
            retry_attempts=2,
        )
        experimental = entry.get("exptl") or []
        info = entry.get("rcsb_entry_info") or {}
        identifiers = entry.get("rcsb_entry_container_identifiers") or {}
        value = {
            "id": pdb_id,
            "source": "pdb",
            "format": "cif",
            "title": str((entry.get("struct") or {}).get("title") or ""),
            "method": "; ".join(
                str(item.get("method")) for item in experimental if item.get("method")
            ) or None,
            "resolutionAngstrom": min(info.get("resolution_combined") or [], default=None),
            "polymerEntityIds": [str(value) for value in identifiers.get("polymer_entity_ids") or []],
            "nonpolymerEntityIds": [str(value) for value in identifiers.get("non_polymer_entity_ids") or []],
            "sourceUrl": f"https://www.rcsb.org/structure/{pdb_id}",
        }
        return self._store(key, value)

    def fetch_mmcif(self, pdb_id: str) -> str:
        pdb_id = pdb_id.strip().upper()
        if not re.fullmatch(r"[0-9A-Z]{4}", pdb_id):
            raise ValueError("A valid four-character PDB ID is required")
        key = f"mmcif:{pdb_id}"
        cached = self._cached(key)
        if cached is not None:
            return cached
        response = self.http.request(
            "GET",
            f"{self.files_url}/{pdb_id}.cif",
            accept="text/plain",
            service="RCSB PDB files",
            timeout=15,
            retry_attempts=2,
        )
        if not response.text.lstrip().startswith("data_"):
            raise RemoteServiceError("RCSB PDB files", "returned an invalid mmCIF record")
        return self._store(key, response.text)

    def search_sequence(
        self,
        sequence: str,
        *,
        identity_cutoff: float = 0.3,
        evalue_cutoff: float = 1e-3,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        sequence = _normalize_pdb_query(sequence)
        payload = {
            "query": {
                "type": "terminal",
                "service": "sequence",
                "parameters": {
                    "evalue_cutoff": float(evalue_cutoff),
                    "identity_cutoff": float(identity_cutoff),
                    "sequence_type": "protein",
                    "value": sequence,
                },
            },
            "return_type": "polymer_entity",
            "request_options": {
                "paginate": {"start": 0, "rows": max(1, min(int(limit), 50))},
                "results_content_type": ["experimental"],
                # Without verbose results RCSB returns only identifiers and a
                # score, dropping the sequence identity and E-value.
                "results_verbosity": "verbose",
            },
        }
        raw = self.http.json(
            "POST", self.search_url, json_body=payload, service="RCSB PDB search",
            retry_attempts=2,
        )
        result_set = raw.get("result_set", [])
        if not isinstance(result_set, list):
            raise RemoteServiceError("RCSB PDB search", "returned an invalid result list")
        records: list[dict[str, Any]] = []
        seen: set[tuple[str, str]] = set()
        for result in result_set:
            if not isinstance(result, dict):
                continue
            identifier = str(result.get("identifier", ""))
            match = re.fullmatch(r"([0-9A-Za-z]{4})_(\d+)", identifier)
            if not match:
                continue
            pdb_id, entity_id = match.group(1).upper(), match.group(2)
            if (pdb_id, entity_id) in seen:
                continue
            seen.add((pdb_id, entity_id))
            services = result.get("services") or []
            first_service = services[0] if services and isinstance(services[0], dict) else {}
            nodes = first_service.get("nodes", []) if isinstance(first_service.get("nodes", []), list) else []
            first_node = nodes[0] if nodes and isinstance(nodes[0], dict) else {}
            match_context = first_node.get("match_context", []) if isinstance(first_node.get("match_context", []), list) else []
            context = match_context[0] if match_context else {}
            if not isinstance(context, dict):
                context = {}
            records.append(
                self.fetch_record(
                    pdb_id,
                    entity_id,
                    score=_number(result.get("score")),
                    identity=_number(context.get("sequence_identity")),
                    evalue=_number(context.get("evalue")),
                    query_sequence=sequence,
                )
            )
        # Closest structures first.
        records.sort(key=lambda record: (
            -(record.get("identity") or 0),
            -(record.get("coverage") or 0),
            record["pdbId"], record["entityId"],
        ))
        return records

    def fetch_record(
        self,
        pdb_id: str,
        entity_id: str,
        *,
        score: float | None = None,
        identity: float | None = None,
        evalue: float | None = None,
        query_sequence: str = "",
    ) -> dict[str, Any]:
        entry = self.http.json(
            "GET", f"{self.data_url}/entry/{pdb_id}", service="RCSB PDB data",
            retry_attempts=2,
        )
        entity = self.http.json(
            "GET",
            f"{self.data_url}/polymer_entity/{pdb_id}/{entity_id}",
            service="RCSB PDB data",
            retry_attempts=2,
        )
        conditions = parse_mmcif_conditions(self.fetch_mmcif(pdb_id))
        experimental = entry.get("exptl") or []
        entry_info = entry.get("rcsb_entry_info") or {}
        struct = entry.get("struct") or {}
        polymer = entity.get("rcsb_polymer_entity") or {}
        identifiers = entity.get("rcsb_polymer_entity_container_identifiers") or {}
        chain_ids = identifiers.get("auth_asym_ids") or identifiers.get("asym_ids") or []
        if not isinstance(chain_ids, list):
            chain_ids = []
        chain_ids = [str(value) for value in chain_ids if str(value).strip()]
        entity_sequence = re.sub(
            r"\s+", "", str((entity.get("entity_poly") or {}).get("pdbx_seq_one_letter_code_can") or "")
        )
        comparison = (
            local_alignment_metrics(query_sequence, entity_sequence)
            if query_sequence and entity_sequence
            else None
        )
        sources = (
            entity.get("rcsb_entity_source_organism")
            or entity.get("entity_src_nat")
            or entity.get("entity_src_gen")
            or []
        )
        return {
            "pdbId": pdb_id,
            "entityId": str(entity_id),
            # Stable Structure Viewer contract.  All metrics are fractions
            # (0..1); resolution is in Angstrom; chain IDs are author chain
            # IDs when RCSB supplies them.
            "chainId": chain_ids[0] if chain_ids else None,
            "chainIds": chain_ids,
            "score": score,
            # Identity and similarity come from our own BLOSUM62 alignment so
            # they are measured the same way; RCSB's identity is kept beside it.
            "identity": comparison["identity"] if comparison else identity,
            "similarity": comparison["similarity"] if comparison else None,
            "comparison": comparison,
            "coverage": comparison["queryCoverage"] if comparison else None,
            "rcsbIdentity": identity,
            "evalue": evalue,
            "entitySequenceLength": len(entity_sequence) or None,
            "title": struct.get("title", ""),
            "entityDescription": polymer.get("pdbx_description", ""),
            "uniprotIds": [str(value) for value in identifiers.get("uniprot_ids") or []],
            "experimentalMethods": [item.get("method") for item in experimental if item.get("method")],
            "resolutionAngstrom": _resolutions(entry_info.get("resolution_combined")),
            "method": "; ".join(str(item.get("method")) for item in experimental if item.get("method")) or None,
            "resolution": min(_resolutions(entry_info.get("resolution_combined")), default=None),
            "sourceOrganisms": _organism_names(sources),
            "crystallizationConditions": conditions["crystallizationConditions"],
            "purificationConditions": conditions["purificationConditions"],
            "source": {
                "provider": "RCSB Protein Data Bank",
                "entryUrl": f"https://www.rcsb.org/structure/{pdb_id}",
                "mmcifUrl": f"{self.files_url}/{pdb_id}.cif",
            },
        }


class AlphaFoldDBClient:
    """Retrieve current AlphaFold DB metadata and coordinates by UniProt ID."""

    api_url = "https://alphafold.ebi.ac.uk/api/prediction"

    def __init__(self, http: HttpClient):
        self.http = http
        self._cache: dict[str, tuple[float, dict[str, Any]]] = {}

    def fetch(self, accession: str) -> dict[str, Any]:
        accession = accession.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,19}", accession):
            raise ValueError("A valid UniProt accession is required")
        cached = self._cache.get(accession)
        if cached is not None and cached[0] > time.monotonic():
            return copy.deepcopy(cached[1])
        response = self.http.request(
            "GET",
            f"{self.api_url}/{accession}",
            service="AlphaFold Database",
        )
        try:
            raw = json.loads(response.text)
        except json.JSONDecodeError as error:
            raise RemoteServiceError(
                "AlphaFold Database", "returned invalid prediction metadata"
            ) from error
        predictions = raw if isinstance(raw, list) else [raw]
        prediction = next(
            (item for item in predictions if isinstance(item, dict)), None
        )
        if prediction is None:
            raise LookupError(
                f"AlphaFold DB does not contain a model for {accession}"
            )
        cif_url = str(prediction.get("cifUrl") or "").strip()
        if not cif_url.startswith("https://"):
            raise RemoteServiceError(
                "AlphaFold Database", "prediction metadata did not include a CIF file"
            )
        coordinates = self.http.request(
            "GET",
            cif_url,
            accept="text/plain",
            service="AlphaFold Database coordinates",
            timeout=90,
        ).text
        geometry = parse_structure_geometry(coordinates, "cif")
        model_id = str(
            prediction.get("entryId") or f"AF-{accession}-F1"
        ).strip()
        value = {
            "modelId": model_id,
            "accession": str(prediction.get("uniprotAccession") or accession),
            "name": str(
                prediction.get("uniprotDescription")
                or prediction.get("uniprotId")
                or model_id
            ),
            "source": "AlphaFold DB",
            "format": "cif",
            "structureText": coordinates,
            "metadata": {
                **prediction,
                "entryUrl": f"https://alphafold.ebi.ac.uk/entry/{model_id}",
                "coordinateUrl": cif_url,
                "meanPlddt": geometry["meanPlddt"],
                "residueCount": geometry["residueCount"],
                "chainCount": geometry["chainCount"],
                "previewGeometry": structure_preview(geometry),
            },
        }
        self._cache[accession] = (time.monotonic() + 900, copy.deepcopy(value))
        return value


class PDBeSIFTSClient:
    """Small fail-fast client for accession-to-residue SIFTS segments."""

    mappings_url = "https://www.ebi.ac.uk/pdbe/api/mappings/all_isoforms"

    def __init__(self, http: HttpClient):
        self.http = http
        self._cache: dict[str, tuple[float, list[dict[str, Any]]]] = {}

    def mappings_for_accession(self, accession: str) -> list[dict[str, Any]]:
        accession = accession.strip().upper()
        if not re.fullmatch(r"[A-Z0-9][A-Z0-9-]{1,19}", accession):
            raise ValueError("A valid UniProt accession is required")
        cached = self._cache.get(accession)
        if cached is not None and cached[0] > time.monotonic():
            return copy.deepcopy(cached[1])
        raw = self.http.json(
            "GET",
            f"{self.mappings_url}/{accession}",
            service="PDBe SIFTS mappings",
            timeout=10,
        )
        segments: list[dict[str, Any]] = []
        # Accession-oriented all_isoforms response:
        # {accession: {"PDB": {pdb_id: [mapping, ...]}}}
        accession_entry = raw.get(accession) or raw.get(accession.lower())
        if isinstance(accession_entry, dict) and isinstance(accession_entry.get("PDB"), dict):
            for pdb_id, mappings in accession_entry["PDB"].items():
                for mapping in mappings or []:
                    if isinstance(mapping, dict):
                        segments.append(self._segment(pdb_id, accession, mapping))
        # Retain compatibility with the entry-oriented SIFTS response used by
        # older PDBe deployments and offline fixtures.
        for pdb_id, entry in raw.items():
            if not isinstance(entry, dict):
                continue
            uniprot_records = entry.get("UniProt") or entry.get("uniprot") or {}
            if isinstance(uniprot_records, dict):
                records = uniprot_records.items()
            else:
                records = []
            for mapped_accession, record in records:
                if str(mapped_accession).upper() != accession or not isinstance(record, dict):
                    continue
                for mapping in record.get("mappings") or []:
                    if not isinstance(mapping, dict):
                        continue
                    segments.append(self._segment(pdb_id, accession, mapping))
        self._cache[accession] = (time.monotonic() + 900, copy.deepcopy(segments))
        return segments

    @staticmethod
    def _segment(pdb_id: str, accession: str, mapping: dict[str, Any]) -> dict[str, Any]:
        return {
            "pdbId": str(pdb_id).upper(),
            "accession": accession,
            "entityId": str(mapping.get("entity_id") or ""),
            "chainId": str(mapping.get("chain_id") or ""),
            "structAsymId": str(mapping.get("struct_asym_id") or ""),
            "uniprotStart": mapping.get("unp_start"),
            "uniprotEnd": mapping.get("unp_end"),
            "start": {
                "residueNumber": (mapping.get("start") or {}).get("residue_number"),
                "authorResidueNumber": (mapping.get("start") or {}).get("author_residue_number"),
                "authorInsertionCode": (mapping.get("start") or {}).get("author_insertion_code") or None,
            },
            "end": {
                "residueNumber": (mapping.get("end") or {}).get("residue_number"),
                "authorResidueNumber": (mapping.get("end") or {}).get("author_residue_number"),
                "authorInsertionCode": (mapping.get("end") or {}).get("author_insertion_code") or None,
            },
        }


def _match_line(text: str, key: str) -> str | None:
    match = re.search(rf"^\s*{re.escape(key)}\s*=\s*(\S+)", text, re.MULTILINE)
    return match.group(1) if match else None


def representative_peptides(
    sequence: str, *, peptide_length: int = 15, count: int = 4
) -> list[str]:
    """Return evenly distributed sequence-only probes for UniProt peptide search."""
    sequence = sequence.strip().upper()
    if len(sequence) < 7:
        return []
    length = min(max(7, peptide_length), len(sequence))
    last_start = len(sequence) - length
    if last_start == 0 or count <= 1:
        return [sequence]
    starts = {
        round(index * last_start / (count - 1)) for index in range(max(2, count))
    }
    return [sequence[start : start + length] for start in sorted(starts)]


_BLOSUM62 = substitution_matrices.load("BLOSUM62")


def local_alignment_metrics(query: str, target: str) -> dict[str, Any] | None:
    """Compare two proteins the way BLAST reports a hit.

    A local alignment scored with BLOSUM62 and BLAST's default gap costs
    (11 to open, 1 per residue; Biopython charges the first residue as the
    opening, hence -12/-1). Identity counts identical residues and similarity
    counts identical or conservative ones (positive BLOSUM62 score), both as
    fractions of the aligned length including gaps, matching BLAST's
    Identities and Positives.
    """
    alphabet = set(_BLOSUM62.alphabet)
    query = "".join(residue if residue in alphabet else "X" for residue in query.upper())
    target = "".join(residue if residue in alphabet else "X" for residue in target.upper())
    if not query or not target:
        return None
    aligner = PairwiseAligner(
        mode="local",
        substitution_matrix=_BLOSUM62,
        open_gap_score=-12,
        extend_gap_score=-1,
    )
    alignment = aligner.align(query, target)[0]
    query_blocks, target_blocks = alignment.aligned
    if not len(query_blocks):
        return None
    identities = positives = paired = 0
    for (query_start, query_end), (target_start, target_end) in zip(query_blocks, target_blocks):
        for a, b in zip(query[query_start:query_end], target[target_start:target_end]):
            identities += a == b
            positives += a == b or _BLOSUM62[a][b] > 0
        paired += int(query_end) - int(query_start)
    gaps = sum(
        int(query_blocks[index + 1][0]) - int(query_blocks[index][1])
        + int(target_blocks[index + 1][0]) - int(target_blocks[index][1])
        for index in range(len(query_blocks) - 1)
    )
    length = paired + gaps
    query_start, query_end = int(query_blocks[0][0]), int(query_blocks[-1][1])
    return {
        "method": "Local alignment, BLOSUM62, gap open 11 / extend 1",
        "identity": identities / length,
        "similarity": positives / length,
        "identities": identities,
        "positives": positives,
        "gaps": gaps,
        "alignmentLength": length,
        "queryStart": query_start + 1,
        "queryEnd": query_end,
        "queryLength": len(query),
        "queryCoverage": (query_end - query_start) / len(query),
        "targetStart": int(target_blocks[0][0]) + 1,
        "targetEnd": int(target_blocks[-1][1]),
        "targetLength": len(target),
    }


def global_sequence_metrics(query: str, target: str) -> dict[str, float]:
    """Calculate reproducible identity and query coverage for two proteins."""
    if not query or not target:
        return {"identity": 0.0, "queryCoverage": 0.0}
    aligner = PairwiseAligner(
        mode="global",
        match_score=2,
        mismatch_score=-1,
        open_gap_score=-5,
        extend_gap_score=-1,
    )
    alignment = aligner.align(query, target)[0]
    aligned_query = sum(
        int(end) - int(start) for start, end in alignment.aligned[0]
    )
    counts = alignment.counts()
    return {
        "identity": counts.identities / max(1, counts.aligned),
        "queryCoverage": aligned_query / len(query),
    }


def _number(value: Any) -> float | None:
    try:
        return None if value is None else float(value)
    except (TypeError, ValueError):
        return None


def _normalize_pdb_query(sequence: str) -> str:
    """Validate an RCSB protein sequence query before it reaches the network."""
    normalized = re.sub(r"\s+", "", str(sequence).upper())
    # RCSB's protein sequence service rejects values below ten residues.
    # Validate locally so the desktop can explain short-peptide failures
    # without showing an upstream JSON error.
    if len(normalized) < 10:
        raise ValueError("PDB sequence search requires at least 10 standard amino-acid residues")
    if len(normalized) > 10_000:
        raise ValueError("PDB sequence search supports at most 10,000 residues per query")
    nonstandard = sorted(set(normalized) - set("ACDEFGHIKLMNPQRSTVWY"))
    if nonstandard:
        raise ValueError(
            "PDB sequence search accepts standard amino-acid residues only; "
            f"found {''.join(nonstandard)}"
        )
    return normalized


def _resolutions(value: Any) -> list[float]:
    """Keep only numeric RCSB resolutions, which are reported in Angstrom."""
    values = value if isinstance(value, list) else []
    return [number for item in values if (number := _number(item)) is not None]


def _uniprot_accession(accession: str, hit_id: str) -> str | None:
    for value in (accession, hit_id):
        match = re.search(r"(?:sp|tr)\|([A-Z0-9]+)\|", value, re.IGNORECASE)
        if match:
            return match.group(1).upper()
    clean = accession.strip().upper()
    if re.fullmatch(r"[A-Z0-9]{6,10}(?:-\d+)?", clean):
        return clean
    return None


def parse_blast_xml(xml_text: str) -> list[dict[str, Any]]:
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as error:
        raise RemoteServiceError("NCBI BLAST", "returned invalid XML") from error
    query_length = int(root.findtext(".//BlastOutput_query-len", "0") or 0)
    results: list[dict[str, Any]] = []
    for hit in root.findall(".//Hit"):
        hsp = hit.find(".//Hsp")
        if hsp is None:
            continue
        align_length = int(hsp.findtext("Hsp_align-len", "0") or 0)
        identities = int(hsp.findtext("Hsp_identity", "0") or 0)
        query_from = int(hsp.findtext("Hsp_query-from", "0") or 0)
        query_to = int(hsp.findtext("Hsp_query-to", "0") or 0)
        accession = hit.findtext("Hit_accession", "")
        hit_id = hit.findtext("Hit_id", "")
        results.append(
            {
                "rank": len(results) + 1,
                "accession": accession,
                "uniprotAccession": _uniprot_accession(accession, hit_id),
                "hitId": hit_id,
                "description": hit.findtext("Hit_def", ""),
                "hitLength": int(hit.findtext("Hit_len", "0") or 0),
                "identity": identities / align_length if align_length else None,
                "queryCoverage": (
                    (abs(query_to - query_from) + 1) / query_length if query_length else None
                ),
                "evalue": _number(hsp.findtext("Hsp_evalue")),
                "bitScore": _number(hsp.findtext("Hsp_bit-score")),
                "alignmentLength": align_length,
                "queryStart": query_from,
                "queryEnd": query_to,
            }
        )
    return results


def parse_blast_xml2(xml_text: str) -> list[dict[str, Any]]:
    """Parse the currently supported NCBI BLAST XML2 result format."""
    try:
        root = ElementTree.fromstring(xml_text)
    except ElementTree.ParseError as error:
        raise RemoteServiceError("NCBI BLAST", "returned invalid XML2") from error
    query_length = int(root.findtext(".//{*}query-len", "0") or 0)
    results: list[dict[str, Any]] = []
    for hit in root.findall(".//{*}Hit"):
        description = hit.find("./{*}description/{*}HitDescr")
        hsp = hit.find("./{*}hsps/{*}Hsp")
        if description is None or hsp is None:
            continue
        accession = description.findtext("./{*}accession", "")
        hit_id = description.findtext("./{*}id", "")
        align_length = int(hsp.findtext("./{*}align-len", "0") or 0)
        identities = int(hsp.findtext("./{*}identity", "0") or 0)
        query_from = int(hsp.findtext("./{*}query-from", "0") or 0)
        query_to = int(hsp.findtext("./{*}query-to", "0") or 0)
        results.append(
            {
                "rank": len(results) + 1,
                "accession": accession,
                "uniprotAccession": _uniprot_accession(accession, hit_id),
                "description": description.findtext("./{*}title", ""),
                "scientificName": description.findtext("./{*}sciname", ""),
                "taxonId": _integer_or_none(
                    description.findtext("./{*}taxid", "")
                ),
                "length": int(hit.findtext("./{*}len", "0") or 0),
                "bitScore": float(hsp.findtext("./{*}bit-score", "0") or 0),
                "evalue": float(hsp.findtext("./{*}evalue", "inf") or "inf"),
                "identity": identities / align_length if align_length else None,
                "queryCoverage": (
                    (abs(query_to - query_from) + 1) / query_length
                    if query_length and query_from and query_to
                    else None
                ),
                "alignmentLength": align_length,
            }
        )
    return results


def parse_ebi_blast_json(raw: dict[str, Any]) -> list[dict[str, Any]]:
    """Normalize EMBL-EBI Job Dispatcher output from the NCBI BLAST+ tool."""
    query_length = int(raw.get("query_len") or 0)
    results: list[dict[str, Any]] = []
    for hit in raw.get("hits") or []:
        hsps = hit.get("hit_hsps") or []
        if not hsps:
            continue
        hsp = hsps[0]
        query_from = int(hsp.get("hsp_query_from") or 0)
        query_to = int(hsp.get("hsp_query_to") or 0)
        accession = str(hit.get("hit_acc") or "")
        hit_id = str(hit.get("hit_id") or "")
        identity = _number(hsp.get("hsp_identity"))
        results.append(
            {
                "rank": int(hit.get("hit_num") or len(results) + 1),
                "accession": accession,
                "uniprotAccession": _uniprot_accession(accession, hit_id),
                "description": str(hit.get("hit_desc") or hit.get("hit_def") or ""),
                "scientificName": str(hit.get("hit_os") or ""),
                "taxonId": _integer_or_none(str(hit.get("hit_uni_ox") or "")),
                "length": int(hit.get("hit_len") or 0),
                "bitScore": _number(hsp.get("hsp_bit_score")),
                "evalue": _number(hsp.get("hsp_expect")),
                "identity": identity / 100 if identity is not None else None,
                "queryCoverage": (
                    (abs(query_to - query_from) + 1) / query_length
                    if query_length and query_from and query_to
                    else None
                ),
                "alignmentLength": int(hsp.get("hsp_align_len") or 0),
            }
        )
    return results


def _integer_or_none(value: str) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _full_name(description: dict[str, Any]) -> str:
    recommended = description.get("recommendedName") or {}
    submitted = description.get("submissionNames") or []
    alternative = description.get("alternativeNames") or []
    candidates = [recommended, *(submitted[:1]), *(alternative[:1])]
    for candidate in candidates:
        value = (candidate.get("fullName") or {}).get("value")
        if value:
            return str(value)
    return ""


PTM_TYPES = {
    "Modified residue",
    "Glycosylation",
    "Lipidation",
    "Disulfide bond",
    "Cross-link",
    "Initiator methionine",
    "Peptide",
    "Propeptide",
    "Signal peptide",
    "Chain",
}


def _feature_location(location: dict[str, Any]) -> dict[str, int | None]:
    def position(key: str) -> int | None:
        value = location.get(key) or {}
        return value.get("value") if isinstance(value.get("value"), int) else None

    return {"start": position("start"), "end": position("end")}


def normalize_uniprot(raw: dict[str, Any]) -> dict[str, Any]:
    organism = raw.get("organism") or {}
    genes = raw.get("genes") or []
    features = raw.get("features") or []
    comments = raw.get("comments") or []
    accession = str(raw.get("primaryAccession") or raw.get("uniProtkbId") or "")

    def normalized_feature(feature: dict[str, Any]) -> dict[str, Any]:
        return {
            "type": feature.get("type"),
            "description": feature.get("description", ""),
            "location": _feature_location(feature.get("location") or {}),
            "evidences": feature.get("evidences") or [],
            "featureId": feature.get("featureId"),
        }

    location_comments = [
        comment for comment in comments
        if comment.get("commentType") == "SUBCELLULAR LOCATION"
    ]
    cofactor_comments = [
        comment for comment in comments
        if comment.get("commentType") == "COFACTOR"
    ]
    return {
        "accession": accession,
        "entryId": raw.get("uniProtkbId", ""),
        "reviewed": raw.get("entryType") == "UniProtKB reviewed (Swiss-Prot)",
        "proteinName": _full_name(raw.get("proteinDescription") or {}),
        "genes": [
            gene.get("geneName", {}).get("value")
            for gene in genes
            if gene.get("geneName", {}).get("value")
        ],
        "organism": {
            "scientificName": organism.get("scientificName", ""),
            "commonName": organism.get("commonName", ""),
            "taxonId": organism.get("taxonId"),
        },
        "sequence": {
            "value": (raw.get("sequence") or {}).get("value", ""),
            "length": (raw.get("sequence") or {}).get("length"),
            "molecularWeightDa": (raw.get("sequence") or {}).get("molWeight"),
            "checksum": (raw.get("sequence") or {}).get("crc64"),
        },
        "postTranslationalModifications": [
            normalized_feature(feature)
            for feature in features
            if feature.get("type") in PTM_TYPES
        ],
        "transmembraneRegions": [
            normalized_feature(feature)
            for feature in features
            if feature.get("type") in {"Transmembrane", "Intramembrane"}
        ],
        "disorderedRegions": [
            normalized_feature(feature)
            for feature in features
            if feature.get("type") == "Disordered"
            or (
                feature.get("type") == "Region"
                and "disorder" in str(feature.get("description") or "").lower()
            )
        ],
        "bindingSites": [
            normalized_feature(feature)
            for feature in features
            if feature.get("type") in {"Binding site", "Active site", "Metal binding"}
        ],
        "domains": [
            normalized_feature(feature)
            for feature in features
            if feature.get("type") in {"Domain", "Repeat", "Region", "Motif"}
            and not (
                feature.get("type") == "Region"
                and "disorder" in str(feature.get("description") or "").lower()
            )
        ],
        "subcellularLocations": [
            {
                "location": (item.get("location") or {}).get("value", ""),
                "topology": (item.get("topology") or {}).get("value", ""),
                "orientation": (item.get("orientation") or {}).get("value", ""),
                "evidences": item.get("evidences") or [],
            }
            for comment in location_comments
            for item in comment.get("subcellularLocations") or []
        ],
        "cofactors": [
            {
                "name": item.get("name", ""),
                "chebiId": item.get("chebiId", ""),
                "evidences": item.get("evidences") or [],
            }
            for comment in cofactor_comments
            for item in comment.get("cofactors") or []
        ],
        "comments": [
            {
                "type": comment.get("commentType"),
                "texts": [text.get("value") for text in comment.get("texts", []) if text.get("value")],
            }
            for comment in comments
        ],
        "pdbCrossReferences": [
            reference
            for reference in raw.get("uniProtKBCrossReferences", [])
            if reference.get("database") == "PDB"
        ],
        "source": {
            "provider": "UniProtKB",
            "url": f"https://www.uniprot.org/uniprotkb/{accession}/entry",
        },
    }


def _as_list(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def _clean_cif_value(value: Any) -> Any:
    if isinstance(value, list):
        return [_clean_cif_value(item) for item in value]
    return None if value in {"?", ".", ""} else value


def _cif_category(cif: dict[str, Any], prefix: str) -> list[dict[str, Any]]:
    keys = [key for key in cif if key.startswith(prefix)]
    if not keys:
        return []
    columns = {key[len(prefix):]: _as_list(cif[key]) for key in keys}
    size = max(len(values) for values in columns.values())
    rows: list[dict[str, Any]] = []
    for index in range(size):
        row = {
            name: _clean_cif_value(values[index] if index < len(values) else None)
            for name, values in columns.items()
        }
        rows.append({key: value for key, value in row.items() if value is not None})
    return rows


def parse_structure_geometry(text: str, file_format: str) -> dict[str, Any]:
    """Return a compact C-alpha trace suitable for the native 3D viewer."""
    normalized_format = file_format.lower().lstrip(".")
    points: list[dict[str, Any]] = []
    if normalized_format in {"cif", "mmcif"}:
        try:
            cif = MMCIF2Dict(StringIO(text))
        except Exception as error:
            raise ValueError("The AlphaFold mmCIF file could not be parsed") from error
        atoms = _cif_category(cif, "_atom_site.")
        for atom in atoms:
            atom_name = str(
                atom.get("auth_atom_id") or atom.get("label_atom_id") or ""
            ).strip()
            group = str(atom.get("group_PDB") or "ATOM").strip().upper()
            alt_id = str(atom.get("label_alt_id") or "").strip()
            if atom_name != "CA" or group != "ATOM" or alt_id not in {"", "A"}:
                continue
            x = _number(atom.get("Cartn_x"))
            y = _number(atom.get("Cartn_y"))
            z = _number(atom.get("Cartn_z"))
            if x is None or y is None or z is None:
                continue
            points.append({
                "x": round(x, 3),
                "y": round(y, 3),
                "z": round(z, 3),
                "chain": str(
                    atom.get("auth_asym_id") or atom.get("label_asym_id") or "A"
                ),
                "residue": str(
                    atom.get("auth_seq_id") or atom.get("label_seq_id") or len(points) + 1
                ),
                "name": str(atom.get("label_comp_id") or ""),
                "plddt": _number(atom.get("B_iso_or_equiv")),
            })
    elif normalized_format == "pdb":
        for line in text.splitlines():
            if not line.startswith("ATOM") or len(line) < 54:
                continue
            if line[12:16].strip() != "CA" or line[16:17].strip() not in {"", "A"}:
                continue
            try:
                x, y, z = float(line[30:38]), float(line[38:46]), float(line[46:54])
            except ValueError:
                continue
            try:
                plddt = float(line[60:66])
            except (ValueError, IndexError):
                plddt = None
            points.append({
                "x": round(x, 3),
                "y": round(y, 3),
                "z": round(z, 3),
                "chain": line[21:22].strip() or "A",
                "residue": line[22:27].strip() or str(len(points) + 1),
                "name": line[17:20].strip(),
                "plddt": plddt,
            })
    else:
        raise ValueError("AlphaFold results must contain an mmCIF or PDB model")

    if not points:
        raise ValueError("The structure does not contain any protein C-alpha atoms")
    confidence = [
        float(point["plddt"])
        for point in points
        if isinstance(point.get("plddt"), (int, float))
    ]
    chains = list(dict.fromkeys(str(point["chain"]) for point in points))
    return {
        "points": points,
        "residueCount": len(points),
        "chainCount": len(chains),
        "chains": chains,
        "meanPlddt": (
            round(sum(confidence) / len(confidence), 2) if confidence else None
        ),
    }


def structure_preview(
    geometry: dict[str, Any], *, maximum_points: int = 180
) -> dict[str, Any]:
    """Downsample viewer geometry for fast project-card thumbnails."""
    points = list(geometry.get("points") or [])
    if len(points) > maximum_points:
        step = max(1, (len(points) + maximum_points - 1) // maximum_points)
        sampled = points[::step]
        if sampled[-1] is not points[-1]:
            sampled.append(points[-1])
        points = sampled
    return {
        "points": points,
        "residueCount": geometry.get("residueCount"),
        "chainCount": geometry.get("chainCount"),
        "chains": geometry.get("chains") or [],
        "meanPlddt": geometry.get("meanPlddt"),
    }


PURIFICATION_PATTERN = re.compile(
    r"\b(purif(?:y|ied|ication)|chromatograph(?:y|ic))\b",
    re.IGNORECASE,
)


def parse_mmcif_conditions(text: str) -> dict[str, Any]:
    try:
        cif = MMCIF2Dict(StringIO(text))
    except Exception as error:
        raise RemoteServiceError("RCSB PDB files", "could not parse the mmCIF record") from error

    grow = _cif_category(cif, "_exptl_crystal_grow.")
    components = _cif_category(cif, "_exptl_crystal_grow_comp.")
    nmr = _cif_category(cif, "_pdbx_nmr_exptl_sample_conditions.")
    crystallization = {
        "status": "reported" if grow or components or nmr else "not_reported",
        "crystalGrowth": grow,
        "components": components,
        "nmrSampleConditions": nmr,
        "evidence": [
            {
                "source": "PDB mmCIF",
                "categories": [
                    category
                    for category, present in (
                        ("_exptl_crystal_grow", bool(grow)),
                        ("_exptl_crystal_grow_comp", bool(components)),
                        ("_pdbx_nmr_exptl_sample_conditions", bool(nmr)),
                    )
                    if present
                ],
            }
        ] if grow or components or nmr else [],
    }

    purification_evidence: list[dict[str, str]] = []
    for key, raw_value in cif.items():
        if key.startswith(("_exptl_crystal_grow", "_pdbx_nmr_exptl_sample_conditions")):
            continue
        for value in _as_list(raw_value):
            cleaned = str(_clean_cif_value(value) or "").strip()
            if cleaned and PURIFICATION_PATTERN.search(cleaned):
                purification_evidence.append(
                    {"source": "PDB mmCIF", "field": key, "reportedText": cleaned}
                )
    purification = {
        "status": "reported" if purification_evidence else "not_reported",
        "evidence": purification_evidence,
        "note": (
            "Only deposition text explicitly describing purification is included. "
            "The PDB does not require a standardized purification-buffer field."
        ),
    }
    return {
        "crystallizationConditions": crystallization,
        "purificationConditions": purification,
    }


def _organism_names(rows: Any) -> list[str]:
    names: list[str] = []
    for row in _as_list(rows):
        if not isinstance(row, dict):
            continue
        name = row.get("ncbi_scientific_name") or row.get("pdbx_gene_src_scientific_name")
        if name and name not in names:
            names.append(str(name))
    return names
