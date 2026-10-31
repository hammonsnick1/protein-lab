"""ConSurf grades parsing, ConSurf-DB lookups, and the conservation API."""

import json
from pathlib import Path

import pytest

from protein_labs.protein_planner.conservation import (
    CONSURF_COLORS,
    ConSurfDbClient,
    ConSurfParseError,
    parse_consurf_grades,
    parse_consurf_msa,
)
from protein_labs.protein_planner.database import Database
from protein_labs.protein_planner.integrations import (
    AlphaFoldDBClient,
    HttpClient,
    HttpResponse,
    NCBIBlastClient,
    RCSBClient,
    RemoteServiceError,
    UniProtClient,
)
from protein_labs.protein_planner.service import ProteinPlanner

FIXTURES = Path(__file__).parent / "fixtures"
UBIQUITIN = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG"

MSA_FASTA = """>Input_seq_SEQRES_A
MQ-IFVKT-L---T-G--KTITL
>ur|G8DFN2|1_76|7.4e-45|unclassified_Coccolithovirus
MQ-IFVKT-L---T-G--KTITL
>ur|A0A2D7CSY3|1_76|4.6e-43|Rhodospirillaceae_bacterium
MQ-IFVKT-L---T-G--KTITC
"""


def db_grades() -> str:
    return (FIXTURES / "consurf_db_summary.txt").read_text()


def server_grades() -> str:
    return (FIXTURES / "consurf_server_grades.txt").read_text()


# ----------------------------------------------------------------------
# Parser: the ConSurf-DB layout
# ----------------------------------------------------------------------
def test_parses_consurf_db_summary_layout():
    parsed = parse_consurf_grades(db_grades())
    assert parsed["layout"] == "consurf-db"
    assert parsed["residueCount"] == 20
    assert parsed["chains"] == ["A"]
    assert parsed["skippedRowCount"] == 0
    assert parsed["columns"][:5] == ["POS", "SEQ", "ATOM", "SCORE", "COLOR"]
    assert parsed["sequence"].startswith("MQIFVKTLTGKTITLEVE")

    first = parsed["residues"][0]
    assert first["position"] == 1
    assert first["residue"] == "M"
    assert first["grade"] == 9
    assert first["score"] == pytest.approx(-1.527)
    assert first["insufficientData"] is False
    assert first["confidenceInterval"] == [-1.736, -1.428]
    assert first["confidenceGrades"] == [9, 9]
    assert first["alignedSequences"] == 159
    assert first["totalSequences"] == 300
    assert first["msaData"] == "159/300"
    assert first["burialState"] == "e"
    assert first["functionalState"] == "f"
    assert first["pdbResidueNumber"] == "1"
    assert first["pdbChain"] == "A"
    assert first["modelled"] is True


def test_parses_consurf_db_residue_variety_percentages():
    parsed = parse_consurf_grades(db_grades())
    variety = parsed["residues"][0]["varietyResidues"]
    assert variety[0] == {"residue": "M", "percent": 88.0, "belowOnePercent": False}
    # ConSurf writes "<1%", so the bound is reported rather than a made-up value.
    assert variety[-1] == {"residue": "R", "percent": 1.0, "belowOnePercent": True}


def test_consurf_db_grade_scale_comes_from_the_file_header():
    scale = parse_consurf_grades(db_grades())["gradeScale"]
    assert [layer["grade"] for layer in scale] == [9, 8, 7, 6, 5, 4, 3, 2, 1]
    assert scale[0] == {"grade": 9, "from": -1.7, "to": -1.322}


# ----------------------------------------------------------------------
# Parser: the ConSurf server layout
# ----------------------------------------------------------------------
def test_parses_consurf_server_grades_layout():
    parsed = parse_consurf_grades(server_grades())
    assert parsed["layout"] == "consurf-server"
    assert parsed["residueCount"] == 10
    assert parsed["skippedRowCount"] == 0
    assert "CONFIDENCE INTERVAL COLORS" in parsed["columns"]

    first = parsed["residues"][0]
    assert (first["position"], first["residue"], first["grade"]) == (1, "M", 9)
    # The server layout keeps the interval and its grades in separate columns.
    assert first["confidenceInterval"] == [-1.459, -1.079]
    assert first["confidenceGrades"] == [9, 9]
    assert first["pdbResidueNumber"] == "1"
    assert first["varietyResidues"] == [
        {"residue": "M", "percent": None, "belowOnePercent": False}
    ]


