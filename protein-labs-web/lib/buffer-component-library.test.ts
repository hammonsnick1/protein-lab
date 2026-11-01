// The buffer component library and how composed buffers save and load. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { applyLibraryComponent, bufferComponentLibrary, bufferPurposes, findLibraryComponent, purposeExplanation, purposeOptions, rangeStatus, resolvePurpose, searchLibrary } from "./buffer-component-library.ts";
import { bufferPresets, normalizeBufferSteps, type BufferStep } from "./purification-catalog.ts";

const starterList = ["Tris", "HEPES", "sodium phosphate", "MES", "NaCl", "KCl", "imidazole", "glycerol", "sucrose", "L-arginine", "L-glutamate", "TCEP", "DTT", "β-mercaptoethanol", "EDTA", "MgCl2", "CaCl2", "ZnCl2", "PMSF", "protease inhibitor cocktail", "Benzonase", "DNase I", "lysozyme", "Triton X-100", "Tween-20", "DDM", "CHAPS", "desthiobiotin", "reduced glutathione", "maltose"];

/** Save is JSON through the engine; load is the planner's normalizer. */
function saveAndLoad(steps: Record<string, BufferStep>) {
  return normalizeBufferSteps(JSON.parse(JSON.stringify(steps)));
}

describe("bufferComponentLibrary", () => {
  it("gives every entry at least one listed purpose with an explanation, and a reference", () => {
    const purposeIds = new Set(bufferPurposes.map((purpose) => purpose.id));
    for (const entry of bufferComponentLibrary) {
      assert.ok(entry.purposes.length >= 1, `${entry.name} has no purpose`);
      for (const purpose of entry.purposes) {
        assert.ok(purposeIds.has(purpose.purpose), `${entry.name}: unknown purpose ${purpose.purpose}`);
        assert.ok(purpose.why.trim().length > 20, `${entry.name}: ${purpose.purpose} has no explanation`);
      }
      assert.ok(entry.references.length >= 1, `${entry.name} has no reference`);
      for (const reference of entry.references) assert.match(reference, /\w.*\.\s*\S|\(\d{4}\)|\d{4}/, `${entry.name}: reference "${reference}" looks empty`);
      assert.ok(entry.typical.low <= entry.typical.high, `${entry.name}: typical range is reversed`);
    }
  });

  it("has unique ids and names that do not collide with another entry's alias", () => {
    assert.equal(new Set(bufferComponentLibrary.map((entry) => entry.id)).size, bufferComponentLibrary.length);
    for (const entry of bufferComponentLibrary) for (const name of [entry.name, ...entry.aliases]) assert.equal(findLibraryComponent(name)?.id, entry.id, `"${name}" resolves to another entry`);
  });

  it("covers the starter list", () => {
    for (const name of starterList) assert.ok(findLibraryComponent(name), `${name} is missing`);
  });

  it("records the key cautions", () => {
    assert.match(findLibraryComponent("EDTA")!.cautions.join(" "), /Ni²⁺.*IMAC/);
    assert.match(findLibraryComponent("DTT")!.cautions.join(" "), /higher concentration it reduces the Ni²⁺ on IMAC resin.*1–5 mM TCEP/);
    assert.match(findLibraryComponent("β-mercaptoethanol")!.cautions.join(" "), /higher concentration it can reduce the Ni²⁺ on IMAC resin; 1–5 mM TCEP is the preferred reductant/);
    assert.match(findLibraryComponent("Imidazole")!.cautions.join(" "), /280 nm/);
  });

  it("recommends 1–5 mM TCEP for IMAC and does not warn against it", () => {
    const tcep = findLibraryComponent("TCEP")!;
    assert.deepEqual([tcep.typical.low, tcep.typical.high, tcep.typical.unit, tcep.defaultConcentration], [1, 5, "mM", 1]);
    assert.match(tcep.purposes[0].why, /does not reduce the Ni²⁺ on Ni-NTA or other IMAC resins.*1–5 mM TCEP is the preferred reductant/);
    assert.equal(tcep.alert, undefined);
    assert.doesNotMatch(tcep.cautions.join(" "), /IMAC|Ni²⁺|nickel/);
  });

  it("puts a row alert only on the components that can ruin a purification", () => {
    assert.deepEqual(bufferComponentLibrary.filter((entry) => entry.alert).map((entry) => entry.id).sort(), ["ddm", "dtt", "edta", "glycine-low-ph", "imidazole", "pmsf", "protease-inhibitor-cocktail", "triton-x-100"]);
  });

  it("finds every component the presets use, except free-text peptides", () => {
    const names = new Set(bufferPresets.flatMap((preset) => Object.values(preset.steps).flatMap((step) => step.components.map((component) => component.name))));
    const missing = [...names].filter((name) => !findLibraryComponent(name));
    assert.deepEqual(missing, ["Tag peptide"]);
  });

  it("searches by name, alias and purpose", () => {
    assert.equal(searchLibrary("imid")[0].name, "Imidazole");
    assert.equal(searchLibrary("dodecyl")[0].name, "DDM");
    assert.ok(searchLibrary("reducing").some((entry) => entry.name === "TCEP"));
    assert.equal(searchLibrary("").length, bufferComponentLibrary.length);
    assert.deepEqual(searchLibrary("xyzzy"), []);
  });
});

