from protein_labs.protein_planner.integrations import (
    AlphaFoldDBClient,
    HttpClient,
    HttpResponse,
    NCBIBlastClient,
    RCSBClient,
    global_sequence_metrics,
    local_alignment_metrics,
    normalize_uniprot,
    parse_blast_xml,
    parse_blast_xml2,
    parse_ebi_blast_json,
    parse_mmcif_conditions,
    parse_structure_geometry,
    representative_peptides,
)
from urllib.parse import parse_qs


BLAST_XML = """<?xml version="1.0"?>
<BlastOutput>
  <BlastOutput_query-len>100</BlastOutput_query-len>
  <BlastOutput_iterations><Iteration><Iteration_hits><Hit>
    <Hit_id>sp|P12345|EXAMPLE_HUMAN</Hit_id>
    <Hit_def>Example protein</Hit_def><Hit_accession>P12345</Hit_accession><Hit_len>120</Hit_len>
    <Hit_hsps><Hsp><Hsp_bit-score>80.5</Hsp_bit-score><Hsp_evalue>1e-20</Hsp_evalue>
      <Hsp_query-from>11</Hsp_query-from><Hsp_query-to>90</Hsp_query-to>
      <Hsp_identity>60</Hsp_identity><Hsp_align-len>80</Hsp_align-len>
    </Hsp></Hit_hsps>
  </Hit></Iteration_hits></Iteration></BlastOutput_iterations>
</BlastOutput>"""

BLAST_XML2 = """<?xml version="1.0"?>
<BlastXML2 xmlns="http://www.ncbi.nlm.nih.gov">
  <BlastOutput2><report><Report><results><Results><search><Search>
    <query-len>146</query-len><hits><Hit><num>1</num>
    <description><HitDescr><id>sp|P02067|HBB_PIG</id><accession>P02067</accession>
      <title>Hemoglobin subunit beta</title><taxid>9823</taxid><sciname>Sus scrofa</sciname>
    </HitDescr></description><len>147</len><hsps><Hsp>
      <bit-score>280.4</bit-score><evalue>1e-100</evalue><identity>145</identity>
      <query-from>1</query-from><query-to>146</query-to><align-len>146</align-len>
    </Hsp></hsps></Hit></hits>
  </Search></search></Results></results></Report></report></BlastOutput2>
</BlastXML2>"""

EBI_BLAST_JSON = {
    "query_len": 146,
    "hits": [{
        "hit_num": 1,
        "hit_id": "HBB_PIG",
        "hit_acc": "P02067",
        "hit_desc": "Hemoglobin subunit beta",
        "hit_os": "Sus scrofa",
        "hit_uni_ox": "9823",
        "hit_len": 147,
        "hit_hsps": [{
            "hsp_bit_score": 295.8,
            "hsp_expect": 9e-104,
            "hsp_align_len": 146,
            "hsp_identity": 99.3,
            "hsp_query_from": 1,
            "hsp_query_to": 146,
        }],
    }],
}


ALPHAFOLD_CIF = """data_AF-TEST-F1
loop_
_atom_site.group_PDB
_atom_site.label_atom_id
_atom_site.label_alt_id
_atom_site.auth_asym_id
_atom_site.auth_seq_id
_atom_site.label_comp_id
_atom_site.Cartn_x
_atom_site.Cartn_y
_atom_site.Cartn_z
_atom_site.B_iso_or_equiv
ATOM CA . A 1 ALA 1.0 2.0 3.0 95.0
ATOM CA . A 2 CYS 2.0 2.5 3.4 82.0
"""


