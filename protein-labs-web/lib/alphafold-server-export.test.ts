// Reading a project's earlier jobs into an AlphaFold Server job request. Run
// with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { alphaFoldRequestFor, cofactorKey, descriptionKey, recogniseGlycan, recognisePtm, splitCofactorText } from "./alphafold-server-export.ts";
import type { PartnerChain } from "./alphafold-server-export.ts";
import { buildAlphaFoldJob } from "./alphafold-server-job.ts";
import type { AlphaFoldProteinChain, ExportWarning } from "./alphafold-server-job.ts";

function job(appType: string, config: ProjectJob["config"]): ProjectJob {
  return { id: appType, proteinId: "p1", name: appType, appType, status: "complete", config, createdAt: "", updatedAt: "" };
}

// Human haemoglobin β. S10 and S45 are serines, N20 an asparagine, K9 a lysine
// and T13/T124 threonines, so annotated positions can be aimed at a real
// residue or deliberately at the wrong one.
const sequence = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";

function bundle(jobs: ProjectJob[], matches: ProteinBundle["uniprotMatches"] = []): ProteinBundle {
  return {
    protein: { id: "p1", name: "Hemoglobin subunit beta", sequence, organism: "Homo sapiens", geneName: "HBB", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {} },
    protparam: null,
    blastJobs: [], uniprotMatches: matches, pdbMatches: [], alphaFoldModels: [],
    projectJobs: jobs,
    projectNotebook: null,
  };
}

function feature(type: string, description: string, start: number | null) {
  return start === null ? { type, description } : { type, description, start, end: start };
}

function reference(features: object[], cofactors: object[] = []) {
  return job("reference-match", {
    selectedAccession: "P68871",
    evidenceSnapshot: { postTranslationalModifications: features, cofactors },
  });
}

/** A recorded state, so a test about features is not also a test about state. */
const monomer = job("protparam", { oligomericState: { kind: "monomer" } });

function categories(warnings: ExportWarning[]): string[] {
  return warnings.map((warning) => warning.category);
}

function chainOf(result: ReturnType<typeof buildAlphaFoldJob>): AlphaFoldProteinChain {
  const entity = result.jobs[0].sequences[0];
  assert.ok("proteinChain" in entity);
  return entity.proteinChain;
}

describe("the construct chain", () => {
  it("takes its copy count from the recorded oligomeric state", () => {
    const request = alphaFoldRequestFor(bundle([job("protparam", { oligomericState: { kind: "homotetramer" } })]));
    assert.equal(request.proteins[0].copies, 4);
    assert.equal(request.proteins[0].required, true);
    assert.equal(request.jobName, "Hemoglobin subunit beta");
    assert.deepEqual(request.notes, []);
  });

  it("assumes one copy and says so when no state is recorded", () => {
    const request = alphaFoldRequestFor(bundle([]));
    assert.equal(request.proteins[0].copies, 1);
    assert.deepEqual(categories(request.notes ?? []), ["approximation"]);
    assert.match((request.notes ?? [])[0].message, /No oligomeric state is recorded/);
  });

  it("explains that a hetero-complex needs each partner's own sequence", () => {
    const request = alphaFoldRequestFor(bundle([job("protparam", { oligomericState: { kind: "hetero-complex", complexNote: "α2β2 with HBA" } })]));
    assert.equal(request.proteins[0].copies, 1);
    assert.match((request.notes ?? [])[0].message, /hetero-complex \(α2β2 with HBA\)/);
    assert.match((request.notes ?? [])[0].message, /add the partner chains/);
  });

  it("adds partner chains the scientist pasted in, as droppable entities", () => {
    const partners: PartnerChain[] = [
      { id: "1", label: "HBA", sequence: "MVLSPADKTNVKAAW", copies: 2 },
      { id: "2", label: "", sequence: "  ", copies: 1 },
    ];
    const request = alphaFoldRequestFor(bundle([job("protparam", { oligomericState: { kind: "homodimer" } })]), partners);
    assert.equal(request.proteins.length, 2);
    assert.deepEqual(request.proteins[1], { label: "HBA", sequence: "MVLSPADKTNVKAAW", copies: 2, required: false });
  });
});

