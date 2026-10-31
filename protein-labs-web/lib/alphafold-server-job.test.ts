// Unit tests for the AlphaFold Server job builder.
//
// Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  alphaFoldFileName, bareCcdCode, buildAlphaFoldJob, cleanJobName, glycanResidueLimit,
  moleculeKey, parseGlycan, recogniseMolecule, tokenLimit,
} from "./alphafold-server-job.ts";
import type { AlphaFoldJobRequest, AlphaFoldProteinChain, ExportWarning } from "./alphafold-server-job.ts";

// M1 S2 N3 K4 T5 Y6 P7 C8 R9 G10 — one residue for most supported PTMs.
const chain = "MSNKTYPCRG";

function request(overrides: Partial<AlphaFoldJobRequest> = {}): AlphaFoldJobRequest {
  return { jobName: "Test job", proteins: [{ label: "Construct", sequence: chain, required: true }], ...overrides };
}

function categories(warnings: ExportWarning[]): string[] {
  return warnings.map((warning) => warning.category);
}

function proteins(result: ReturnType<typeof buildAlphaFoldJob>): AlphaFoldProteinChain[] {
  return result.jobs[0].sequences
    .filter((entity): entity is { proteinChain: AlphaFoldProteinChain } => "proteinChain" in entity)
    .map((entity) => entity.proteinChain);
}

describe("job envelope", () => {
  it("writes a list of jobs in the alphafoldserver dialect", () => {
    const result = buildAlphaFoldJob(request());
    assert.equal(result.jobs.length, 1);
    assert.deepEqual(result.jobs[0].modelSeeds, []);
    assert.equal(result.jobs[0].dialect, "alphafoldserver");
    assert.equal(result.jobs[0].version, 1);
    // The format requires a list even for one job.
    assert.ok(Array.isArray(JSON.parse(result.json)));
    assert.equal(JSON.parse(result.json)[0].name, "Test job");
  });

  it("omits the optional glycans and modifications keys when there are none", () => {
    const chainJson = proteins(buildAlphaFoldJob(request()))[0];
    assert.deepEqual(Object.keys(chainJson), ["sequence", "count"]);
  });

  it("keeps a job name on one line and falls back when it is empty", () => {
    assert.equal(cleanJobName("  Lysozyme\n C  "), "Lysozyme C");
    assert.equal(cleanJobName(""), "Protein Lab job");
    assert.equal(cleanJobName("x".repeat(200)).length, 120);
  });

  it("names the file after the project", () => {
    assert.equal(alphaFoldFileName("Hen lysozyme (C)"), "Hen-lysozyme-C-af-server.json");
    assert.equal(alphaFoldFileName("   "), "protein-project-af-server.json");
  });
});

describe("oligomeric state becomes the chain count", () => {
  it("exports a homodimer as one chain with count 2", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: chain, copies: 2, required: true }] }));
    const exported = proteins(result);
    assert.equal(exported.length, 1);
    assert.equal(exported[0].count, 2);
    assert.equal(result.summary.tokens, chain.length * 2);
    assert.equal(result.warnings.length, 0);
  });

  it("clamps a missing or nonsensical copy count to one", () => {
    for (const copies of [undefined, 0, -3, Number.NaN]) {
      assert.equal(proteins(buildAlphaFoldJob(request({ proteins: [{ label: "C", sequence: chain, copies, required: true }] })))[0].count, 1);
    }
  });

  it("exports a hetero-complex as one entity per distinct chain", () => {
    const result = buildAlphaFoldJob(request({
      proteins: [
        { label: "Alpha", sequence: chain, copies: 2, required: true },
        { label: "Beta", sequence: "MGHKLEYNY", copies: 2, required: false },
      ],
    }));
    const exported = proteins(result);
    assert.equal(exported.length, 2);
    assert.deepEqual(exported.map((entry) => [entry.sequence, entry.count]), [[chain, 2], ["MGHKLEYNY", 2]]);
    assert.equal(result.summary.tokens, chain.length * 2 + 9 * 2);
    assert.deepEqual(result.summary.chains.map((entry) => entry.label), ["Alpha", "Beta"]);
  });

  it("normalises a sequence pasted with line breaks and FASTA numbering", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "C", sequence: "  1 msnk\n ty pcrg \n", required: true }] }));
    assert.equal(proteins(result)[0].sequence, chain);
  });

  it("leaves out a chain with a non-standard residue and says which letter", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: "MSNKXYPCRG", required: true }] }));
    assert.equal(proteins(result).length, 0);
    assert.equal(result.canExport, false);
    assert.deepEqual(categories(result.warnings), ["invalid-residue", "empty-job"]);
    assert.match(result.warnings[0].message, /contains X/);
  });

  it("leaves out a chain with no sequence at all", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: "   ", required: true }] }));
    assert.deepEqual(categories(result.warnings), ["no-sequence", "empty-job"]);
  });
});