def test_residues_absent_from_the_model_keep_their_grade_without_a_pdb_number():
    residues = parse_consurf_grades(server_grades())["residues"]
    unmodelled = [row for row in residues if not row["modelled"]]
    assert [row["position"] for row in unmodelled] == [7, 8]
    assert unmodelled[0]["grade"] == 1
    assert unmodelled[0]["pdbResidueNumber"] == ""
    assert unmodelled[0]["pdbChain"] == ""
    assert unmodelled[0]["atomLabel"] == ""
    # A blank B/E column must not shift the MSA count onto another field.
    assert unmodelled[0]["burialState"] == ""
    assert unmodelled[0]["msaData"] == "281/300"


# ----------------------------------------------------------------------
# Parser: insufficient data
# ----------------------------------------------------------------------
@pytest.mark.parametrize(
    "text,positions",
    [(db_grades(), [19, 20]), (server_grades(), [9, 10])],
    ids=["consurf-db", "consurf-server"],
)
def test_starred_rows_are_reported_as_insufficient_data(text, positions):
    parsed = parse_consurf_grades(text)
    flagged = [row["position"] for row in parsed["residues"] if row["insufficientData"]]
    assert flagged == positions
    assert parsed["insufficientDataCount"] == len(positions)
    assert parsed["gradedCount"] == parsed["residueCount"] - len(positions)
    # Insufficient-data sites keep their numbers; it is their confidence that
    # is in question, so they must still be available to the caller.
    starred = next(row for row in parsed["residues"] if row["insufficientData"])
    assert 1 <= starred["grade"] <= 9
    assert starred["alignedSequences"] is not None and starred["alignedSequences"] < 6


def test_mean_grade_excludes_insufficient_data_sites():
    parsed = parse_consurf_grades(server_grades())
    graded = [row["grade"] for row in parsed["residues"] if not row["insufficientData"]]
    assert parsed["meanGrade"] == pytest.approx(round(sum(graded) / len(graded), 3))


# ----------------------------------------------------------------------
# Parser: malformed files
# ----------------------------------------------------------------------
def test_empty_file_is_rejected_with_an_explanation():
    with pytest.raises(ConSurfParseError) as error:
        parse_consurf_grades("   \n\n")
    assert "empty" in str(error.value)
    assert "consurf_grades.txt" in str(error.value)


def test_a_file_that_is_not_consurf_output_is_rejected():
    with pytest.raises(ConSurfParseError) as error:
        parse_consurf_grades(">sp|P69905|HBA_HUMAN\nMVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSF\n")
    assert "not a ConSurf grades file" in str(error.value)


def test_a_consurf_header_with_no_rows_says_the_table_was_empty():
    header = "POS\tSEQ\tATOM\tSCORE\tCOLOR\tCONFIDENCE INTERVAL\tMSA DATA\n\n"
    with pytest.raises(ConSurfParseError) as error:
        parse_consurf_grades(header)
    assert "no residue rows could be read" in str(error.value)


def test_grades_outside_the_published_scale_are_refused():
    rows = "POS\tSEQ\tATOM\tSCORE\tCOLOR\tCONFIDENCE INTERVAL\tMSA DATA\n" \
        "  1\t  M\t MET:1:A\t-1.527\t  12 \t-1.736, -1.428  9,9\t 159/300\tM\n"
    with pytest.raises(ConSurfParseError) as error:
        parse_consurf_grades(rows)
    assert "outside the 1-9 scale" in str(error.value)


def test_a_truncated_row_is_counted_rather_than_silently_dropped():
    text = server_grades() + "  11\t   K\n"
    parsed = parse_consurf_grades(text)
    assert parsed["residueCount"] == 10
    assert parsed["skippedRowCount"] == 1


# ----------------------------------------------------------------------
# Parser: sequence comparison and MSA summary
# ----------------------------------------------------------------------
def test_sequence_match_reports_agreement_with_the_project_sequence():
    parsed = parse_consurf_grades(db_grades(), query_sequence=UBIQUITIN[:20])
    assert parsed["sequenceMatch"]["identical"] is True
    assert parsed["sequenceMatch"]["coverage"] == 1.0

    shifted = parse_consurf_grades(db_grades(), query_sequence="A" + UBIQUITIN[:19])
    assert shifted["sequenceMatch"]["identical"] is False
    assert shifted["sequenceMatch"]["matchingResidues"] < 20