describe("cofactors from earlier jobs", () => {
  it("reads the reference record's cofactors and the readiness check's notes", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "heme b", chebiId: "CHEBI:60344" }, { name: "Fe(2+)", chebiId: "CHEBI:29033" }]),
      job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "Zn(2+); ATP" }),
    ]));
    assert.deepEqual(request.cofactors?.map((entry) => entry.code), ["heme b", "Fe(2+)", "Zn(2+)", "ATP"]);
    const result = buildAlphaFoldJob(request);
    assert.deepEqual(result.jobs[0].sequences.slice(1), [
      { ligand: { ligand: "CCD_HEM", count: 1 } },
      { ion: { ion: "FE", count: 1 } },
      { ion: { ion: "ZN", count: 1 } },
      { ligand: { ligand: "CCD_ATP", count: 1 } },
    ]);
  });

  it("does not count a cofactor twice when the readiness check pre-filled it from the same reference", () => {
    // The readiness job pre-fills Cofactor details from the chosen reference as
    // `name · CHEBI:id`, so the same cofactor arrives under two spellings. It
    // must stay one copy: a monomer with one heme is not a monomer with two.
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "heme b", chebiId: "CHEBI:60344" }, { name: "Zn(2+)", chebiId: "CHEBI:29105" }]),
      job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "heme b · CHEBI:60344; Zn(2+) · CHEBI:29105" }),
    ])));
    assert.deepEqual(result.jobs[0].sequences.slice(1), [
      { ligand: { ligand: "CCD_HEM", count: 1 } },
      { ion: { ion: "ZN", count: 1 } },
    ]);
  });

  it("dedupes on the cofactor AlphaFold Server will model, not on how it was written", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "Mg(2+)" }]),
      job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "magnesium; MG; Mg2+" }),
    ]));
    assert.equal(request.cofactors?.length, 1);
  });

  it("keeps two cofactors it cannot recognise apart", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer,
      job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "molybdopterin; biotin; molybdopterin" }),
    ]));
    assert.deepEqual(request.cofactors?.map((entry) => entry.code), ["molybdopterin", "biotin"]);
  });

  it("does not record the same cofactor twice from two jobs", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "Mg(2+)" }]),
      job("protein-readiness", { cofactorDetails: "mg(2+)" }),
    ]));
    assert.equal(request.cofactors?.length, 1);
  });

  it("splits free text and ignores a 'none' answer", () => {
    assert.deepEqual(splitCofactorText("heme, Zn2+ and FAD"), ["heme", "Zn2+", "FAD"]);
    assert.deepEqual(splitCofactorText("none"), []);
    assert.deepEqual(splitCofactorText(""), []);
  });

  it("reads a bare NA as \"not applicable\", but still accepts sodium", () => {
    // Researchers type NA for not-applicable; exporting a silent sodium ion
    // off the back of that would be a fabricated entity in the job.
    assert.deepEqual(splitCofactorText("NA"), []);
    assert.deepEqual(splitCofactorText("heme; NA"), ["heme"]);
    assert.deepEqual(splitCofactorText("Na+"), ["Na+"]);
    assert.deepEqual(splitCofactorText("sodium"), ["sodium"]);
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([
      monomer, job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "NA" }),
    ])));
    assert.equal(result.jobs[0].sequences.length, 1);
    assert.deepEqual(result.warnings, []);
  });

  it("does not read the readiness notes when the answer is no, and says the reference's still apply", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "heme b" }]),
      job("protein-readiness", { cofactorRequired: "No", cofactorDetails: "ATP" }),
    ]));
    assert.deepEqual(request.cofactors?.map((entry) => entry.code), ["heme b"]);
    const note = (request.notes ?? []).find((entry) => entry.subject === "Readiness check");
    assert.ok(note);
    assert.match(note.message, /answers "no" to requiring a cofactor/);
    assert.match(note.message, /still comes from P68871/);
  });

  it("stays quiet about a no answer when the reference named no cofactors either", () => {
    const request = alphaFoldRequestFor(bundle([
      monomer, job("protein-readiness", { cofactorRequired: "No" }),
    ]));
    assert.deepEqual(request.cofactors, []);
    assert.equal((request.notes ?? []).filter((entry) => entry.subject === "Readiness check").length, 0);
  });

  it("leaves out a cofactor the scientist removed in the export dialog, and says so", () => {
    const jobs = [monomer, reference([], [{ name: "heme b" }, { name: "Zn(2+)" }])];
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle(jobs), [], ["ligand:HEM"]));
    assert.deepEqual(result.jobs[0].sequences.slice(1), [{ ion: { ion: "ZN", count: 1 } }]);
    const note = result.warnings.find((entry) => entry.category === "removed-by-hand");
    assert.ok(note);
    assert.equal(note.severity, "excluded");
    assert.match(note.message, /heme b was removed in this dialog/);
    // And nothing is said about it when it is put back.
    const restored = buildAlphaFoldJob(alphaFoldRequestFor(bundle(jobs), [], []));
    assert.equal(restored.jobs[0].sequences.length, 3);
    assert.equal(categories(restored.warnings).includes("removed-by-hand"), false);
  });

  it("removes every spelling of a removed cofactor, not just the one that was clicked", () => {
    // The row the scientist clicks stands for one AlphaFold Server entity, and
    // the same heme reaches the export as both "heme b" and
    // "heme b · CHEBI:60344". Keying the removal on the text would leave the
    // other spelling behind and the ligand still in the job.
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "heme b", chebiId: "CHEBI:60344" }]),
      job("protein-readiness", { cofactorRequired: "Yes", cofactorDetails: "heme b · CHEBI:60344" }),
    ]), [], ["ligand:HEM"]));
    assert.equal(result.jobs[0].sequences.length, 1);
    assert.deepEqual(result.summary.molecules, []);
  });

  it("keys a removal on the entity AlphaFold Server models", () => {
    assert.equal(cofactorKey("heme b"), "ligand:HEM");
    assert.equal(cofactorKey("heme b · CHEBI:60344"), "ligand:HEM");
    assert.equal(cofactorKey("Zn(2+)"), "ion:ZN");
    assert.equal(cofactorKey("molybdopterin"), "text:molybdopterin");
  });

  it("stops telling the scientist to remove a cofactor they have already removed", () => {
    // The "readiness answers no" note counts what is in the job. Once the last
    // reference cofactor is gone the note has nothing left to point at, so it
    // must not still be asking for a removal that already happened.
    const jobs = [monomer, reference([], [{ name: "heme b" }]), job("protein-readiness", { cofactorRequired: "No" })];
    const kept = alphaFoldRequestFor(bundle(jobs));
    assert.match((kept.notes ?? []).find((entry) => entry.subject === "Readiness check")?.message ?? "", /remove it from the job/);
    const emptied = alphaFoldRequestFor(bundle(jobs), [], ["ligand:HEM"]);
    assert.equal((emptied.notes ?? []).filter((entry) => entry.subject === "Readiness check").length, 0);
    assert.deepEqual(emptied.cofactors, []);
  });

  it("counts only the cofactors the preview actually lists below the note", () => {
    // Molybdopterin has no AlphaFold Server entity, so it never becomes a row:
    // counting it would promise four rows under a list of three and ask for a
    // removal the fourth has no button for.
    const request = alphaFoldRequestFor(bundle([
      monomer,
      reference([], [{ name: "heme b" }, { name: "Zn(2+)" }, { name: "molybdopterin" }]),
      job("protein-readiness", { cofactorRequired: "No" }),
    ]));
    const note = (request.notes ?? []).find((entry) => entry.subject === "Readiness check");
    assert.match(note?.message ?? "", /The 2 cofactors below still come from P68871/);
    // The unmodellable one is still carried and still reported, just elsewhere.
    assert.equal(request.cofactors?.length, 3);
  });

  it("ignores a removal key no cofactor in the project matches", () => {
    const request = alphaFoldRequestFor(bundle([monomer, reference([], [{ name: "heme b" }])]), [], ["ion:MG"]);
    assert.deepEqual(request.cofactors?.map((entry) => entry.code), ["heme b"]);
    assert.equal(categories(request.notes ?? []).includes("removed-by-hand"), false);
  });

  it("does not split a chemical name on its own punctuation", () => {
    // A comma inside 2,3-bisphosphoglycerate is part of the name, not a list
    // separator, and "Zn2+" must not lose its charge to the "+" separator.
    assert.deepEqual(splitCofactorText("heme b; Zn(2+); 2,3-bisphosphoglycerate"), ["heme b", "Zn(2+)", "2,3-bisphosphoglycerate"]);
    assert.deepEqual(splitCofactorText("N6,N6-dimethyllysine, ATP"), ["N6,N6-dimethyllysine", "ATP"]);
  });
});