describe("purposes", () => {
  it("offers a library component its own purposes, and a custom component every purpose", () => {
    assert.deepEqual(purposeOptions(findLibraryComponent("EDTA")).map((purpose) => purpose.id), ["chelator", "affinity-eluent"]);
    assert.equal(purposeOptions(undefined).length, bufferPurposes.length);
  });

  it("reads purposes saved by the presets and older versions", () => {
    assert.equal(resolvePurpose(findLibraryComponent("Tris-HCl"), "Buffering"), "buffering");
    assert.equal(resolvePurpose(findLibraryComponent("Imidazole"), "Competitive wash"), "competitor");
    assert.equal(resolvePurpose(findLibraryComponent("Desthiobiotin"), "Competitive elution"), "affinity-eluent");
    assert.equal(resolvePurpose(findLibraryComponent("EDTA"), "Chelate calcium"), "affinity-eluent");
    assert.equal(resolvePurpose(findLibraryComponent("TCEP"), "Redox control"), "reducing");
    assert.equal(resolvePurpose(findLibraryComponent("NaCl"), "ionic strength"), "ionic-strength");
  });

  it("treats any other role text as the scientist's own purpose", () => {
    assert.equal(resolvePurpose(findLibraryComponent("EDTA"), "Outer-membrane permeabilization"), null);
    assert.equal(resolvePurpose(findLibraryComponent("NaCl"), "Reducing agent"), null, "a purpose the component does not serve is custom text");
    assert.equal(resolvePurpose(undefined, ""), null);
  });

  it("explains a purpose with the component's own reason, or the general summary for custom components", () => {
    assert.match(purposeExplanation(findLibraryComponent("Imidazole"), "competitor"), /histidine/);
    assert.match(purposeExplanation(undefined, "detergent"), /membranes/);
  });
});

describe("applyLibraryComponent", () => {
  it("fills a blank row with the typical concentration, unit and first purpose", () => {
    assert.deepEqual(applyLibraryComponent({ name: "", concentration: "", unit: "mM", role: "" }, findLibraryComponent("glycerol")!), { name: "Glycerol", concentration: 10, unit: "% (v/v)", role: "Stabilizer / osmolyte" });
  });

  it("keeps a typed concentration and a purpose the component serves", () => {
    assert.deepEqual(applyLibraryComponent({ name: "edt", concentration: "5", unit: "mM", role: "Chelate calcium" }, findLibraryComponent("EDTA")!), { name: "EDTA", concentration: "5", unit: "mM", role: "Chelate calcium" });
  });

  it("returns only the four saved BufferComponent fields", () => {
    assert.deepEqual(Object.keys(applyLibraryComponent({ name: "", concentration: "", unit: "mM", role: "" }, findLibraryComponent("DTT")!)).sort(), ["concentration", "name", "role", "unit"]);
  });
});