def test_blast_submission_uses_complete_common_url_parameters():
    captured = {}

    def transport(method, url, *, data, headers):
        captured.update(parse_qs(data.decode("utf-8")))
        return HttpResponse(
            200,
            "<!--QBlastInfoBegin\nRID = TEST123\nRTOE = 3\nQBlastInfoEnd-->",
            {},
        )

    result = NCBIBlastClient(HttpClient(transport=transport)).submit(
        "ACDEFGHIK", hitlist_size=7
    )

    assert result["rid"] == "TEST123"
    assert captured["PROGRAM"] == ["blastp"]
    assert captured["DATABASE"] == ["swissprot"]
    assert captured["EXPECT"] == ["10.0"]
    assert captured["HITLIST_SIZE"] == ["7"]
    assert captured["FORMAT_TYPE"] == ["XML"]


def test_parse_blast_xml_metrics_and_accession():
    result = parse_blast_xml(BLAST_XML)[0]
    assert result["uniprotAccession"] == "P12345"
    assert result["identity"] == 0.75
    assert result["queryCoverage"] == 0.8
    assert result["evalue"] == 1e-20


def test_parse_current_blast_xml2_metrics_and_accession():
    result = parse_blast_xml2(BLAST_XML2)[0]
    assert result["uniprotAccession"] == "P02067"
    assert result["scientificName"] == "Sus scrofa"
    assert result["identity"] == 145 / 146
    assert result["queryCoverage"] == 1.0
    assert result["evalue"] == 1e-100


def test_blast_poll_uses_plain_xml_and_returns_completed_hits():
    requested = {}

    def transport(method, url, *, data, headers):
        requested["url"] = url
        return HttpResponse(200, BLAST_XML, {"Content-Type": "application/xml"})

    result = NCBIBlastClient(HttpClient(transport=transport)).poll("TEST123")

    assert "FORMAT_TYPE=XML" in requested["url"]
    assert "FORMAT_OBJECT" not in requested["url"]
    assert result["status"] == "complete"
    assert result["results"][0]["uniprotAccession"] == "P12345"


def test_ebi_ncbiblast_completes_and_normalizes_hits():
    calls = []

    def transport(method, url, *, data, headers):
        calls.append((method, url, data))
        if url.endswith("/run"):
            return HttpResponse(200, "ncbiblast-RTEST", {})
        if "/status/" in url:
            return HttpResponse(200, "FINISHED", {})
        return HttpResponse(200, __import__("json").dumps(EBI_BLAST_JSON), {})

    client = NCBIBlastClient(
        HttpClient(email="scientist@example.org", transport=transport),
        email="scientist@example.org",
    )
    submitted = client.submit("ACDEFGHIK", hitlist_size=25)
    completed = client.poll(submitted["rid"])

    assert submitted["provider"] == "ebi-ncbiblast"
    assert submitted["hitlistSize"] == 20
    assert completed["status"] == "complete"
    assert completed["results"][0]["uniprotAccession"] == "P02067"
    assert completed["results"][0]["identity"] == 0.993
    assert b"scientist%40example.org" in calls[0][2]


def test_parse_ebi_blast_json_reports_query_coverage():
    result = parse_ebi_blast_json(EBI_BLAST_JSON)[0]
    assert result["scientificName"] == "Sus scrofa"
    assert result["queryCoverage"] == 1.0
    assert result["evalue"] == 9e-104


def test_sequence_matching_handles_removed_initiator_and_substitution():
    query = "VHLSAEEKEAVLGLWGKVNVDEVG"
    target = "MVHLSAEEKEAVLGLWGKVNVDEVA"
    metrics = global_sequence_metrics(query, target)
    assert metrics["queryCoverage"] == 1.0
    assert metrics["identity"] == 23 / 24


def test_representative_peptides_cover_the_sequence():
    sequence = "ABCDEFGHIJKLMNOPQRSTUVWXYZ"
    peptides = representative_peptides(sequence, peptide_length=7, count=4)
    assert peptides[0] == "ABCDEFG"
    assert peptides[-1] == "TUVWXYZ"
    assert len(peptides) == 4


