"""SQLite persistence for Protein Planner.

The database deliberately stores both normalized search metadata and the full
source-derived JSON. This keeps common UI queries fast without throwing away
provenance needed to revisit a scientific claim later.
"""

from __future__ import annotations

from contextlib import contextmanager
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import sqlite3
from typing import Any, Iterator
import uuid


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _loads(value: str | None, fallback: Any) -> Any:
    if not value:
        return fallback
    return json.loads(value)


class ProteinNotFoundError(LookupError):
    """Raised when a protein record does not exist."""


class Database:
    def __init__(self, path: str | Path):
        self.path = Path(path).expanduser().resolve()
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self.initialize()

    @contextmanager
    def connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=15)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.execute("PRAGMA busy_timeout = 5000")
        try:
            yield connection
            connection.commit()
        except Exception:
            connection.rollback()
            raise
        finally:
            connection.close()

    def initialize(self) -> None:
        with self.connect() as connection:
            connection.execute("PRAGMA journal_mode = WAL")
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS proteins (
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

                CREATE TABLE IF NOT EXISTS protparam_results (
                    protein_id TEXT PRIMARY KEY REFERENCES proteins(id) ON DELETE CASCADE,
                    result_json TEXT NOT NULL,
                    analyzed_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS blast_jobs (
                    rid TEXT PRIMARY KEY,
                    protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                    status TEXT NOT NULL,
                    params_json TEXT NOT NULL,
                    results_json TEXT,
                    submitted_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    error TEXT
                );

                CREATE TABLE IF NOT EXISTS uniprot_matches (
                    protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                    accession TEXT NOT NULL,
                    source TEXT NOT NULL,
                    identity REAL,
                    query_coverage REAL,
                    evalue REAL,
                    record_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (protein_id, accession)
                );

                CREATE TABLE IF NOT EXISTS pdb_matches (
                    protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                    pdb_id TEXT NOT NULL,
                    entity_id TEXT NOT NULL,
                    score REAL,
                    identity REAL,
                    evalue REAL,
                    record_json TEXT NOT NULL,
                    fetched_at TEXT NOT NULL,
                    PRIMARY KEY (protein_id, pdb_id, entity_id)
                );

                CREATE TABLE IF NOT EXISTS alphafold_models (
                    protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                    model_id TEXT NOT NULL,
                    source TEXT NOT NULL,
                    accession TEXT NOT NULL DEFAULT '',
                    name TEXT NOT NULL DEFAULT '',
                    file_format TEXT NOT NULL,
                    structure_text TEXT NOT NULL,
                    metadata_json TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    PRIMARY KEY (protein_id, model_id)
                );

                CREATE TABLE IF NOT EXISTS project_jobs (
                    id TEXT PRIMARY KEY,
                    protein_id TEXT NOT NULL REFERENCES proteins(id) ON DELETE CASCADE,
                    name TEXT NOT NULL,
                    app_type TEXT NOT NULL,
                    status TEXT NOT NULL DEFAULT 'ready',
                    config_json TEXT NOT NULL DEFAULT '{}',
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS project_notebooks (
                    protein_id TEXT PRIMARY KEY REFERENCES proteins(id) ON DELETE CASCADE,
                    title TEXT NOT NULL,
                    summary TEXT NOT NULL DEFAULT '',
                    sections_json TEXT NOT NULL DEFAULT '[]',
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS expression_vectors (
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

                -- One shared catalogue of every vector that has been saved,
                -- identified by its sequence so the same construct saved in
                -- two projects is one entry used twice.
                CREATE TABLE IF NOT EXISTS vector_library (
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

                CREATE TABLE IF NOT EXISTS vector_library_uses (
                    library_id TEXT NOT NULL
                        REFERENCES vector_library(id) ON DELETE CASCADE,
                    protein_id TEXT NOT NULL
                        REFERENCES proteins(id) ON DELETE CASCADE,
                    vector_id TEXT NOT NULL,
                    first_used_at TEXT NOT NULL,
                    last_used_at TEXT NOT NULL,
                    PRIMARY KEY (library_id, protein_id)
                );

                CREATE INDEX IF NOT EXISTS idx_vector_library_updated
                    ON vector_library(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_vector_library_uses_protein
                    ON vector_library_uses(protein_id);

                CREATE INDEX IF NOT EXISTS idx_proteins_updated
                    ON proteins(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_blast_protein
                    ON blast_jobs(protein_id, submitted_at DESC);
                CREATE INDEX IF NOT EXISTS idx_uniprot_protein
                    ON uniprot_matches(protein_id);
                CREATE INDEX IF NOT EXISTS idx_pdb_protein
                    ON pdb_matches(protein_id);
                CREATE INDEX IF NOT EXISTS idx_alphafold_protein
                    ON alphafold_models(protein_id, imported_at DESC);
                CREATE INDEX IF NOT EXISTS idx_project_jobs_protein
                    ON project_jobs(protein_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_expression_vectors_protein
                    ON expression_vectors(protein_id, updated_at DESC);
                """
            )
            vector_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(expression_vectors)"
                ).fetchall()
            }
            if "primers_json" not in vector_columns:
                connection.execute(
                    "ALTER TABLE expression_vectors ADD COLUMN primers_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "enzyme_names_json" not in vector_columns:
                connection.execute(
                    "ALTER TABLE expression_vectors ADD COLUMN enzyme_names_json TEXT NOT NULL DEFAULT '[]'"
                )
            if "minimum_orf_amino_acids" not in vector_columns:
                connection.execute(
                    "ALTER TABLE expression_vectors ADD COLUMN minimum_orf_amino_acids INTEGER NOT NULL DEFAULT 50"
                )

    def create_protein(self, fields: dict[str, Any], sequence: str) -> dict[str, Any]:
        protein_id = str(uuid.uuid4())
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO proteins (
                    id, name, sequence, organism, gene_name, description,
                    expression_system, notes, tags_json, external_ids_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    protein_id,
                    str(fields.get("name") or "Untitled protein").strip(),
                    sequence,
                    str(fields.get("organism") or "").strip(),
                    str(fields.get("geneName") or "").strip(),
                    str(fields.get("description") or "").strip(),
                    str(fields.get("expressionSystem") or "").strip(),
                    str(fields.get("notes") or ""),
                    json.dumps(fields.get("tags") or []),
                    json.dumps(fields.get("externalIds") or {}),
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_protein(protein_id)

    def list_proteins(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM proteins ORDER BY updated_at DESC"
            ).fetchall()
            models = connection.execute(
                "SELECT * FROM alphafold_models ORDER BY imported_at DESC"
            ).fetchall()
        latest_models: dict[str, dict[str, Any]] = {}
        for row in models:
            latest_models.setdefault(row["protein_id"], self._alphafold(row))
        proteins = [self._protein(row) for row in rows]
        for protein in proteins:
            protein["alphaFoldModel"] = latest_models.get(protein["id"])
        return proteins

    def get_protein(self, protein_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM proteins WHERE id = ?", (protein_id,)
            ).fetchone()
        if row is None:
            raise ProteinNotFoundError(f"Protein {protein_id!r} was not found")
        return self._protein(row)

    def update_protein(
        self, protein_id: str, fields: dict[str, Any], sequence: str | None = None
    ) -> dict[str, Any]:
        current = self.get_protein(protein_id)
        merged = {**current, **fields}
        next_sequence = sequence if sequence is not None else current["sequence"]
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                UPDATE proteins SET
                    name = ?, sequence = ?, organism = ?, gene_name = ?,
                    description = ?, expression_system = ?, notes = ?,
                    tags_json = ?, external_ids_json = ?, updated_at = ?
                WHERE id = ?
                """,
                (
                    str(merged.get("name") or "Untitled protein").strip(),
                    next_sequence,
                    str(merged.get("organism") or "").strip(),
                    str(merged.get("geneName") or "").strip(),
                    str(merged.get("description") or "").strip(),
                    str(merged.get("expressionSystem") or "").strip(),
                    str(merged.get("notes") or ""),
                    json.dumps(merged.get("tags") or []),
                    json.dumps(merged.get("externalIds") or {}),
                    timestamp,
                    protein_id,
                ),
            )
            if sequence is not None and sequence != current["sequence"]:
                connection.execute(
                    "DELETE FROM protparam_results WHERE protein_id = ?", (protein_id,)
                )
                connection.execute(
                    "DELETE FROM alphafold_models WHERE protein_id = ?", (protein_id,)
                )
        return self.get_protein(protein_id)

    def delete_protein(self, protein_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM proteins WHERE id = ?", (protein_id,)
            )
            if cursor.rowcount == 0:
                raise ProteinNotFoundError(f"Protein {protein_id!r} was not found")

    def save_protparam(self, protein_id: str, result: dict[str, Any]) -> None:
        self.get_protein(protein_id)
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO protparam_results (protein_id, result_json, analyzed_at)
                VALUES (?, ?, ?)
                ON CONFLICT(protein_id) DO UPDATE SET
                    result_json = excluded.result_json,
                    analyzed_at = excluded.analyzed_at
                """,
                (protein_id, json.dumps(result, allow_nan=False), timestamp),
            )

    def get_bundle(self, protein_id: str) -> dict[str, Any]:
        protein = self.get_protein(protein_id)
        with self.connect() as connection:
            protparam = connection.execute(
                "SELECT result_json, analyzed_at FROM protparam_results WHERE protein_id = ?",
                (protein_id,),
            ).fetchone()
            blast = connection.execute(
                "SELECT * FROM blast_jobs WHERE protein_id = ? ORDER BY submitted_at DESC",
                (protein_id,),
            ).fetchall()
            uniprot = connection.execute(
                "SELECT * FROM uniprot_matches WHERE protein_id = ? ORDER BY identity DESC",
                (protein_id,),
            ).fetchall()
            pdb = connection.execute(
                "SELECT * FROM pdb_matches WHERE protein_id = ? ORDER BY identity IS NULL, identity DESC, score DESC",
                (protein_id,),
            ).fetchall()
            alphafold = connection.execute(
                "SELECT * FROM alphafold_models WHERE protein_id = ? ORDER BY imported_at DESC",
                (protein_id,),
            ).fetchall()
            jobs = connection.execute(
                "SELECT * FROM project_jobs WHERE protein_id = ? ORDER BY created_at",
                (protein_id,),
            ).fetchall()
            notebook = connection.execute(
                "SELECT * FROM project_notebooks WHERE protein_id = ?",
                (protein_id,),
            ).fetchone()
        return {
            "protein": protein,
            "protparam": None if protparam is None else {
                "result": json.loads(protparam["result_json"]),
                "analyzedAt": protparam["analyzed_at"],
            },
            "blastJobs": [self._blast(row) for row in blast],
            "uniprotMatches": [self._uniprot(row) for row in uniprot],
            "pdbMatches": [self._pdb(row) for row in pdb],
            "alphaFoldModels": [self._alphafold(row) for row in alphafold],
            "projectJobs": [self._project_job(row) for row in jobs],
            "projectNotebook": None if notebook is None else self._notebook(notebook),
        }

    def save_project_notebook(
        self,
        protein_id: str,
        title: str,
        summary: str,
        sections: list[dict[str, Any]],
    ) -> dict[str, Any]:
        self.get_protein(protein_id)
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO project_notebooks (
                    protein_id, title, summary, sections_json, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(protein_id) DO UPDATE SET
                    title = excluded.title,
                    summary = excluded.summary,
                    sections_json = excluded.sections_json,
                    updated_at = excluded.updated_at
                """,
                (
                    protein_id,
                    title,
                    summary,
                    json.dumps(sections, allow_nan=False),
                    timestamp,
                ),
            )
            row = connection.execute(
                "SELECT * FROM project_notebooks WHERE protein_id = ?",
                (protein_id,),
            ).fetchone()
        assert row is not None
        return self._notebook(row)

    def create_project_job(
        self, protein_id: str, name: str, app_type: str, config: dict[str, Any]
    ) -> dict[str, Any]:
        self.get_protein(protein_id)
        job_id = str(uuid.uuid4())
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO project_jobs (
                    id, protein_id, name, app_type, status, config_json,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, 'ready', ?, ?, ?)
                """,
                (
                    job_id,
                    protein_id,
                    name.strip(),
                    app_type,
                    json.dumps(config or {}),
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_project_job(job_id)

    def update_project_job(
        self,
        protein_id: str,
        job_id: str,
        *,
        name: str,
        status: str,
        config: dict[str, Any],
    ) -> dict[str, Any]:
        self.get_protein(protein_id)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE project_jobs
                SET name = ?, status = ?, config_json = ?, updated_at = ?
                WHERE id = ? AND protein_id = ?
                """,
                (
                    name.strip(),
                    status,
                    json.dumps(config or {}, allow_nan=False),
                    utc_now(),
                    job_id,
                    protein_id,
                ),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project job {job_id!r} was not found")
        return self.get_project_job(job_id)

    def delete_project_job(self, protein_id: str, job_id: str) -> None:
        self.get_protein(protein_id)
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM project_jobs WHERE id = ? AND protein_id = ?",
                (job_id, protein_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project job {job_id!r} was not found")

    def list_expression_vectors(self, protein_id: str) -> list[dict[str, Any]]:
        self.get_protein(protein_id)
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT * FROM expression_vectors
                WHERE protein_id = ? ORDER BY updated_at DESC
                """,
                (protein_id,),
            ).fetchall()
        return [self._expression_vector(row) for row in rows]

    def get_expression_vector(
        self, protein_id: str, vector_id: str
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM expression_vectors
                WHERE protein_id = ? AND id = ?
                """,
                (protein_id, vector_id),
            ).fetchone()
        if row is None:
            raise LookupError(f"Expression vector {vector_id!r} was not found")
        return self._expression_vector(row)

    def save_expression_vector(
        self,
        protein_id: str,
        vector: dict[str, Any],
        vector_id: str | None = None,
    ) -> dict[str, Any]:
        self.get_protein(protein_id)
        timestamp = utc_now()
        if vector_id is None:
            vector_id = str(uuid.uuid4())
            created_at = timestamp
        else:
            current = self.get_expression_vector(protein_id, vector_id)
            created_at = current["createdAt"]
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO expression_vectors (
                    id, protein_id, name, sequence, circular, features_json,
                    primers_json, enzyme_names_json, minimum_orf_amino_acids,
                    history_json, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    sequence = excluded.sequence,
                    circular = excluded.circular,
                    features_json = excluded.features_json,
                    primers_json = excluded.primers_json,
                    enzyme_names_json = excluded.enzyme_names_json,
                    minimum_orf_amino_acids = excluded.minimum_orf_amino_acids,
                    history_json = excluded.history_json,
                    updated_at = excluded.updated_at
                """,
                (
                    vector_id,
                    protein_id,
                    vector["name"],
                    vector["sequence"],
                    1 if vector.get("circular", True) else 0,
                    json.dumps(vector.get("features") or [], allow_nan=False),
                    json.dumps(vector.get("primers") or [], allow_nan=False),
                    json.dumps(vector.get("enzymeNames") or [], allow_nan=False),
                    int(vector.get("minimumOrfAminoAcids") or 50),
                    json.dumps(vector.get("history") or [], allow_nan=False),
                    created_at,
                    timestamp,
                ),
            )
        return self.get_expression_vector(protein_id, vector_id)

    # ------------------------------------------------------------------
    # Shared vector library
    # ------------------------------------------------------------------
    def record_vector_use(
        self, protein_id: str, vector: dict[str, Any]
    ) -> dict[str, Any]:
        """Add or refresh a vector in the catalogue and note this project's use.

        Naming and saving a vector in a project is what puts it in the
        catalogue, so every project that reaches for the same construct adds
        itself to that entry rather than creating a second one.
        """
        sequence = str(vector.get("sequence") or "")
        if not sequence:
            raise ValueError("A catalogued vector needs a sequence")
        fingerprint = hashlib.sha256(sequence.upper().encode("utf-8")).hexdigest()
        features = vector.get("features") or []
        insert_name = ""
        for feature in features:
            if isinstance(feature, dict) and feature.get("isInsert"):
                insert_name = str(feature.get("name") or "")
                break
        timestamp = utc_now()
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM vector_library WHERE fingerprint = ?",
                (fingerprint,),
            ).fetchone()
            if row is None:
                library_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO vector_library (
                        id, fingerprint, name, sequence, circular,
                        features_json, insert_name, notes, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', ?, ?)
                    """,
                    (
                        library_id,
                        fingerprint,
                        str(vector.get("name") or "Untitled vector"),
                        sequence,
                        1 if vector.get("circular", True) else 0,
                        json.dumps(features, allow_nan=False),
                        insert_name,
                        timestamp,
                        timestamp,
                    ),
                )
            else:
                library_id = row["id"]
                connection.execute(
                    """
                    UPDATE vector_library
                    SET name = ?, circular = ?, features_json = ?,
                        insert_name = ?, updated_at = ?
                    WHERE id = ?
                    """,
                    (
                        str(vector.get("name") or row["name"]),
                        1 if vector.get("circular", True) else 0,
                        json.dumps(features, allow_nan=False),
                        insert_name or row["insert_name"],
                        timestamp,
                        library_id,
                    ),
                )
            connection.execute(
                """
                INSERT INTO vector_library_uses (
                    library_id, protein_id, vector_id, first_used_at, last_used_at
                ) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT(library_id, protein_id) DO UPDATE SET
                    vector_id = excluded.vector_id,
                    last_used_at = excluded.last_used_at
                """,
                (
                    library_id,
                    protein_id,
                    str(vector.get("id") or ""),
                    timestamp,
                    timestamp,
                ),
            )
        return self.get_library_vector(library_id)

    def list_library_vectors(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM vector_library ORDER BY updated_at DESC"
            ).fetchall()
            return [self._library_vector(connection, row, full=False) for row in rows]

    def get_library_vector(self, library_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM vector_library WHERE id = ?", (library_id,)
            ).fetchone()
            if row is None:
                raise LookupError(f"Catalogued vector {library_id!r} was not found")
            return self._library_vector(connection, row, full=True)

    def delete_library_vector(self, library_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM vector_library WHERE id = ?", (library_id,)
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Catalogued vector {library_id!r} was not found")

    def _library_vector(
        self, connection: sqlite3.Connection, row: sqlite3.Row, full: bool
    ) -> dict[str, Any]:
        uses = connection.execute(
            """
            SELECT u.protein_id, u.vector_id, u.first_used_at, u.last_used_at,
                   p.name AS protein_name
            FROM vector_library_uses u
            JOIN proteins p ON p.id = u.protein_id
            WHERE u.library_id = ?
            ORDER BY u.first_used_at
            """,
            (row["id"],),
        ).fetchall()
        features = json.loads(row["features_json"])
        record: dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "lengthBp": len(row["sequence"]),
            "circular": bool(row["circular"]),
            "featureCount": len(features),
            "insertName": row["insert_name"],
            "notes": row["notes"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "projects": [
                {
                    "proteinId": use["protein_id"],
                    "proteinName": use["protein_name"],
                    "vectorId": use["vector_id"],
                    "firstUsedAt": use["first_used_at"],
                    "lastUsedAt": use["last_used_at"],
                }
                for use in uses
            ],
        }
        record["projectCount"] = len(record["projects"])
        if full:
            record["sequence"] = row["sequence"]
            record["features"] = features
        return record

    def delete_expression_vector(self, protein_id: str, vector_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM expression_vectors WHERE protein_id = ? AND id = ?",
                (protein_id, vector_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Expression vector {vector_id!r} was not found")

    def get_project_job(self, job_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM project_jobs WHERE id = ?", (job_id,)
            ).fetchone()
        if row is None:
            raise LookupError(f"Project job {job_id!r} was not found")
        return self._project_job(row)

    def save_blast_job(
        self, protein_id: str, rid: str, status: str, params: dict[str, Any]
    ) -> None:
        timestamp = utc_now()
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO blast_jobs (
                    rid, protein_id, status, params_json, submitted_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(rid) DO UPDATE SET status = excluded.status,
                    params_json = excluded.params_json, updated_at = excluded.updated_at
                """,
                (rid, protein_id, status, json.dumps(params), timestamp, timestamp),
            )

    def update_blast_job(
        self,
        rid: str,
        status: str,
        results: list[dict[str, Any]] | None = None,
        error: str | None = None,
    ) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE blast_jobs SET status = ?, results_json = ?, error = ?, updated_at = ?
                WHERE rid = ?
                """,
                (
                    status,
                    None if results is None else json.dumps(results, allow_nan=False),
                    error,
                    utc_now(),
                    rid,
                ),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"BLAST job {rid!r} was not found")

    def get_blast_job(self, rid: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM blast_jobs WHERE rid = ?", (rid,)
            ).fetchone()
        if row is None:
            raise LookupError(f"BLAST job {rid!r} was not found")
        return self._blast(row)

    def cancel_blast_job(self, rid: str) -> dict[str, Any]:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE blast_jobs
                SET status = 'canceled', error = ?, updated_at = ?
                WHERE rid = ? AND status NOT IN ('complete', 'failed', 'canceled')
                """,
                ("Terminated locally by the user", utc_now(), rid),
            )
            if cursor.rowcount == 0:
                existing = connection.execute(
                    "SELECT rid FROM blast_jobs WHERE rid = ?", (rid,)
                ).fetchone()
                if existing is None:
                    raise LookupError(f"BLAST job {rid!r} was not found")
        return self.get_blast_job(rid)

    def cancel_superseded_blast_jobs(
        self, protein_id: str, keep_rid: str, purpose: str
    ) -> None:
        """Stop older local polling records after a replacement submits."""
        timestamp = utc_now()
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT rid, params_json FROM blast_jobs
                WHERE protein_id = ? AND rid != ? AND status = 'waiting'
                """,
                (protein_id, keep_rid),
            ).fetchall()
            superseded = [
                row["rid"]
                for row in rows
                if _loads(row["params_json"], {}).get("purpose", "blast")
                == purpose
            ]
            connection.executemany(
                """
                UPDATE blast_jobs
                SET status = 'canceled', error = ?, updated_at = ?
                WHERE rid = ?
                """,
                [
                    ("Superseded by a newer search", timestamp, rid)
                    for rid in superseded
                ],
            )

    def save_uniprot_match(
        self,
        protein_id: str,
        record: dict[str, Any],
        source: str,
        metrics: dict[str, Any] | None = None,
    ) -> None:
        metrics = metrics or {}
        accession = str(record["accession"])
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO uniprot_matches (
                    protein_id, accession, source, identity, query_coverage,
                    evalue, record_json, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(protein_id, accession) DO UPDATE SET
                    source = excluded.source, identity = excluded.identity,
                    query_coverage = excluded.query_coverage,
                    evalue = excluded.evalue, record_json = excluded.record_json,
                    fetched_at = excluded.fetched_at
                """,
                (
                    protein_id,
                    accession,
                    source,
                    metrics.get("identity"),
                    metrics.get("queryCoverage"),
                    metrics.get("evalue"),
                    json.dumps(record, allow_nan=False),
                    utc_now(),
                ),
            )

    def save_pdb_match(self, protein_id: str, record: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO pdb_matches (
                    protein_id, pdb_id, entity_id, score, identity, evalue,
                    record_json, fetched_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(protein_id, pdb_id, entity_id) DO UPDATE SET
                    score = excluded.score, identity = excluded.identity,
                    evalue = excluded.evalue, record_json = excluded.record_json,
                    fetched_at = excluded.fetched_at
                """,
                (
                    protein_id,
                    str(record["pdbId"]),
                    str(record["entityId"]),
                    record.get("score"),
                    record.get("identity"),
                    record.get("evalue"),
                    json.dumps(record, allow_nan=False),
                    utc_now(),
                ),
            )

    def save_alphafold_model(self, protein_id: str, model: dict[str, Any]) -> None:
        self.get_protein(protein_id)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO alphafold_models (
                    protein_id, model_id, source, accession, name, file_format,
                    structure_text, metadata_json, imported_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(protein_id, model_id) DO UPDATE SET
                    source = excluded.source,
                    accession = excluded.accession,
                    name = excluded.name,
                    file_format = excluded.file_format,
                    structure_text = excluded.structure_text,
                    metadata_json = excluded.metadata_json,
                    imported_at = excluded.imported_at
                """,
                (
                    protein_id,
                    str(model["modelId"]),
                    str(model.get("source") or "AlphaFold Server"),
                    str(model.get("accession") or ""),
                    str(model.get("name") or model["modelId"]),
                    str(model.get("format") or "cif"),
                    str(model["structureText"]),
                    json.dumps(model.get("metadata") or {}, allow_nan=False),
                    utc_now(),
                ),
            )

    def get_alphafold_model(self, protein_id: str, model_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM alphafold_models
                WHERE protein_id = ? AND model_id = ?
                """,
                (protein_id, model_id),
            ).fetchone()
        if row is None:
            raise LookupError(f"AlphaFold model {model_id!r} was not found")
        value = self._alphafold(row)
        value["structureText"] = row["structure_text"]
        return value

    @staticmethod
    def _protein(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "name": row["name"],
            "sequence": row["sequence"],
            "organism": row["organism"],
            "geneName": row["gene_name"],
            "description": row["description"],
            "expressionSystem": row["expression_system"],
            "notes": row["notes"],
            "tags": _loads(row["tags_json"], []),
            "externalIds": _loads(row["external_ids_json"], {}),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _blast(row: sqlite3.Row) -> dict[str, Any]:
        parameters = _loads(row["params_json"], {})
        status = row["status"]
        purpose = parameters.get("purpose", "blast")
        provider = parameters.get("provider", "ncbi-url-api")
        if status == "waiting":
            if provider == "ebi-ncbiblast":
                stage = (
                    "Running NCBI BLAST at EMBL-EBI before importing UniProt records"
                    if purpose == "uniprot"
                    else "Running NCBI BLAST at EMBL-EBI"
                )
            else:
                stage = (
                    "Waiting for NCBI similarity results before importing UniProt records"
                    if purpose == "uniprot"
                    else "Waiting in the NCBI BLAST queue"
                )
            progress = None
        elif status == "complete":
            stage, progress = "Complete", 1.0
        elif status == "canceled":
            stage, progress = "Terminated locally", 0.0
        elif status == "failed":
            stage, progress = "NCBI reported a failure", 0.0
        else:
            stage, progress = "Checking job status", None
        return {
            "rid": row["rid"],
            "proteinId": row["protein_id"],
            "status": status,
            "stage": stage,
            "progress": progress,
            "canCancel": status not in {"complete", "failed", "canceled"},
            "parameters": parameters,
            "results": _loads(row["results_json"], None),
            "submittedAt": row["submitted_at"],
            "updatedAt": row["updated_at"],
            "error": row["error"],
        }

    @staticmethod
    def _uniprot(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "accession": row["accession"],
            "source": row["source"],
            "identity": row["identity"],
            "queryCoverage": row["query_coverage"],
            "evalue": row["evalue"],
            "record": json.loads(row["record_json"]),
            "fetchedAt": row["fetched_at"],
        }

    @staticmethod
    def _pdb(row: sqlite3.Row) -> dict[str, Any]:
        value = json.loads(row["record_json"])
        value["fetchedAt"] = row["fetched_at"]
        return value

    @staticmethod
    def _alphafold(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "modelId": row["model_id"],
            "proteinId": row["protein_id"],
            "source": row["source"],
            "accession": row["accession"],
            "name": row["name"],
            "format": row["file_format"],
            "metadata": _loads(row["metadata_json"], {}),
            "importedAt": row["imported_at"],
        }

    @staticmethod
    def _project_job(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "proteinId": row["protein_id"],
            "name": row["name"],
            "appType": row["app_type"],
            "status": row["status"],
            "config": _loads(row["config_json"], {}),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _notebook(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "proteinId": row["protein_id"],
            "title": row["title"],
            "summary": row["summary"],
            "sections": _loads(row["sections_json"], []),
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _expression_vector(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "proteinId": row["protein_id"],
            "name": row["name"],
            "sequence": row["sequence"],
            "circular": bool(row["circular"]),
            "features": _loads(row["features_json"], []),
            "primers": _loads(row["primers_json"], []),
            "enzymeNames": _loads(row["enzyme_names_json"], []),
            "minimumOrfAminoAcids": row["minimum_orf_amino_acids"],
            "history": _loads(row["history_json"], []),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
