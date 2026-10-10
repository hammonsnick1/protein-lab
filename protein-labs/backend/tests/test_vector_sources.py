"""Offline tests for vector-source selection.

The network fetches themselves are not exercised here; what matters locally is
that the catalogue search behaves and that every source is described for the UI.
"""

import pytest

from protein_labs.vector_sources import (
    VectorSourceError,
    _loose,
    _rank,
    describe_sources,
    fetch_vector,
    search_vectors,
)


def test_every_selectable_source_is_described():
    sources = {source["id"]: source for source in describe_sources()}
    assert set(sources) == {"snapgene", "ncbi", "addgene", "file"}
    assert sources["snapgene"]["needsSet"] is True
    # Addgene publishes sequence without features, so it must be annotated here.
    assert sources["addgene"]["annotated"] is False
    assert sources["snapgene"]["attribution"]


def test_loose_matching_ignores_catalogue_punctuation():
    # Addgene writes "pET-28 a (+)" where SnapGene writes "pET-28a(+)".
    assert _loose("pET-28 a (+)") == _loose("pET-28a(+)")


def test_rank_prefers_exact_then_prefix_then_substring():
    entries = [
        {"name": "pET-28b(+)", "description": ""},
        {"name": "ApET-28a(+) derivative", "description": ""},
        {"name": "pET-28 a (+)", "description": ""},
    ]
    ranked = [entry["name"] for entry in _rank(entries, "pET-28a(+)", 10)]
    assert ranked[0] == "pET-28 a (+)"
    assert "ApET-28a(+) derivative" in ranked


def test_rank_returns_nothing_for_an_empty_query_unless_listing():
    entries = [{"name": "pET-28a(+)", "description": ""}]
    assert _rank(entries, "", 10) == []
    assert _rank(entries, "", 10, allow_empty=True) == entries


def test_unknown_sources_are_rejected():
    with pytest.raises(VectorSourceError, match="Unknown vector source"):
        search_vectors("elsewhere", "pET-28a")
    with pytest.raises(VectorSourceError, match="Unknown vector source"):
        fetch_vector("elsewhere", "pET-28a")


def test_fetching_requires_an_identifier():
    with pytest.raises(VectorSourceError, match="identifier is required"):
        fetch_vector("ncbi", "   ")


def test_file_source_is_handled_by_import_rather_than_search():
    assert search_vectors("file", "anything") == []