def test_uniprot_normalization_preserves_ptm_evidence():
    result = normalize_uniprot({
        "primaryAccession": "P12345",
        "uniProtkbId": "EXAMPLE_HUMAN",
        "entryType": "UniProtKB reviewed (Swiss-Prot)",
        "proteinDescription": {"recommendedName": {"fullName": {"value": "Example"}}},
        "organism": {"scientificName": "Homo sapiens", "taxonId": 9606},
        "genes": [{"geneName": {"value": "EXM"}}],
        "sequence": {"value": "ACD", "length": 3, "molWeight": 307},
        "features": [{
            "type": "Modified residue",
            "description": "Phosphoserine",
            "location": {"start": {"value": 2}, "end": {"value": 2}},
            "evidences": [{"evidenceCode": "ECO:0000269"}],
        }],
    })
    assert result["reviewed"] is True
    assert result["genes"] == ["EXM"]
    ptm = result["postTranslationalModifications"][0]
    assert ptm["description"] == "Phosphoserine"
    assert ptm["location"] == {"start": 2, "end": 2}
    assert ptm["evidences"][0]["evidenceCode"] == "ECO:0000269"


def test_uniprot_normalization_preserves_readiness_evidence():
    result = normalize_uniprot({
        "primaryAccession": "P54321",
        "features": [
            {
                "type": "Transmembrane",
                "description": "Helical",
                "location": {"start": {"value": 20}, "end": {"value": 42}},
            },
            {
                "type": "Region",
                "description": "Disordered",
                "location": {"start": {"value": 70}, "end": {"value": 95}},
            },
        ],
        "comments": [
            {
                "commentType": "SUBCELLULAR LOCATION",
                "subcellularLocations": [
                    {"location": {"value": "Cell membrane"}, "topology": {"value": "Single-pass"}}
                ],
            },
            {
                "commentType": "COFACTOR",
                "cofactors": [{"name": "Heme", "chebiId": "CHEBI:30413"}],
            },
        ],
    })

    assert result["transmembraneRegions"][0]["location"] == {"start": 20, "end": 42}
    assert result["disorderedRegions"][0]["description"] == "Disordered"
    assert result["subcellularLocations"][0]["location"] == "Cell membrane"
    assert result["cofactors"][0] == {
        "name": "Heme", "chebiId": "CHEBI:30413", "evidences": []
    }


def test_mmcif_conditions_are_evidence_linked():
    result = parse_mmcif_conditions("""data_demo
_exptl_crystal_grow.method 'VAPOR DIFFUSION, HANGING DROP'
_exptl_crystal_grow.temp 293
_exptl_crystal_grow.pH 7.5
_exptl_crystal_grow.pdbx_details '0.1 M HEPES and 20 percent PEG 3350'
_entity.pdbx_description 'Protein purified by nickel affinity chromatography in Tris buffer'
""")
    crystal = result["crystallizationConditions"]
    purification = result["purificationConditions"]
    assert crystal["status"] == "reported"
    assert crystal["crystalGrowth"][0]["pH"] == "7.5"
    assert purification["status"] == "reported"
    assert purification["evidence"][0]["field"] == "_entity.pdbx_description"


def test_does_not_call_crystallization_recipe_a_purification_buffer():
    result = parse_mmcif_conditions("""data_demo
_exptl_crystal_grow.pdbx_details 'Tris buffer, PEG 4000, vapor diffusion'
""")
    assert result["crystallizationConditions"]["status"] == "reported"
    assert result["purificationConditions"]["status"] == "not_reported"


def test_does_not_mislabel_assembly_evidence_as_purification_conditions():
    result = parse_mmcif_conditions("""data_demo
_pdbx_struct_assembly_auth_evidence.experimental_support 'gel filtration'
""")
    assert result["purificationConditions"]["status"] == "not_reported"


def test_alphafold_cif_geometry_preserves_confidence():
    result = parse_structure_geometry(ALPHAFOLD_CIF, "cif")
    assert result["residueCount"] == 2
    assert result["chainCount"] == 1
    assert result["meanPlddt"] == 88.5
    assert result["points"][0]["plddt"] == 95.0