describe("ligands and ions", () => {
  it("splits recorded cofactors into ligand and ion entries", () => {
    const result = buildAlphaFoldJob(request({ cofactors: [{ code: "ATP" }, { code: "Mg(2+)" }] }));
    assert.deepEqual(result.jobs[0].sequences.slice(1), [
      { ligand: { ligand: "CCD_ATP", count: 1 } },
      { ion: { ion: "MG", count: 1 } },
    ]);
    // Ligands cost one token per atom; an ion is a single atom.
    assert.equal(result.summary.tokens, chain.length + 31 + 1);
    assert.equal(result.warnings.length, 0);
  });

  it("prefixes ligand codes with CCD_ but leaves ion codes bare", () => {
    const result = buildAlphaFoldJob(request({ ligands: [{ code: "HEM" }], ions: [{ code: "ZN", copies: 2 }] }));
    assert.deepEqual(result.jobs[0].sequences.slice(1), [
      { ligand: { ligand: "CCD_HEM", count: 1 } },
      { ion: { ion: "ZN", count: 2 } },
    ]);
  });

  it("merges two annotations naming the same cofactor into one entity", () => {
    const result = buildAlphaFoldJob(request({ cofactors: [{ code: "Zn(2+)" }, { code: "zinc" }, { code: "CCD_ZN" }] }));
    assert.deepEqual(result.jobs[0].sequences.slice(1), [{ ion: { ion: "ZN", count: 3 } }]);
  });

  it("warns when an explicit ligand turns out to be an ion", () => {
    const result = buildAlphaFoldJob(request({ ligands: [{ code: "magnesium", source: "Mg(2+)" }] }));
    assert.deepEqual(categories(result.warnings), ["reclassified"]);
    assert.deepEqual(result.jobs[0].sequences.slice(1), [{ ion: { ion: "MG", count: 1 } }]);
  });

  it("does not warn about placement for a cofactor recorded without a kind", () => {
    assert.equal(buildAlphaFoldJob(request({ cofactors: [{ code: "magnesium" }] })).warnings.length, 0);
  });

  it("leaves out an unsupported CCD code and lists what is allowed", () => {
    const result = buildAlphaFoldJob(request({ cofactors: [{ code: "CCD_FMN", source: "FMN" }] }));
    assert.equal(result.jobs[0].sequences.length, 1);
    assert.deepEqual(categories(result.warnings), ["unsupported-ligand"]);
    assert.match(result.warnings[0].message, /cannot model "FMN"/);
    assert.match(result.warnings[0].message, /ATP/);
  });

  it("leaves out a cofactor it cannot recognise at all", () => {
    const result = buildAlphaFoldJob(request({ cofactors: [{ code: "pyridoxal 5'-phosphate" }] }));
    assert.deepEqual(categories(result.warnings), ["unsupported-ligand"]);
  });

  it("notes a substitution that is not an exact chemical match", () => {
    const result = buildAlphaFoldJob(request({ cofactors: [{ code: "NADH" }] }));
    assert.deepEqual(categories(result.warnings), ["approximation"]);
    assert.deepEqual(result.jobs[0].sequences.slice(1), [{ ligand: { ligand: "CCD_NAD", count: 1 } }]);
  });
});

