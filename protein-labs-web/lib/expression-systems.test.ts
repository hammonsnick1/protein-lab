// Expression host catalog contract (HOM-228). The screen presents this data as
// referenced evidence and other jobs read the saved config keys, so both are
// pinned here.
import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  allHosts, compatibleVectorFamilies, expressionHosts, expressionReferences, expressionVectors, familyMetrics, findHost,
  hostCategories, hostFamilies, hostMetrics, hostReferences, hostSavedConfig, hostSystems, isMeter, matchesHostSearch,
  metricColumns, normalizeHostSystem, referenceCitation, referenceUrl, systemLabel, type HostSystem,
} from "./expression-systems.ts";

describe("host families", () => {
  it("covers the five families the job offers, each with hosts and vectors", () => {
    assert.deepEqual(hostSystems, ["ecoli", "yeast", "insect", "mammalian", "cellfree"]);
    for (const system of hostSystems) {
      assert.equal(hostFamilies[system].id, system, `${system} family id`);
      assert.ok(expressionHosts[system].length >= 4, `${system} needs at least four strains`);
      assert.ok(expressionVectors[system].length >= 4, `${system} needs at least four vector families`);
    }
  });

  it("gives every family a complete metric set", () => {
    for (const system of hostSystems) {
      const cells = familyMetrics(system);
      assert.equal(cells.length, metricColumns.length);
      for (const cell of cells) {
        if (isMeter(cell.value)) {
          assert.ok(cell.value.level >= 0 && cell.value.level <= cell.column.max, `${system}.${cell.key} level within 0..${cell.column.max}`);
          assert.ok(cell.value.label.length > 0, `${system}.${cell.key} label`);
        } else {
          assert.ok(cell.value.trim().length > 0, `${system}.${cell.key} text`);
        }
        assert.equal(cell.inherited, false);
      }
    }
  });

  it("uses a unique colour and short name per family", () => {
    const colors = new Set(hostSystems.map((system) => hostFamilies[system].color));
    const names = new Set(hostSystems.map((system) => hostFamilies[system].shortName));
    assert.equal(colors.size, hostSystems.length);
    assert.equal(names.size, hostSystems.length);
  });
});

