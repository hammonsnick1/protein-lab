"""Protein Planner application service."""

from __future__ import annotations

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
    RCSBClient,
    RemoteServiceError,
    UniProtClient,
    global_sequence_metrics,
    parse_structure_geometry,
    structure_preview,
)
from .protparam import analyze_sequence, normalize_sequence
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
    available_hosts,
    back_translate,
    insert_target_sequence,
    insertion_sites,
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
        email: str = "",
    ):
        self.database = database
        self.blast = blast
        self.uniprot = uniprot
        self.rcsb = rcsb
        self.alphafold = alphafold
        self.email = email

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
        features = normalize_features(fields.get("features") or [], len(sequence))
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
                "circular": bool(fields.get("circular", True)),
                "features": features,
                "primers": primers,
                "enzymeNames": enzyme_names,
                "minimumOrfAminoAcids": minimum_orf_amino_acids,
                "history": history,
            },
            vector_id,
        )
        # Naming and saving a vector is what publishes it: the catalogue keeps
        # one entry per distinct sequence and records this project against it.
        self.database.record_vector_use(protein_id, value)
        return vector_preview(value)

    # ------------------------------------------------------------------
    # Shared vector library
    # ------------------------------------------------------------------
    def list_library_vectors(self) -> list[dict[str, Any]]:
        return self.database.list_library_vectors()

    def get_library_vector(self, library_id: str) -> dict[str, Any]:
        return self.database.get_library_vector(library_id)

    def delete_library_vector(self, library_id: str) -> None:
        self.database.delete_library_vector(library_id)

    def copy_library_vector(self, protein_id: str, library_id: str) -> dict[str, Any]:
        """Bring a catalogued vector into a project, recording the new use."""
        source = self.database.get_library_vector(library_id)
        return self.save_expression_vector(protein_id, {
            "name": source["name"],
            "sequence": source["sequence"],
            "circular": source["circular"],
            "features": source["features"],
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
        primers = design_pcr_primers(
            vector["sequence"],
            int(fields.get("start", 0)),
            int(fields.get("end", len(vector["sequence"]))),
            int(fields.get("primerLength", 20)),
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
        if file_format not in {"genbank", "fasta"}:
            raise ValueError("Export format must be genbank or fasta")
        vector = self.database.get_expression_vector(protein_id, vector_id)
        return {
            "filename": f"{vector['name']}.{'gb' if file_format == 'genbank' else 'fasta'}",
            "format": file_format,
            "content": export_sequence(vector, file_format),
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
