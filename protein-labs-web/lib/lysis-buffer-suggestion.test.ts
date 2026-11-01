// The Cell lysis buffer suggestion and how it follows the capture column. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { findLibraryComponent } from "./buffer-component-library.ts";
import { bufferPresets } from "./purification-catalog.ts";
import { captureChemistry, lysisHost, suggestLysisBuffer, type LysisContext } from "./lysis-buffer-suggestion.ts";

const binding = (presetId: string) => bufferPresets.find((preset) => preset.id === presetId)!.steps.binding;
const names = (context: LysisContext) => suggestLysisBuffer(context).step.components.map((item) => item.name);
const component = (context: LysisContext, name: string) => suggestLysisBuffer(context).step.components.find((item) => item.name === name);
const reason = (context: LysisContext, name: string) => suggestLysisBuffer(context).reasons.find((item) => item.component === name)?.text ?? "";

const his: LysisContext = { capture: { columnId: "his-ni", shortName: "Ni²⁺ IMAC", tag: "6×His / polyhistidine", binding: binding("his-ni-native") }, host: "bacteria", membrane: false };
const gst: LysisContext = { capture: { columnId: "gst", shortName: "Glutathione affinity", tag: "GST", binding: binding("gst-native") }, host: "bacteria", membrane: false };
const strep: LysisContext = { capture: { columnId: "strep-ii", shortName: "Strep-Tactin", tag: "Strep-tag II", binding: binding("strep-native") }, host: "bacteria", membrane: false };
const mbp: LysisContext = { capture: { columnId: "mbp-amylose", shortName: "Amylose resin", tag: "MBP", binding: binding("mbp-native") }, host: "bacteria", membrane: false };

describe("captureChemistry", () => {
  it("reads the chemistry from the column id, or the tag when the id is unknown", () => {
    assert.equal(captureChemistry("his-co"), "imac");
    assert.equal(captureChemistry("hat-ni"), "imac");
    assert.equal(captureChemistry("gst"), "gst");
    assert.equal(captureChemistry("twin-strep-xt"), "strep");
    assert.equal(captureChemistry("mbp-dextrin"), "mbp");
    assert.equal(captureChemistry("cbp"), "calcium");
    assert.equal(captureChemistry("flag"), "other");
    assert.equal(captureChemistry("", "6×His / polyhistidine"), "imac");
    assert.equal(captureChemistry(undefined, undefined), "none");
  });
});

describe("lysisHost", () => {
  it("maps saved host ids and labels to host families", () => {
    assert.equal(lysisHost("ecoli"), "bacteria");
    assert.equal(lysisHost("Escherichia coli"), "bacteria");
    assert.equal(lysisHost("yeast"), "yeast");
    assert.equal(lysisHost("Insect"), "insect");
    assert.equal(lysisHost("mammalian"), "mammalian");
    assert.equal(lysisHost(undefined), "");
  });
  it("keeps a cell-free plan out of the E. coli family", () => {
    assert.equal(lysisHost("cellfree"), "cellfree");
    assert.equal(lysisHost("Cell-free"), "cellfree");
    const suggestion = suggestLysisBuffer({ ...his, host: "cellfree" });
    assert.ok(!names({ ...his, host: "cellfree" }).includes("Lysozyme"));
    assert.match(suggestion.reasons.find(reason => reason.component === "Lysozyme")?.text ?? "", /no cells/);
  });
});