def test_alphafold_db_downloads_current_cif_metadata():
    def transport(method, url, *, data, headers):
        if "/api/prediction/" in url:
            return HttpResponse(200, __import__("json").dumps([{
                "entryId": "AF-P02067-F1",
                "uniprotAccession": "P02067",
                "uniprotId": "HBB_PIG",
                "cifUrl": "https://example.test/model.cif",
                "globalMetricValue": 96.81,
            }]), {})
        return HttpResponse(200, ALPHAFOLD_CIF, {})

    result = AlphaFoldDBClient(HttpClient(transport=transport)).fetch("P02067")
    assert result["modelId"] == "AF-P02067-F1"
    assert result["metadata"]["meanPlddt"] == 88.5
    assert result["metadata"]["residueCount"] == 2


HUMAN_HBA = "MVLSPADKTNVKAAWGKVGAHAGEYGAEALERMFLSFPTTKTYFPHFDLSHGSAQVKGHGKKVADALTNAVAHVDDMPNALSALSDLHAHKLRVDPVNFKLLSHCLLVTLAAHLPAEFTPAVHASLDKFLASVSTVLTSKYR"
HUMAN_HBB = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH"


def test_local_alignment_metrics_match_blast_identities_and_positives():
    # BLASTp reports human alpha vs beta globin as 61/145 identities (42%),
    # 86/145 positives (59%) and 8 gaps.
    metrics = local_alignment_metrics(HUMAN_HBA, HUMAN_HBB)
    assert metrics["alignmentLength"] == 145
    assert metrics["identities"] == 61
    assert metrics["positives"] == 86
    assert metrics["gaps"] == 8
    assert round(metrics["identity"] * 100) == 42
    assert round(metrics["similarity"] * 100) == 59


def test_local_alignment_metrics_report_coverage_of_a_fragment():
    metrics = local_alignment_metrics(HUMAN_HBA, HUMAN_HBA[20:100])
    assert metrics["identity"] == 1.0
    assert metrics["similarity"] == 1.0
    assert (metrics["queryStart"], metrics["queryEnd"]) == (21, 100)
    assert round(metrics["queryCoverage"], 3) == round(80 / len(HUMAN_HBA), 3)


def test_rcsb_search_reports_identity_and_similarity_closest_first():
    import json

    posted = {}
    entities = {"1AAA": HUMAN_HBB, "2BBB": HUMAN_HBA}

    def transport(method, url, *, data, headers):
        if url.endswith("/query"):
            posted.update(json.loads(data))
            return HttpResponse(200, json.dumps({"result_set": [
                {"identifier": "1AAA_1", "score": 1.0, "services": [{"nodes": [{"match_context": [{"sequence_identity": 0.42, "evalue": 1e-30}]}]}]},
                {"identifier": "2BBB_1", "score": 0.9, "services": [{"nodes": [{"match_context": [{"sequence_identity": 1.0, "evalue": 1e-90}]}]}]},
            ]}), {})
        if "/polymer_entity/" in url:
            pdb_id = url.split("/polymer_entity/")[1].split("/")[0]
            return HttpResponse(200, json.dumps({"entity_poly": {"pdbx_seq_one_letter_code_can": entities[pdb_id]}, "rcsb_polymer_entity": {"pdbx_description": "Hemoglobin"}}), {})
        if "/entry/" in url:
            return HttpResponse(200, json.dumps({"struct": {"title": "Hemoglobin"}}), {})
        return HttpResponse(200, "data_test\n", {})

    records = RCSBClient(HttpClient(transport=transport)).search_sequence(HUMAN_HBA)

    assert posted["request_options"]["results_verbosity"] == "verbose"
    assert [record["pdbId"] for record in records] == ["2BBB", "1AAA"]
    assert records[0]["identity"] == 1.0 and records[0]["similarity"] == 1.0
    assert round(records[1]["identity"] * 100) == 42
    assert round(records[1]["similarity"] * 100) == 59
    assert records[1]["rcsbIdentity"] == 0.42
    assert records[1]["evalue"] == 1e-30