describe("recognising recorded cofactor names", () => {
  it("accepts a bare code with or without the CCD_ prefix", () => {
    assert.equal(bareCcdCode(" ccd_atp "), "ATP");
    assert.equal(bareCcdCode("atp"), "ATP");
  });

  it("strips charge notation and a trailing ChEBI identifier", () => {
    assert.equal(moleculeKey("Zn(2+) · CHEBI:29105"), "zn");
    assert.equal(moleculeKey("Mg2+"), "mg");
    assert.equal(moleculeKey("Fe cation"), "fe");
    assert.equal(moleculeKey("NAD(+)"), "nad");
  });

  it("maps element names, nucleotides and the heme family", () => {
    assert.deepEqual(recogniseMolecule("Ca(2+)"), { kind: "ion", code: "CA" });
    assert.deepEqual(recogniseMolecule("heme b"), { kind: "ligand", code: "HEM" });
    assert.deepEqual(recogniseMolecule("heme c"), { kind: "ligand", code: "HEC" });
    assert.deepEqual(recogniseMolecule("NADP(+)"), { kind: "ligand", code: "NAP" });
    assert.deepEqual(recogniseMolecule("NADPH"), { kind: "ligand", code: "NDP" });
    assert.equal(recogniseMolecule("molybdopterin"), null);
  });
});

describe("post-translational modifications", () => {
  const ptm = (code: string, position: number) => request({ proteins: [{ label: "Construct", sequence: chain, required: true, ptms: [{ code, position, source: `${code} at ${position}` }] }] });

  it("writes ptmType and ptmPosition for a modification on the right residue", () => {
    const result = buildAlphaFoldJob(ptm("SEP", 2));
    assert.deepEqual(proteins(result)[0].modifications, [{ ptmType: "CCD_SEP", ptmPosition: 2 }]);
    assert.equal(result.warnings.length, 0);
    // A modified residue is tokenised per atom: 10 residues, one swapped for 11 atoms.
    assert.equal(result.summary.tokens, chain.length - 1 + 11);
    assert.deepEqual(result.summary.chains[0].ptms, [{ code: "SEP", position: 2, name: "Phosphoserine" }]);
  });

  it("accepts a code given with the CCD_ prefix", () => {
    assert.deepEqual(proteins(buildAlphaFoldJob(ptm("CCD_TPO", 5)))[0].modifications, [{ ptmType: "CCD_TPO", ptmPosition: 5 }]);
  });

  it("leaves out a modification whose residue does not match the construct", () => {
    const result = buildAlphaFoldJob(ptm("SEP", 3));
    assert.equal(proteins(result)[0].modifications, undefined);
    assert.deepEqual(categories(result.warnings), ["ptm-residue"]);
    assert.match(result.warnings[0].message, /modified S, but Construct has N at position 3/);
    assert.match(result.warnings[0].message, /reference sequence, not this construct/);
  });

  it("leaves out a modification past the end of the chain", () => {
    const result = buildAlphaFoldJob(ptm("SEP", 99));
    assert.deepEqual(categories(result.warnings), ["ptm-position"]);
    assert.match(result.warnings[0].message, /10 residues long/);
  });

  it("leaves out a code AlphaFold Server does not support", () => {
    const result = buildAlphaFoldJob(ptm("CCD_SEB", 2));
    assert.deepEqual(categories(result.warnings), ["unsupported-ptm"]);
    assert.match(result.warnings[0].message, /23 modifications/);
  });

  it("keeps only the first modification on a residue", () => {
    const result = buildAlphaFoldJob(request({
      proteins: [{ label: "Construct", sequence: chain, required: true, ptms: [{ code: "ALY", position: 4 }, { code: "MLZ", position: 4 }] }],
    }));
    assert.deepEqual(proteins(result)[0].modifications, [{ ptmType: "CCD_ALY", ptmPosition: 4 }]);
    assert.deepEqual(categories(result.warnings), ["duplicate-ptm"]);
  });

  it("checks every supported code against its own parent residue", () => {
    // CIR is citrulline from arginine (R9); YHA is homocitrulline from lysine
    // (K4). The two sit next to each other in the allowed list and are easy to
    // swap, so both directions are pinned here.
    assert.equal(buildAlphaFoldJob(ptm("CIR", 9)).warnings.length, 0);
    assert.deepEqual(categories(buildAlphaFoldJob(ptm("CIR", 4)).warnings), ["ptm-residue"]);
    assert.equal(buildAlphaFoldJob(ptm("YHA", 4)).warnings.length, 0);
    assert.deepEqual(categories(buildAlphaFoldJob(ptm("YHA", 9)).warnings), ["ptm-residue"]);
    assert.equal(buildAlphaFoldJob(ptm("HYP", 7)).warnings.length, 0);
    assert.equal(buildAlphaFoldJob(ptm("P1L", 8)).warnings.length, 0);
    assert.equal(buildAlphaFoldJob(ptm("PTR", 6)).warnings.length, 0);
    assert.equal(buildAlphaFoldJob(ptm("AHB", 3)).warnings.length, 0);
    assert.equal(buildAlphaFoldJob(ptm("TRF", 1)).warnings.length, 1);
  });
});