def test_sequence_match_is_marked_uncompared_without_a_query():
    assert parse_consurf_grades(db_grades())["sequenceMatch"]["compared"] is False


def test_msa_summary_counts_sequences_without_keeping_the_alignment():
    summary = parse_consurf_msa(MSA_FASTA)
    assert summary["available"] is True
    assert summary["sequenceCount"] == 3
    assert summary["alignmentLength"] == 23
    assert summary["queryId"] == "Input_seq_SEQRES_A"
    assert parse_consurf_msa("")["available"] is False


def test_published_colours_cover_every_grade_and_insufficient_data():
    assert sorted(CONSURF_COLORS) == [
        "1", "2", "3", "4", "5", "6", "7", "8", "9", "insufficient"
    ]


# ----------------------------------------------------------------------
# ConSurf-DB client
# ----------------------------------------------------------------------
class FakeTransport:
    """Replays recorded ConSurf-DB responses and records what was requested."""

    def __init__(self, replies: dict[str, HttpResponse]):
        self.replies = replies
        self.calls: list[tuple[str, str, dict[str, str]]] = []

    def __call__(self, method, url, data=None, headers=None):
        self.calls.append((method, url, dict(headers or {})))
        for fragment, reply in self.replies.items():
            if fragment in url:
                return reply
        return HttpResponse(404, "not found", {})


def ok(text: str, cookies: dict[str, str] | None = None) -> HttpResponse:
    return HttpResponse(200, text, {}, cookies or {})


def consurf_client(replies: dict[str, HttpResponse]) -> tuple[ConSurfDbClient, FakeTransport]:
    transport = FakeTransport(replies)
    return ConSurfDbClient(HttpClient(transport=transport)), transport


def test_consurf_db_maps_a_pdb_chain_onto_its_stored_representative():
    client, transport = consurf_client({
        "find_chains": ok('["A", "B"]'),
        "get_identical_chain": ok('{"identical_pdb": "6Q00", "identical_chain": "A"}'),
    })
    assert client.chains("1ubq") == ["A", "B"]
    assert client.identical_chain("1UBQ", "A") == ("6Q00", "A")
    assert "pdb_ID=1UBQ" in transport.calls[0][1]


def test_consurf_db_reports_a_missing_entry_instead_of_an_empty_chain():
    client, _ = consurf_client({
        "get_identical_chain": ok('{"identical_pdb": "", "identical_chain": ""}'),
    })
    with pytest.raises(RemoteServiceError) as error:
        client.identical_chain("9ZZZ", "A")
    assert "no pre-calculated entry" in str(error.value)


def test_consurf_db_sequence_lookup_sends_the_csrf_token_it_was_issued():
    client, transport = consurf_client({
        "consurfdb.tau.ac.il/check_seq": ok('{"pdb": "6Q00", "chain": "A"}'),
        # The home page is what hands out the token; it must be fetched first.
        "consurfdb.tau.ac.il/": ok("<html></html>", {"csrftoken": "tok3n", "TS01": "waf"}),
    })
    assert client.sequence_entry(UBIQUITIN) == ("6Q00", "A")
    headers = transport.calls[-1][2]
    assert headers["X-CSRFToken"] == "tok3n"
    # Django compares the header against the cookie, so both must travel.
    assert "csrftoken=tok3n" in headers["Cookie"] and "TS01=waf" in headers["Cookie"]


def test_consurf_db_sequence_lookup_surfaces_its_own_error_text():
    client, _ = consurf_client({
        "check_seq": ok('{"error": "Sequence not found in ConSurf-DB"}'),
        "consurfdb.tau.ac.il/": ok("<html></html>", {"csrftoken": "tok3n"}),
    })
    with pytest.raises(RemoteServiceError) as error:
        client.sequence_entry(UBIQUITIN)
    assert "Sequence not found" in str(error.value)


def test_consurf_db_grades_and_msa_are_fetched_for_the_representative_chain():
    client, _ = consurf_client({
        "Get_Score_File": ok(json.dumps({"Score_File": db_grades()})),
        "Show_Fasta": ok(MSA_FASTA),
    })
    assert "Amino Acid Conservation Scores" in client.grades("6Q00", "A")
    assert client.msa("6Q00", "A").startswith(">")