describe("modifications from the reference record", () => {
  it("translates a UniProt description into a CCD code at the same position", () => {
    const request = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Phosphoserine; by PKA", 10)])]));
    assert.deepEqual(request.proteins[0].ptms, [{ code: "SEP", position: 10, source: "Phosphoserine; by PKA at 10" }]);
    const result = buildAlphaFoldJob(request);
    assert.deepEqual(chainOf(result).modifications, [{ ptmType: "CCD_SEP", ptmPosition: 10 }]);
  });

  it("warns once that annotated positions belong to the reference, not the construct", () => {
    const notes = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Phosphoserine", 10), feature("MOD_RES", "N6-acetyllysine", 9)])])).notes ?? [];
    const positional = notes.filter((note) => note.subject === "Annotated positions");
    assert.equal(positional.length, 1);
    assert.match(positional[0].message, /come from P68871, not from this construct/);
  });

  it("drops a modification the reference puts on a residue this construct does not have", () => {
    // P68871 numbering counts the initiator methionine; a construct without it
    // is offset by one, which is exactly the mistake this check catches.
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Phosphoserine", 11)])])));
    assert.equal(chainOf(result).modifications, undefined);
    assert.ok(categories(result.warnings).includes("ptm-residue"));
  });

  it("names a modification it cannot translate", () => {
    const notes = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "N-acetylvaline", 2)])])).notes ?? [];
    assert.deepEqual(categories(notes), ["unsupported-ptm"]);
    assert.match(notes[0].message, /"N-acetylvaline" has no AlphaFold Server equivalent/);
  });

  it("leaves out a modification the record gives no position for", () => {
    const notes = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Phosphoserine", null)])])).notes ?? [];
    assert.deepEqual(categories(notes), ["ptm-position"]);
  });

  it("counts features that have no AlphaFold Server field at all in one note", () => {
    const notes = alphaFoldRequestFor(bundle([monomer, reference([
      feature("DISULFID", "Disulfide bond", 93),
      feature("SIGNAL", "Signal peptide", 1),
      feature("CHAIN", "Hemoglobin subunit beta", 1),
    ])])).notes ?? [];
    assert.deepEqual(categories(notes), ["unsupported-ptm"]);
    assert.match(notes[0].message, /3 other annotated features from P68871/);
  });

  it("notes a translation that is close but not exact", () => {
    const notes = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Omega-N-methylarginine", 31)])])).notes ?? [];
    assert.ok(notes.some((note) => note.category === "approximation" && /only 5-methylarginine/.test(note.message)));
  });

  it("maps descriptions through evidence clauses, stereo prefixes and spacing", () => {
    assert.equal(descriptionKey("Phosphoserine; by PKA"), "phosphoserine");
    assert.deepEqual(recognisePtm("N6,N6,N6-trimethyllysine"), { code: "M3L" });
    assert.deepEqual(recognisePtm("N6-crotonyl-L-lysine"), { code: "KCR" });
    assert.deepEqual(recognisePtm("3'-phosphohistidine"), { code: "HIP" });
    assert.equal(recognisePtm("Phosphohistidine")?.code, "NEP");
    assert.ok(recognisePtm("Phosphohistidine")?.note);
    assert.equal(recognisePtm("Blocked amino end"), null);
  });

  it("reads a lipidation feature as a cysteine palmitoylation", () => {
    // C94 in this sequence, so the residue check passes.
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([monomer, reference([feature("LIPID", "S-palmitoyl cysteine", 94)])])));
    assert.deepEqual(chainOf(result).modifications, [{ ptmType: "CCD_P1L", ptmPosition: 94 }]);
  });
});