describe("glycans", () => {
  const glycan = (residues: string, position: number) => request({ proteins: [{ label: "Construct", sequence: chain, required: true, glycans: [{ residues, position, source: `${residues} at ${position}` }] }] });

  it("attaches a glycan to an asparagine", () => {
    const result = buildAlphaFoldJob(glycan("NAG", 3));
    assert.deepEqual(proteins(result)[0].glycans, [{ residues: "NAG", position: 3 }]);
    assert.equal(result.warnings.length, 0);
    assert.equal(result.summary.tokens, chain.length + 15);
    assert.equal(result.summary.glycanResidues, 1);
  });

  it("keeps a branched glycan's nested form and counts each residue", () => {
    const result = buildAlphaFoldJob(glycan("NAG(NAG)(BMA)", 3));
    assert.deepEqual(proteins(result)[0].glycans, [{ residues: "NAG(NAG)(BMA)", position: 3 }]);
    assert.equal(result.summary.glycanResidues, 3);
    assert.equal(result.summary.tokens, chain.length + 15 + 15 + 12);
  });

  it("parses nested and malformed glycan strings", () => {
    assert.deepEqual(parseGlycan("NAG(NAG)(BMA)"), ["NAG", "NAG", "BMA"]);
    assert.deepEqual(parseGlycan(" man "), ["MAN"]);
    assert.equal(parseGlycan("NAG(NAG"), null);
    assert.equal(parseGlycan("NAG)"), null);
    assert.equal(parseGlycan(""), null);
  });

  it("allows fucose on threonine but not on asparagine", () => {
    assert.equal(buildAlphaFoldJob(glycan("FUC", 5)).warnings.length, 0);
    const rejected = buildAlphaFoldJob(glycan("FUC", 3));
    assert.deepEqual(categories(rejected.warnings), ["unsupported-glycan"]);
    assert.match(rejected.warnings[0].message, /cannot be attached to N3/);
  });

  it("leaves out a sugar AlphaFold Server has no code for", () => {
    const result = buildAlphaFoldJob(glycan("A2G", 5));
    assert.deepEqual(categories(result.warnings), ["unsupported-glycan"]);
    assert.match(result.warnings[0].message, /A2G cannot be attached to T5/);
  });

  it("refuses a site that is not N, S or T", () => {
    const result = buildAlphaFoldJob(glycan("NAG", 1));
    assert.deepEqual(categories(result.warnings), ["glycan-site"]);
    assert.match(result.warnings[0].message, /only to N, S or T/);
  });

  it("refuses a position outside the chain", () => {
    assert.deepEqual(categories(buildAlphaFoldJob(glycan("NAG", 40)).warnings), ["glycan-position"]);
  });

  it("stops at the per-job glycan residue limit", () => {
    const result = buildAlphaFoldJob(request({
      proteins: [{
        label: "Construct", sequence: chain, required: true,
        glycans: [
          { residues: "NAG(NAG)(BMA)(MAN)", position: 3, source: "first" },
          { residues: "NAG(NAG)(BMA)(MAN)", position: 5, source: "second" },
          { residues: "NAG(NAG)", position: 2, source: "third" },
        ],
      }],
    }));
    assert.equal(result.summary.glycanResidues, glycanResidueLimit);
    assert.deepEqual(proteins(result)[0].glycans?.map((entry) => entry.position), [3, 5]);
    assert.deepEqual(categories(result.warnings), ["glycan-limit"]);
    assert.match(result.warnings[0].message, /8 glycan residues in total/);
  });
});

