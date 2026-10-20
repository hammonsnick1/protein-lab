"""Project-tree integrity, import, and experiment-aware project diffs."""

from __future__ import annotations

from collections.abc import Iterable
from copy import deepcopy
from typing import Any
import uuid

from Bio.Align import PairwiseAligner

from .database import Database
from .protparam import analyze_sequence


IMPORT_SOURCE_KEY = "protein-labs-project-trees-v1"
ALIGNMENT_METHOD = "Needleman-Wunsch global alignment with affine gap penalties"

_CATEGORY_ORDER = {
    "sequence": 0,
    "construct": 1,
    "vector": 2,
    "host": 3,
    "purification": 4,
    "assay": 5,
    "protparam": 6,
    "metadata": 7,
}
_EXPRESSION_JOB_TYPES = {
    "expression-system",
    "expression-planning",
    "transformation-expression",
}
_IGNORED_METADATA_KEYS = {
    "id",
    "proteinid",
    "createdat",
    "updatedat",
    "analyzedat",
    "savedbyuser",
}


def _clean_text(value: Any, label: str, *, required: bool = False) -> str:
    text = str(value or "").strip()
    if required and not text:
        raise ValueError(f"{label} is required")
    if len(text) > 10_000:
        raise ValueError(f"{label} is too long")
    return text


def _change(
    category: str,
    kind: str,
    before: Any,
    after: Any,
    summary: str,
    details: dict[str, Any] | None = None,
) -> dict[str, Any]:
    return {
        "category": category,
        "kind": kind,
        "before": before,
        "after": after,
        "summary": summary,
        "details": details or {},
    }


def _sequence_diff(
    before: str, after: str
) -> tuple[list[dict[str, Any]], dict[str, str]]:
    """Return edits from a true global alignment, using 1-based coordinates."""
    aligner = PairwiseAligner()
    aligner.mode = "global"
    aligner.match_score = 2.0
    aligner.mismatch_score = -1.0
    aligner.open_gap_score = -4.0
    aligner.extend_gap_score = -0.5
    alignment = aligner.align(before, after)[0]
    coordinates = alignment.coordinates
    changes: list[dict[str, Any]] = []
    aligned_before: list[str] = []
    aligned_after: list[str] = []

    for index in range(coordinates.shape[1] - 1):
        before_start = int(coordinates[0, index])
        before_end = int(coordinates[0, index + 1])
        after_start = int(coordinates[1, index])
        after_end = int(coordinates[1, index + 1])
        before_length = before_end - before_start
        after_length = after_end - after_start

        if before_length and after_length:
            before_segment = before[before_start:before_end]
            after_segment = after[after_start:after_end]
            aligned_before.append(before_segment)
            aligned_after.append(after_segment)
            mismatch_start: int | None = None
            for offset, (old, new) in enumerate(
                zip(before_segment, after_segment, strict=True)
            ):
                if old != new and mismatch_start is None:
                    mismatch_start = offset
                is_last = offset == len(before_segment) - 1
                if mismatch_start is not None and (old == new or is_last):
                    mismatch_end = offset if old == new else offset + 1
                    old_value = before_segment[mismatch_start:mismatch_end]
                    new_value = after_segment[mismatch_start:mismatch_end]
                    old_position = before_start + mismatch_start + 1
                    new_position = after_start + mismatch_start + 1
                    if len(old_value) == 1:
                        summary = f"{old_value}{old_position}{new_value}"
                    else:
                        summary = (
                            f"{old_position}–{old_position + len(old_value) - 1}: "
                            f"{old_value} → {new_value}"
                        )
                    changes.append(_change(
                        "sequence",
                        "substitution",
                        old_value,
                        new_value,
                        summary,
                        {
                            "beforeStart": old_position,
                            "beforeEnd": old_position + len(old_value) - 1,
                            "afterStart": new_position,
                            "afterEnd": new_position + len(new_value) - 1,
                        },
                    ))
                    mismatch_start = None
        elif before_length:
            deleted = before[before_start:before_end]
            aligned_before.append(deleted)
            aligned_after.append("-" * before_length)
            start = before_start + 1
            end = before_end
            terminal = before_start == 0 or before_end == len(before)
            if terminal:
                terminus = "N" if before_start == 0 else "C"
                summary = f"{terminus}-terminal truncation Δ{start}–{end}"
                kind = "truncation"
            elif len(deleted) == 1:
                summary = f"Δ{deleted}{start}"
                kind = "deletion"
            else:
                summary = f"Deletion {start}–{end} ({deleted})"
                kind = "deletion"
            changes.append(_change(
                "sequence",
                kind,
                deleted,
                None,
                summary,
                {
                    "beforeStart": start,
                    "beforeEnd": end,
                    "afterStart": after_start + 1,
                    "afterEnd": after_start,
                    **({"terminus": terminus} if terminal else {}),
                },
            ))
        elif after_length:
            inserted = after[after_start:after_end]
            aligned_before.append("-" * after_length)
            aligned_after.append(inserted)
            after_position = after_start + 1
            location = (
                "before residue 1" if before_start == 0
                else f"after residue {before_start}"
            )
            summary = (
                f"+{inserted} {location}" if len(inserted) == 1
                else f"Insertion {inserted} {location}"
            )
            changes.append(_change(
                "sequence",
                "insertion",
                None,
                inserted,
                summary,
                {
                    "beforeStart": before_start,
                    "beforeEnd": before_start,
                    "afterStart": after_position,
                    "afterEnd": after_end,
                },
            ))

    before_aligned = "".join(aligned_before)
    after_aligned = "".join(aligned_after)
    return changes, {
        "before": before_aligned,
        "after": after_aligned,
        "match": "".join(
            "|" if old == new else " "
            for old, new in zip(before_aligned, after_aligned, strict=True)
        ),
    }