describe("strain records", () => {
  it("keeps strain ids unique across every family", () => {
    const ids = allHosts().map((entry) => entry.host.id);
    assert.equal(new Set(ids).size, ids.length);
  });

  it("fills in every display field the job renders", () => {
    for (const { system, host } of allHosts()) {
      for (const field of ["name", "category", "lineage", "promoter", "genotype", "usefulFor", "markers", "caution", "color"] as const) {
        assert.ok(String(host[field]).trim().length > 0, `${system}/${host.id} is missing ${field}`);
      }
      assert.ok(host.bestFor.length >= 2, `${system}/${host.id} needs at least two best-for tags`);
      assert.ok(host.strengths.length >= 2, `${system}/${host.id} needs at least two strengths`);
      assert.ok(host.limits.length >= 2, `${system}/${host.id} needs at least two limits`);
      assert.match(host.color, /^#[0-9a-f]{6}$/, `${system}/${host.id} colour is a lowercase hex value`);
    }
  });

  it("inherits family metrics for cells the strain does not override", () => {
    const cells = hostMetrics("ecoli", expressionHosts.ecoli.find((host) => host.id === "bl21-de3")!);
    const yieldCell = cells.find((cell) => cell.key === "yield")!;
    const scaleCell = cells.find((cell) => cell.key === "scale")!;
    assert.equal(yieldCell.inherited, false);
    assert.equal(yieldCell.value, "Among the highest of the E. coli hosts: tens to >100 mg/L for a soluble target");
    assert.equal(scaleCell.inherited, true);
    assert.equal(scaleCell.value, hostFamilies.ecoli.metrics.scale);
  });

  it("reports an engineered oxidising cytoplasm for the disulfide-folding strains", () => {
    for (const id of ["origami", "rosetta-gami", "shuffle", "shuffle-lysy"]) {
      const cell = hostMetrics("ecoli", expressionHosts.ecoli.find((host) => host.id === id)!).find((entry) => entry.key === "disulfides")!;
      assert.ok(isMeter(cell.value) && cell.value.level === 2, `${id} should report an engineered cytoplasm`);
      assert.equal(cell.inherited, false);
    }
  });

  it("never lets a strain metric exceed its column scale", () => {
    for (const { system, host } of allHosts()) {
      for (const cell of hostMetrics(system, host)) {
        if (!isMeter(cell.value)) continue;
        assert.ok(cell.value.level <= cell.column.max, `${system}/${host.id}.${cell.key} exceeds the ${cell.column.max}-step scale`);
      }
    }
  });
});

describe("references", () => {
  it("resolves every referenced id and gives each host at least one literature source", () => {
    for (const { system, host } of allHosts()) {
      const resolved = hostReferences(host);
      assert.equal(resolved.length, host.referenceIds.length, `${system}/${host.id} has an unresolved reference id`);
      assert.ok(resolved.length >= 2, `${system}/${host.id} needs at least two references`);
      assert.ok(resolved.some((reference) => reference.kind === "literature"), `${system}/${host.id} needs a literature reference, not only vendor documentation`);
    }
    for (const system of hostSystems) {
      const resolved = hostFamilies[system].referenceIds.map((id) => expressionReferences[id]);
      assert.ok(resolved.every(Boolean) && resolved.length >= 2, `${system} family references`);
    }
  });

  it("gives every literature reference a DOI and every vendor reference none", () => {
    for (const reference of Object.values(expressionReferences)) {
      assert.equal(reference.id.length > 0, true);
      if (reference.kind === "literature") {
        assert.match(reference.doi ?? "", /^10\.\d{4,9}\//, `${reference.id} needs a DOI`);
        assert.match(String(reference.year), /^(19|20)\d{2}$/, `${reference.id} needs a four-digit year`);
        assert.equal(referenceUrl(reference), `https://doi.org/${reference.doi}`);
      } else {
        assert.equal(reference.doi, undefined, `${reference.id} is vendor documentation and must not claim a DOI`);
        assert.equal(referenceUrl(reference), null);
      }
      assert.ok(reference.title.length > 10, `${reference.id} title`);
    }
  });

  it("does not keep references nothing cites", () => {
    const cited = new Set([...allHosts().flatMap((entry) => entry.host.referenceIds), ...hostSystems.flatMap((system) => hostFamilies[system].referenceIds)]);
    for (const id of Object.keys(expressionReferences)) assert.ok(cited.has(id), `${id} is not cited by any family or strain`);
  });

  it("formats literature and vendor citations differently", () => {
    assert.equal(referenceCitation(expressionReferences.lobstein2012), "Lobstein J, Emrich CA, Jeans C, Faulkner M, Riggs P, Berkmen M (2012) Microb Cell Fact 11:56");
    assert.equal(referenceCitation(expressionReferences.nebStrains).startsWith("New England Biolabs —"), true);
  });
});

describe("saved project compatibility", () => {
  it("maps legacy and current system values, including the new cell-free family", () => {
    const cases: [unknown, HostSystem][] = [
      ["ecoli", "ecoli"], ["Escherichia coli", "ecoli"], ["", "ecoli"], [undefined, "ecoli"], [null, "ecoli"], ["something odd", "ecoli"],
      ["yeast", "yeast"], ["Yeast", "yeast"], ["Komagataella phaffii", "yeast"],
      ["insect", "insect"], ["Insect", "insect"], ["Baculovirus", "insect"],
      ["mammalian", "mammalian"], ["Mammalian", "mammalian"], ["CHO", "mammalian"], ["HEK293", "mammalian"],
      ["cellfree", "cellfree"], ["Cell-free", "cellfree"], ["cell free", "cellfree"], ["In vitro translation", "cellfree"],
    ];
    for (const [input, expected] of cases) assert.equal(normalizeHostSystem(input), expected, `normalizeHostSystem(${JSON.stringify(input)})`);
  });

  it("round-trips every system label back to its id", () => {
    for (const system of hostSystems) assert.equal(normalizeHostSystem(systemLabel(system)), system);
  });

  it("finds a saved strain id regardless of the saved system label", () => {
    assert.equal(findHost("bl21-de3")?.system, "ecoli");
    assert.equal(findHost("x33")?.system, "yeast");
    assert.equal(findHost("wheat-germ")?.system, "cellfree");
    assert.equal(findHost("not-a-strain"), null);
  });

  it("writes the config keys other jobs read", () => {
    const host = expressionHosts.ecoli.find((entry) => entry.id === "bl21-de3")!;
    const config = hostSavedConfig("ecoli", host);
    assert.equal(config.hostSystem, "Escherichia coli");
    assert.equal(config.hostSystemId, "ecoli");
    assert.equal(config.hostId, "bl21-de3");
    assert.equal(config.strainId, "bl21-de3");
    assert.equal(config.strainName, "BL21(DE3)");
    assert.equal(config.savedByUser, true);
    assert.deepEqual(config.bestFor, host.bestFor);
    assert.equal(config.markers, host.markers);
    assert.ok(config.typicalYield.length > 0);
    assert.ok(config.referenceCitations.length >= 2);
    // Cell lysis derives the lysis family from these two keys, so they must be
    // readable for a cell-free save as well.
    const cellFree = hostSavedConfig("cellfree", expressionHosts.cellfree[0]);
    assert.equal(cellFree.hostSystemId, "cellfree");
    assert.equal(normalizeHostSystem(cellFree.hostSystem), "cellfree");
  });
});

describe("catalog helpers", () => {
  it("filters vectors to the chosen host and flags promoter mismatches", () => {
    const x33 = expressionHosts.yeast.find((host) => host.id === "x33")!;
    const matches = compatibleVectorFamilies("yeast", x33);
    assert.deepEqual(matches.map((match) => match.family.id).sort(), ["pgapz", "ppicz"]);
    assert.ok(matches.every((match) => match.level === "pass"));

    const by4741 = expressionHosts.yeast.find((host) => host.id === "by4741")!;
    const saccharomyces = compatibleVectorFamilies("yeast", by4741);
    assert.ok(!saccharomyces.some((match) => match.family.id === "pyd1"), "display vector is restricted to EBY100");
    assert.ok(saccharomyces.some((match) => match.family.id === "pyes2" && match.level === "pass"));

    const nebexpress = expressionHosts.ecoli.find((host) => host.id === "nebexpress")!;
    const t7Needed = compatibleVectorFamilies("ecoli", nebexpress).filter((match) => match.level === "warning");
    assert.ok(t7Needed.some((match) => match.family.id === "pet28"), "a T7 vector in a non-T7 host is a warning");
    assert.match(t7Needed[0].note, /NEBExpress/);
  });

  it("only lists vector families whose host restrictions name real strains", () => {
    const ids = new Set(allHosts().map((entry) => entry.host.id));
    for (const system of hostSystems) {
      for (const family of expressionVectors[system]) {
        for (const hostId of family.compatibleHostIds ?? []) assert.ok(ids.has(hostId), `${family.id} names unknown host ${hostId}`);
      }
    }
  });

  it("builds a category filter that starts with every host", () => {
    for (const system of hostSystems) {
      const categories = hostCategories(system);
      assert.equal(categories[0], "All hosts");
      assert.equal(new Set(categories).size, categories.length);
      for (const host of expressionHosts[system]) assert.ok(categories.includes(host.category));
    }
  });

  it("searches names, aliases, genotypes and strengths", () => {
    const x33 = expressionHosts.yeast.find((host) => host.id === "x33")!;
    assert.equal(matchesHostSearch(x33, ""), true);
    assert.equal(matchesHostSearch(x33, "  "), true);
    assert.equal(matchesHostSearch(x33, "Pichia"), true, "alias is searchable");
    assert.equal(matchesHostSearch(x33, "zeocin"), true, "markers text is searchable");
    assert.equal(matchesHostSearch(x33, "methotrexate"), false);
    const shuffle = expressionHosts.ecoli.find((host) => host.id === "shuffle")!;
    assert.equal(matchesHostSearch(shuffle, "DsbC"), true, "strengths text is searchable");
    assert.equal(matchesHostSearch(shuffle, "ΔtrxB"), true, "genotype is searchable");
  });
});