def test_a_missing_msa_is_not_treated_as_a_failure():
    client, _ = consurf_client({"Show_Fasta": HttpResponse(500, "server error", {})})
    assert client.msa("6Q00", "A") == ""


def test_empty_scores_are_reported_rather_than_parsed():
    client, _ = consurf_client({"Get_Score_File": ok('{"Score_File": ""}')})
    with pytest.raises(RemoteServiceError) as error:
        client.grades("6Q00", "A")
    assert "no conservation scores" in str(error.value)


# ----------------------------------------------------------------------
# Service and persistence
# ----------------------------------------------------------------------
@pytest.fixture()
def planner(tmp_path) -> ProteinPlanner:
    http = HttpClient(transport=lambda *args, **kwargs: HttpResponse(200, "{}", {}))
    return ProteinPlanner(
        Database(tmp_path / "conservation.sqlite3"),
        NCBIBlastClient(http),
        UniProtClient(http),
        RCSBClient(http),
        AlphaFoldDBClient(http),
    )


@pytest.fixture()
def protein(planner: ProteinPlanner) -> str:
    bundle = planner.create_protein({"name": "Ubiquitin", "sequence": UBIQUITIN})
    return bundle["protein"]["id"]


def test_prepare_consurf_job_writes_a_fasta_and_records_the_steps(planner, protein):
    job = planner.prepare_consurf_job(protein)
    assert job["status"] == "prepared"
    assert job["source"] == "consurf-server"
    files = job["metadata"]["files"]
    assert [item["kind"] for item in files] == ["fasta"]
    fasta = Path(files[0]["path"])
    assert fasta.read_text().startswith(">Ubiquitin\nMQIFVKTLTG")
    assert job["metadata"]["serverUrl"].startswith("https://consurf.tau.ac.il")
    assert len(job["metadata"]["steps"]) >= 5
    assert job["metadata"]["colors"]["9"] == CONSURF_COLORS["9"]


def test_prepare_consurf_job_refuses_a_project_with_no_sequence(planner):
    # The planner will not create one, but a record saved before the sequence
    # was required must still give a clear instruction rather than an empty FASTA.
    empty = planner.database.create_protein({"name": "Draft"}, "")["id"]
    with pytest.raises(ValueError) as error:
        planner.prepare_consurf_job(empty)
    assert "no amino-acid sequence" in str(error.value)


def test_importing_grades_saves_the_per_residue_profile(planner, protein):
    path = FIXTURES / "consurf_db_summary.txt"
    job = planner.import_consurf_result(protein, str(path))
    assert job["status"] == "complete"
    assert job["source"] == "consurf-server-import"
    assert job["residueCount"] == 20
    assert job["chain"] == "A"
    assert job["metadata"]["insufficientDataCount"] == 2
    assert job["metadata"]["importedFile"] == "consurf_db_summary.txt"
    assert job["metadata"]["sequenceMatch"]["compared"] is True

    stored = planner.get_conservation(protein, job["id"])
    assert len(stored["residues"]) == 20
    assert stored["residues"][0]["grade"] == 9
    assert stored["colors"]["insufficient"] == CONSURF_COLORS["insufficient"]


def test_importing_completes_the_prepared_job_instead_of_adding_a_second_run(planner, protein):
    prepared = planner.prepare_consurf_job(protein)
    imported = planner.import_consurf_result(
        protein, str(FIXTURES / "consurf_server_grades.txt"), job_id=prepared["id"]
    )
    assert imported["id"] == prepared["id"]
    assert imported["status"] == "complete"
    assert len(planner.list_conservation(protein)["jobs"]) == 1


def test_importing_a_malformed_file_reports_it_and_stores_nothing(planner, protein, tmp_path):
    broken = tmp_path / "notes.txt"
    broken.write_text("conservation looked fine to me\n")
    with pytest.raises(ConSurfParseError):
        planner.import_consurf_result(protein, str(broken))
    assert planner.list_conservation(protein)["jobs"] == []


def test_importing_a_missing_file_names_the_path(planner, protein, tmp_path):
    with pytest.raises(ValueError) as error:
        planner.import_consurf_result(protein, str(tmp_path / "absent.grades"))
    assert "does not exist" in str(error.value)