describe("rangeStatus", () => {
  it("flags concentrations outside the typical range in the same unit only", () => {
    const imidazole = findLibraryComponent("imidazole");
    assert.equal(rangeStatus(imidazole, { name: "Imidazole", concentration: 1000, unit: "mM", role: "" }), "above");
    assert.equal(rangeStatus(imidazole, { name: "Imidazole", concentration: "1", unit: "mM", role: "" }), "below");
    assert.equal(rangeStatus(imidazole, { name: "Imidazole", concentration: 300, unit: "mM", role: "" }), "");
    assert.equal(rangeStatus(imidazole, { name: "Imidazole", concentration: 1, unit: "M", role: "" }), "", "different unit is not compared");
    assert.equal(rangeStatus(findLibraryComponent("glycerol"), { name: "Glycerol", concentration: 50, unit: "%", role: "" }), "above", "a bare % matches % (v/v)");
    assert.equal(rangeStatus(undefined, { name: "Mystery", concentration: 9, unit: "mM", role: "" }), "");
  });
});

describe("saving and loading composed buffers", () => {
  it("round-trips a custom component with a custom purpose", () => {
    const steps = saveAndLoad({
      binding: { pH: "7.4", purpose: "Affinity capture", components: [
        { name: "HEPES", concentration: 20, unit: "mM", role: "Buffering agent" },
        { name: "Trehalose", concentration: "0.5", unit: "M", role: "Keeps the enzyme active through freeze–thaw" },
      ] },
    })!;
    assert.deepEqual(steps.binding.components, [
      { name: "HEPES", concentration: 20, unit: "mM", role: "Buffering agent" },
      { name: "Trehalose", concentration: "0.5", unit: "M", role: "Keeps the enzyme active through freeze–thaw" },
    ]);
    const custom = steps.binding.components[1];
    assert.equal(findLibraryComponent(custom.name), undefined);
    assert.equal(resolvePurpose(undefined, custom.role), null, "the custom purpose stays the scientist's own text");
  });

  it("loads an old saved step unchanged", () => {
    const saved = {
      binding: { pH: "7.5", purpose: "Affinity capture", components: [
        { name: "Tris-HCl", concentration: 50, unit: "mM", role: "Buffering" },
        { name: "NaCl", concentration: 300, unit: "mM", role: "Ionic strength" },
        { name: "Imidazole", concentration: 10, unit: "mM", role: "Selectivity" },
      ] },
      wash: { pH: "7.5", purpose: "Remove contaminants", components: [{ name: "New component", concentration: "", unit: "mM", role: "Purpose" }] },
      elution: { pH: "8.0", purpose: "Elute target", components: [{ name: "Low-pH glycine", concentration: 100, unit: "mM", role: "Acidic elution" }] },
    };
    const loaded = saveAndLoad(saved as Record<string, BufferStep>)!;
    for (const id of Object.keys(saved) as (keyof typeof saved)[]) assert.deepEqual(loaded[id], saved[id]);
    assert.deepEqual(loaded.lysis, { pH: "", purpose: "Lysis step", components: [] });
  });

  it("fills only missing fields in partial old records", () => {
    const loaded = normalizeBufferSteps({ elution: { components: [{ name: "Maltose", concentration: 10 }] } })!;
    assert.deepEqual(loaded.elution, { pH: "", purpose: "Elution step", components: [{ name: "Maltose", concentration: 10, unit: "mM", role: "" }] });
    assert.equal(normalizeBufferSteps(null), null);
    assert.equal(normalizeBufferSteps([]), null);
  });
});