describe("suggestLysisBuffer", () => {
  it("His/IMAC: binding-buffer base, 10–20 mM imidazole, TCEP not DTT, no EDTA, EDTA-free inhibitor", () => {
    const suggestion = suggestLysisBuffer(his);
    assert.equal(suggestion.chemistry, "imac");
    assert.equal(suggestion.step.pH, "7.5");
    assert.deepEqual(names(his).slice(0, 2), ["Tris-HCl", "NaCl"]);
    assert.equal(component(his, "NaCl")?.concentration, 300);
    const imidazole = Number(component(his, "Imidazole")?.concentration);
    assert.ok(imidazole >= 10 && imidazole <= 20);
    assert.equal(component(his, "TCEP")?.concentration, 1);
    assert.match(reason(his, "TCEP"), /1–5 mM suits IMAC.*does not reduce the Ni²⁺.*higher concentration can reduce Ni²⁺/);
    assert.ok(!names(his).includes("DTT"));
    assert.ok(!names(his).some((name) => /edta/i.test(name) && !/edta-free/i.test(name)));
    assert.ok(names(his).includes("EDTA-free protease inhibitor"));
    assert.match(reason(his, "EDTA"), /strips Ni/);
    assert.match(reason(his, "Base"), /binding buffer/);
  });

  it("His/IMAC: keeps the binding imidazole when it is 10–20 mM and caps a higher one at 20 mM", () => {
    const at15 = { ...his, capture: { ...his.capture, binding: { ...binding("his-ni-native"), components: [...binding("his-ni-native").components.filter((item) => item.name !== "Imidazole"), { name: "Imidazole", concentration: 15, unit: "mM", role: "Competitor / eluent" }] } } };
    assert.equal(component(at15, "Imidazole")?.concentration, 15);
    const at40 = { ...his, capture: { ...his.capture, binding: { ...binding("his-ni-native"), components: [...binding("his-ni-native").components.filter((item) => item.name !== "Imidazole"), { name: "Imidazole", concentration: 40, unit: "mM", role: "Competitor / eluent" }] } } };
    assert.equal(component(at40, "Imidazole")?.concentration, 20);
  });

  it("GST: no imidazole, DTT allowed, ordinary protease inhibitor cocktail", () => {
    assert.equal(suggestLysisBuffer(gst).chemistry, "gst");
    assert.ok(!names(gst).includes("Imidazole"));
    assert.ok(names(gst).includes("DTT"));
    assert.ok(names(gst).includes("Protease inhibitor cocktail"));
    assert.match(reason(gst, "Imidazole"), /No imidazole/);
  });

  it("Strep: no biotin, avidin mentioned as optional", () => {
    assert.equal(suggestLysisBuffer(strep).chemistry, "strep");
    assert.ok(!names(strep).some((name) => /biotin/i.test(name)));
    assert.match(reason(strep, "Biotin"), /avidin \(optional\)/);
    // The Strep preset binds at pH 8.0; the lysis buffer follows the binding pH.
    assert.equal(suggestLysisBuffer(strep).step.pH, "8.0");
  });

  it("MBP: no maltose", () => {
    assert.equal(suggestLysisBuffer(mbp).chemistry, "mbp");
    assert.ok(!names(mbp).some((name) => /maltose/i.test(name)));
    assert.match(reason(mbp, "Maltose"), /No maltose/);
  });

  it("changes when the capture column changes", () => {
    assert.notDeepEqual(names(his), names(gst));
    assert.notDeepEqual(names(gst), names(strep).concat());
    assert.notDeepEqual(suggestLysisBuffer(his).reasons, suggestLysisBuffer(mbp).reasons);
  });

  it("always adds nuclease with Mg²⁺ and a protease inhibitor", () => {
    for (const context of [his, gst, strep, mbp]) {
      assert.ok(names(context).includes("Benzonase nuclease"));
      assert.ok(names(context).includes("MgCl₂"));
      assert.ok(names(context).some((name) => /protease inhibitor/i.test(name)));
    }
  });

  it("adds lysozyme for E. coli only, and says why it is left out otherwise", () => {
    assert.ok(names(his).includes("Lysozyme"));
    const mammalian = { ...his, host: "mammalian" as const };
    assert.ok(!names(mammalian).includes("Lysozyme"));
    assert.match(reason(mammalian, "Lysozyme"), /no cell wall/);
    assert.match(reason({ ...his, host: "yeast" }, "Lysozyme"), /bead beating/);
    assert.match(reason({ ...his, host: "" }, "Lysozyme"), /No expression host/);
  });

  it("adds lysozyme for E. coli only with a non-mechanical method; optional with sonication", () => {
    for (const method of ["enzymatic", "freeze-thaw", "detergent", "osmotic"]) {
      assert.ok(names({ ...his, method }).includes("Lysozyme"), method);
      assert.match(reason({ ...his, method }, "Lysozyme"), /this method relies on/);
    }
    for (const method of ["sonication", "homogenizer", "bead-mill"]) {
      assert.ok(!names({ ...his, method }).includes("Lysozyme"), method);
      assert.match(reason({ ...his, method }, "Lysozyme"), /Optional.*14\.3 kDa/);
    }
    assert.ok(!names({ ...his, host: "mammalian", method: "freeze-thaw" }).includes("Lysozyme"));
  });

  it("adds a reductant only when the construct has cysteines, or the count is unknown", () => {
    for (const context of [his, strep, mbp, { ...his, capture: null }]) {
      assert.equal(component({ ...context, cysteines: 2 }, "TCEP")?.concentration, 1);
      assert.match(reason({ ...context, cysteines: 2 }, "TCEP"), /^2 Cys in the construct\./);
      assert.ok(names({ ...context, cysteines: null }).includes("TCEP"));
      assert.ok(!names({ ...context, cysteines: 0 }).includes("TCEP"));
      assert.match(reason({ ...context, cysteines: 0 }, "TCEP"), /no cysteines/);
    }
    assert.ok(!names({ ...gst, cysteines: 0 }).includes("DTT"));
    assert.ok(names({ ...gst, cysteines: 4 }).includes("DTT"));
  });

  it("warns that TCEP oxidizes in a phosphate base", () => {
    const phosphate = { ...his, capture: { ...his.capture, binding: { pH: "8.0", purpose: "Binding", components: [{ name: "Sodium phosphate", concentration: 50, unit: "mM", role: "Buffering" }, { name: "NaCl", concentration: 300, unit: "mM", role: "Ionic strength" }] } } };
    assert.match(reason(phosphate, "TCEP"), /phosphate buffer oxidizes within days/);
    assert.doesNotMatch(reason(his, "TCEP"), /phosphate/);
  });

  it("membrane proteins get a detergent, matching the SEC detergent when there is one", () => {
    assert.ok(!names(his).some((name) => findLibraryComponent(name)?.purposes.some((value) => value.purpose === "detergent")));
    const membrane = { ...his, membrane: true };
    assert.equal(component(membrane, "DDM")?.concentration, 1);
    const chaps = { ...membrane, secComponents: [{ name: "HEPES", concentration: 20, unit: "mM", role: "Buffering" }, { name: "CHAPS", concentration: 0.5, unit: "% (w/v)", role: "Detergent" }] };
    assert.ok(names(chaps).includes("CHAPS"));
    assert.ok(!names(chaps).includes("DDM"));
  });

  it("uses an EDTA-free inhibitor when Subtractive cleanup is IMAC, even after a non-IMAC capture", () => {
    const context = { ...gst, cleanup: { columnId: "his-ni", shortName: "Ni²⁺ IMAC", tag: "6×His / polyhistidine" } };
    assert.ok(names(context).includes("EDTA-free protease inhibitor"));
    assert.match(reason(context, "EDTA-free protease inhibitor"), /Subtractive cleanup/);
  });

  it("falls back to a general base when nothing is saved, and says so", () => {
    const empty: LysisContext = { host: "", membrane: false };
    const suggestion = suggestLysisBuffer(empty);
    assert.equal(suggestion.chemistry, "none");
    assert.equal(suggestion.step.pH, "7.5");
    assert.match(reason(empty, "Base"), /No Affinity capture is saved/);
    const noBinding = { ...his, capture: { ...his.capture, binding: null } };
    assert.equal(suggestLysisBuffer(noBinding).step.pH, "8.0");
    assert.equal(component(noBinding, "NaCl")?.concentration, 300);
  });

  it("gives one reason per suggested component and every component a library match", () => {
    for (const context of [his, gst, strep, mbp, { ...his, membrane: true, host: "yeast" as const }]) {
      const suggestion = suggestLysisBuffer(context);
      for (const item of suggestion.step.components) {
        assert.ok(findLibraryComponent(item.name), `${item.name} is not in the library`);
        assert.ok(item.role, `${item.name} has no purpose`);
      }
      const named = suggestion.reasons.map((value) => value.component);
      for (const item of suggestion.step.components.slice(2)) assert.ok(named.includes(item.name), `${item.name} has no reason`);
    }
  });
});