def _without_noise(value: Any) -> Any:
    if isinstance(value, dict):
        return {
            key: _without_noise(item)
            for key, item in sorted(value.items())
            if key.casefold() not in _IGNORED_METADATA_KEYS
            and not key.casefold().endswith("_id")
            and not key.endswith("Id")
        }
    if isinstance(value, list):
        return [_without_noise(item) for item in value]
    return value


def _job_snapshot(job: dict[str, Any]) -> dict[str, Any]:
    return {
        "name": job["name"],
        "appType": job["appType"],
        "status": job["status"],
        "config": _without_noise(job.get("config") or {}),
    }


def _jobs_for(
    bundle: dict[str, Any], predicate: Any
) -> list[dict[str, Any]]:
    return [
        _job_snapshot(job)
        for job in bundle["projectJobs"]
        if predicate(str(job.get("appType") or ""))
    ]


def _vector_snapshot(database: Database, protein_id: str) -> list[dict[str, Any]]:
    snapshots: list[dict[str, Any]] = []
    for vector in database.list_expression_vectors(protein_id):
        backbone = str(vector.get("name") or "").split(" — ", 1)[0]
        library_id = vector.get("libraryId")
        if library_id:
            try:
                backbone = database.get_library_vector(str(library_id))["name"]
            except LookupError:
                pass
        insert_names = [
            str(feature.get("name") or "")
            for feature in vector.get("features") or []
            if isinstance(feature, dict) and feature.get("isInsert")
        ]
        snapshots.append({
            "name": vector["name"],
            "backbone": backbone,
            "circular": bool(vector.get("circular", True)),
            "lengthBp": len(str(vector.get("sequence") or "")),
            "inserts": insert_names,
        })
    return snapshots


def _fusion_partners(
    protein: dict[str, Any], vectors: Iterable[dict[str, Any]]
) -> list[str]:
    values: set[str] = set()
    external_ids = protein.get("externalIds") or {}
    for key in ("fusionPartner", "fusionPartners"):
        values.update(
            item.strip()
            for item in str(external_ids.get(key) or "").split(",")
            if item.strip()
        )
    markers = ("fusion", "tag", "mbp", "gst", "sumo", "strep", "his")
    for vector in vectors:
        for feature in vector.get("features") or []:
            if not isinstance(feature, dict):
                continue
            name = str(feature.get("name") or "").strip()
            feature_type = str(feature.get("type") or "").casefold()
            if name and any(
                marker in f"{feature_type} {name.casefold()}" for marker in markers
            ):
                values.add(name)
    return sorted(values, key=str.casefold)


def _format_value(value: float, unit: str) -> str:
    if unit == "Da":
        return f"{value:,.1f} Da"
    if unit == "M⁻¹ cm⁻¹":
        return f"{value:,.0f} M⁻¹ cm⁻¹"
    return f"{value:.2f}"