def test_an_msa_that_is_not_fasta_is_refused(planner, protein, tmp_path):
    msa = tmp_path / "alignment.txt"
    msa.write_text("CLUSTAL W (1.83) multiple sequence alignment\n")
    with pytest.raises(ValueError) as error:
        planner.import_consurf_result(
            protein, str(FIXTURES / "consurf_db_summary.txt"), msa_path=str(msa)
        )
    assert "not a FASTA alignment" in str(error.value)


def test_an_imported_msa_is_kept_and_served_separately(planner, protein, tmp_path):
    msa = tmp_path / "msa.fasta"
    msa.write_text(MSA_FASTA)
    job = planner.import_consurf_result(
        protein, str(FIXTURES / "consurf_db_summary.txt"), msa_path=str(msa)
    )
    assert job["metadata"]["msa"]["sequenceCount"] == 3
    assert job["metadata"]["msaFile"] == "msa.fasta"
    # The profile response stays small: the alignment has its own endpoint.
    assert "msaFasta" not in job
    served = planner.get_conservation_msa(protein, job["id"])
    assert served["fasta"] == MSA_FASTA
    assert served["sequenceCount"] == 3


def test_the_project_bundle_lists_runs_without_their_residue_profiles(planner, protein):
    planner.import_consurf_result(protein, str(FIXTURES / "consurf_db_summary.txt"))
    listed = planner.database.get_bundle(protein)["conservationJobs"]
    assert len(listed) == 1
    assert listed[0]["residueCount"] == 20
    assert "residues" not in listed[0]


def test_conservation_runs_are_dropped_when_the_sequence_changes(planner, protein):
    planner.import_consurf_result(protein, str(FIXTURES / "consurf_db_summary.txt"))
    planner.update_protein(protein, {"sequence": UBIQUITIN[:40]})
    assert planner.list_conservation(protein)["jobs"] == []


def test_renaming_a_project_keeps_its_conservation_runs(planner, protein):
    planner.import_consurf_result(protein, str(FIXTURES / "consurf_db_summary.txt"))
    planner.update_protein(protein, {"name": "Ubiquitin (His-tagged)"})
    assert len(planner.list_conservation(protein)["jobs"]) == 1


def test_deleting_a_run_removes_it(planner, protein):
    job = planner.import_consurf_result(protein, str(FIXTURES / "consurf_db_summary.txt"))
    assert planner.delete_conservation(protein, job["id"]) == {"deleted": job["id"]}
    assert planner.list_conservation(protein)["jobs"] == []
    with pytest.raises(LookupError):
        planner.get_conservation(protein, job["id"])


def test_consurf_db_lookup_stores_the_representative_chain_it_used(planner, protein):
    transport = FakeTransport({
        "find_chains": ok('["A"]'),
        "get_identical_chain": ok('{"identical_pdb": "6Q00", "identical_chain": "A"}'),
        "Get_Score_File": ok(json.dumps({"Score_File": db_grades()})),
        "Show_Fasta": ok(MSA_FASTA),
    })
    planner.consurf = ConSurfDbClient(HttpClient(transport=transport))
    job = planner.lookup_consurf_db(protein, "1UBQ", "A")
    assert job["source"] == "consurf-db"
    assert job["status"] == "complete"
    assert job["pdbId"] == "1UBQ"
    assert job["metadata"]["identicalPdbId"] == "6Q00"
    assert job["metadata"]["matchedBy"] == "pdb"
    assert job["metadata"]["msa"]["sequenceCount"] == 3
    assert job["residueCount"] == 20
    assert "consurfdb.tau.ac.il" in job["metadata"]["entryUrl"]


def test_consurf_db_lookup_falls_back_to_the_sequence_when_no_pdb_is_known(planner, protein):
    transport = FakeTransport({
        "check_seq": ok('{"pdb": "6Q00", "chain": "A"}'),
        "Get_Score_File": ok(json.dumps({"Score_File": db_grades()})),
        "Show_Fasta": ok(MSA_FASTA),
        "consurfdb.tau.ac.il/": ok("<html></html>", {"csrftoken": "tok3n"}),
    })
    planner.consurf = ConSurfDbClient(HttpClient(transport=transport))
    job = planner.lookup_consurf_db(protein)
    assert job["metadata"]["matchedBy"] == "sequence"
    assert job["pdbId"] == "6Q00"