describe("glycosylation from the reference record", () => {
  it("builds a GlcNAc glycan from an N-linked annotation", () => {
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([monomer, reference([feature("CARBOHYD", "N-linked (GlcNAc...) asparagine", 20)])])));
    assert.deepEqual(chainOf(result).glycans, [{ residues: "NAG", position: 20 }]);
  });

  it("names a sugar AlphaFold Server has no code for instead of guessing", () => {
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([monomer, reference([feature("CARBOHYD", "O-linked (GalNAc...) threonine", 13)])])));
    assert.equal(chainOf(result).glycans, undefined);
    const glycanWarnings = result.warnings.filter((warning) => warning.category === "unsupported-glycan");
    assert.equal(glycanWarnings.length, 1);
    assert.match(glycanWarnings[0].message, /A2G cannot be attached to T13/);
  });

  it("reads the sugar out of the description", () => {
    assert.equal(recogniseGlycan("N-linked (GlcNAc...) asparagine"), "NAG");
    assert.equal(recogniseGlycan("O-linked (Man) serine"), "MAN");
    assert.equal(recogniseGlycan("O-linked (Fuc...) threonine"), "FUC");
    assert.equal(recogniseGlycan("O-linked (Xyl...) serine"), "XYS");
    assert.equal(recogniseGlycan("Glycosylation"), null);
  });
});