class ProjectTreeService:
    """Stable service boundary used by both the REST API and focused tests."""

    def __init__(self, database: Database):
        self.database = database

    def list_trees(self) -> list[dict[str, Any]]:
        return [self._refresh_tree(tree) for tree in self.database.list_project_trees()]

    def get_tree(self, tree_id: str) -> dict[str, Any]:
        return self._refresh_tree(self.database.get_project_tree(tree_id))

    def create_tree(self, fields: dict[str, Any]) -> dict[str, Any]:
        name = _clean_text(fields.get("name"), "Tree name", required=True)
        root_project_id = _clean_text(
            fields.get("rootProjectId"), "Root project id", required=True
        )
        self.database.get_protein(root_project_id)
        return self._present_tree(
            self.database.create_project_tree(name, root_project_id)
        )

    def rename_tree(self, tree_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        name = _clean_text(fields.get("name"), "Tree name", required=True)
        return self._present_tree(self.database.rename_project_tree(tree_id, name))

    def delete_tree(self, tree_id: str) -> None:
        self.database.delete_project_tree(tree_id)

    def create_link(self, tree_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        from_id = _clean_text(
            fields.get("fromProjectId"), "From project id", required=True
        )
        to_id = _clean_text(
            fields.get("toProjectId"), "To project id", required=True
        )
        self._validate_link(tree_id, from_id, to_id)
        diff = self.project_diff(from_id, to_id)
        from_project = diff["fromProject"]
        to_project = diff["toProject"]
        return self._present_link(self.database.create_project_tree_link(
            tree_id,
            from_id,
            to_id,
            change_type=_clean_text(fields.get("changeType"), "Change type"),
            description=_clean_text(fields.get("description"), "Description"),
            diff_summary=diff["summary"],
            diff_categories=diff["changeCategories"],
            from_project_updated_at=self.database.project_diff_revision(
                from_project["id"]
            ),
            to_project_updated_at=self.database.project_diff_revision(
                to_project["id"]
            ),
        ))

    def update_link(
        self, tree_id: str, link_id: str, fields: dict[str, Any]
    ) -> dict[str, Any]:
        current = self.database.get_project_tree_link(tree_id, link_id)
        from_id = _clean_text(
            fields.get("fromProjectId", current["fromProjectId"]),
            "From project id",
            required=True,
        )
        to_id = _clean_text(
            fields.get("toProjectId", current["toProjectId"]),
            "To project id",
            required=True,
        )
        self._validate_link(tree_id, from_id, to_id, replacing_link_id=link_id)
        diff = self.project_diff(from_id, to_id)
        return self._present_link(self.database.update_project_tree_link(
            tree_id,
            link_id,
            from_id,
            to_id,
            change_type=_clean_text(
                fields.get("changeType", current["changeType"]), "Change type"
            ),
            description=_clean_text(
                fields.get("description", current["description"]), "Description"
            ),
            diff_summary=diff["summary"],
            diff_categories=diff["changeCategories"],
            from_project_updated_at=self.database.project_diff_revision(from_id),
            to_project_updated_at=self.database.project_diff_revision(to_id),
        ))

    def delete_link(self, tree_id: str, link_id: str) -> None:
        self.database.delete_project_tree_link(tree_id, link_id)

    def import_local_trees(self, fields: dict[str, Any]) -> dict[str, Any]:
        source_key = _clean_text(
            fields.get("sourceKey"), "Import source key", required=True
        )
        if source_key != IMPORT_SOURCE_KEY:
            raise ValueError(f"Unsupported project-tree import source {source_key!r}")
        raw_trees = fields.get("trees")
        if not isinstance(raw_trees, list):
            raise ValueError("trees must be an array")
        if len(raw_trees) > 500:
            raise ValueError("At most 500 project trees can be imported at once")
        trees = self._normalize_import(raw_trees)
        imported, existing = self.database.import_project_trees(source_key, trees)
        return {
            "confirmed": True,
            "importedTreeIds": imported,
            "existingTreeIds": existing,
            "trees": self.list_trees(),
        }

    def project_diff(self, from_project_id: str, to_project_id: str) -> dict[str, Any]:
        before_bundle = self.database.get_bundle(from_project_id)
        after_bundle = self.database.get_bundle(to_project_id)
        before = before_bundle["protein"]
        after = after_bundle["protein"]
        changes, alignment = _sequence_diff(before["sequence"], after["sequence"])

        before_vectors_full = self.database.list_expression_vectors(from_project_id)
        after_vectors_full = self.database.list_expression_vectors(to_project_id)
        before_construct = {
            "tags": sorted(before.get("tags") or [], key=str.casefold),
            "fusionPartners": _fusion_partners(before, before_vectors_full),
        }
        after_construct = {
            "tags": sorted(after.get("tags") or [], key=str.casefold),
            "fusionPartners": _fusion_partners(after, after_vectors_full),
        }
        if before_construct != after_construct:
            before_label = ", ".join(
                before_construct["tags"] + before_construct["fusionPartners"]
            ) or "none"
            after_label = ", ".join(
                after_construct["tags"] + after_construct["fusionPartners"]
            ) or "none"
            changes.append(_change(
                "construct",
                "tags_and_fusions",
                before_construct,
                after_construct,
                f"Tags/fusions: {before_label} → {after_label}",
            ))

        before_vectors = _vector_snapshot(self.database, from_project_id)
        after_vectors = _vector_snapshot(self.database, to_project_id)
        if before_vectors != after_vectors:
            before_label = before_vectors[0]["backbone"] if before_vectors else "none"
            after_label = after_vectors[0]["backbone"] if after_vectors else "none"
            changes.append(_change(
                "vector",
                "changed",
                before_vectors,
                after_vectors,
                f"Vector: {before_label} → {after_label}",
            ))

        before_host = {
            "expressionSystem": before.get("expressionSystem") or "",
            "jobs": _jobs_for(
                before_bundle, lambda app_type: app_type in _EXPRESSION_JOB_TYPES
            ),
        }
        after_host = {
            "expressionSystem": after.get("expressionSystem") or "",
            "jobs": _jobs_for(
                after_bundle, lambda app_type: app_type in _EXPRESSION_JOB_TYPES
            ),
        }
        if before_host != after_host:
            before_label = before_host["expressionSystem"] or "not specified"
            after_label = after_host["expressionSystem"] or "not specified"
            changes.append(_change(
                "host", "changed", before_host, after_host,
                f"Host/expression: {before_label} → {after_label}",
            ))

        before_purification = _jobs_for(
            before_bundle,
            lambda app_type: app_type.startswith("purification-")
            or app_type == "chromatogram-studio",
        )
        after_purification = _jobs_for(
            after_bundle,
            lambda app_type: app_type.startswith("purification-")
            or app_type == "chromatogram-studio",
        )
        if before_purification != after_purification:
            changes.append(_change(
                "purification",
                "plan_changed",
                before_purification,
                after_purification,
                f"Purification plan: {len(before_purification)} → "
                f"{len(after_purification)} saved steps/jobs",
            ))

        def is_assay(app_type: str) -> bool:
            return (
                app_type not in _EXPRESSION_JOB_TYPES
                and not app_type.startswith("purification-")
                and app_type not in {
                    "chromatogram-studio",
                    "protein-planner",
                    "protparam",
                }
            )

        before_assays = _jobs_for(before_bundle, is_assay)
        after_assays = _jobs_for(after_bundle, is_assay)
        if before_assays != after_assays:
            changes.append(_change(
                "assay",
                "jobs_changed",
                before_assays,
                after_assays,
                f"Assays/jobs: {len(before_assays)} → {len(after_assays)}",
            ))

        before_metrics = analyze_sequence(before["sequence"])
        after_metrics = analyze_sequence(after["sequence"])
        metrics = [
            ("molecular_weight", "Molecular weight", "molecularWeightDa", "Da"),
            ("isoelectric_point", "Theoretical pI", "theoreticalPI", "pI"),
        ]
        for kind, label, key, unit in metrics:
            old_value = float(before_metrics[key])
            new_value = float(after_metrics[key])
            if old_value != new_value:
                changes.append(_change(
                    "protparam",
                    kind,
                    old_value,
                    new_value,
                    f"{label}: {_format_value(old_value, unit)} → "
                    f"{_format_value(new_value, unit)}",
                    {"unit": unit},
                ))
        before_extinction = float(
            before_metrics["extinctionCoefficient280"]["oxidizedMolarM1Cm1"]
        )
        after_extinction = float(
            after_metrics["extinctionCoefficient280"]["oxidizedMolarM1Cm1"]
        )
        if before_extinction != after_extinction:
            unit = "M⁻¹ cm⁻¹"
            changes.append(_change(
                "protparam",
                "extinction_coefficient_280",
                before_extinction,
                after_extinction,
                f"Extinction coefficient: {_format_value(before_extinction, unit)} "
                f"→ {_format_value(after_extinction, unit)}",
                {"unit": unit, "state": "oxidized"},
            ))

        before_metadata = {
            "name": before["name"],
            "geneName": before.get("geneName") or "",
            "organism": before.get("organism") or "",
            "description": before.get("description") or "",
            "notes": before.get("notes") or "",
            "notebook": _without_noise(before_bundle.get("projectNotebook")),
        }
        after_metadata = {
            "name": after["name"],
            "geneName": after.get("geneName") or "",
            "organism": after.get("organism") or "",
            "description": after.get("description") or "",
            "notes": after.get("notes") or "",
            "notebook": _without_noise(after_bundle.get("projectNotebook")),
        }
        for field in before_metadata:
            if before_metadata[field] != after_metadata[field]:
                label = {
                    "geneName": "Gene name",
                    "notebook": "Notes/report",
                }.get(field, field.capitalize())
                changes.append(_change(
                    "metadata",
                    f"{field}_changed",
                    before_metadata[field],
                    after_metadata[field],
                    f"{label} changed",
                    {"field": field},
                ))

        changes.sort(key=lambda item: _CATEGORY_ORDER[item["category"]])
        categories = list(dict.fromkeys(change["category"] for change in changes))
        return {
            "fromProject": {
                "id": before["id"],
                "name": before["name"],
                "updatedAt": before["updatedAt"],
            },
            "toProject": {
                "id": after["id"],
                "name": after["name"],
                "updatedAt": after["updatedAt"],
            },
            "summary": self._branch_summary(changes),
            "changeCategories": categories,
            "algorithm": {
                "sequenceAlignment": ALIGNMENT_METHOD,
                "positions": "1-based",
                "matchScore": 2.0,
                "mismatchScore": -1.0,
                "gapOpenScore": -4.0,
                "gapExtendScore": -0.5,
            },
            "sequenceAlignment": alignment,
            "changes": changes,
        }

    @staticmethod
    def _branch_summary(changes: list[dict[str, Any]]) -> str:
        if not changes:
            return "No experimental changes"
        selected: list[str] = []
        experimental_categories = (
            "sequence", "construct", "vector", "host", "purification", "assay"
        )
        categories = (
            experimental_categories
            if any(
                change["category"] in experimental_categories for change in changes
            )
            else ("metadata", "protparam")
        )
        for category in categories:
            for change in changes:
                if change["category"] == category:
                    selected.append(change["summary"])
                    break
            if len(selected) == 3:
                break
        return " · ".join(selected)

    def _validate_link(
        self,
        tree_id: str,
        from_id: str,
        to_id: str,
        *,
        replacing_link_id: str | None = None,
    ) -> None:
        if from_id == to_id:
            raise ValueError("A project cannot link to itself")
        self.database.get_protein(from_id)
        self.database.get_protein(to_id)
        tree = self.database.get_project_tree(tree_id)
        edges = [
            (link["fromProjectId"], link["toProjectId"])
            for link in tree["links"]
            if link["id"] != replacing_link_id
        ]
        if (from_id, to_id) in edges:
            raise ValueError("That project link already exists")
        edges.append((from_id, to_id))
        if self._has_cycle(edges):
            raise ValueError("Project tree links cannot create a cycle")

    @staticmethod
    def _has_cycle(edges: Iterable[tuple[str, str]]) -> bool:
        adjacency: dict[str, set[str]] = {}
        for source, target in edges:
            adjacency.setdefault(source, set()).add(target)
            adjacency.setdefault(target, set())
        visiting: set[str] = set()
        visited: set[str] = set()

        def visit(node: str) -> bool:
            if node in visiting:
                return True
            if node in visited:
                return False
            visiting.add(node)
            if any(visit(child) for child in adjacency[node]):
                return True
            visiting.remove(node)
            visited.add(node)
            return False

        return any(visit(node) for node in adjacency if node not in visited)

    def _refresh_tree(self, tree: dict[str, Any]) -> dict[str, Any]:
        nodes = {node["projectId"]: node for node in tree["nodes"]}
        for link in tree["links"]:
            from_node = nodes.get(link["fromProjectId"])
            to_node = nodes.get(link["toProjectId"])
            if not from_node or not to_node or from_node["missing"] or to_node["missing"]:
                continue
            before = self.database.get_protein(link["fromProjectId"])
            after = self.database.get_protein(link["toProjectId"])
            before_revision = self.database.project_diff_revision(before["id"])
            after_revision = self.database.project_diff_revision(after["id"])
            cache = link.get("_cache") or {}
            if (
                cache.get("fromProjectUpdatedAt") == before_revision
                and cache.get("toProjectUpdatedAt") == after_revision
                and link["diffSummary"]
            ):
                continue
            diff = self.project_diff(before["id"], after["id"])
            link["diffSummary"] = diff["summary"]
            link["changeCategories"] = diff["changeCategories"]
            self.database.update_project_tree_link_cache(
                tree["id"],
                link["id"],
                diff_summary=diff["summary"],
                diff_categories=diff["changeCategories"],
                from_project_updated_at=before_revision,
                to_project_updated_at=after_revision,
            )
        return self._present_tree(tree)

    @staticmethod
    def _present_link(link: dict[str, Any]) -> dict[str, Any]:
        value = deepcopy(link)
        value.pop("_cache", None)
        return value

    @classmethod
    def _present_tree(cls, tree: dict[str, Any]) -> dict[str, Any]:
        value = deepcopy(tree)
        links = [cls._present_link(link) for link in value["links"]]
        value["links"] = links
        value["relationships"] = deepcopy(links)
        return value

    @classmethod
    def _normalize_import(
        cls, raw_trees: list[Any]
    ) -> list[dict[str, Any]]:
        trees: list[dict[str, Any]] = []
        seen_tree_ids: set[str] = set()
        seen_link_ids: set[str] = set()
        for raw_tree in raw_trees:
            if not isinstance(raw_tree, dict):
                raise ValueError("Every imported tree must be an object")
            tree_id = _clean_text(raw_tree.get("id"), "Tree id", required=True)
            if tree_id in seen_tree_ids:
                raise ValueError(f"Duplicate imported tree id {tree_id!r}")
            seen_tree_ids.add(tree_id)
            root_id = _clean_text(
                raw_tree.get("rootProjectId"), "Root project id", required=True
            )
            raw_links = raw_tree.get("relationships", raw_tree.get("links", []))
            if not isinstance(raw_links, list):
                raise ValueError("Tree relationships must be an array")
            if len(raw_links) > 5_000:
                raise ValueError("A project tree cannot exceed 5,000 links")
            links: list[dict[str, str]] = []
            edges: set[tuple[str, str]] = set()
            for index, raw_link in enumerate(raw_links):
                if not isinstance(raw_link, dict):
                    raise ValueError("Every imported relationship must be an object")
                link_id = _clean_text(raw_link.get("id"), "Link id")
                if not link_id:
                    link_id = str(uuid.uuid5(
                        uuid.NAMESPACE_URL,
                        f"{IMPORT_SOURCE_KEY}:{tree_id}:link:{index}",
                    ))
                if link_id in seen_link_ids:
                    raise ValueError(f"Duplicate imported link id {link_id!r}")
                seen_link_ids.add(link_id)
                source = _clean_text(
                    raw_link.get("fromProjectId"),
                    "From project id",
                    required=True,
                )
                target = _clean_text(
                    raw_link.get("toProjectId"),
                    "To project id",
                    required=True,
                )
                if source == target:
                    raise ValueError("A project cannot link to itself")
                if (source, target) in edges:
                    raise ValueError("An imported project link is duplicated")
                edges.add((source, target))
                links.append({
                    "id": link_id,
                    "fromProjectId": source,
                    "toProjectId": target,
                    "changeType": _clean_text(
                        raw_link.get("changeType"), "Change type"
                    ),
                    "description": _clean_text(
                        raw_link.get("description"), "Description"
                    ),
                })
            if cls._has_cycle(edges):
                raise ValueError("Imported project tree links cannot contain a cycle")
            trees.append({
                "id": tree_id,
                "name": _clean_text(
                    raw_tree.get("name"), "Tree name", required=True
                ),
                "rootProjectId": root_id,
                "links": links,
                "createdAt": _clean_text(raw_tree.get("createdAt"), "Created at"),
                "updatedAt": _clean_text(raw_tree.get("updatedAt"), "Updated at"),
            })
        return trees