def test_consurf_db_lookup_without_a_client_is_a_configuration_error(planner, protein):
    planner.consurf = None
    with pytest.raises(RuntimeError) as error:
        planner.lookup_consurf_db(protein, "1UBQ", "A")
    assert "not configured" in str(error.value)


# ----------------------------------------------------------------------
# Column reading: flags vs a variety that looks like one
# ----------------------------------------------------------------------
HEADER = "POS\tSEQ\t    ATOM\t SCORE\tCOLOR\tCONFIDENCE INTERVAL\tB/E\tF/S\tMSA DATA\tRESIDUE VARIETY\n"


def row(burial: str = "", function: str = "", msa: str = "", variety: str = "M") -> str:
    return (
        HEADER
        + f"  1\t  M\t MET:1:A\t-0.500\t   6 \t-0.700, -0.300  7,6"
        + f"\t{burial or '   '}\t{function or '   '}\t{msa or '    '}\t{variety}\n"
    )


def first(text: str):
    return parse_consurf_grades(text)["residues"][0]


def test_a_variety_beginning_with_a_flag_letter_is_not_read_as_the_flag():
    # Every optional column before the variety is blank, so a scan of the
    # flattened text would charge this variety's leading E to burialState and
    # hand back a truncated ",D".
    parsed = first(row(variety="E,D"))
    assert parsed["burialState"] == ""
    assert parsed["functionalState"] == ""
    assert parsed["residueVariety"] == "E,D"
    assert [item["residue"] for item in parsed["varietyResidues"]] == ["E", "D"]


def test_a_lone_single_letter_variety_is_the_variety_not_a_flag():
    parsed = first(row(variety="B"))
    assert parsed["burialState"] == ""
    assert parsed["residueVariety"] == "B"


@pytest.mark.parametrize("variety", ["E,D", "B,A", "F,Y", "S,T"])
def test_no_variety_residue_is_ever_swallowed_by_a_blank_flag_column(variety):
    parsed = first(row(variety=variety))
    assert parsed["residueVariety"] == variety


def test_real_flag_columns_are_still_read_when_they_are_filled():
    parsed = first(row(burial="  b", function="  f", msa=" 159/300", variety="M 88%"))
    assert (parsed["burialState"], parsed["functionalState"]) == ("b", "f")
    assert parsed["msaData"] == "159/300"
    assert parsed["residueVariety"] == "M 88%"


def test_a_flag_is_still_read_when_the_msa_column_is_blank():
    parsed = first(row(burial="  b", variety="F,Y"))
    assert parsed["burialState"] == "b"
    assert parsed["residueVariety"] == "F,Y"


def test_the_msa_column_anchors_the_variety_even_when_the_flags_are_blank():
    parsed = first(row(msa=" 200/300", variety="E,D"))
    assert parsed["msaData"] == "200/300"
    assert parsed["burialState"] == ""
    assert parsed["residueVariety"] == "E,D"


# ----------------------------------------------------------------------
# Prepared submission file names
# ----------------------------------------------------------------------
def fasta_sequence(path: Path) -> str:
    """The residues of a FASTA file, with its header and line wrapping removed."""
    body = path.read_text().split("\n", 1)[1]
    return "".join(body.split())


def test_two_projects_with_the_same_name_get_separate_submission_files(planner):
    first_id = planner.create_protein({"name": "Ubiquitin", "sequence": UBIQUITIN})["protein"]["id"]
    second_id = planner.create_protein({"name": "Ubiquitin", "sequence": UBIQUITIN[:40]})["protein"]["id"]
    first_path = Path(planner.prepare_consurf_job(first_id)["metadata"]["files"][0]["path"])
    second_path = Path(planner.prepare_consurf_job(second_id)["metadata"]["files"][0]["path"])

    assert first_path != second_path
    # Neither submission may be overwritten by the other: a silently swapped
    # FASTA would send the wrong sequence to ConSurf.
    assert fasta_sequence(first_path) == UBIQUITIN
    assert fasta_sequence(second_path) == UBIQUITIN[:40]


def test_a_project_with_no_usable_name_still_gets_a_distinct_file(planner):
    blank = planner.database.create_protein({"name": "!!!"}, UBIQUITIN)["id"]
    path = Path(planner.prepare_consurf_job(blank)["metadata"]["files"][0]["path"])
    assert path.is_file()
    assert blank[:8] in path.name
