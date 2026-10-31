"""Protein Planner application service."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
from typing import Any
import uuid
import zipfile

from .database import Database, utc_now
from .integrations import (
    AlphaFoldDBClient,
    NCBIBlastClient,
    PDBeSIFTSClient,
    RCSBClient,
    RemoteServiceError,
    UniProtClient,
    global_sequence_metrics,
    parse_structure_geometry,
    structure_preview,
)
from .structures import build_residue_mapping, compute_regions, summarize_structure
from .protparam import analyze_sequence, normalize_sequence
from .project_trees import ProjectTreeService
from ..expression_planner import (
    COMMON_ENZYMES,
    align_dna_sequences,
    annotate_with_plannotate,
    assemble_by_overlap,
    apply_sequence_operation,
    automatic_annotations,
    design_pcr_primers,
    export_sequence,
    normalize_dna,
    normalize_features,
    normalize_primers,
    parse_sequence_file,
    simulate_restriction_digest,
    vector_preview,
)
from ..construct_builder import (
    CODON_PREFERENCES,
    available_hosts,
    back_translate,
    insert_target_sequence,
    insertion_sites,
)
from ..vector_engine import (
    assembly_warnings,
    enzyme_analysis,
    gateway_preview,
    optimize_codons,
    restriction_ligation_preview,
    simulate_gel,
)
from ..vector_sources import (
    describe_sources,
    fetch_vector,
    list_snapgene_sets,
    search_vectors,
)


class ProteinPlanner:
    def __init__(
        self,
        database: Database,
        blast: NCBIBlastClient,
        uniprot: UniProtClient,
        rcsb: RCSBClient,
        alphafold: AlphaFoldDBClient | None = None,
        sifts: PDBeSIFTSClient | None = None,
        email: str = "",
    ):
        self.database = database
        self.blast = blast
        self.uniprot = uniprot
        self.rcsb = rcsb
        self.alphafold = alphafold
        self.sifts = sifts
        self.email = email
        self.project_trees = ProjectTreeService(database)

    def create_protein(self, fields: dict[str, Any]) -> dict[str, Any]:
        sequence = normalize_sequence(str(fields.get("sequence") or ""))
        protein = self.database.create_protein(fields, sequence)
        result = analyze_sequence(sequence)
        self.database.save_protparam(protein["id"], result)
        return self.database.get_bundle(protein["id"])

    def update_protein(self, protein_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        sequence: str | None = None
        if "sequence" in fields:
            sequence = normalize_sequence(str(fields["sequence"]))
        self.database.update_protein(protein_id, fields, sequence)
        if sequence is not None:
            self.database.save_protparam(protein_id, analyze_sequence(sequence))
        return self.database.get_bundle(protein_id)

    def analyze(self, protein_id: str) -> dict[str, Any]:
        protein = self.database.get_protein(protein_id)
        result = analyze_sequence(protein["sequence"])
        self.database.save_protparam(protein_id, result)
        return result

    def analyze_raw_sequence(self, sequence: str) -> dict[str, Any]:
        """Analyze an arbitrary sequence without storing it.

        Construct planning needs ProtParam numbers for a tagged fusion and for
        the cleaved product. Both are derived sequences rather than the saved
        target, so they use the same calculations but are never persisted.
        """
        return analyze_sequence(sequence)

    def submit_blast(
        self,
        protein_id: str,
        *,
        database: str = "swissprot",
        hitlist_size: int = 25,
        purpose: str = "blast",
    ) -> dict[str, Any]:
        protein = self.database.get_protein(protein_id)
        submission = self.blast.submit(
            protein["sequence"], database=database, hitlist_size=hitlist_size
        )
        self.database.save_blast_job(
            protein_id,
            submission["rid"],
            "waiting",
            {
                "database": submission["database"],
                "hitlistSize": submission["hitlistSize"],
                "querySequence": protein["sequence"],
                "stageId": "submitted",
                "purpose": "uniprot" if purpose == "uniprot" else "blast",
                "provider": submission.get("provider", "ncbi-url-api"),
            },
        )
        self.database.cancel_superseded_blast_jobs(
            protein_id,
            submission["rid"],
            "uniprot" if purpose == "uniprot" else "blast",
        )
        return self.database.get_blast_job(submission["rid"]) | {
            "estimatedSeconds": submission["estimatedSeconds"],
            "database": submission["database"],
            "hitlistSize": submission["hitlistSize"],
        }

    def poll_blast(self, rid: str, *, fetch_uniprot: bool = True) -> dict[str, Any]:
        job = self.database.get_blast_job(rid)
        if job["status"] in {"complete", "failed", "unknown", "canceled"}:
            return job
        polled = self.blast.poll(rid)
        if self.database.get_blast_job(rid)["status"] == "canceled":
            return self.database.get_blast_job(rid)
        self.database.update_blast_job(
            rid,
            polled["status"],
            polled.get("results"),
            polled.get("error"),
            stage_id=polled.get("stageId"),
        )
        enrichment_errors: list[dict[str, str]] = []
        if polled["status"] == "complete" and fetch_uniprot:
            hits_by_accession = {
                hit["uniprotAccession"]: hit
                for hit in polled.get("results") or []
                if hit.get("uniprotAccession")
            }
            try:
                records = self.uniprot.fetch_many(list(hits_by_accession))
                fetched_accessions: set[str] = set()
                for record in records:
                    accession = record.get("accession")
                    if not accession or accession not in hits_by_accession:
                        continue
                    fetched_accessions.add(accession)
                    self.database.save_uniprot_match(
                        job["proteinId"],
                        record,
                        "NCBI BLAST",
                        hits_by_accession[accession],
                    )
                for accession in hits_by_accession.keys() - fetched_accessions:
                    enrichment_errors.append(
                        {"accession": accession, "error": "UniProt record not returned"}
                    )
            except RemoteServiceError as error:
                enrichment_errors.extend(
                    {"accession": accession, "error": str(error)}
                    for accession in hits_by_accession
                )
        updated = self.database.get_blast_job(rid)
        if enrichment_errors:
            updated["uniprotEnrichmentErrors"] = enrichment_errors
        return updated

    def cancel_blast(self, rid: str) -> dict[str, Any]:
        """Stop local polling; NCBI does not expose remote job deletion."""
        return self.database.cancel_blast_job(rid)

    def search_uniprot(
        self, protein_id: str, query: str, *, size: int = 10
    ) -> list[dict[str, Any]]:
        self.database.get_protein(protein_id)
        records = self.uniprot.search(query, size=size)
        for record in records:
            self.database.save_uniprot_match(protein_id, record, "UniProt search")
        return records

    def fetch_uniprot(self, protein_id: str, accession: str) -> dict[str, Any]:
        self.database.get_protein(protein_id)
        record = self.uniprot.fetch(accession)
        self.database.save_uniprot_match(protein_id, record, "UniProt accession")
        return record

    def match_uniprot_sequence(
        self, protein_id: str, *, size: int = 25
    ) -> list[dict[str, Any]]:
        """Find and save exact UniProtKB matches using the sequence checksum."""
        protein = self.database.get_protein(protein_id)
        sequence = protein["sequence"]
        checksum = hashlib.md5(sequence.encode("ascii")).hexdigest().upper()
        records = self.uniprot.search(f"checksum:{checksum}", size=size)
        exact = [
            record
            for record in records
            if record.get("sequence", {}).get("value") == sequence
        ]
        matches = exact
        source = "UniProt exact sequence"
        if not matches:
            try:
                matches = self.uniprot.find_sequence_matches(
                    sequence, size=size, hint=str(protein.get("name") or "")
                )
                source = "UniProt peptide-assisted sequence match"
            except RemoteServiceError:
                # NCBI BLAST is still submitted by the desktop workflow, so a
                # temporary peptide-service failure must not abort that search.
                matches = []
        # RCSB polymer entities carry curated UniProt cross-references. They
        # are a reliable offline bridge when UniProt's checksum or peptide
        # search does not return a record for a construct taken from a PDB
        # entry (for example PA0012 chain A in 8U0I).
        if not matches:
            pdb_records = self.database.get_bundle(protein_id)["pdbMatches"]
            # The UniProt action must remain one-click: when no PDB evidence
            # has been collected yet, perform the sequence search here so a
            # construct taken directly from a PDB entry can still follow its
            # curated RCSB-to-UniProt cross-reference without extra input.
            if not pdb_records:
                try:
                    pdb_records = self.search_pdb(
                        protein_id,
                        identity_cutoff=0.30,
                        evalue_cutoff=0.001,
                        limit=max(5, min(size, 10)),
                    )
                except RemoteServiceError:
                    pdb_records = []
            accessions: list[str] = []
            for pdb_record in pdb_records:
                for accession in pdb_record.get("uniprotIds") or []:
                    value = str(accession).strip().upper()
                    if value and value not in accessions:
                        accessions.append(value)
            for accession in accessions[: max(1, min(size, 25))]:
                try:
                    record = self.uniprot.fetch(accession)
                except (RemoteServiceError, LookupError):
                    continue
                metrics = global_sequence_metrics(
                    sequence, str(record.get("sequence", {}).get("value") or "")
                )
                record["sequenceMatch"] = metrics
                matches.append(record)
            if matches:
                source = "RCSB PDB UniProt cross-reference"
        for record in matches:
            sequence_match = record.get("sequenceMatch") or {}
            self.database.save_uniprot_match(
                protein_id,
                record,
                source,
                {
                    "identity": sequence_match.get("identity", 1.0),
                    "queryCoverage": sequence_match.get("queryCoverage", 1.0),
                    "evalue": 0.0 if source == "UniProt exact sequence" else None,
                },
            )
        return matches

    def search_pdb(
        self,
        protein_id: str,
        *,
        identity_cutoff: float = 0.3,
        evalue_cutoff: float = 1e-3,
        limit: int = 10,
    ) -> list[dict[str, Any]]:
        protein = self.database.get_protein(protein_id)
        records = self.rcsb.search_sequence(
            protein["sequence"],
            identity_cutoff=identity_cutoff,
            evalue_cutoff=evalue_cutoff,
            limit=limit,
        )
        for record in records:
            self.database.save_pdb_match(protein_id, record)
        return records

    @staticmethod
    def _source_error(source: str, error: Exception) -> dict[str, Any]:
        return {
            "source": source,
            "code": error.__class__.__name__,
            "message": str(error),
            "retryable": isinstance(error, RemoteServiceError),
        }

    @staticmethod
    def _best_reference_match(bundle: dict[str, Any], accession: str = "") -> dict[str, Any] | None:
        accession = accession.strip().upper()
        matches = bundle.get("uniprotMatches") or []
        if accession:
            return next(
                (item for item in matches if str(item.get("accession") or "").upper() == accession),
                None,
            )
        return max(
            matches,
            key=lambda item: float(item.get("identity") or 0) * float(item.get("queryCoverage") or 0),
            default=None,
        )

    def list_structures(self, protein_id: str, *, limit: int = 10) -> dict[str, Any]:
        """List AlphaFold DB and accession-linked experimental structures.

        Each optional upstream is isolated so a partial list remains usable.
        Client-level TTL caches avoid repeating RCSB coordinate and SIFTS calls.
        """
        bundle = self.database.get_bundle(protein_id)
        reference = self._best_reference_match(bundle)
        errors: list[dict[str, Any]] = []
        structures: list[dict[str, Any]] = []
        accession = str(reference.get("accession") or "") if reference else ""
        for model in bundle.get("alphaFoldModels") or []:
            if str(model.get("source") or "").lower() != "alphafold db":
                continue
            if accession and model.get("accession") and str(model["accession"]).upper() != accession:
                continue
            metadata = model.get("metadata") or {}
            structures.append({
                "id": model["modelId"],
                "source": "alphafold_db",
                "format": model.get("format") or "cif",
                "title": model.get("name") or model["modelId"],
                "method": "AlphaFold prediction",
                "resolutionAngstrom": None,
                "chains": [{
                    "chainId": "A",
                    "labelChainId": "A",
                    "residueCount": metadata.get("residueCount"),
                    "modeledResidueCount": metadata.get("residueCount"),
                }],
                "ligands": [],
                "accession": model.get("accession") or accession,
                "sourceUrl": metadata.get("entryUrl"),
            })
        if not reference:
            errors.append({
                "source": "UniProt",
                "code": "reference_missing",
                "message": "No saved UniProt reference match is available.",
                "retryable": False,
            })
            return {
                "proteinId": protein_id,
                "referenceAccession": None,
                "structures": structures,
                "errors": errors,
            }
        if self.sifts is None:
            errors.append({
                "source": "PDBe SIFTS",
                "code": "not_configured",
                "message": "PDBe SIFTS client is not configured.",
                "retryable": False,
            })
            sifts_segments: list[dict[str, Any]] = []
        else:
            try:
                sifts_segments = self.sifts.mappings_for_accession(accession)
            except (RemoteServiceError, LookupError, ValueError) as error:
                errors.append(self._source_error("PDBe SIFTS", error))
                sifts_segments = []
        try:
            rcsb_ids = self.rcsb.entry_ids_for_accession(accession, limit=limit)
        except (RemoteServiceError, LookupError, ValueError) as error:
            errors.append(self._source_error("RCSB PDB", error))
            rcsb_ids = []
        sifts_ids = [
            str(segment.get("pdbId") or "").upper()
            for segment in sifts_segments
            if segment.get("pdbId")
        ]
        entry_ids = list(dict.fromkeys([*rcsb_ids, *sifts_ids]))[: max(1, min(limit, 50))]
        def load_entry(pdb_id: str) -> tuple[dict[str, Any], dict[str, Any], list[dict[str, Any]]]:
            entry_errors: list[dict[str, Any]] = []
            try:
                metadata = self.rcsb.entry_metadata(pdb_id)
            except (RemoteServiceError, LookupError, ValueError) as error:
                entry_errors.append(self._source_error(f"RCSB PDB {pdb_id}", error))
                metadata = {
                    "id": pdb_id,
                    "source": "pdb",
                    "format": "cif",
                    "title": "",
                    "method": None,
                    "resolutionAngstrom": None,
                    "sourceUrl": f"https://www.rcsb.org/structure/{pdb_id}",
                }
            try:
                summary = summarize_structure(self.rcsb.fetch_mmcif(pdb_id))
            except (RemoteServiceError, LookupError, ValueError) as error:
                entry_errors.append(self._source_error(f"RCSB PDB {pdb_id} coordinates", error))
                summary = {"chains": [], "ligands": []}
            return metadata, summary, entry_errors

        # Entry metadata and coordinates are independent. Loading them in a
        # bounded pool makes one slow entry cost one timeout window, not N.
        with ThreadPoolExecutor(max_workers=min(8, max(1, len(entry_ids)))) as executor:
            loaded = {
                pdb_id: executor.submit(load_entry, pdb_id)
                for pdb_id in entry_ids
            }
            entry_results = {
                pdb_id: loaded[pdb_id].result()
                for pdb_id in entry_ids
            }
        for pdb_id in entry_ids:
            metadata, summary, entry_errors = entry_results[pdb_id]
            errors.extend(entry_errors)
            entry_segments = [
                segment for segment in sifts_segments
                if str(segment.get("pdbId") or "").upper() == pdb_id
            ]
            structures.append({
                **metadata,
                **summary,
                "accession": accession,
                "siftsAvailable": bool(entry_segments),
                "mappedChains": list(dict.fromkeys(
                    str(segment.get("chainId") or segment.get("structAsymId") or "")
                    for segment in entry_segments
                    if segment.get("chainId") or segment.get("structAsymId")
                )),
            })
        return {
            "proteinId": protein_id,
            "referenceAccession": accession,
            "structures": structures,
            "errors": errors,
        }

    def get_structure(self, protein_id: str, source: str, structure_id: str) -> dict[str, Any]:
        bundle = self.database.get_bundle(protein_id)
        source = source.strip().lower()
        errors: list[dict[str, Any]] = []
        if source == "alphafold_db":
            stored = self.database.get_alphafold_model(protein_id, structure_id)
            if str(stored.get("source") or "").lower() != "alphafold db":
                raise LookupError(f"AlphaFold DB model {structure_id!r} was not found")
            structure_text = str(stored.pop("structureText"))
            accession = str(stored.get("accession") or "")
            reference = self._best_reference_match(bundle, accession)
            metadata = {
                "id": structure_id,
                "source": source,
                "format": stored.get("format") or "cif",
                "title": stored.get("name") or structure_id,
                "method": "AlphaFold prediction",
                "resolutionAngstrom": None,
                **summarize_structure(structure_text),
            }
            segments: list[dict[str, Any]] = []
        elif source == "pdb":
            structure_id = structure_id.strip().upper()
            reference = self._best_reference_match(bundle)
            if reference is None:
                raise LookupError("No saved UniProt reference match is available")
            accession = str(reference["accession"])
            structure_text = self.rcsb.fetch_mmcif(structure_id)
            try:
                entry_metadata = self.rcsb.entry_metadata(structure_id)
            except (RemoteServiceError, LookupError, ValueError) as error:
                errors.append(self._source_error(f"RCSB PDB {structure_id}", error))
                entry_metadata = {
                    "id": structure_id,
                    "source": "pdb",
                    "format": "cif",
                    "title": "",
                    "method": None,
                    "resolutionAngstrom": None,
                    "sourceUrl": f"https://www.rcsb.org/structure/{structure_id}",
                }
            metadata = {**entry_metadata, **summarize_structure(structure_text)}
            if self.sifts is None:
                segments = []
                errors.append({
                    "source": "PDBe SIFTS", "code": "not_configured",
                    "message": "PDBe SIFTS client is not configured.", "retryable": False,
                })
            else:
                try:
                    segments = [
                        segment for segment in self.sifts.mappings_for_accession(accession)
                        if str(segment.get("pdbId") or "").upper() == structure_id
                    ]
                except (RemoteServiceError, LookupError, ValueError) as error:
                    errors.append(self._source_error("PDBe SIFTS", error))
                    segments = []
        else:
            raise ValueError("source must be alphafold_db or pdb")
        if reference is None:
            raise LookupError(f"UniProt reference {accession!r} was not found for this protein")
        reference_record = reference.get("record") or {}
        reference_sequence = str((reference_record.get("sequence") or {}).get("value") or "")
        if not reference_sequence:
            raise LookupError(f"UniProt reference {accession!r} has no saved sequence")
        mapping, _ = build_residue_mapping(
            str(bundle["protein"]["sequence"]),
            reference_sequence,
            structure_text,
            accession=accession,
            source=source,
            sifts_segments=segments,
        )
        return {
            "proteinId": protein_id,
            "referenceAccession": accession,
            "structure": metadata,
            "structureText": structure_text,
            "format": "cif",
            "mapping": {
                "numbering": {
                    "positionsAreOneBased": True,
                    "construct": "user construct residue position",
                    "uniprot": "UniProt reference residue position",
                    "labelSeqId": "mmCIF label_seq_id",
                    "authSeqId": "mmCIF auth_seq_id; insertionCode is separate",
                    "unmappedValues": None,
                },
                "residues": mapping,
            },
            "errors": errors,
        }

    def get_structure_regions(self, protein_id: str, source: str, structure_id: str) -> dict[str, Any]:
        structure = self.get_structure(protein_id, source, structure_id)
        bundle = self.database.get_bundle(protein_id)
        reference = self._best_reference_match(bundle, str(structure["referenceAccession"]))
        assert reference is not None
        reference_record = reference.get("record") or {}
        reference_sequence = str((reference_record.get("sequence") or {}).get("value") or "")
        mapping, parsed = build_residue_mapping(
            str(bundle["protein"]["sequence"]),
            reference_sequence,
            str(structure["structureText"]),
            accession=str(structure["referenceAccession"]),
            source=source,
            sifts_segments=(),
        )
        # PDB UniProt positions have already been resolved in get_structure.
        # Reuse them rather than performing or guessing a second SIFTS mapping.
        if source == "pdb":
            mapped_by_structure = {
                (row.get("labelChainId"), row.get("labelSeqId")): row
                for row in structure["mapping"]["residues"]
                if row.get("labelChainId") is not None
            }
            for row in mapping:
                saved = mapped_by_structure.get((row.get("labelChainId"), row.get("labelSeqId")))
                if saved:
                    row.update({
                        key: saved.get(key)
                        for key in ("constructPosition", "uniprotPosition", "constructResidue", "uniprotResidue", "mismatch")
                    })
        computed = compute_regions(
            mapping,
            parsed,
            reference_sequence,
            reference_record,
            model_confidence=source == "alphafold_db",
        )
        return {
            "proteinId": protein_id,
            "referenceAccession": structure["referenceAccession"],
            "structure": structure["structure"],
            "numbering": structure["mapping"]["numbering"],
            **computed,
            "errors": structure["errors"],
        }

    def fetch_alphafold_db(
        self, protein_id: str, accession: str = ""
    ) -> dict[str, Any]:
        """Fetch the best available AlphaFold DB model for this protein."""
        if self.alphafold is None:
            raise RuntimeError("The AlphaFold Database client is not configured")
        self.database.get_protein(protein_id)
        bundle = self.database.get_bundle(protein_id)
        matches = bundle["uniprotMatches"]
        if not accession and not matches:
            self.match_uniprot_sequence(protein_id)
            matches = self.database.get_bundle(protein_id)["uniprotMatches"]
        selected: dict[str, Any] | None = None
        if accession:
            accession = accession.strip().upper()
            selected = next(
                (item for item in matches if item["accession"] == accession), None
            )
        elif matches:
            selected = max(
                matches,
                key=lambda item: float(item.get("identity") or 0)
                * float(item.get("queryCoverage") or 0),
            )
            accession = str(selected["accession"])
        if not accession:
            raise LookupError(
                "No UniProt match is available for AlphaFold DB. Run the UniProt search first or use AlphaFold Server for a new prediction."
            )
        model = self.alphafold.fetch(accession)
        metrics = {
            "identity": selected.get("identity") if selected else None,
            "queryCoverage": selected.get("queryCoverage") if selected else None,
            "sequenceExact": bool(
                selected
                and selected.get("identity") == 1.0
                and selected.get("queryCoverage") == 1.0
            ),
        }
        model["metadata"] = {**model["metadata"], "sequenceMatch": metrics}
        self.database.save_alphafold_model(protein_id, model)
        return self.database.get_alphafold_model(protein_id, model["modelId"])

    def prepare_alphafold_server_job(self, protein_id: str) -> dict[str, Any]:
        """Create an official AlphaFold Server JSON job for GUI upload."""
        protein = self.database.get_protein(protein_id)
        safe_name = re.sub(r"[^A-Za-z0-9._-]+", "_", protein["name"]).strip("._-")
        safe_name = safe_name[:80] or f"protein_{protein_id[:8]}"
        job = [{
            "name": safe_name,
            "modelSeeds": [],
            "sequences": [{
                "proteinChain": {"sequence": protein["sequence"], "count": 1}
            }],
            "dialect": "alphafoldserver",
            "version": 1,
        }]
        directory = self.database.path.parent / "alphafold_submissions"
        directory.mkdir(parents=True, exist_ok=True)
        path = directory / f"{safe_name}_alphafold_server_job.json"
        path.write_text(json.dumps(job, indent=2) + "\n", encoding="utf-8")
        return {
            "proteinId": protein_id,
            "submissionPath": str(path),
            "serverUrl": "https://alphafoldserver.com/",
            "job": job,
            "stage": "Ready to upload to AlphaFold Server",
        }

    def import_alphafold_result(self, protein_id: str, source_path: str) -> dict[str, Any]:
        """Import an AlphaFold Server ZIP, mmCIF, or PDB result."""
        protein = self.database.get_protein(protein_id)
        path = Path(source_path).expanduser().resolve()
        if not path.is_file():
            raise ValueError("The selected AlphaFold result file does not exist")
        if path.stat().st_size > 100_000_000:
            raise ValueError("The selected AlphaFold result is larger than 100 MB")

        metadata: dict[str, Any] = {"importedFile": path.name}
        if path.suffix.lower() == ".zip":
            structure_text, file_format, member_name, extra = self._read_alphafold_zip(path)
            metadata.update(extra)
            metadata["modelFile"] = member_name
            name = Path(member_name).stem
        elif path.suffix.lower() in {".cif", ".mmcif", ".pdb"}:
            file_format = "pdb" if path.suffix.lower() == ".pdb" else "cif"
            structure_text = path.read_text(encoding="utf-8", errors="replace")
            name = path.stem
        else:
            raise ValueError("Select an AlphaFold ZIP, CIF, mmCIF, or PDB file")

        geometry = parse_structure_geometry(structure_text, file_format)
        digest = hashlib.sha256(structure_text.encode("utf-8")).hexdigest()[:16]
        model_id = f"AFS-{digest}"
        metadata.update({
            "meanPlddt": geometry["meanPlddt"],
            "residueCount": geometry["residueCount"],
            "chainCount": geometry["chainCount"],
            "sequenceLength": len(protein["sequence"]),
            "previewGeometry": structure_preview(geometry),
        })
        model = {
            "modelId": model_id,
            "accession": "",
            "name": name,
            "source": "AlphaFold Server",
            "format": file_format,
            "structureText": structure_text,
            "metadata": metadata,
        }
        self.database.save_alphafold_model(protein_id, model)
        return self.database.get_alphafold_model(protein_id, model_id)

    @staticmethod
    def _read_alphafold_zip(
        path: Path,
    ) -> tuple[str, str, str, dict[str, Any]]:
        try:
            with zipfile.ZipFile(path) as archive:
                coordinate_files = [
                    item for item in archive.infolist()
                    if not item.is_dir()
                    and Path(item.filename).suffix.lower() in {".cif", ".mmcif", ".pdb"}
                    and item.file_size <= 75_000_000
                ]
                if not coordinate_files:
                    raise ValueError(
                        "The AlphaFold results ZIP does not contain a CIF or PDB model"
                    )
                coordinate_files.sort(key=lambda item: (
                    "model" not in item.filename.lower(),
                    Path(item.filename).suffix.lower() == ".pdb",
                    -item.file_size,
                ))
                selected = coordinate_files[0]
                text = archive.read(selected).decode("utf-8", errors="replace")
                summary: dict[str, Any] = {}
                summary_files = [
                    item for item in archive.infolist()
                    if "summary_confidences" in item.filename.lower()
                    and item.filename.lower().endswith(".json")
                    and item.file_size < 2_000_000
                ]
                if summary_files:
                    try:
                        value = json.loads(archive.read(summary_files[0]))
                        if isinstance(value, dict):
                            summary = value
                    except (json.JSONDecodeError, UnicodeDecodeError):
                        pass
        except zipfile.BadZipFile as error:
            raise ValueError("The selected AlphaFold results ZIP is damaged") from error
        file_format = "pdb" if selected.filename.lower().endswith(".pdb") else "cif"
        return text, file_format, selected.filename, {"summaryConfidence": summary}

    def get_alphafold_model(
        self, protein_id: str, model_id: str
    ) -> dict[str, Any]:
        model = self.database.get_alphafold_model(protein_id, model_id)
        structure_text = str(model.pop("structureText"))
        geometry = parse_structure_geometry(structure_text, model["format"])
        # The full coordinate record is required by the desktop molecular viewer
        # to calculate secondary structure, ligands, bonds, and molecular surfaces.
        # Compact project cards continue to use metadata.previewGeometry instead.
        geometry["structureText"] = structure_text
        geometry["format"] = model["format"]
        return {**model, "geometry": geometry}

    def create_project_job(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        app_type = str(fields.get("appType") or "").strip()
        labels = {
            "protein-planner": "Protein sequence",
            "protparam": "ProtParam analysis",
            "database-research": "Database research",
            "reference-match": "Reference match review",
            "alphafold": "AlphaFold structure",
            "protein-readiness": "Protein readiness check",
            "expression-system": "Expression system selection",
            "expression-planning": "Expression vector design",
            "purification-lysis": "Cell lysis planning",
            "purification-affinity": "Affinity capture selection",
            "purification-cleavage": "Affinity-tag cleavage",
            "purification-subtractive": "Subtractive affinity cleanup",
            "purification-sec": "Size exclusion chromatography polishing",
            "purification-buffer": "Purification buffer design",
            "purification-workflow": "Purification workflow review",
            "purification-roadmap": "Purification roadmap",
            "transformation-expression": "Transformation and expression",
            "chromatogram-studio": "Chromatogram analysis",
            "gel-analysis": "Gel purity analysis",
        }
        if app_type not in labels:
            raise ValueError("Select a valid Protein Labs application")
        name = str(fields.get("name") or labels[app_type]).strip()
        if not name:
            name = labels[app_type]
        if len(name) > 120:
            raise ValueError("Project job names must be 120 characters or fewer")
        return self.database.create_project_job(
            protein_id, name, app_type, fields.get("config") or {}
        )

    def update_project_job(
        self, protein_id: str, job_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        existing = self.database.get_project_job(job_id)
        if existing["proteinId"] != protein_id:
            raise LookupError(f"Project job {job_id!r} was not found")
        name = str(fields.get("name") or existing["name"]).strip()
        if not name or len(name) > 120:
            raise ValueError("Project job names must contain 1–120 characters")
        status = str(fields.get("status") or existing["status"]).strip().lower()
        if status not in {"ready", "in_progress", "complete"}:
            raise ValueError("Project job status must be ready, in_progress or complete")
        config = fields.get("config", existing["config"])
        if not isinstance(config, dict):
            raise ValueError("Project job configuration must be an object")
        return self.database.update_project_job(
            protein_id,
            job_id,
            name=name,
            status=status,
            config=config,
        )

    def delete_project_job(self, protein_id: str, job_id: str) -> None:
        existing = self.database.get_project_job(job_id)
        if existing["proteinId"] != protein_id:
            raise LookupError(f"Project job {job_id!r} was not found")
        self.database.delete_project_job(protein_id, job_id)

    def list_expression_vectors(self, protein_id: str) -> list[dict[str, Any]]:
        return [
            vector_preview(vector)
            for vector in self.database.list_expression_vectors(protein_id)
        ]

    def save_expression_vector(
        self,
        protein_id: str,
        fields: dict[str, Any],
        vector_id: str | None = None,
    ) -> dict[str, Any]:
        name = str(fields.get("name") or "Untitled vector").strip()
        if not name or len(name) > 120:
            raise ValueError("Vector names must be 1 to 120 characters")
        sequence = normalize_dna(str(fields.get("sequence") or ""))
        if not sequence:
            raise ValueError("Enter or import a DNA sequence before saving the vector")
        if len(sequence) > 5_000_000:
            raise ValueError("Vectors are limited to 5,000,000 bases")
        circular = bool(fields.get("circular", True))
        features = normalize_features(
            fields.get("features") or [], len(sequence), circular=circular
        )
        primers = normalize_primers(fields.get("primers") or [], len(sequence))
        enzyme_names = fields.get("enzymeNames") or COMMON_ENZYMES
        if not isinstance(enzyme_names, list) or len(enzyme_names) > 250:
            raise ValueError("Select no more than 250 restriction enzymes")
        enzyme_names = [str(name).strip() for name in enzyme_names if str(name).strip()]
        minimum_orf_amino_acids = int(fields.get("minimumOrfAminoAcids") or 50)
        if minimum_orf_amino_acids < 5 or minimum_orf_amino_acids > 10_000:
            raise ValueError("Minimum ORF length must be between 5 and 10,000 amino acids")
        history = fields.get("history") or []
        if not isinstance(history, list):
            raise ValueError("Vector history must be a list")
        if vector_id is None and not history:
            history = [{
                "type": "ManuallyTypedSource",
                "input": [],
                "outputName": name,
            }]
        value = self.database.save_expression_vector(
            protein_id,
            {
                "name": name,
                "sequence": sequence,
                "circular": circular,
                "features": features,
                "primers": primers,
                "enzymeNames": enzyme_names,
                "minimumOrfAminoAcids": minimum_orf_amino_acids,
                "history": history,
                "libraryId": fields.get("sourceLibraryId") or fields.get("libraryId"),
            },
            vector_id,
        )
        self.database.record_vector_use(
            protein_id,
            value,
            source_library_id=str(fields.get("sourceLibraryId") or "") or None,
        )
        return vector_preview(
            self.database.get_expression_vector(protein_id, value["id"])
        )

    # ------------------------------------------------------------------
    # Shared vector library
    # ------------------------------------------------------------------
    # Purified protein library -------------------------------------------------
    def search_library_proteins(
        self, *, query: str = "", filters: dict[str, list[str]] | None = None,
        favorite: bool | None = None, limit: int = 100, offset: int = 0,
    ) -> dict[str, Any]:
        if limit < 1 or limit > 500:
            raise ValueError("Protein library limit must be between 1 and 500")
        if offset < 0:
            raise ValueError("Protein library offset cannot be negative")
        unknown = set(filters or {}) - set(self.database.PROTEIN_LIBRARY_FACETS)
        if unknown:
            raise ValueError("Unknown protein library facet: " + ", ".join(sorted(unknown)))
        return self.database.search_library_proteins(
            query=query, filters=filters, favorite=favorite, limit=limit, offset=offset
        )

    def get_library_protein(self, protein_id: str) -> dict[str, Any]:
        return self.database.get_library_protein(protein_id)

    def create_library_protein(self, fields: dict[str, Any]) -> dict[str, Any]:
        self._validate_library_protein_fields(fields)
        return self.database.create_library_protein(fields)

    def update_library_protein(self, protein_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        self._validate_library_protein_fields(fields, partial=True)
        return self.database.update_library_protein(protein_id, fields)

    def delete_library_protein(self, protein_id: str) -> None:
        self.database.delete_library_protein(protein_id)

    def add_library_protein_event(self, protein_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return self.database.add_library_protein_event(protein_id, fields)

    @staticmethod
    def _validate_library_protein_fields(fields: dict[str, Any], partial: bool = False) -> None:
        if not partial and not str(fields.get("name") or "").strip():
            raise ValueError("name is required")
        if "name" in fields and len(str(fields["name"]).strip()) > 200:
            raise ValueError("name must be at most 200 characters")
        if "favorite" in fields and not isinstance(fields["favorite"], bool):
            raise ValueError("favorite must be a boolean")
        if "tags" in fields and (not isinstance(fields["tags"], list) or not all(isinstance(tag, str) for tag in fields["tags"])):
            raise ValueError("tags must be an array of strings")

    def list_library_vectors(self) -> list[dict[str, Any]]:
        return self.database.list_library_vectors()

    def search_library_vectors(
        self,
        *,
        query: str = "",
        filters: dict[str, list[str]] | None = None,
        favorite: bool | None = None,
        limit: int = 100,
        offset: int = 0,
        view: str = "all",
        collection: str | None = None,
        tags: list[str] | None = None,
        sort: str = "name",
        order: str = "asc",
    ) -> dict[str, Any]:
        if limit < 1 or limit > 500:
            raise ValueError("Vector library limit must be between 1 and 500")
        if offset < 0:
            raise ValueError("Vector library offset cannot be negative")
        unknown = set(filters or {}) - set(self.database.VECTOR_LIBRARY_FACETS)
        if unknown:
            raise ValueError(
                "Unknown vector library facet: " + ", ".join(sorted(unknown))
            )
        return self.database.search_library_vectors(
            query=query,
            filters=filters,
            favorite=favorite,
            limit=limit,
            offset=offset,
            view=view, collection=collection, tags=tags or [], sort=sort, order=order,
        )

    def list_recent_library_vectors(self, limit: int = 10) -> list[dict[str, Any]]:
        if limit < 1 or limit > 100:
            raise ValueError("Recent vector limit must be between 1 and 100")
        return self.database.list_recent_library_vectors(limit)

    def set_library_favorite(
        self, library_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        if "favorite" not in fields or not isinstance(fields["favorite"], bool):
            raise ValueError("favorite must be a boolean")
        return self.database.set_library_favorite(library_id, fields["favorite"])

    def get_library_vector(self, library_id: str) -> dict[str, Any]:
        return self.database.get_library_vector(library_id)

    def import_library_vector(
        self, filename: str, content: str, *, keep_both: bool = False
    ) -> dict[str, Any]:
        """Parse a sequence file directly into the shared catalogue."""
        if len(content) > 15_000_000:
            raise ValueError("The sequence file is too large")
        parsed = parse_sequence_file(content, filename)
        name = str(parsed.get("name") or "Untitled vector").strip()
        if not name or len(name) > 120:
            raise ValueError("Vector names must be 1 to 120 characters")
        sequence = normalize_dna(str(parsed.get("sequence") or ""))
        if not sequence:
            raise ValueError("The imported file does not contain a DNA sequence")
        if len(sequence) > 5_000_000:
            raise ValueError("Vectors are limited to 5,000,000 bases")
        vector, duplicate = self.database.import_library_vector({
            "name": name,
            "sequence": sequence,
            "circular": bool(parsed.get("circular", True)),
            "features": normalize_features(parsed.get("features") or [], len(sequence)),
        }, keep_both=keep_both)
        return {**vector, "duplicate": True} if duplicate else vector

    # ------------------------------------------------------------------
    # Vector Workbench: project-free parse, export, analysis and saving.
    # ------------------------------------------------------------------
    @staticmethod
    def _workbench_vector(fields: dict[str, Any]) -> dict[str, Any]:
        name = str(fields.get("name") or "Untitled vector").strip()
        if not name or len(name) > 120:
            raise ValueError("Vector names must be 1 to 120 characters")
        sequence = normalize_dna(str(fields.get("sequence") or ""))
        if not sequence:
            raise ValueError("A vector needs a DNA sequence")
        if len(sequence) > 5_000_000:
            raise ValueError("Vectors are limited to 5,000,000 bases")
        circular = bool(fields.get("circular", True))
        return {
            "name": name,
            "sequence": sequence,
            "circular": circular,
            "features": normalize_features(fields.get("features") or [], len(sequence), circular=circular),
        }

    def parse_workbench_file(self, filename: str, content: str) -> dict[str, Any]:
        """Read GenBank, FASTA or SnapGene (.dna, base64) without saving anything."""
        if len(content) > 15_000_000:
            raise ValueError("The sequence file is too large")
        parsed = parse_sequence_file(content, filename)
        vector = self._workbench_vector({**parsed, "name": str(parsed.get("name") or "Untitled vector")[:120]})
        return {**vector, "fileFormat": parsed["history"][0]["fileFormat"]}

    def export_workbench_vector(self, fields: dict[str, Any]) -> dict[str, Any]:
        file_format = str(fields.get("format") or "genbank")
        if file_format not in {"genbank", "fasta", "snapgene"}:
            raise ValueError("Export format must be genbank, fasta, or snapgene")
        vector = self._workbench_vector(dict(fields.get("vector") or {}))
        extension = {"genbank": "gb", "fasta": "fasta", "snapgene": "dna"}[file_format]
        return {
            "filename": f"{vector['name']}.{extension}",
            "format": file_format,
            "content": export_sequence(vector, file_format),
            "encoding": "base64" if file_format == "snapgene" else "text",
        }

    def analyze_workbench_vector(self, fields: dict[str, Any]) -> dict[str, Any]:
        """Restriction sites and ORFs for an unsaved sequence."""
        sequence = normalize_dna(str(fields.get("sequence") or ""))
        if len(sequence) > 5_000_000:
            raise ValueError("Vectors are limited to 5,000,000 bases")
        preview = vector_preview({
            "sequence": sequence,
            "circular": bool(fields.get("circular", True)),
            "enzymeNames": fields.get("enzymeNames") or COMMON_ENZYMES,
            "minimumOrfAminoAcids": int(fields.get("minimumOrfAminoAcids") or 50),
        })
        return {"restrictionSites": preview["restrictionSites"], "orfs": preview["orfs"], "enzymeNames": list(fields.get("enzymeNames") or COMMON_ENZYMES)}

    def create_library_vector(self, fields: dict[str, Any]) -> dict[str, Any]:
        """Save a workbench vector as a new catalogue entry, even if its sequence is already there."""
        vector, _ = self.database.import_library_vector(self._workbench_vector(fields), keep_both=True)
        return self.database.get_library_vector(vector["id"])

    def replace_library_vector(self, library_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        """Overwrite a user's catalogue entry; bundled standard vectors stay read-only."""
        return self.database.replace_library_vector_contents(library_id, self._workbench_vector(fields))

    def export_library_vector(
        self, library_id: str, file_format: str
    ) -> dict[str, Any]:
        """Export a catalogue record without requiring a project copy."""
        if file_format not in {"genbank", "fasta"}:
            raise ValueError("Export format must be genbank or fasta")
        vector = self.database.get_library_vector(library_id)
        return {
            "filename": f"{vector['name']}.{'gb' if file_format == 'genbank' else 'fasta'}",
            "format": file_format,
            "content": export_sequence(vector, file_format),
        }

    def delete_library_vector(self, library_id: str) -> dict[str, str]:
        self.database.delete_library_vector(library_id)
        return {"deleted": library_id, "restoreToken": library_id}

    def list_library_collections(self) -> dict[str, Any]:
        return {"collections": self.database.list_collections()}

    def create_library_collection(self, fields: dict[str, Any]) -> dict[str, Any]:
        return {"collection": self.database.create_collection(str(fields.get("name") or ""))}

    def update_library_collection(self, collection_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return {"collection": self.database.update_collection(collection_id, name=fields.get("name"), position=fields.get("position"))}

    def delete_library_collection(self, collection_id: str) -> dict[str, str]:
        self.database.delete_collection(collection_id); return {"deletedId": collection_id}

    def bulk_library_action(self, fields: dict[str, Any]) -> dict[str, Any]:
        ids = fields.get("ids")
        if not isinstance(ids, list) or not all(isinstance(i, str) for i in ids): raise ValueError("ids must be an array of strings")
        action = str(fields.get("action") or "")
        aliases = {"addToCollection": "add_to_collection", "removeFromCollection": "remove_from_collection", "untag": "untag", "unfavorite": "favorite", "restore": "restore"}
        action = aliases.get(action, action)
        tags = fields.get("tags", fields.get("tag"))
        if isinstance(tags, str): tags = [tags]
        if tags is not None and (not isinstance(tags, list) or not all(isinstance(tag, str) and tag.strip() for tag in tags)):
            raise ValueError("tags must be a string or an array of non-empty strings")
        favorite = fields.get("favorite", False if fields.get("action") == "unfavorite" else None)
        vectors = self.database.bulk_library_action(ids, action, collection_id=fields.get("collectionId"), tags=tags, favorite=favorite)
        return {"updated": ids, "skipped": [], "affectedIds": ids, "vectors": vectors}

    def reorder_library_collections(self, fields: dict[str, Any]) -> dict[str, Any]:
        ids = fields.get("ids")
        if not isinstance(ids, list) or not all(isinstance(item, str) for item in ids):
            raise ValueError("ids must be an array of strings")
        return {"collections": self.database.reorder_collections(ids)}

    def list_library_tags(self) -> list[dict[str, Any]]:
        return self.database.list_tags()

    def rename_library_tag(self, old_name: str, fields: dict[str, Any]) -> dict[str, Any]:
        return {"tags": self.database.rename_tag(old_name, str(fields.get("name") or ""))}

    def update_library_vector(self, library_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        return self.database.update_library_vector(library_id, fields)

    def restore_library_vector(self, library_id: str) -> dict[str, Any]:
        return self.database.restore_library_vector(library_id)

    def duplicate_library_vector(self, library_id: str) -> dict[str, Any]:
        return self.database.duplicate_library_vector(library_id)

    def preview_library_import(self, fields: dict[str, Any]) -> dict[str, Any]:
        files = fields.get("files")
        if not isinstance(files, list): raise ValueError("files must be an array")
        # A review batch must be self-consistent too: the second copy of a
        # sequence is a duplicate even before either file is committed.
        batch_duplicates: dict[tuple[bool, str], dict[str, Any]] = {}
        return {"files": [self._preview_import_file(file, batch_duplicates) for file in files]}

    def _preview_import_file(
        self, file: Any, batch_duplicates: dict[tuple[bool, str], dict[str, Any]] | None = None
    ) -> dict[str, Any]:
        if not isinstance(file, dict): return {"filename": "", "status": "error", "error": "Invalid file"}
        filename, content = str(file.get("filename") or ""), str(file.get("content") or "")
        try:
            parsed = parse_sequence_file(content, filename); sequence = normalize_dna(str(parsed.get("sequence") or ""))
            if not sequence: raise ValueError("The imported file does not contain a DNA sequence")
            circular = bool(parsed.get("circular", True))
            duplicate = self.database.find_library_duplicate(sequence, circular)
            checksum = self.database._sequence_checksum(sequence, circular)
            result = {"filename": filename, "status": "duplicate" if duplicate else "new", "name": str(parsed.get("name") or "Untitled vector"), "lengthBp": len(sequence)}
            batch_key = (circular, checksum)
            if duplicate is None and batch_duplicates is not None and batch_key in batch_duplicates:
                duplicate = batch_duplicates[batch_key]
                result["status"] = "duplicate"
            if duplicate: result["duplicateOf"] = duplicate
            elif batch_duplicates is not None:
                # This lightweight pseudo-summary gives the review sheet a
                # concrete earlier file to reference without writing anything.
                batch_duplicates[batch_key] = {
                    "id": None, "filename": filename, "name": result["name"],
                    "isStandard": False, "deletedAt": None,
                }
            return result
        except Exception as error:
            return {"filename": filename, "status": "error", "error": str(error)}

    def commit_library_import(self, fields: dict[str, Any]) -> dict[str, Any]:
        files = fields.get("files")
        if not isinstance(files, list): raise ValueError("files must be an array")
        results = []
        for file in files:
            preview = self._preview_import_file(file)
            resolution = str(file.get("resolution") or "skip") if isinstance(file, dict) else "skip"
            if preview["status"] == "error" or resolution == "skip":
                results.append(preview | ({"resolution": "skipped"} if preview["status"] != "error" else {})); continue
            if preview["status"] == "duplicate" and resolution == "merge":
                results.append(preview | {"resolution": "merged", "vector": preview["duplicateOf"]}); continue
            try:
                vector = self.import_library_vector(str(file.get("filename") or ""), str(file.get("content") or ""), keep_both=resolution == "keepBoth")
                results.append(preview | {"resolution": "kept", "vector": vector})
            except Exception as error: results.append(preview | {"status": "error", "error": str(error)})
        return {"files": results}

    def copy_library_vector(self, protein_id: str, library_id: str) -> dict[str, Any]:
        """Bring a catalogued vector into a project, recording the new use."""
        source = self.database.get_library_vector(library_id)
        return self.save_expression_vector(protein_id, {
            "name": source["name"],
            "sequence": source["sequence"],
            "circular": source["circular"],
            "features": source["features"],
            "sourceLibraryId": source["id"],
        })

    def auto_annotate_expression_vector(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        minimum = int(
            fields.get("minimumOrfAminoAcids")
            or vector.get("minimumOrfAminoAcids")
            or 50
        )
        annotations = automatic_annotations(
            vector["sequence"],
            include_orfs=bool(fields.get("includeOrfs", True)),
            minimum_orf_amino_acids=minimum,
        )
        annotation_method = "Protein Labs local annotator"
        annotation_version = "2"
        plannotate_report: list[dict[str, Any]] = []
        plannotate_warning: str | None = None
        plannotate_url = os.environ.get("PROTEIN_LABS_PLANNOTATE_URL", "").strip()
        if plannotate_url:
            try:
                remote = annotate_with_plannotate(
                    vector,
                    plannotate_url,
                    timeout=float(os.environ.get("PROTEIN_LABS_PLANNOTATE_TIMEOUT", "60")),
                )
                annotations = [*remote["features"], *annotations]
                plannotate_report = remote["report"]
                annotation_method = "pLannotate + Protein Labs local annotator"
                annotation_version = f"pLannotate {remote['version']}; local 2"
            except Exception as error:
                # Database annotation is additive. A sidecar outage must not
                # prevent deterministic local annotation or ORF detection.
                plannotate_warning = str(error)
        existing = {
            (
                feature.get("name"),
                int(feature.get("start", 0)),
                int(feature.get("end", 0)),
                int(feature.get("strand", 1)),
            )
            for feature in vector.get("features") or []
        }
        added = [
            feature
            for feature in annotations
            if (
                feature["name"],
                feature["start"],
                feature["end"],
                feature["strand"],
            ) not in existing
        ]
        vector["features"] = [*(vector.get("features") or []), *added]
        vector["minimumOrfAminoAcids"] = minimum
        vector.setdefault("history", []).append({
            "type": "AnnotationSource",
            "annotationTool": annotation_method,
            "annotationToolVersion": annotation_version,
            "featureCount": len(added),
            "outputName": vector["name"],
        })
        saved = self.save_expression_vector(protein_id, vector, vector_id)
        saved["annotationReport"] = {
            "added": len(added),
            "detected": len(annotations),
            "method": annotation_method,
            "localMethod": "curated exact motifs, translated tags, and six-frame ORFs",
            "pLannotateReport": plannotate_report,
            "warning": plannotate_warning,
        }
        return saved

    def design_expression_primers(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        primer_length = (
            int(fields["primerLength"]) if fields.get("primerLength") is not None else None
        )
        primers = design_pcr_primers(
            vector["sequence"],
            int(fields.get("start", 0)),
            int(fields.get("end", len(vector["sequence"]))),
            primer_length,
            target_tm=float(fields.get("targetTmCelsius", 60.0)),
            min_length=int(fields.get("minLength", 18)),
            max_length=int(fields.get("maxLength", 30)),
            min_gc=float(fields.get("minGcPercent", 35.0)),
            max_gc=float(fields.get("maxGcPercent", 65.0)),
            sodium_mm=float(fields.get("sodiumMm", 50.0)),
            magnesium_mm=float(fields.get("magnesiumMm", 1.5)),
            dntp_mm=float(fields.get("dntpMm", 0.2)),
            primer_nm=float(fields.get("primerNm", 500.0)),
            forward_overhang=str(fields.get("forwardOverhang") or ""),
            reverse_overhang=str(fields.get("reverseOverhang") or ""),
            cloning_method=str(fields.get("cloningMethod") or "pcr"),
            max_five_prime_shift=int(fields.get("maxFivePrimeShift", 0)),
        )
        label = str(fields.get("name") or "PCR").strip()
        primers[0]["name"] = f"{label} forward"
        primers[1]["name"] = f"{label} reverse"
        existing_ids = {primer.get("id") for primer in vector.get("primers") or []}
        for primer in primers:
            if primer["id"] in existing_ids:
                primer["id"] += f"-{uuid.uuid4().hex[:6]}"
        vector["primers"] = [*(vector.get("primers") or []), *primers]
        vector.setdefault("history", []).append({
            "type": "PrimerDesignSource",
            "input": [vector_id],
            "start": int(fields.get("start", 0)),
            "end": int(fields.get("end", len(vector["sequence"]))),
            "outputName": label,
        })
        saved = self.save_expression_vector(protein_id, vector, vector_id)
        saved["designedPrimers"] = primers
        return saved

    def edit_expression_vector_sequence(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        edited = apply_sequence_operation(vector, fields)
        return self.save_expression_vector(protein_id, edited, vector_id)

    def list_construct_hosts(self) -> dict[str, Any]:
        return {"hosts": available_hosts()}

    def back_translate_target(self, fields: dict[str, Any]) -> dict[str, Any]:
        return back_translate(
            str(fields.get("protein") or ""),
            host=str(fields.get("host") or "ecoli"),
            avoid_enzymes=[str(name) for name in (fields.get("avoidEnzymes") or [])],
            include_stop=fields.get("includeStop") is not False,
        )

    def optimize_target_codons(self, fields: dict[str, Any]) -> dict[str, Any]:
        host = str(fields.get("host") or "ecoli")
        preferences = CODON_PREFERENCES.get(host)
        if preferences is None:
            raise ValueError(f"No codon table for host {host!r}")
        result = optimize_codons(
            str(fields.get("protein") or ""),
            preferences=preferences,
            target_gc=float(fields.get("targetGcPercent", 55.0)),
            min_gc=float(fields.get("minGcPercent", 40.0)),
            max_gc=float(fields.get("maxGcPercent", 65.0)),
            avoid_motifs=[str(value) for value in (fields.get("avoidMotifs") or [])],
            max_homopolymer=int(fields.get("maxHomopolymer", 6)),
        )
        result["host"] = host
        return result

    def expression_vector_insertion_sites(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        enzymes = [str(name) for name in (fields.get("enzymeNames") or COMMON_ENZYMES)]
        return {"sites": insertion_sites(vector, enzymes=enzymes)}

    def insert_into_expression_vector(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        """Insert a target CDS, back-translating the protein when needed."""
        vector = self.database.get_expression_vector(protein_id, vector_id)
        insert_dna = normalize_dna(str(fields.get("insertDna") or ""))
        translation_report: dict[str, Any] | None = None
        if not insert_dna:
            protein = str(fields.get("protein") or "")
            if not protein:
                raise ValueError("Provide either insert DNA or a protein sequence")
            translation_report = back_translate(
                protein,
                host=str(fields.get("host") or "ecoli"),
                avoid_enzymes=[str(name) for name in (fields.get("avoidEnzymes") or [])],
                include_stop=fields.get("includeStop") is not False,
            )
            insert_dna = translation_report["dna"]
        result = insert_target_sequence(
            vector,
            insert_dna=insert_dna,
            start=int(fields.get("start") or 0),
            end=None if fields.get("end") is None else int(fields["end"]),
            strand=int(fields.get("strand") or 1),
            name=str(fields.get("name") or "Target CDS"),
            keep_frame=fields.get("keepFrame") is not False,
        )
        updated = dict(vector)
        updated["sequence"] = result["sequence"]
        updated["features"] = result["features"]
        updated["history"] = [*(vector.get("history") or []), *result["history"]]
        saved = self.save_expression_vector(protein_id, updated, vector_id)
        saved["insertReport"] = result["report"]
        if translation_report is not None:
            saved["backTranslation"] = translation_report
        return saved

    def digest_expression_vector(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        enzymes = fields.get("enzymeNames") or vector.get("enzymeNames") or COMMON_ENZYMES
        if not isinstance(enzymes, list) or len(enzymes) > 250:
            raise ValueError("Select between 1 and 250 restriction enzymes")
        return simulate_restriction_digest(
            vector["sequence"],
            circular=bool(vector.get("circular", True)),
            enzyme_names=[str(name) for name in enzymes],
        )

    def analyze_expression_vector_enzymes(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector = self.database.get_expression_vector(protein_id, vector_id)
        insert_sequence = str(fields.get("insertSequence") or "")
        insert_id = str(fields.get("insertVectorId") or "")
        if insert_id:
            insert_sequence = self.database.get_expression_vector(protein_id, insert_id)["sequence"]
        mcs = fields.get("mcs") or {}
        names = fields.get("enzymeNames") or vector.get("enzymeNames") or COMMON_ENZYMES
        if not isinstance(names, list) or not names or len(names) > 250:
            raise ValueError("Select between 1 and 250 restriction enzymes")
        return enzyme_analysis(
            vector["sequence"],
            insert_sequence=insert_sequence,
            enzyme_names=[str(name) for name in names],
            mcs_start=None if mcs.get("start") is None else int(mcs["start"]),
            mcs_end=None if mcs.get("end") is None else int(mcs["end"]),
            supplier=str(fields.get("supplier") or "") or None,
            circular=bool(vector.get("circular", True)),
        )

    def simulate_expression_vector_gel(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        lanes = fields.get("lanes") or []
        if not isinstance(lanes, list) or not lanes or len(lanes) > 24:
            raise ValueError("A gel requires between 1 and 24 sample lanes")
        prepared = []
        for lane in lanes:
            if not isinstance(lane, dict):
                raise ValueError("Every gel lane must be an object")
            item = dict(lane)
            vector_id = str(item.get("vectorId") or "")
            if vector_id:
                vector = self.database.get_expression_vector(protein_id, vector_id)
                item["name"] = item.get("name") or vector["name"]
                enzyme_names = [str(name) for name in (item.get("enzymeNames") or [])]
                if enzyme_names:
                    digest = simulate_restriction_digest(
                        vector["sequence"],
                        circular=bool(vector.get("circular", True)),
                        enzyme_names=enzyme_names,
                    )
                    item["fragments"] = digest["fragments"]
                else:
                    item["bandSizes"] = [len(vector["sequence"])]
                    item["uncut"] = {
                        "sizeBp": len(vector["sequence"]),
                        "forms": ["supercoiled", "nicked/open-circle", "linear"],
                        "note": (
                            "Rendered as one size-equivalent band. Uncut plasmids can show "
                            "multiple topology-dependent apparent mobilities."
                        ),
                    }
            prepared.append(item)
        return simulate_gel(prepared, ladder=str(fields.get("ladder") or "1kb"))

    def simulate_expression_cloning(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        method = str(fields.get("method") or "").lower().replace("_", "-")
        backbone = self.database.get_expression_vector(
            protein_id, str(fields.get("backboneVectorId") or "")
        )
        insert = self.database.get_expression_vector(
            protein_id, str(fields.get("insertVectorId") or "")
        )
        if method == "restriction-ligation":
            return restriction_ligation_preview(
                backbone,
                insert,
                backbone_enzymes=[str(name) for name in (fields.get("backboneEnzymes") or [])],
                insert_enzymes=[str(name) for name in (fields.get("insertEnzymes") or [])] or None,
            )
        if method in {"gibson", "in-fusion", "infusion"}:
            vectors = [backbone, insert]
            result = assemble_by_overlap(
                vectors,
                minimum_overlap=int(fields.get("minimumOverlap", 20)),
                circular=bool(fields.get("circular", False)),
            )
            return {
                "method": "in-fusion" if method in {"in-fusion", "infusion"} else "gibson",
                "product": {
                    "sequence": result["sequence"],
                    "circular": result["circular"],
                    "features": result["features"],
                },
                "junctions": result["junctions"],
                "warnings": assembly_warnings(result["sequence"], result["features"]),
                "lostFeatures": [],
            }
        if method in {"gateway-bp", "gateway-lr"}:
            return gateway_preview(
                backbone,
                insert,
                reaction=method.rsplit("-", 1)[1],
                backbone_start=int(fields.get("backboneStart", 0)),
                backbone_end=int(fields.get("backboneEnd", len(backbone["sequence"]))),
                insert_start=int(fields.get("insertStart", 0)),
                insert_end=(
                    None if fields.get("insertEnd") is None else int(fields["insertEnd"])
                ),
            )
        raise ValueError(
            "Cloning method must be restriction-ligation, gibson, in-fusion, gateway-bp, or gateway-lr"
        )

    def align_expression_vectors(
        self, protein_id: str, vector_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        reference = self.database.get_expression_vector(protein_id, vector_id)
        query_id = str(fields.get("queryVectorId") or "")
        if not query_id or query_id == vector_id:
            raise ValueError("Select a different project vector to align")
        query = self.database.get_expression_vector(protein_id, query_id)
        result = align_dna_sequences(reference["sequence"], query["sequence"])
        return {
            **result,
            "reference": {"id": reference["id"], "name": reference["name"]},
            "query": {"id": query["id"], "name": query["name"]},
        }

    def assemble_expression_vectors(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        vector_ids = fields.get("vectorIds") or []
        if not isinstance(vector_ids, list) or len(vector_ids) < 2 or len(vector_ids) > 20:
            raise ValueError("Select between 2 and 20 vectors in assembly order")
        vectors = [
            self.database.get_expression_vector(protein_id, str(vector_id))
            for vector_id in vector_ids
        ]
        minimum = int(fields.get("minimumOverlap") or 20)
        result = assemble_by_overlap(
            vectors,
            minimum_overlap=minimum,
            circular=bool(fields.get("circular", False)),
        )
        name = str(fields.get("name") or "Overlap assembly").strip()
        history = [{
            "type": "AssemblySource",
            "assemblyMethod": "exact overlap assembly",
            "input": [vector["id"] for vector in vectors],
            "minimumOverlap": minimum,
            "junctions": result["junctions"],
            "closingOverlapLength": result["closingOverlapLength"],
            "outputName": name,
        }]
        saved = self.save_expression_vector(
            protein_id,
            {
                "name": name,
                "sequence": result["sequence"],
                "circular": result["circular"],
                "features": result["features"],
                "primers": result["primers"],
                "history": history,
            },
        )
        saved["assemblyReport"] = {
            "inputs": [vector["name"] for vector in vectors],
            "junctions": result["junctions"],
            "closingOverlapLength": result["closingOverlapLength"],
        }
        return saved

    def describe_vector_sources(self) -> dict[str, Any]:
        return {"sources": describe_sources()}

    def list_vector_source_sets(self, source: str) -> dict[str, Any]:
        if source != "snapgene":
            return {"sets": []}
        return {"sets": list_snapgene_sets(self.email)}

    def search_vector_sources(self, body: dict[str, Any]) -> dict[str, Any]:
        results = search_vectors(
            str(body.get("source") or "snapgene"),
            str(body.get("query") or ""),
            set_id=str(body.get("set") or ""),
            limit=int(body.get("limit") or 25),
            email=self.email,
        )
        return {"results": results}

    def load_vector_from_source(
        self, protein_id: str, body: dict[str, Any]
    ) -> dict[str, Any]:
        """Download a backbone from a named source and save it to the project."""
        parsed = fetch_vector(
            str(body.get("source") or ""),
            str(body.get("identifier") or ""),
            set_id=str(body.get("set") or ""),
            email=self.email,
            annotate=body.get("annotate") is not False,
            minimum_orf_amino_acids=int(body.get("minimumOrfAminoAcids") or 50),
        )
        if str(body.get("name") or "").strip():
            parsed["name"] = str(body["name"]).strip()
        return self.save_expression_vector(protein_id, parsed)

    def import_expression_vector(
        self, protein_id: str, filename: str, content: str
    ) -> dict[str, Any]:
        if len(content) > 15_000_000:
            raise ValueError("The sequence file is too large")
        parsed = parse_sequence_file(content, filename)
        return self.save_expression_vector(protein_id, parsed)

    def export_expression_vector(
        self, protein_id: str, vector_id: str, file_format: str
    ) -> dict[str, Any]:
        if file_format not in {"genbank", "fasta", "snapgene"}:
            raise ValueError("Export format must be genbank, fasta, or snapgene")
        vector = self.database.get_expression_vector(protein_id, vector_id)
        extension = {"genbank": "gb", "fasta": "fasta", "snapgene": "dna"}[file_format]
        return {
            "filename": f"{vector['name']}.{extension}",
            "format": file_format,
            "content": export_sequence(vector, file_format),
            "encoding": "base64" if file_format == "snapgene" else "text",
        }

    def save_project_notebook(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        title = str(fields.get("title") or "Purification report").strip()
        summary = str(fields.get("summary") or "").strip()
        sections = fields.get("sections") or []
        if not title or len(title) > 200:
            raise ValueError("Notebook titles must be 1 to 200 characters")
        if len(summary) > 10_000:
            raise ValueError("Notebook summaries must be 10,000 characters or fewer")
        if not isinstance(sections, list) or len(sections) > 200:
            raise ValueError("A notebook can contain up to 200 sections")
        cleaned: list[dict[str, Any]] = []
        for index, section in enumerate(sections):
            if not isinstance(section, dict):
                raise ValueError("Every notebook section must be an object")
            section_title = str(section.get("title") or f"Section {index + 1}").strip()
            content = str(section.get("content") or "")
            if len(section_title) > 200 or len(content) > 100_000:
                raise ValueError("A notebook section is too large")
            # Report pages carry structured layout state (which figures are
            # placed, their captions, which blocks are hidden) alongside the
            # prose, so a section keeps an arbitrary but bounded data object.
            data = section.get("data")
            if data is None:
                data = {}
            if not isinstance(data, dict):
                raise ValueError("Notebook section data must be an object")
            if len(json.dumps(data)) > 200_000:
                raise ValueError("A notebook section is too large")
            cleaned.append({
                "id": str(section.get("id") or uuid.uuid4()),
                "type": str(section.get("type") or "note")[:40],
                "title": section_title,
                "content": content,
                "data": data,
                "sourceJobId": str(section.get("sourceJobId") or ""),
                "sourceAppType": str(section.get("sourceAppType") or ""),
                "sourceLabel": str(section.get("sourceLabel") or ""),
                "capturedAt": str(section.get("capturedAt") or utc_now()),
            })
        return self.database.save_project_notebook(
            protein_id, title, summary, cleaned
        )

    def start_research(
        self,
        protein_id: str,
        *,
        blast_database: str = "swissprot",
        blast_hits: int = 25,
        pdb_hits: int = 10,
        identity_cutoff: float = 0.3,
        evalue_cutoff: float = 1e-3,
    ) -> dict[str, Any]:
        """Start asynchronous BLAST and synchronously collect PDB evidence."""
        blast = self.submit_blast(
            protein_id, database=blast_database, hitlist_size=blast_hits
        )
        pdb = self.search_pdb(
            protein_id,
            identity_cutoff=identity_cutoff,
            evalue_cutoff=evalue_cutoff,
            limit=pdb_hits,
        )
        return {
            "proteinId": protein_id,
            "blast": blast,
            "pdbMatches": pdb,
            "nextAction": f"Poll /v1/protein-planner/blast/{blast['rid']}",
        }