describe("the readiness check's free-text modifications", () => {
  it("says they need positions when nothing positional was exported", () => {
    const notes = alphaFoldRequestFor(bundle([
      monomer,
      job("protein-readiness", { postTranslationalModification: "Yes", postTranslationalModificationDetails: "phosphoserine, glycosylation" }),
    ])).notes ?? [];
    const positional = notes.filter((note) => note.subject === "Readiness check");
    assert.equal(positional.length, 1);
    assert.match(positional[0].message, /without residue positions/);
  });

  it("stays quiet once real positioned modifications are in the job", () => {
    const notes = alphaFoldRequestFor(bundle([
      monomer,
      reference([feature("MOD_RES", "Phosphoserine", 10)]),
      job("protein-readiness", { postTranslationalModification: "Yes", postTranslationalModificationDetails: "phosphoserine" }),
    ])).notes ?? [];
    assert.equal(notes.filter((note) => note.subject === "Readiness check").length, 0);
  });
});

describe("the live UniProt match", () => {
  it("is preferred over the saved snapshot when it carries features", () => {
    const live = {
      record: {
        accession: "P68871",
        postTranslationalModifications: [feature("MOD_RES", "N6-acetyllysine", 9)],
        cofactors: [{ name: "heme b" }],
      },
    };
    const request = alphaFoldRequestFor(bundle([monomer, reference([feature("MOD_RES", "Phosphoserine", 10)])], [live]));
    assert.deepEqual(request.proteins[0].ptms?.map((ptm) => ptm.code), ["ALY"]);
    assert.deepEqual(request.cofactors?.map((entry) => entry.code), ["heme b"]);
  });
});

describe("the whole chain, end to end", () => {
  it("exports a haemoglobin tetramer with heme, an iron ion and a phosphoserine", () => {
    const result = buildAlphaFoldJob(alphaFoldRequestFor(bundle([
      job("protparam", { oligomericState: { kind: "homotetramer" } }),
      reference([feature("MOD_RES", "Phosphoserine", 10)], [{ name: "heme b" }, { name: "Fe(2+)" }]),
    ])));
    assert.equal(result.canExport, true);
    assert.equal(result.fitsTokenLimit, true);
    assert.deepEqual(JSON.parse(result.json)[0], {
      name: "Hemoglobin subunit beta",
      modelSeeds: [],
      sequences: [
        { proteinChain: { sequence, count: 4, modifications: [{ ptmType: "CCD_SEP", ptmPosition: 10 }] } },
        { ligand: { ligand: "CCD_HEM", count: 1 } },
        { ion: { ion: "FE", count: 1 } },
      ],
      dialect: "alphafoldserver",
      version: 1,
    });
    // 147 residues, one of them swapped for phosphoserine's 11 atoms, ×4,
    // plus heme's 43 atoms and one for the iron.
    assert.equal(result.summary.tokens, (sequence.length - 1 + 11) * 4 + 43 + 1);
    assert.deepEqual(categories(result.warnings), ["approximation"]);
  });
});
