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

from .standard_vectors import STANDARD_VECTORS


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

                CREATE TABLE IF NOT EXISTS project_trees (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    root_project_id TEXT NOT NULL,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                -- Project ids intentionally are not foreign keys. A deleted
                -- project remains a visible missing node instead of silently
                -- erasing lineage history.
                CREATE TABLE IF NOT EXISTS project_tree_nodes (
                    tree_id TEXT NOT NULL
                        REFERENCES project_trees(id) ON DELETE CASCADE,
                    project_id TEXT NOT NULL,
                    added_at TEXT NOT NULL,
                    PRIMARY KEY (tree_id, project_id)
                );

                CREATE TABLE IF NOT EXISTS project_tree_links (
                    id TEXT PRIMARY KEY,
                    tree_id TEXT NOT NULL
                        REFERENCES project_trees(id) ON DELETE CASCADE,
                    from_project_id TEXT NOT NULL,
                    to_project_id TEXT NOT NULL,
                    change_type TEXT NOT NULL DEFAULT '',
                    description TEXT NOT NULL DEFAULT '',
                    diff_summary TEXT NOT NULL DEFAULT '',
                    diff_categories_json TEXT NOT NULL DEFAULT '[]',
                    diff_change_count INTEGER NOT NULL DEFAULT 0,
                    from_project_updated_at TEXT,
                    to_project_updated_at TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL,
                    UNIQUE (tree_id, from_project_id, to_project_id),
                    FOREIGN KEY (tree_id, from_project_id)
                        REFERENCES project_tree_nodes(tree_id, project_id),
                    FOREIGN KEY (tree_id, to_project_id)
                        REFERENCES project_tree_nodes(tree_id, project_id)
                );

                CREATE TABLE IF NOT EXISTS project_tree_imports (
                    source_key TEXT NOT NULL,
                    legacy_tree_id TEXT NOT NULL,
                    tree_id TEXT NOT NULL UNIQUE
                        REFERENCES project_trees(id) ON DELETE CASCADE,
                    payload_hash TEXT NOT NULL,
                    imported_at TEXT NOT NULL,
                    PRIMARY KEY (source_key, legacy_tree_id)
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
                    library_id TEXT REFERENCES vector_library(id) ON DELETE SET NULL,
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
                    metadata_json TEXT NOT NULL DEFAULT '{}',
                    is_standard INTEGER NOT NULL DEFAULT 0,
                    favorite INTEGER NOT NULL DEFAULT 0,
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

                CREATE TABLE IF NOT EXISTS vector_collections (
                    id TEXT PRIMARY KEY, name TEXT NOT NULL COLLATE NOCASE UNIQUE,
                    position INTEGER NOT NULL DEFAULT 0, created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );
                CREATE TABLE IF NOT EXISTS vector_collection_memberships (
                    collection_id TEXT NOT NULL REFERENCES vector_collections(id) ON DELETE CASCADE,
                    library_id TEXT NOT NULL REFERENCES vector_library(id) ON DELETE CASCADE,
                    PRIMARY KEY (collection_id, library_id)
                );
                CREATE TABLE IF NOT EXISTS vector_tags (
                    library_id TEXT NOT NULL REFERENCES vector_library(id) ON DELETE CASCADE,
                    tag TEXT NOT NULL COLLATE NOCASE,
                    PRIMARY KEY (library_id, tag)
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
                CREATE INDEX IF NOT EXISTS idx_project_tree_links_tree
                    ON project_tree_links(tree_id, created_at);
                CREATE INDEX IF NOT EXISTS idx_project_tree_nodes_project
                    ON project_tree_nodes(project_id);
                CREATE INDEX IF NOT EXISTS idx_expression_vectors_protein
                    ON expression_vectors(protein_id, updated_at DESC);

                -- Physical purified-protein batches are deliberately separate
                -- from design-project proteins: deleting a design must never
                -- erase an inventory record or its custody history.
                CREATE TABLE IF NOT EXISTS protein_library (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    gene_name TEXT NOT NULL DEFAULT '',
                    organism TEXT NOT NULL DEFAULT '',
                    construct_name TEXT NOT NULL DEFAULT '',
                    tags_json TEXT NOT NULL DEFAULT '[]',
                    purification_method TEXT NOT NULL DEFAULT '',
                    concentration_value REAL,
                    concentration_unit TEXT NOT NULL DEFAULT 'mg/mL',
                    yield_value REAL,
                    yield_unit TEXT NOT NULL DEFAULT 'mg',
                    purity_percent REAL,
                    buffer TEXT NOT NULL DEFAULT '',
                    storage_date TEXT NOT NULL DEFAULT '',
                    storage_temperature TEXT NOT NULL DEFAULT '',
                    location_path TEXT NOT NULL DEFAULT '',
                    freezer TEXT NOT NULL DEFAULT '',
                    shelf TEXT NOT NULL DEFAULT '',
                    rack TEXT NOT NULL DEFAULT '',
                    box TEXT NOT NULL DEFAULT '',
                    position TEXT NOT NULL DEFAULT '',
                    aliquot_count INTEGER NOT NULL DEFAULT 0 CHECK (aliquot_count >= 0),
                    aliquot_volume REAL,
                    aliquot_unit TEXT NOT NULL DEFAULT 'uL',
                    status TEXT NOT NULL DEFAULT 'stored'
                        CHECK (status IN ('stored', 'low', 'used_up', 'discarded')),
                    notes TEXT NOT NULL DEFAULT '',
                    favorite INTEGER NOT NULL DEFAULT 0,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                );

                CREATE TABLE IF NOT EXISTS protein_library_events (
                    id TEXT PRIMARY KEY,
                    protein_library_id TEXT NOT NULL
                        REFERENCES protein_library(id) ON DELETE CASCADE,
                    event_type TEXT NOT NULL
                        CHECK (event_type IN ('stored', 'thawed', 'aliquot_used', 'moved', 'discarded')),
                    aliquots_used INTEGER NOT NULL DEFAULT 0 CHECK (aliquots_used >= 0),
                    from_location TEXT NOT NULL DEFAULT '',
                    to_location TEXT NOT NULL DEFAULT '',
                    notes TEXT NOT NULL DEFAULT '',
                    occurred_at TEXT NOT NULL,
                    created_at TEXT NOT NULL
                );

                CREATE INDEX IF NOT EXISTS idx_protein_library_updated
                    ON protein_library(updated_at DESC);
                CREATE INDEX IF NOT EXISTS idx_protein_library_status
                    ON protein_library(status);
                CREATE INDEX IF NOT EXISTS idx_protein_library_events_batch
                    ON protein_library_events(protein_library_id, occurred_at DESC);
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
            if "library_id" not in vector_columns:
                connection.execute(
                    "ALTER TABLE expression_vectors ADD COLUMN library_id TEXT"
                )
            library_columns = {row["name"] for row in connection.execute(
                "PRAGMA table_info(vector_library)").fetchall()}
            if "color_label" not in library_columns:
                connection.execute("ALTER TABLE vector_library ADD COLUMN color_label TEXT")
            if "deleted_at" not in library_columns:
                connection.execute("ALTER TABLE vector_library ADD COLUMN deleted_at TEXT")
            project_tree_link_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(project_tree_links)"
                ).fetchall()
            }
            if "diff_change_count" not in project_tree_link_columns:
                connection.execute(
                    "ALTER TABLE project_tree_links ADD COLUMN "
                    "diff_change_count INTEGER NOT NULL DEFAULT 0"
                )
            library_columns = {
                row["name"]
                for row in connection.execute(
                    "PRAGMA table_info(vector_library)"
                ).fetchall()
            }
            if "metadata_json" not in library_columns:
                connection.execute(
                    "ALTER TABLE vector_library ADD COLUMN metadata_json TEXT NOT NULL DEFAULT '{}'"
                )
            if "is_standard" not in library_columns:
                connection.execute(
                    "ALTER TABLE vector_library ADD COLUMN is_standard INTEGER NOT NULL DEFAULT 0"
                )
            if "favorite" not in library_columns:
                connection.execute(
                    "ALTER TABLE vector_library ADD COLUMN favorite INTEGER NOT NULL DEFAULT 0"
                )
            connection.execute(
                """
                UPDATE expression_vectors
                SET library_id = (
                    SELECT uses.library_id
                    FROM vector_library_uses AS uses
                    WHERE uses.protein_id = expression_vectors.protein_id
                      AND uses.vector_id = expression_vectors.id
                    ORDER BY uses.last_used_at DESC
                    LIMIT 1
                )
                WHERE library_id IS NULL
                  AND EXISTS (
                    SELECT 1
                    FROM vector_library_uses AS uses
                    WHERE uses.protein_id = expression_vectors.protein_id
                      AND uses.vector_id = expression_vectors.id
                )
                """
            )
            self._seed_standard_vectors(connection)

    @staticmethod
    def _seed_standard_vectors(connection: sqlite3.Connection) -> None:
        """Idempotently install the attributed starter catalogue."""
        timestamp = utc_now()
        for vector in STANDARD_VECTORS:
            sequence = str(vector["sequence"]).upper()
            fingerprint = hashlib.sha256(sequence.encode("utf-8")).hexdigest()
            connection.execute(
                """
                INSERT INTO vector_library (
                    id, fingerprint, name, sequence, circular, features_json,
                    insert_name, notes, metadata_json, is_standard, favorite,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, '', ?, ?, 1, 0, ?, ?)
                ON CONFLICT(fingerprint) DO UPDATE SET
                    name = excluded.name,
                    sequence = excluded.sequence,
                    circular = excluded.circular,
                    features_json = excluded.features_json,
                    insert_name = excluded.insert_name,
                    notes = excluded.notes,
                    metadata_json = excluded.metadata_json,
                    is_standard = 1
                """,
                (
                    str(vector["id"]),
                    fingerprint,
                    str(vector["name"]),
                    sequence,
                    1 if vector.get("circular", True) else 0,
                    json.dumps(vector.get("features") or [], allow_nan=False),
                    str(vector.get("notes") or ""),
                    json.dumps(vector.get("metadata") or {}, allow_nan=False),
                    timestamp,
                    timestamp,
                ),
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

    # ------------------------------------------------------------------
    # Purified protein library
    # ------------------------------------------------------------------
    PROTEIN_LIBRARY_FACETS = {
        "temperature": "storageTemperature",
        "location": "locationPath",
        "status": "status",
        "method": "purificationMethod",
        "tag": "tags",
    }

    def create_library_protein(self, fields: dict[str, Any]) -> dict[str, Any]:
        protein_id = str(uuid.uuid4())
        timestamp = utc_now()
        record = self._library_protein_values(fields)
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO protein_library (
                    id, name, gene_name, organism, construct_name, tags_json,
                    purification_method, concentration_value, concentration_unit,
                    yield_value, yield_unit, purity_percent, buffer, storage_date,
                    storage_temperature, location_path, freezer, shelf, rack, box,
                    position, aliquot_count, aliquot_volume, aliquot_unit, status,
                    notes, favorite, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (protein_id, *record, timestamp, timestamp),
            )
        return self.get_library_protein(protein_id)

    def get_library_protein(self, protein_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM protein_library WHERE id = ?", (protein_id,)
            ).fetchone()
            if row is None:
                raise LookupError(f"Protein library record {protein_id!r} was not found")
            return self._library_protein(connection, row, include_events=True)

    def update_library_protein(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.get_library_protein(protein_id)
        merged = {**current, **fields}
        record = self._library_protein_values(merged)
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE protein_library SET
                    name = ?, gene_name = ?, organism = ?, construct_name = ?,
                    tags_json = ?, purification_method = ?, concentration_value = ?,
                    concentration_unit = ?, yield_value = ?, yield_unit = ?,
                    purity_percent = ?, buffer = ?, storage_date = ?,
                    storage_temperature = ?, location_path = ?, freezer = ?,
                    shelf = ?, rack = ?, box = ?, position = ?, aliquot_count = ?,
                    aliquot_volume = ?, aliquot_unit = ?, status = ?, notes = ?,
                    favorite = ?, updated_at = ?
                WHERE id = ?
                """,
                (*record, utc_now(), protein_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Protein library record {protein_id!r} was not found")
        return self.get_library_protein(protein_id)

    def delete_library_protein(self, protein_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM protein_library WHERE id = ?", (protein_id,)
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Protein library record {protein_id!r} was not found")

    def search_library_proteins(
        self, *, query: str = "", filters: dict[str, list[str]] | None = None,
        favorite: bool | None = None, limit: int = 100, offset: int = 0,
    ) -> dict[str, Any]:
        normalized_filters = {
            key: [str(value).strip() for value in values if str(value).strip()]
            for key, values in (filters or {}).items() if values
        }
        folded = {key: [value.casefold() for value in values]
                  for key, values in normalized_filters.items()}
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM protein_library ORDER BY favorite DESC, updated_at DESC"
            ).fetchall()
            records = [self._library_protein(connection, row, include_events=False) for row in rows]
        search = query.strip().casefold()

        def matches(record: dict[str, Any], ignored: str | None = None) -> bool:
            if favorite is not None and record["favorite"] is not favorite:
                return False
            if search and search not in " ".join(str(value) for value in record.values()).casefold():
                return False
            for facet, values in folded.items():
                if facet == ignored:
                    continue
                record_values = self._protein_library_facet_values(record, facet)
                if values and not record_values.intersection(values):
                    return False
            return True

        matched = [record for record in records if matches(record)]
        facets: dict[str, list[dict[str, Any]]] = {}
        for facet in self.PROTEIN_LIBRARY_FACETS:
            counts: dict[str, tuple[str, int]] = {}
            for record in records:
                if not matches(record, ignored=facet):
                    continue
                for label in self._protein_library_facet_labels(record, facet):
                    key = label.casefold()
                    shown, count = counts.get(key, (label, 0))
                    counts[key] = (shown, count + 1)
            facets[facet] = [
                {"value": shown, "count": count}
                for _, (shown, count) in sorted(
                    counts.items(), key=lambda item: (-item[1][1], item[1][0].casefold())
                )
            ]
        return {"proteins": matched[offset: offset + limit], "total": len(matched),
                "limit": limit, "offset": offset, "query": query.strip(),
                "filters": normalized_filters, "facets": facets}

    def add_library_protein_event(
        self, protein_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        event_type = str(fields.get("eventType") or "").strip()
        if event_type not in {"stored", "thawed", "aliquot_used", "moved", "discarded"}:
            raise ValueError("eventType must be stored, thawed, aliquot_used, moved, or discarded")
        used = int(fields.get("aliquotsUsed", 1 if event_type == "aliquot_used" else 0))
        if used < 0 or (event_type != "aliquot_used" and used):
            raise ValueError("aliquotsUsed is only allowed for aliquot_used events")
        event_id, timestamp = str(uuid.uuid4()), utc_now()
        with self.connect() as connection:
            # The conditional decrement must occur before the event insert and
            # in the same transaction. This prevents two callers that both
            # observed one remaining aliquot from recording two uses.
            current = connection.execute(
                "SELECT aliquot_count, location_path FROM protein_library WHERE id = ?",
                (protein_id,),
            ).fetchone()
            if current is None:
                raise LookupError(f"Protein library record {protein_id!r} was not found")
            to_location = str(fields.get("toLocation") or "").strip()
            if event_type == "aliquot_used":
                cursor = connection.execute(
                    """
                    UPDATE protein_library SET
                        aliquot_count = aliquot_count - ?,
                        status = CASE
                            WHEN aliquot_count - ? = 0 THEN 'used_up'
                            WHEN aliquot_count - ? <= 1 THEN 'low'
                            ELSE 'stored'
                        END,
                        updated_at = ?
                    WHERE id = ? AND aliquot_count >= ?
                    """,
                    (used, used, used, timestamp, protein_id, used),
                )
                if cursor.rowcount == 0:
                    raise ValueError("aliquotsUsed cannot exceed the available aliquot count")
            else:
                status = "discarded" if event_type == "discarded" else None
                if status is None:
                    connection.execute(
                        "UPDATE protein_library SET location_path = ?, updated_at = ? WHERE id = ?",
                        (to_location or current["location_path"], timestamp, protein_id),
                    )
                else:
                    connection.execute(
                        "UPDATE protein_library SET status = ?, location_path = ?, updated_at = ? WHERE id = ?",
                        (status, to_location or current["location_path"], timestamp, protein_id),
                    )
            connection.execute(
                """INSERT INTO protein_library_events (
                    id, protein_library_id, event_type, aliquots_used, from_location,
                    to_location, notes, occurred_at, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (event_id, protein_id, event_type, used,
                 str(fields.get("fromLocation") or current["location_path"]), to_location,
                 str(fields.get("notes") or ""), str(fields.get("occurredAt") or timestamp), timestamp),
            )
        return self.get_library_protein(protein_id)

    def _library_protein_values(self, fields: dict[str, Any]) -> tuple[Any, ...]:
        tags = fields.get("tags") or []
        if not isinstance(tags, list) or not all(isinstance(tag, str) for tag in tags):
            raise ValueError("tags must be an array of strings")
        aliquots = int(fields.get("aliquotCount", 0))
        if aliquots < 0:
            raise ValueError("aliquotCount cannot be negative")
        status = str(fields.get("status") or "stored")
        if status not in {"stored", "low", "used_up", "discarded"}:
            raise ValueError("status must be stored, low, used_up, or discarded")
        numeric = lambda key: None if fields.get(key) in (None, "") else float(fields[key])
        return (
            str(fields.get("name") or "").strip(), str(fields.get("geneName") or "").strip(),
            str(fields.get("organism") or "").strip(), str(fields.get("constructName") or "").strip(),
            json.dumps(tags, allow_nan=False), str(fields.get("purificationMethod") or "").strip(),
            numeric("concentrationValue"), str(fields.get("concentrationUnit") or "mg/mL").strip(),
            numeric("yieldValue"), str(fields.get("yieldUnit") or "mg").strip(), numeric("purityPercent"),
            str(fields.get("buffer") or ""), str(fields.get("storageDate") or ""),
            str(fields.get("storageTemperature") or ""), str(fields.get("locationPath") or ""),
            str(fields.get("freezer") or ""), str(fields.get("shelf") or ""), str(fields.get("rack") or ""),
            str(fields.get("box") or ""), str(fields.get("position") or ""), aliquots,
            numeric("aliquotVolume"), str(fields.get("aliquotUnit") or "uL").strip(), status,
            str(fields.get("notes") or ""), 1 if bool(fields.get("favorite", False)) else 0,
        )

    @classmethod
    def _protein_library_facet_labels(cls, record: dict[str, Any], facet: str) -> list[str]:
        value = record.get(cls.PROTEIN_LIBRARY_FACETS.get(facet, ""))
        return [str(item).strip() for item in (value if isinstance(value, list) else [value]) if str(item or "").strip()]

    @classmethod
    def _protein_library_facet_values(cls, record: dict[str, Any], facet: str) -> set[str]:
        return {label.casefold() for label in cls._protein_library_facet_labels(record, facet)}

    def _library_protein(self, connection: sqlite3.Connection, row: sqlite3.Row, *, include_events: bool) -> dict[str, Any]:
        record = {
            "id": row["id"], "name": row["name"], "geneName": row["gene_name"],
            "organism": row["organism"], "constructName": row["construct_name"],
            "tags": _loads(row["tags_json"], []), "purificationMethod": row["purification_method"],
            "concentrationValue": row["concentration_value"], "concentrationUnit": row["concentration_unit"],
            "yieldValue": row["yield_value"], "yieldUnit": row["yield_unit"], "purityPercent": row["purity_percent"],
            "buffer": row["buffer"], "storageDate": row["storage_date"], "storageTemperature": row["storage_temperature"],
            "locationPath": row["location_path"], "freezer": row["freezer"], "shelf": row["shelf"],
            "rack": row["rack"], "box": row["box"], "position": row["position"],
            "aliquotCount": row["aliquot_count"], "aliquotVolume": row["aliquot_volume"],
            "aliquotUnit": row["aliquot_unit"], "status": row["status"], "notes": row["notes"],
            "favorite": bool(row["favorite"]), "createdAt": row["created_at"], "updatedAt": row["updated_at"],
        }
        if include_events:
            events = connection.execute(
                "SELECT * FROM protein_library_events WHERE protein_library_id = ? ORDER BY occurred_at DESC, created_at DESC", (row["id"],)
            ).fetchall()
            record["events"] = [{"id": event["id"], "eventType": event["event_type"],
                "aliquotsUsed": event["aliquots_used"], "fromLocation": event["from_location"],
                "toLocation": event["to_location"], "notes": event["notes"], "occurredAt": event["occurred_at"],
                "createdAt": event["created_at"]} for event in events]
        return record

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

    def project_diff_revision(self, protein_id: str) -> str:
        """Fingerprint every persisted input that can affect a project diff."""
        with self.connect() as connection:
            protein = connection.execute(
                "SELECT updated_at FROM proteins WHERE id = ?", (protein_id,)
            ).fetchone()
            if protein is None:
                raise ProteinNotFoundError(f"Protein {protein_id!r} was not found")
            values: dict[str, Any] = {
                "protein": protein["updated_at"],
                "protparam": connection.execute(
                    "SELECT analyzed_at FROM protparam_results WHERE protein_id = ?",
                    (protein_id,),
                ).fetchone(),
                "notebook": connection.execute(
                    "SELECT updated_at FROM project_notebooks WHERE protein_id = ?",
                    (protein_id,),
                ).fetchone(),
                "jobs": connection.execute(
                    """
                    SELECT id, updated_at FROM project_jobs
                    WHERE protein_id = ? ORDER BY id
                    """,
                    (protein_id,),
                ).fetchall(),
                "vectors": connection.execute(
                    """
                    SELECT v.id, v.updated_at, v.library_id,
                           l.updated_at AS library_updated_at
                    FROM expression_vectors v
                    LEFT JOIN vector_library l ON l.id = v.library_id
                    WHERE v.protein_id = ? ORDER BY v.id
                    """,
                    (protein_id,),
                ).fetchall(),
            }
        serializable = {
            "protein": values["protein"],
            "protparam": None
            if values["protparam"] is None
            else values["protparam"]["analyzed_at"],
            "notebook": None
            if values["notebook"] is None
            else values["notebook"]["updated_at"],
            "jobs": [tuple(row) for row in values["jobs"]],
            "vectors": [tuple(row) for row in values["vectors"]],
        }
        return hashlib.sha256(
            json.dumps(serializable, sort_keys=True).encode("utf-8")
        ).hexdigest()

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

    # ------------------------------------------------------------------
    # Project lineage trees
    # ------------------------------------------------------------------
    def list_project_trees(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT * FROM project_trees ORDER BY updated_at DESC, id"
            ).fetchall()
            return [self._project_tree(connection, row) for row in rows]

    def get_project_tree(self, tree_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT * FROM project_trees WHERE id = ?", (tree_id,)
            ).fetchone()
            if row is None:
                raise LookupError(f"Project tree {tree_id!r} was not found")
            return self._project_tree(connection, row)

    def create_project_tree(
        self,
        name: str,
        root_project_id: str,
        *,
        tree_id: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        tree_id = tree_id or str(uuid.uuid4())
        created_at = created_at or utc_now()
        updated_at = updated_at or created_at
        with self.connect() as connection:
            connection.execute(
                """
                INSERT INTO project_trees (
                    id, name, root_project_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?)
                """,
                (tree_id, name, root_project_id, created_at, updated_at),
            )
            connection.execute(
                """
                INSERT INTO project_tree_nodes (tree_id, project_id, added_at)
                VALUES (?, ?, ?)
                """,
                (tree_id, root_project_id, created_at),
            )
        return self.get_project_tree(tree_id)

    def rename_project_tree(self, tree_id: str, name: str) -> dict[str, Any]:
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE project_trees SET name = ?, updated_at = ? WHERE id = ?",
                (name, utc_now(), tree_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project tree {tree_id!r} was not found")
        return self.get_project_tree(tree_id)

    def delete_project_tree(self, tree_id: str) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                "DELETE FROM project_trees WHERE id = ?", (tree_id,)
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project tree {tree_id!r} was not found")

    def create_project_tree_link(
        self,
        tree_id: str,
        from_project_id: str,
        to_project_id: str,
        *,
        link_id: str | None = None,
        change_type: str = "",
        description: str = "",
        diff_summary: str = "",
        diff_categories: list[str] | None = None,
        diff_change_count: int = 0,
        from_project_updated_at: str | None = None,
        to_project_updated_at: str | None = None,
        created_at: str | None = None,
        updated_at: str | None = None,
    ) -> dict[str, Any]:
        link_id = link_id or str(uuid.uuid4())
        created_at = created_at or utc_now()
        updated_at = updated_at or created_at
        with self.connect() as connection:
            if connection.execute(
                "SELECT 1 FROM project_trees WHERE id = ?", (tree_id,)
            ).fetchone() is None:
                raise LookupError(f"Project tree {tree_id!r} was not found")
            for project_id in (from_project_id, to_project_id):
                connection.execute(
                    """
                    INSERT OR IGNORE INTO project_tree_nodes (
                        tree_id, project_id, added_at
                    ) VALUES (?, ?, ?)
                    """,
                    (tree_id, project_id, created_at),
                )
            try:
                connection.execute(
                    """
                    INSERT INTO project_tree_links (
                        id, tree_id, from_project_id, to_project_id,
                        change_type, description, diff_summary,
                        diff_categories_json, diff_change_count,
                        from_project_updated_at,
                        to_project_updated_at, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        link_id,
                        tree_id,
                        from_project_id,
                        to_project_id,
                        change_type,
                        description,
                        diff_summary,
                        json.dumps(diff_categories or []),
                        diff_change_count,
                        from_project_updated_at,
                        to_project_updated_at,
                        created_at,
                        updated_at,
                    ),
                )
            except sqlite3.IntegrityError as error:
                if "UNIQUE constraint failed" in str(error):
                    raise ValueError("That project link already exists") from error
                raise
            connection.execute(
                "UPDATE project_trees SET updated_at = ? WHERE id = ?",
                (updated_at, tree_id),
            )
        return self.get_project_tree_link(tree_id, link_id)

    def get_project_tree_link(
        self, tree_id: str, link_id: str
    ) -> dict[str, Any]:
        with self.connect() as connection:
            row = connection.execute(
                """
                SELECT * FROM project_tree_links
                WHERE tree_id = ? AND id = ?
                """,
                (tree_id, link_id),
            ).fetchone()
        if row is None:
            raise LookupError(f"Project tree link {link_id!r} was not found")
        return self._project_tree_link(row)

    def update_project_tree_link(
        self,
        tree_id: str,
        link_id: str,
        from_project_id: str,
        to_project_id: str,
        *,
        change_type: str,
        description: str,
        diff_summary: str,
        diff_categories: list[str],
        diff_change_count: int,
        from_project_updated_at: str | None,
        to_project_updated_at: str | None,
    ) -> dict[str, Any]:
        timestamp = utc_now()
        with self.connect() as connection:
            current = connection.execute(
                """
                SELECT * FROM project_tree_links
                WHERE tree_id = ? AND id = ?
                """,
                (tree_id, link_id),
            ).fetchone()
            if current is None:
                raise LookupError(f"Project tree link {link_id!r} was not found")
            for project_id in (from_project_id, to_project_id):
                connection.execute(
                    """
                    INSERT OR IGNORE INTO project_tree_nodes (
                        tree_id, project_id, added_at
                    ) VALUES (?, ?, ?)
                    """,
                    (tree_id, project_id, timestamp),
                )
            try:
                connection.execute(
                    """
                    UPDATE project_tree_links SET
                        from_project_id = ?, to_project_id = ?,
                        change_type = ?, description = ?, diff_summary = ?,
                        diff_categories_json = ?, diff_change_count = ?,
                        from_project_updated_at = ?,
                        to_project_updated_at = ?, updated_at = ?
                    WHERE tree_id = ? AND id = ?
                    """,
                    (
                        from_project_id,
                        to_project_id,
                        change_type,
                        description,
                        diff_summary,
                        json.dumps(diff_categories),
                        diff_change_count,
                        from_project_updated_at,
                        to_project_updated_at,
                        timestamp,
                        tree_id,
                        link_id,
                    ),
                )
            except sqlite3.IntegrityError as error:
                if "UNIQUE constraint failed" in str(error):
                    raise ValueError("That project link already exists") from error
                raise
            self._prune_project_tree_nodes(connection, tree_id)
            connection.execute(
                "UPDATE project_trees SET updated_at = ? WHERE id = ?",
                (timestamp, tree_id),
            )
        return self.get_project_tree_link(tree_id, link_id)

    def update_project_tree_link_cache(
        self,
        tree_id: str,
        link_id: str,
        *,
        diff_summary: str,
        diff_categories: list[str],
        diff_change_count: int,
        from_project_updated_at: str,
        to_project_updated_at: str,
    ) -> None:
        with self.connect() as connection:
            cursor = connection.execute(
                """
                UPDATE project_tree_links SET
                    diff_summary = ?, diff_categories_json = ?,
                    diff_change_count = ?, from_project_updated_at = ?,
                    to_project_updated_at = ?
                WHERE tree_id = ? AND id = ?
                """,
                (
                    diff_summary,
                    json.dumps(diff_categories),
                    diff_change_count,
                    from_project_updated_at,
                    to_project_updated_at,
                    tree_id,
                    link_id,
                ),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project tree link {link_id!r} was not found")

    def delete_project_tree_link(self, tree_id: str, link_id: str) -> None:
        timestamp = utc_now()
        with self.connect() as connection:
            cursor = connection.execute(
                """
                DELETE FROM project_tree_links
                WHERE tree_id = ? AND id = ?
                """,
                (tree_id, link_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Project tree link {link_id!r} was not found")
            self._prune_project_tree_nodes(connection, tree_id)
            connection.execute(
                "UPDATE project_trees SET updated_at = ? WHERE id = ?",
                (timestamp, tree_id),
            )

    @staticmethod
    def _prune_project_tree_nodes(
        connection: sqlite3.Connection, tree_id: str
    ) -> None:
        connection.execute(
            """
            DELETE FROM project_tree_nodes
            WHERE tree_id = ?
              AND project_id != (
                  SELECT root_project_id FROM project_trees WHERE id = ?
              )
              AND project_id NOT IN (
                  SELECT from_project_id FROM project_tree_links WHERE tree_id = ?
                  UNION
                  SELECT to_project_id FROM project_tree_links WHERE tree_id = ?
              )
            """,
            (tree_id, tree_id, tree_id, tree_id),
        )

    def import_project_trees(
        self, source_key: str, trees: list[dict[str, Any]]
    ) -> tuple[list[str], list[str]]:
        """Atomically import normalized localStorage trees without overwrites."""
        imported: list[str] = []
        existing: list[str] = []
        timestamp = utc_now()
        with self.connect() as connection:
            for tree in trees:
                legacy_id = tree["id"]
                mapping = connection.execute(
                    """
                    SELECT tree_id FROM project_tree_imports
                    WHERE source_key = ? AND legacy_tree_id = ?
                    """,
                    (source_key, legacy_id),
                ).fetchone()
                if mapping is not None:
                    existing.append(mapping["tree_id"])
                    continue

                tree_id = legacy_id
                if connection.execute(
                    "SELECT 1 FROM project_trees WHERE id = ?", (tree_id,)
                ).fetchone() is not None:
                    tree_id = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"protein-labs:{source_key}:{legacy_id}",
                    ))
                    if connection.execute(
                        "SELECT 1 FROM project_trees WHERE id = ?", (tree_id,)
                    ).fetchone() is not None:
                        raise ValueError(
                            f"Cannot safely import project tree {legacy_id!r}"
                        )

                created_at = tree.get("createdAt") or timestamp
                updated_at = tree.get("updatedAt") or created_at
                connection.execute(
                    """
                    INSERT INTO project_trees (
                        id, name, root_project_id, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (
                        tree_id,
                        tree["name"],
                        tree["rootProjectId"],
                        created_at,
                        updated_at,
                    ),
                )
                project_ids = {tree["rootProjectId"]}
                for link in tree["links"]:
                    project_ids.update(
                        (link["fromProjectId"], link["toProjectId"])
                    )
                connection.executemany(
                    """
                    INSERT INTO project_tree_nodes (
                        tree_id, project_id, added_at
                    ) VALUES (?, ?, ?)
                    """,
                    [(tree_id, project_id, created_at) for project_id in project_ids],
                )
                for link in tree["links"]:
                    connection.execute(
                        """
                        INSERT INTO project_tree_links (
                            id, tree_id, from_project_id, to_project_id,
                            change_type, description, diff_summary,
                            diff_categories_json, diff_change_count,
                            created_at, updated_at
                        ) VALUES (?, ?, ?, ?, ?, ?, ?, '[]', 0, ?, ?)
                        """,
                        (
                            link["id"],
                            tree_id,
                            link["fromProjectId"],
                            link["toProjectId"],
                            link["changeType"],
                            link["description"],
                            link["description"] or link["changeType"],
                            created_at,
                            updated_at,
                        ),
                    )
                payload_hash = hashlib.sha256(
                    json.dumps(tree, sort_keys=True).encode("utf-8")
                ).hexdigest()
                connection.execute(
                    """
                    INSERT INTO project_tree_imports (
                        source_key, legacy_tree_id, tree_id,
                        payload_hash, imported_at
                    ) VALUES (?, ?, ?, ?, ?)
                    """,
                    (source_key, legacy_id, tree_id, payload_hash, timestamp),
                )
                imported.append(tree_id)
        return imported, existing

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
                    history_json, library_id, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    name = excluded.name,
                    sequence = excluded.sequence,
                    circular = excluded.circular,
                    features_json = excluded.features_json,
                    primers_json = excluded.primers_json,
                    enzyme_names_json = excluded.enzyme_names_json,
                    minimum_orf_amino_acids = excluded.minimum_orf_amino_acids,
                    history_json = excluded.history_json,
                    library_id = COALESCE(excluded.library_id, expression_vectors.library_id),
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
                    vector.get("libraryId"),
                    created_at,
                    timestamp,
                ),
            )
        return self.get_expression_vector(protein_id, vector_id)

    # ------------------------------------------------------------------
    # Shared vector library
    # ------------------------------------------------------------------
    @staticmethod
    def _sequence_checksum(sequence: str, circular: bool) -> str:
        """Stable content checksum; circular sequences are rotation invariant."""
        sequence = sequence.upper()
        if circular and sequence:
            sequence = min(sequence[index:] + sequence[:index] for index in range(len(sequence)))
        return hashlib.sha256(sequence.encode("utf-8")).hexdigest()

    def find_library_duplicate(self, sequence: str, circular: bool) -> dict[str, Any] | None:
        checksum = self._sequence_checksum(sequence, circular)
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM vector_library WHERE deleted_at IS NULL").fetchall()
            for row in rows:
                if bool(row["circular"]) == circular and self._sequence_checksum(row["sequence"], circular) == checksum:
                    return self._library_vector(connection, row, full=False)
        return None

    def import_library_vector(
        self, vector: dict[str, Any], *, keep_both: bool = False
    ) -> tuple[dict[str, Any], bool]:
        """Insert a project-free catalogue record, or return its sequence twin."""
        sequence = str(vector.get("sequence") or "")
        if not sequence:
            raise ValueError("A catalogued vector needs a sequence")
        fingerprint = self._sequence_checksum(sequence, bool(vector.get("circular", True)))
        features = vector.get("features") or []
        insert_name = next(
            (
                str(feature.get("name") or "")
                for feature in features
                if isinstance(feature, dict) and feature.get("isInsert")
            ),
            "",
        )
        library_id = str(uuid.uuid4())
        timestamp = utc_now()
        existing = self.find_library_duplicate(sequence, bool(vector.get("circular", True)))
        if existing and not keep_both:
            return existing, True
        if existing:
            fingerprint = f"{fingerprint}:{uuid.uuid4()}"
        with self.connect() as connection:
            cursor = connection.execute(
                """
                INSERT OR IGNORE INTO vector_library (
                    id, fingerprint, name, sequence, circular, features_json,
                    insert_name, notes, metadata_json, is_standard, favorite,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, '{}', 0, 0, ?, ?)
                """,
                (
                    library_id,
                    fingerprint,
                    str(vector.get("name") or "Untitled vector"),
                    sequence,
                    1 if vector.get("circular", True) else 0,
                    json.dumps(features, allow_nan=False),
                    insert_name,
                    str(vector.get("notes") or ""),
                    timestamp,
                    timestamp,
                ),
            )
            duplicate = cursor.rowcount == 0
            if duplicate:
                row = connection.execute(
                    "SELECT id, sequence FROM vector_library WHERE fingerprint = ?",
                    (fingerprint,),
                ).fetchone()
                if row is None or row["sequence"] != sequence:
                    raise ValueError("The vector sequence fingerprint collided")
                library_id = row["id"]
        return self.get_library_vector(library_id), duplicate

    def record_vector_use(
        self,
        protein_id: str,
        vector: dict[str, Any],
        source_library_id: str | None = None,
    ) -> dict[str, Any]:
        """Link a project copy to one stable catalogue entry and record its use.

        Once a project vector has a source entry, later sequence edits and
        renames must remain project-local. The legacy-use lookup migrates old
        databases without republishing an edited sequence.
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
            library_id = source_library_id or vector.get("libraryId")
            if not library_id and vector.get("id"):
                legacy_use = connection.execute(
                    """
                    SELECT library_id FROM vector_library_uses
                    WHERE protein_id = ? AND vector_id = ?
                    """,
                    (protein_id, str(vector["id"])),
                ).fetchone()
                if legacy_use is not None:
                    library_id = legacy_use["library_id"]
            row = None
            if library_id:
                row = connection.execute(
                    "SELECT * FROM vector_library WHERE id = ?",
                    (str(library_id),),
                ).fetchone()
                if row is None:
                    raise LookupError(
                        f"Catalogued vector {library_id!r} was not found"
                    )
            else:
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
                        features_json, insert_name, notes, metadata_json,
                        is_standard, favorite, created_at, updated_at
                    ) VALUES (?, ?, ?, ?, ?, ?, ?, '', '{}', 0, 0, ?, ?)
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
            vector_id = str(vector.get("id") or "")
            connection.execute(
                """
                UPDATE expression_vectors SET library_id = ?
                WHERE id = ? AND protein_id = ?
                """,
                (library_id, vector_id, protein_id),
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
                    vector_id,
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
        """Search catalogue summaries and compute disjunctive facet counts."""
        normalized_filters = {
            key: [value.strip() for value in values if value.strip()]
            for key, values in (filters or {}).items()
            if values
        }
        folded_filters = {
            key: [value.casefold() for value in values]
            for key, values in normalized_filters.items()
        }
        with self.connect() as connection:
            rows = connection.execute("SELECT * FROM vector_library WHERE deleted_at IS NULL").fetchall()
            records = [
                self._library_vector(connection, row, full=False) for row in rows
            ]

        query_value = query.strip().casefold()

        view = view or "all"
        if view not in {"all", "favorites", "recent", "imports", "standard", "unsorted"}:
            raise ValueError("Unknown vector library view")
        if sort not in {"name", "size", "created", "lastUsed"} or order not in {"asc", "desc"}:
            raise ValueError("Unknown vector library sort")
        tag_filter = {tag.casefold() for tag in tags or [] if tag.strip()}

        def matches(
            record: dict[str, Any], ignored_facet: str | None = None
        ) -> bool:
            if favorite is not None and record["favorite"] is not favorite:
                return False
            if view == "favorites" and not record["favorite"]: return False
            if view == "recent" and not record["lastUsedAt"]: return False
            if view == "imports" and record["origin"] != "import": return False
            if view == "standard" and record["origin"] != "standard": return False
            if view == "unsorted" and (record["origin"] == "standard" or record["collectionIds"] or record["tags"]): return False
            if collection and collection not in record["collectionIds"]: return False
            if tag_filter and not tag_filter.issubset({tag.casefold() for tag in record["tags"]}): return False
            if query_value:
                searchable = " ".join(
                    str(value)
                    for key, value in record.items()
                    if key != "projects"
                ).casefold()
                if query_value not in searchable:
                    return False
            for facet, selected in folded_filters.items():
                if facet == ignored_facet:
                    continue
                if selected and not set(selected).intersection(
                    self._facet_values(record, facet)
                ):
                    return False
            return True

        matched = [record for record in records if matches(record)]
        sort_keys = {"name": lambda r: r["name"].casefold(), "size": lambda r: r["lengthBp"], "created": lambda r: r["createdAt"], "lastUsed": lambda r: r["lastUsedAt"] or ""}
        matched.sort(key=sort_keys[sort], reverse=order == "desc")
        facets: dict[str, list[dict[str, Any]]] = {}
        for facet in self.VECTOR_LIBRARY_FACETS:
            counts: dict[str, int] = {}
            labels: dict[str, str] = {}
            for record in records:
                if not matches(record, ignored_facet=facet):
                    continue
                for label in self._facet_labels(record, facet):
                    folded = label.casefold()
                    labels.setdefault(folded, label)
                    counts[folded] = counts.get(folded, 0) + 1
            facets[facet] = [
                {"value": labels[value], "count": count}
                for value, count in sorted(
                    counts.items(),
                    key=lambda item: (-item[1], labels[item[0]].casefold()),
                )
            ]
        selected_view = view
        view_counts: dict[str, int] = {}
        for candidate in ("all", "favorites", "recent", "imports", "standard", "unsorted"):
            view = candidate
            view_counts[candidate] = sum(1 for record in records if matches(record))
        view = selected_view
        return {
            "vectors": matched[offset : offset + limit],
            "total": len(matched),
            "limit": limit,
            "offset": offset,
            "query": query.strip(),
            "filters": normalized_filters,
            "facets": facets,
            "tags": self.list_tags(),
            "viewCounts": view_counts,
        }

    VECTOR_LIBRARY_FACETS = {
        "host": "host",
        "promoter": "promoter",
        "inducer": "inducer",
        "nTag": "nTags",
        "cTag": "cTags",
        "proteaseSite": "proteaseSites",
        "selectionMarker": "selectionMarker",
        "origin": "origin",
        "copyNumber": "copyNumber",
        "supplier": "supplier",
    }

    @classmethod
    def _facet_labels(cls, record: dict[str, Any], facet: str) -> list[str]:
        key = cls.VECTOR_LIBRARY_FACETS.get(facet)
        if key is None:
            return []
        value = record.get(key)
        raw_values = value if isinstance(value, list) else [value]
        return [str(item).strip() for item in raw_values if str(item or "").strip()]

    @classmethod
    def _facet_values(cls, record: dict[str, Any], facet: str) -> set[str]:
        return {value.casefold() for value in cls._facet_labels(record, facet)}

    def list_recent_library_vectors(self, limit: int = 10) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                """
                SELECT l.*, MAX(u.last_used_at) AS recent_used_at
                FROM vector_library l
                JOIN vector_library_uses u ON u.library_id = l.id
                WHERE l.deleted_at IS NULL
                GROUP BY l.id
                ORDER BY recent_used_at DESC
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
            records = [
                self._library_vector(connection, row, full=False) for row in rows
            ]
        for record, row in zip(records, rows, strict=True):
            record["lastUsedAt"] = row["recent_used_at"]
        return records

    def set_library_favorite(
        self, library_id: str, favorite: bool
    ) -> dict[str, Any]:
        with self.connect() as connection:
            cursor = connection.execute(
                "UPDATE vector_library SET favorite = ? WHERE id = ?",
                (1 if favorite else 0, library_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Catalogued vector {library_id!r} was not found")
        return self.get_library_vector(library_id)

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
            row = connection.execute(
                "SELECT is_standard FROM vector_library WHERE id = ?",
                (library_id,),
            ).fetchone()
            if row is None:
                raise LookupError(f"Catalogued vector {library_id!r} was not found")
            if bool(row["is_standard"]):
                raise ValueError("Bundled standard vectors cannot be deleted")
            cursor = connection.execute("UPDATE vector_library SET deleted_at = ? WHERE id = ?", (utc_now(), library_id))
            if cursor.rowcount == 0:
                raise LookupError(f"Catalogued vector {library_id!r} was not found")

    def list_collections(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("""SELECT c.*, COUNT(l.id) AS vector_count
                FROM vector_collections c LEFT JOIN vector_collection_memberships m
                ON m.collection_id=c.id LEFT JOIN vector_library l
                ON l.id=m.library_id AND l.deleted_at IS NULL
                GROUP BY c.id ORDER BY c.position, c.name""").fetchall()
        return [{"id": r["id"], "name": r["name"], "position": r["position"],
                 "vectorCount": r["vector_count"], "createdAt": r["created_at"], "updatedAt": r["updated_at"]} for r in rows]

    def create_collection(self, name: str) -> dict[str, Any]:
        name = name.strip()
        if not name or len(name) > 120: raise ValueError("Collection names must be 1 to 120 characters")
        now, collection_id = utc_now(), str(uuid.uuid4())
        with self.connect() as connection:
            try:
                position = connection.execute("SELECT COALESCE(MAX(position), -1)+1 FROM vector_collections").fetchone()[0]
                connection.execute("INSERT INTO vector_collections VALUES (?, ?, ?, ?, ?)", (collection_id, name, position, now, now))
            except sqlite3.IntegrityError as error: raise ValueError("That collection name already exists") from error
        return next(c for c in self.list_collections() if c["id"] == collection_id)

    def update_collection(self, collection_id: str, *, name: str | None = None, position: int | None = None) -> dict[str, Any]:
        with self.connect() as connection:
            if name is not None:
                name = name.strip()
                if not name: raise ValueError("Collection name is required")
                try: cursor = connection.execute("UPDATE vector_collections SET name=?, updated_at=? WHERE id=?", (name, utc_now(), collection_id))
                except sqlite3.IntegrityError as error: raise ValueError("That collection name already exists") from error
            else: cursor = connection.execute("SELECT 1 FROM vector_collections WHERE id=?", (collection_id,))
            if name is not None and cursor.rowcount == 0: raise LookupError(f"Collection {collection_id!r} was not found")
            if name is None and cursor.fetchone() is None: raise LookupError(f"Collection {collection_id!r} was not found")
            if position is not None:
                if not isinstance(position, int) or position < 0: raise ValueError("position must be a non-negative integer")
                connection.execute("UPDATE vector_collections SET position=?, updated_at=? WHERE id=?", (position, utc_now(), collection_id))
        return next(c for c in self.list_collections() if c["id"] == collection_id)

    def delete_collection(self, collection_id: str) -> None:
        with self.connect() as connection:
            if connection.execute("DELETE FROM vector_collections WHERE id=?", (collection_id,)).rowcount == 0: raise LookupError(f"Collection {collection_id!r} was not found")

    def reorder_collections(self, ids: list[str]) -> list[dict[str, Any]]:
        with self.connect() as connection:
            known = [row["id"] for row in connection.execute("SELECT id FROM vector_collections ORDER BY position").fetchall()]
            if len(ids) != len(known) or set(ids) != set(known): raise ValueError("ids must contain every collection exactly once")
            now = utc_now(); connection.executemany("UPDATE vector_collections SET position=?, updated_at=? WHERE id=?", [(position, now, item) for position, item in enumerate(ids)])
        return self.list_collections()

    def list_tags(self) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute("""SELECT t.tag, COUNT(*) AS count FROM vector_tags t
                JOIN vector_library l ON l.id=t.library_id WHERE l.deleted_at IS NULL
                GROUP BY t.tag ORDER BY t.tag COLLATE NOCASE""").fetchall()
            return [{"name": row["tag"], "count": row["count"]} for row in rows]

    def rename_tag(self, old_name: str, new_name: str) -> list[dict[str, Any]]:
        old_name, new_name = old_name.strip(), new_name.strip()
        if not old_name or not new_name: raise ValueError("Tag names are required")
        with self.connect() as connection:
            if connection.execute("SELECT 1 FROM vector_tags WHERE tag=? COLLATE NOCASE", (old_name,)).fetchone() is None: raise LookupError(f"Tag {old_name!r} was not found")
            connection.execute("INSERT OR IGNORE INTO vector_tags (library_id, tag) SELECT library_id, ? FROM vector_tags WHERE tag=? COLLATE NOCASE", (new_name, old_name))
            connection.execute("DELETE FROM vector_tags WHERE tag=? COLLATE NOCASE", (old_name,))
        return self.list_tags()

    def update_library_vector(self, library_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        allowed = {"name", "notes", "color", "colorLabel", "tags", "favorite"}
        unknown = set(fields) - allowed
        if unknown: raise ValueError("Unsupported vector fields: " + ", ".join(sorted(unknown)))
        with self.connect() as connection:
            row = connection.execute("SELECT * FROM vector_library WHERE id=?", (library_id,)).fetchone()
            if row is None: raise LookupError(f"Catalogued vector {library_id!r} was not found")
            if row["is_standard"] and set(fields) - {"notes", "color", "colorLabel", "tags", "favorite"}: raise PermissionError("read_only")
            updates: list[str] = []; values: list[Any] = []
            for field, column in (("name", "name"), ("notes", "notes"), ("color", "color_label"), ("colorLabel", "color_label"), ("favorite", "favorite")):
                if field in fields:
                    if field == "name" and not str(fields[field]).strip(): raise ValueError("name is required")
                    updates.append(f"{column}=?"); values.append(int(fields[field]) if field == "favorite" else fields[field])
            if updates:
                updates.append("updated_at=?"); values.append(utc_now()); values.append(library_id)
                connection.execute(f"UPDATE vector_library SET {', '.join(updates)} WHERE id=?", values)
            if "tags" in fields:
                tags = fields["tags"]
                if not isinstance(tags, list) or not all(isinstance(tag, str) and tag.strip() for tag in tags): raise ValueError("tags must be an array of non-empty strings")
                connection.execute("DELETE FROM vector_tags WHERE library_id=?", (library_id,)); connection.executemany("INSERT OR IGNORE INTO vector_tags VALUES (?, ?)", [(library_id, tag.strip()) for tag in tags])
        return self.get_library_vector(library_id)

    def replace_library_vector_contents(self, library_id: str, vector: dict[str, Any]) -> dict[str, Any]:
        """Overwrite the sequence, topology and features of a user's catalogue record."""
        sequence = str(vector.get("sequence") or "")
        if not sequence:
            raise ValueError("A catalogued vector needs a sequence")
        circular = bool(vector.get("circular", True))
        features = vector.get("features") or []
        fingerprint = self._sequence_checksum(sequence, circular)
        with self.connect() as connection:
            row = connection.execute("SELECT is_standard FROM vector_library WHERE id=?", (library_id,)).fetchone()
            if row is None: raise LookupError(f"Catalogued vector {library_id!r} was not found")
            if row["is_standard"]: raise PermissionError("read_only")
            # The fingerprint is unique; an identical twin elsewhere keeps its own.
            if connection.execute("SELECT 1 FROM vector_library WHERE fingerprint=? AND id<>?", (fingerprint, library_id)).fetchone():
                fingerprint = f"{fingerprint}:{uuid.uuid4()}"
            insert_name = next((str(feature.get("name") or "") for feature in features if isinstance(feature, dict) and feature.get("isInsert")), "")
            connection.execute(
                "UPDATE vector_library SET name=?, sequence=?, circular=?, features_json=?, insert_name=?, fingerprint=?, updated_at=? WHERE id=?",
                (str(vector.get("name") or "Untitled vector"), sequence, 1 if circular else 0, json.dumps(features, allow_nan=False), insert_name, fingerprint, utc_now(), library_id),
            )
        return self.get_library_vector(library_id)

    def restore_library_vector(self, library_id: str) -> dict[str, Any]:
        with self.connect() as connection:
            if connection.execute("UPDATE vector_library SET deleted_at=NULL WHERE id=? AND deleted_at IS NOT NULL", (library_id,)).rowcount == 0: raise LookupError(f"Deleted vector {library_id!r} was not found")
        return self.get_library_vector(library_id)

    def duplicate_library_vector(self, library_id: str) -> dict[str, Any]:
        source = self.get_library_vector(library_id)
        source["name"] = f"{source['name']} copy"
        vector, _ = self.import_library_vector(source, keep_both=True)
        return vector

    def bulk_library_action(self, ids: list[str], action: str, *, collection_id: str | None = None, tags: list[str] | None = None, favorite: bool | None = None) -> list[dict[str, Any]]:
        if not ids or len(set(ids)) != len(ids): raise ValueError("ids must be a non-empty unique list")
        with self.connect() as connection:
            rows = connection.execute("SELECT id, is_standard FROM vector_library WHERE id IN (%s)" % ",".join("?" * len(ids)), ids).fetchall()
            if len(rows) != len(ids): raise LookupError("One or more catalogued vectors were not found")
            if action in {"delete"} and any(r["is_standard"] for r in rows): raise ValueError("Bundled standard vectors cannot be deleted")
            if action in {"add_to_collection", "move_to_collection"}:
                if not collection_id or connection.execute("SELECT 1 FROM vector_collections WHERE id=?", (collection_id,)).fetchone() is None: raise LookupError("Collection was not found")
                if action == "move_to_collection": connection.execute("DELETE FROM vector_collection_memberships WHERE library_id IN (%s)" % ",".join("?" * len(ids)), ids)
                connection.executemany("INSERT OR IGNORE INTO vector_collection_memberships VALUES (?, ?)", [(collection_id, i) for i in ids])
            elif action == "remove_from_collection":
                if not collection_id: raise ValueError("collectionId is required")
                connection.execute("DELETE FROM vector_collection_memberships WHERE collection_id=? AND library_id IN (%s)" % ",".join("?" * len(ids)), [collection_id, *ids])
            elif action in {"tag", "untag"}:
                if not tags: raise ValueError("At least one tag is required")
                sql = "INSERT OR IGNORE INTO vector_tags VALUES (?, ?)" if action == "tag" else "DELETE FROM vector_tags WHERE library_id=? AND tag=?"
                connection.executemany(sql, [(i, tag.strip()) for i in ids for tag in tags])
            elif action == "favorite":
                if not isinstance(favorite, bool): raise ValueError("favorite must be a boolean")
                connection.execute("UPDATE vector_library SET favorite=? WHERE id IN (%s)" % ",".join("?" * len(ids)), [int(favorite), *ids])
            elif action == "delete": connection.execute("UPDATE vector_library SET deleted_at=? WHERE id IN (%s)" % ",".join("?" * len(ids)), [utc_now(), *ids])
            elif action == "restore": connection.execute("UPDATE vector_library SET deleted_at=NULL WHERE id IN (%s)" % ",".join("?" * len(ids)), ids)
            else: raise ValueError("Unknown bulk action")
        return [self.get_library_vector(i) for i in ids]

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
        metadata = _loads(row["metadata_json"], {})
        metadata_defaults = {
            "host": [],
            "promoter": [],
            "inducer": [],
            "nTags": [],
            "cTags": [],
            "proteaseSites": [],
            "selectionMarker": "",
            "origin": "",
            "copyNumber": "",
            "supplier": "",
            "sourceUrl": "",
            "license": "",
            "licenseUrl": "",
        }
        metadata_defaults.update(metadata)
        record: dict[str, Any] = {
            "id": row["id"],
            "name": row["name"],
            "lengthBp": len(row["sequence"]),
            "sizeBp": len(row["sequence"]),
            "circular": bool(row["circular"]),
            "featureCount": len(features),
            "insertName": row["insert_name"],
            "notes": row["notes"],
            **metadata_defaults,
            "isStandard": bool(row["is_standard"]),
            "favorite": bool(row["favorite"]),
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "colorLabel": row["color_label"] if "color_label" in row.keys() else None,
            "color": row["color_label"] if "color_label" in row.keys() else None,
            "deletedAt": row["deleted_at"] if "deleted_at" in row.keys() else None,
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
        record["tags"] = [r["tag"] for r in connection.execute("SELECT tag FROM vector_tags WHERE library_id=? ORDER BY tag", (row["id"],))]
        record["collectionIds"] = [r["collection_id"] for r in connection.execute("SELECT collection_id FROM vector_collection_memberships WHERE library_id=?", (row["id"],))]
        record["projectCount"] = len(record["projects"])
        record["lastUsedAt"] = max((use["last_used_at"] for use in uses), default=None)
        record["origin"] = "standard" if record["isStandard"] else ("project" if uses else "import")
        record["mapFeatures"] = [
            {key: feature.get(key) for key in ("name", "type", "start", "end", "strand")}
            for feature in features[:40] if isinstance(feature, dict)
        ]
        if full:
            record["sequence"] = row["sequence"]
            record["features"] = features
        return record

    def delete_expression_vector(self, protein_id: str, vector_id: str) -> None:
        with self.connect() as connection:
            current = connection.execute(
                """
                SELECT library_id FROM expression_vectors
                WHERE protein_id = ? AND id = ?
                """,
                (protein_id, vector_id),
            ).fetchone()
            if current is None:
                raise LookupError(f"Expression vector {vector_id!r} was not found")
            cursor = connection.execute(
                "DELETE FROM expression_vectors WHERE protein_id = ? AND id = ?",
                (protein_id, vector_id),
            )
            if cursor.rowcount == 0:
                raise LookupError(f"Expression vector {vector_id!r} was not found")
            connection.execute(
                """
                DELETE FROM vector_library_uses
                WHERE protein_id = ? AND vector_id = ?
                """,
                (protein_id, vector_id),
            )
            if current["library_id"]:
                replacement = connection.execute(
                    """
                    SELECT id FROM expression_vectors
                    WHERE protein_id = ? AND library_id = ?
                    ORDER BY updated_at DESC LIMIT 1
                    """,
                    (protein_id, current["library_id"]),
                ).fetchone()
                if replacement is not None:
                    timestamp = utc_now()
                    connection.execute(
                        """
                        INSERT INTO vector_library_uses (
                            library_id, protein_id, vector_id,
                            first_used_at, last_used_at
                        ) VALUES (?, ?, ?, ?, ?)
                        ON CONFLICT(library_id, protein_id) DO UPDATE SET
                            vector_id = excluded.vector_id,
                            last_used_at = excluded.last_used_at
                        """,
                        (
                            current["library_id"],
                            protein_id,
                            replacement["id"],
                            timestamp,
                            timestamp,
                        ),
                    )

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
        stage_id: str | None = None,
    ) -> None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT params_json FROM blast_jobs WHERE rid = ?", (rid,)
            ).fetchone()
            if row is None:
                raise LookupError(f"BLAST job {rid!r} was not found")
            parameters = _loads(row["params_json"], {})
            if stage_id:
                parameters["stageId"] = stage_id
            cursor = connection.execute(
                """
                UPDATE blast_jobs SET status = ?, results_json = ?, error = ?, params_json = ?, updated_at = ?
                WHERE rid = ?
                """,
                (
                    status,
                    None if results is None else json.dumps(results, allow_nan=False),
                    error,
                    json.dumps(parameters),
                    utc_now(),
                    rid,
                ),
            )

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

    @classmethod
    def _project_tree(
        cls, connection: sqlite3.Connection, row: sqlite3.Row
    ) -> dict[str, Any]:
        node_rows = connection.execute(
            """
            SELECT n.project_id, p.id AS current_project_id, p.name
            FROM project_tree_nodes n
            LEFT JOIN proteins p ON p.id = n.project_id
            WHERE n.tree_id = ?
            ORDER BY n.added_at, n.project_id
            """,
            (row["id"],),
        ).fetchall()
        link_rows = connection.execute(
            """
            SELECT * FROM project_tree_links
            WHERE tree_id = ? ORDER BY created_at, id
            """,
            (row["id"],),
        ).fetchall()
        links = [cls._project_tree_link(link) for link in link_rows]
        return {
            "id": row["id"],
            "name": row["name"],
            "rootProjectId": row["root_project_id"],
            "nodes": [
                {
                    "projectId": node["project_id"],
                    "project": None
                    if node["current_project_id"] is None
                    else {
                        "id": node["current_project_id"],
                        "name": node["name"],
                    },
                    "missing": node["current_project_id"] is None,
                }
                for node in node_rows
            ],
            "links": links,
            # Temporary compatibility alias for the browser's v1 schema.
            "relationships": links,
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }

    @staticmethod
    def _project_tree_link(row: sqlite3.Row) -> dict[str, Any]:
        return {
            "id": row["id"],
            "fromProjectId": row["from_project_id"],
            "toProjectId": row["to_project_id"],
            "changeType": row["change_type"],
            "description": row["description"],
            "diffSummary": row["diff_summary"],
            "changeCategories": _loads(row["diff_categories_json"], []),
            "changeCount": row["diff_change_count"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
            "_cache": {
                "fromProjectUpdatedAt": row["from_project_updated_at"],
                "toProjectUpdatedAt": row["to_project_updated_at"],
            },
        }

    @staticmethod
    def _blast(row: sqlite3.Row) -> dict[str, Any]:
        parameters = _loads(row["params_json"], {})
        status = row["status"]
        purpose = parameters.get("purpose", "blast")
        provider = parameters.get("provider", "ncbi-url-api")
        stage_id = parameters.get("stageId")
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
            # Machine-readable state for live UI progress.  ``stage`` remains
            # the legacy human-readable message, so old clients still render.
            "stageId": stage_id or {"waiting": "queued", "complete": "done", "canceled": "cancelled"}.get(status, status),
            "progress": progress,
            "canCancel": status not in {"complete", "failed", "canceled"},
            "parameters": parameters,
            "querySequence": parameters.get("querySequence"),
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
            "libraryId": row["library_id"],
            "createdAt": row["created_at"],
            "updatedAt": row["updated_at"],
        }