describe("the token limit", () => {
  it("drops an optional entity to fit, newest first, and says what it cost", () => {
    const long = "A".repeat(tokenLimit - 10);
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: long, required: true }], cofactors: [{ code: "ATP" }] }));
    assert.equal(result.summary.tokens, tokenLimit - 10);
    assert.equal(result.fitsTokenLimit, true);
    assert.equal(result.canExport, true);
    assert.equal(result.jobs[0].sequences.length, 1);
    assert.deepEqual(result.summary.molecules, []);
    assert.deepEqual(categories(result.warnings), ["token-limit"]);
    assert.match(result.warnings[0].message, /ATP was left out .* 5,000-token limit/);
    assert.match(result.warnings[0].message, /cost 31 tokens/);
  });

  it("drops a partner chain before giving up", () => {
    const result = buildAlphaFoldJob(request({
      proteins: [
        { label: "Alpha", sequence: "A".repeat(4000), required: true },
        { label: "Beta", sequence: "A".repeat(2000), required: false },
      ],
    }));
    assert.deepEqual(result.summary.chains.map((entry) => entry.label), ["Alpha"]);
    assert.equal(result.fitsTokenLimit, true);
    assert.match(result.warnings[0].message, /Beta was left out/);
  });

  it("never reduces a chain's copy count to fit", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: "A".repeat(3000), copies: 2, required: true }] }));
    assert.equal(proteins(result)[0].count, 2);
    assert.equal(result.summary.tokens, 6000);
    assert.equal(result.fitsTokenLimit, false);
  });

  it("reports a blocking warning when the required chain alone is over the limit", () => {
    const result = buildAlphaFoldJob(request({ proteins: [{ label: "Construct", sequence: "A".repeat(tokenLimit + 100), required: true }] }));
    assert.equal(result.fitsTokenLimit, false);
    // The file is still written: the scientist may want to trim it by hand.
    assert.equal(result.canExport, true);
    const blocking = result.warnings.filter((warning) => warning.severity === "blocking");
    assert.deepEqual(categories(blocking), ["token-limit"]);
    assert.match(blocking[0].message, /needs about 5,100 tokens and AlphaFold Server allows 5,000/);
  });
});

describe("nucleic acid chains", () => {
  it("writes a DNA chain with modificationType and basePosition", () => {
    const result = buildAlphaFoldJob(request({
      nucleics: [{ label: "Operator", sequence: "GATTACA", kind: "dna", copies: 2, modifications: [{ code: "6OG", position: 1 }] }],
    }));
    assert.deepEqual(result.jobs[0].sequences[1], {
      dnaSequence: { sequence: "GATTACA", count: 2, modifications: [{ modificationType: "CCD_6OG", basePosition: 1 }] },
    });
    assert.equal(result.summary.tokens, chain.length + 14);
  });

  it("rejects a DNA chain holding U and an RNA chain holding T", () => {
    const dna = buildAlphaFoldJob(request({ nucleics: [{ label: "D", sequence: "GAUUACA", kind: "dna" }] }));
    assert.deepEqual(categories(dna.warnings), ["invalid-residue"]);
    assert.match(dna.warnings[0].message, /only A, T, G, C/);
    const rna = buildAlphaFoldJob(request({ nucleics: [{ label: "R", sequence: "GATTACA", kind: "rna" }] }));
    assert.deepEqual(categories(rna.warnings), ["invalid-residue"]);
  });

  it("refuses a protein PTM code on a nucleic chain", () => {
    const result = buildAlphaFoldJob(request({ nucleics: [{ label: "R", sequence: "GUAC", kind: "rna", modifications: [{ code: "SEP", position: 1 }] }] }));
    assert.deepEqual(categories(result.warnings), ["unsupported-ptm"]);
  });
});

describe("caller-supplied notes", () => {
  it("keeps them at the top of the warning list", () => {
    const note: ExportWarning = { category: "approximation", severity: "adjusted", subject: "Oligomeric state", message: "One copy assumed." };
    const result = buildAlphaFoldJob(request({ notes: [note], cofactors: [{ code: "unobtainium" }] }));
    assert.deepEqual(categories(result.warnings), ["approximation", "unsupported-ligand"]);
  });
});
