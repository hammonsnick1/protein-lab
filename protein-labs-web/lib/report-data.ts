import type { JsonObject, ProjectJob, ProteinBundle } from "@/lib/protein-labs-api";

/**
 * Everything the purification report reads out of a saved project.
 *
 * The report reads project data in exactly one place: this file. The gel and
 * chromatogram engines are being reworked to return fit-quality and flag
 * fields, so every number the report prints is wrapped in a value that can
 * carry caveats, and every engine record is scanned for a `flags` array. When
 * the engines start emitting those fields they appear in the report without
 * touching the report components.
 *
 * Fields requested from the engines, in the shape the report already reads:
 *
 * - gel bands: `flags: [{ code, level, title, message }]`, with `saturated`
 *   reported as a flag rather than a boolean, plus `densityUncertainty` so a
 *   purity percentage can print a tolerance.
 * - gel lanes: `sampleLabel` and `stageId`, so a lane can be bound to a
 *   purification stage instead of matched on its printed label, and
 *   `quantificationRefused` when the engine declines to quantify the lane.
 * - gel calibration: `rSquared` under its current name `r2` is enough, plus
 *   `residualKDa` per ladder band for a fit-quality statement.
 * - chromatogram peaks: `flags`, `mwKDa` with `mwUncertaintyKDa`, and
 *   `fitQuality: { rSquared, residual, model }` from the Python peak fit.
 * - chromatogram calibration: `standardMassRangeKDa: [min, max]` so the report
 *   does not have to re-derive the calibrated window from the standards list.
 *
 * A `flags` array is read at every level the engines can attach one: the gel
 * and chromatogram records themselves, their calibrations, each lane, each
 * band, and each peak. A flag raised on a run must not disappear because it
 * was not raised on a single measurement.
 */

export type FlagLevel = "note" | "caution" | "warning";

/** A caveat attached to a printed number. Never hidden, never summarised away. */
export type ReportFlag = {
  id: string;
  level: FlagLevel;
  scope: string;
  title: string;
  detail: string;
};

/**
 * What a purity percentage is actually worth.
 *
 * A saturated band understates its own density, so it moves a ratio in a
 * direction that depends on which side of the ratio it sits. Saturating the
 * target alone pushes the printed purity down, so the truth is at least the
 * printed figure. Saturating a contaminant alone pushes the printed purity up,
 * so the truth is at most the printed figure. Saturating both leaves no
 * defensible direction, and the figure is then only an indication.
 */
export type PurityBound = "measured" | "lower" | "upper" | "unreliable";

export type YieldRow = {
  id: string;
  stage: string;
  /** Where the numbers came from, printed so a reader can audit the table. */
  source: string;
  volumeMl: number | null;
  concentrationMgMl: number | null;
  totalProteinMg: number | null;
  stepRecoveryPercent: number | null;
  overallRecoveryPercent: number | null;
  purityPercent: number | null;
  purityBound: PurityBound;
  purityMethod: string;
  yieldMethod: string;
  note: string;
  flags: ReportFlag[];
};

/** A user-editable override for one stage of the yield table. */
export type YieldEntry = {
  id: string;
  stage: string;
  volumeMl: string;
  concentrationMgMl: string;
  totalProteinMg: string;
  purityPercent: string;
  yieldMethod: string;
  purityMethod: string;
  note: string;
};

export type PurityRow = {
  id: string;
  lane: string;
  isLadder: boolean;
  targetBand: string;
  targetMwKDa: number | null;
  purityPercent: number | null;
  purityBound: PurityBound;
  bandCount: number;
  matchedStage: string;
  flags: ReportFlag[];
};

export type PuritySummary = {
  gelType: string;
  method: string;
  calibration: { slope: number; intercept: number; r2: number } | null;
  ladderPreset: string;
  savedAt: string;
  rows: PurityRow[];
  flags: ReportFlag[];
};

export type SecPeakRow = {
  id: string;
  name: string;
  veMl: number | null;
  kav: number | null;
  /** Only ever set when the calibration actually supports the mass. */
  mwKDa: number | null;
  /** Why no mass is printed, when the project has one saved but unusable. */
  mwSuppressedReason: string;
  areaPercent: number | null;
  fraction: string;
  flags: ReportFlag[];
};

export type SecSummary = {
  columnName: string;
  voMl: number | null;
  vtMl: number | null;
  flowMlMin: number | null;
  sampleVolumeMl: number | null;
  expectedMassKDa: number | null;
  fit: { slope: number; intercept: number; r2: number; standards: number } | null;
  calibratedRangeKDa: [number, number] | null;
  peaks: SecPeakRow[];
  flags: ReportFlag[];
};

export type MethodLine = { label: string; value: string };
export type MethodBlock = { id: string; title: string; summary: string; lines: MethodLine[]; flags: ReportFlag[] };

export type ReportData = {
  yieldRows: YieldRow[];
  yieldStages: { id: string; stage: string }[];
  purity: PuritySummary | null;
  sec: SecSummary | null;
  methods: MethodBlock[];
  /** Every flag raised anywhere in the report, in printing order. */
  flags: ReportFlag[];
};

/* ========================================================================
   Entry point
   ======================================================================== */

export function buildReportData(bundle: ProteinBundle, entries: YieldEntry[]): ReportData {
  const purity = buildPurity(bundle);
  const sec = buildSec(bundle);
  const stages = yieldStages(bundle);
  const yieldRows = buildYield(bundle, stages, entries, purity);
  const methods = buildMethods(bundle);
  const flags = [
    ...yieldRows.flatMap((row) => row.flags),
    ...(purity ? [...purity.flags, ...purity.rows.flatMap((row) => row.flags)] : []),
    ...(sec ? [...sec.flags, ...sec.peaks.flatMap((peak) => peak.flags)] : []),
    ...methods.flatMap((block) => block.flags),
  ];
  return { yieldRows, yieldStages: stages, purity, sec, methods, flags };
}

/* ========================================================================
   Yield across the purification
   ======================================================================== */

/**
 * The stages the yield table covers.
 *
 * The purification roadmap is the project's own record of which steps were
 * actually run, so its steps define the rows. Without a roadmap the table
 * falls back to the stages the planning jobs imply.
 */
export function yieldStages(bundle: ProteinBundle): { id: string; stage: string }[] {
  const roadmap = array(jobConfig(bundle, "purification-roadmap").steps)
    .map((step) => ({ id: String(step.id ?? ""), stage: String(step.title ?? "") }))
    .filter((step) => step.id && step.stage);
  if (roadmap.length) return roadmap;
  const fallback: { id: string; stage: string; present: boolean }[] = [
    { id: "lysate", stage: "Clarified lysate", present: true },
    { id: "affinity", stage: "Affinity eluate", present: Boolean(jobConfig(bundle, "purification-affinity").columnId) },
    { id: "cleavage", stage: "After tag cleavage", present: Boolean(jobConfig(bundle, "purification-cleavage").proteaseId) },
    { id: "cleanup", stage: "Cleanup flow-through", present: Boolean(jobConfig(bundle, "purification-subtractive").columnId) },
    { id: "sec", stage: "SEC pool", present: Boolean(jobConfig(bundle, "purification-sec").columnId) },
  ];
  return fallback.filter((step) => step.present).map(({ id, stage }) => ({ id, stage }));
}

function buildYield(
  bundle: ProteinBundle,
  stages: { id: string; stage: string }[],
  entries: YieldEntry[],
  purity: PuritySummary | null,
): YieldRow[] {
  const roadmap = roadmapMeasurements(bundle);
  const rows: YieldRow[] = stages.map(({ id, stage }) => {
    const entry = entries.find((value) => value.id === id);
    const measured = roadmap.get(id);
    const flags: ReportFlag[] = [];
    const volumeMl = pick(entry?.volumeMl, null);
    const typedTotal = pick(entry?.totalProteinMg, null);
    const typedConcentration = pick(entry?.concentrationMgMl, null);
    // Two of volume, concentration, and total protein determine the third, so
    // the report completes the row rather than printing a gap.
    const totalProteinMg = typedTotal ?? measured?.totalProteinMg
      ?? (volumeMl !== null && typedConcentration !== null ? volumeMl * typedConcentration : null);
    const concentrationMgMl = typedConcentration
      ?? (volumeMl !== null && volumeMl > 0 && totalProteinMg !== null ? totalProteinMg / volumeMl : null);
    const laneMatch = purity?.rows.find((row) => !row.isLadder && row.matchedStage === id) ?? null;
    const typedPurity = pick(entry?.purityPercent, null) ?? measured?.purityPercent ?? null;
    const purityPercent = typedPurity ?? laneMatch?.purityPercent ?? null;
    // A figure the researcher typed or recorded against the step is theirs; it
    // carries no densitometry caveat. Only a purity read off the gel inherits
    // the gel's bound.
    const purityBound: PurityBound = typedPurity !== null ? "measured" : laneMatch?.purityBound ?? "measured";
    const purityMethod = entry?.purityMethod?.trim()
      || measured?.purityMethod
      || (laneMatch ? `${purity?.gelType ?? "SDS-PAGE"} densitometry` : "");
    const yieldMethod = entry?.yieldMethod?.trim() || measured?.yieldMethod || "";

    if (totalProteinMg !== null && volumeMl === null) {
      flags.push(flag("caution", `Yield · ${stage}`, "Total protein recorded without a volume",
        "Recovery is comparable across stages only when the pooled volume is recorded as well. Add the volume for this stage."));
    }
    if (totalProteinMg !== null && yieldMethod === "") {
      flags.push(flag("note", `Yield · ${stage}`, "Protein quantitation method not recorded",
        "State how total protein was measured (A280, Bradford, BCA) so the number can be compared with other preparations."));
    }
    if (purityPercent !== null && purityMethod === "") {
      flags.push(flag("note", `Yield · ${stage}`, "Purity method not recorded",
        "Record whether purity came from gel densitometry, SEC peak area, or another measurement."));
    }
    return {
      id,
      stage,
      source: entry && hasTypedValue(entry) ? "Entered in the report"
        : measured ? "Purification roadmap measurement"
        : laneMatch ? "Gel densitometry" : "",
      volumeMl,
      concentrationMgMl,
      totalProteinMg,
      stepRecoveryPercent: null,
      overallRecoveryPercent: null,
      purityPercent,
      purityBound,
      purityMethod,
      yieldMethod,
      note: entry?.note?.trim() || measured?.note || "",
      flags,
    };
  });

  // Recovery is only meaningful against the first stage that was actually
  // quantified, and against the previous quantified stage for a step figure.
  const start = rows.find((row) => row.totalProteinMg !== null)?.totalProteinMg ?? null;
  let previous: number | null = null;
  for (const row of rows) {
    if (row.totalProteinMg === null) continue;
    if (start !== null && start > 0) row.overallRecoveryPercent = (row.totalProteinMg / start) * 100;
    if (previous !== null && previous > 0) row.stepRecoveryPercent = (row.totalProteinMg / previous) * 100;
    if (row.stepRecoveryPercent !== null && row.stepRecoveryPercent > 105) {
      row.flags.push(flag("warning", `Yield · ${row.stage}`, "Step recovery above 100%",
        `${row.stage} reports ${row.stepRecoveryPercent.toFixed(0)}% of the previous stage. Check the quantitation method, dilution, and whether the two stages measure the same species.`));
    }
    previous = row.totalProteinMg;
  }
  return rows;
}

/** Yield and purity measurements the researcher attached to roadmap steps. */
function roadmapMeasurements(bundle: ProteinBundle) {
  const measurements = new Map<string, {
    totalProteinMg: number | null;
    purityPercent: number | null;
    yieldMethod: string;
    purityMethod: string;
    note: string;
  }>();
  for (const step of array(jobConfig(bundle, "purification-roadmap").steps)) {
    const stepId = String(step.id ?? "");
    const measurement = array(step.components).find((item) => item.type === "measurement");
    if (!stepId || !measurement) continue;
    const unit = String(measurement.yieldUnit ?? "mg").toLowerCase();
    const value = numeric(measurement.yieldValue);
    measurements.set(stepId, {
      // Only an absolute mass belongs in a yield table; mg per litre of
      // culture and a bare percentage are kept as the step's note instead.
      totalProteinMg: value === null ? null : unit === "mg" ? value : unit === "µg" || unit === "ug" ? value / 1000 : null,
      purityPercent: numeric(measurement.purityValue),
      yieldMethod: String(measurement.yieldMethod ?? ""),
      purityMethod: String(measurement.purityMethod ?? ""),
      note: value !== null && unit !== "mg" && unit !== "µg" && unit !== "ug"
        ? `${value} ${String(measurement.yieldUnit ?? "")}`.trim()
        : String(measurement.notes ?? ""),
    });
  }
  return measurements;
}

/* ========================================================================
   Purity from gel densitometry
   ======================================================================== */

function buildPurity(bundle: ProteinBundle): PuritySummary | null {
  const job = bundle.projectJobs.find((value) => value.appType === "gel-analysis");
  if (!job) return null;
  const config = job.config;
  const lanes = array(config.lanes);
  const bands = array(config.bands);
  if (!lanes.length) return null;
  const calibration = fitOf(config.calibration);
  const stages = yieldStages(bundle);
  const flags: ReportFlag[] = [
    ...engineFlags(config, "Gel densitometry"),
    ...engineFlags(asObject(config.calibration), "Gel ladder calibration"),
  ];

  if (!calibration) {
    flags.push(flag("warning", "Gel densitometry", "The ladder is not calibrated",
      "No molecular-weight fit was stored with this gel, so band masses are not reported. Mark a ladder lane with at least two detected bands and save the gel again."));
  } else if (calibration.r2 < 0.98) {
    flags.push(flag("caution", "Gel densitometry", `Ladder fit R² is ${calibration.r2.toFixed(3)}`,
      "Band molecular weights carry more uncertainty than the single figure suggests. Check that the ladder bands are matched to the correct standards."));
  }

  const rows: PurityRow[] = lanes.map((lane, index) => {
    const laneId = String(lane.id ?? index);
    const laneBands = bands.filter((band) => String(band.laneId) === laneId);
    const target = laneBands.find((band) => band.isTarget === true);
    const label = String(lane.label ?? `Lane ${index + 1}`);
    const isLadder = lane.isLadder === true;
    const scope = `Gel · ${label}`;
    const rowFlags: ReportFlag[] = [...engineFlags(lane, scope)];
    for (const band of laneBands) rowFlags.push(...engineFlags(band, scope));

    // The engine can decline to quantify a lane outright. Its remaining band
    // densities must not be renormalised into a purity that looks measured.
    const refused = lane.quantificationRefused === true;
    if (refused) {
      rowFlags.push(flag("warning", scope, "The engine refused to quantify this lane",
        `${reasonText(lane.saturationReason ?? lane.refusalReason)} No purity is reported for this lane, and the densities that were measured are not renormalised to fill the gap.`));
    }

    const total = laneBands.reduce((sum, band) => sum + (numeric(band.density) ?? 0), 0);
    const purityPercent = !refused && target && total > 0 ? ((numeric(target.density) ?? 0) / total) * 100 : null;
    const purityBound = saturationBound(target, laneBands);

    if (!isLadder && !target && laneBands.length && !refused) {
      rowFlags.push(flag("caution", scope, "No band is marked as the target",
        "Purity cannot be calculated for this lane until the protein-of-interest band is selected in Gel densitometry."));
    }
    if (!isLadder && laneBands.length === 1 && purityPercent !== null) {
      rowFlags.push(flag("warning", scope, "Purity comes from a single detected band",
        "One detected band always gives 100%. Lower the detection threshold or inspect the lane before reporting this as purity."));
    }
    if (purityPercent !== null && purityPercent >= 99.5 && laneBands.length > 1 && purityBound === "measured") {
      rowFlags.push(flag("caution", scope, "Purity is at the limit of lane densitometry",
        "Densitometry of a stained gel cannot resolve contaminants below roughly 1% of the lane. Report this as >99% rather than an exact figure."));
    }
    if (purityPercent !== null && purityBound !== "measured") {
      rowFlags.push(saturationFlag(scope, purityBound, purityPercent));
    }
    const targetMass = target ? bandMass(target, calibration !== null) : { kDa: null, reason: "" };
    if (targetMass.reason) {
      rowFlags.push(flag("caution", scope, "No apparent mass for the target band", targetMass.reason));
    }

    return {
      id: laneId,
      lane: label,
      isLadder,
      targetBand: target ? String(target.label ?? "Target") : "",
      targetMwKDa: targetMass.kDa,
      purityPercent,
      purityBound: purityPercent === null ? "measured" : purityBound,
      bandCount: laneBands.length,
      matchedStage: "",
      flags: rowFlags,
    };
  });

  bindStages(rows, lanes, stages, flags);

  return {
    gelType: String(config.gelType ?? "SDS-PAGE"),
    method: `${String(config.gelType ?? "SDS-PAGE")} lane densitometry`,
    calibration,
    ladderPreset: String(config.ladderPreset ?? ""),
    savedAt: String(config.savedAt ?? job.updatedAt ?? ""),
    rows,
    flags,
  };
}

/**
 * The apparent mass of a gel band, or none with the reason why.
 *
 * The gel engine reports `molecularWeightDa` with a `molecularWeightStatus`,
 * and only an `estimated` status is a mass a reader may use. Older saves carry
 * `molecularWeightKDa` alone, which is printed only while the ladder is still
 * calibrated, so a stale figure cannot outlive the fit it came from.
 */
export function bandMass(band: JsonObject, calibrated: boolean): { kDa: number | null; reason: string } {
  const status = text(band.molecularWeightStatus).trim();
  if (status && status !== "estimated") {
    return { kDa: null, reason: `${reasonText(status)} The gel engine assigned no mass to this band.` };
  }
  const da = numeric(band.molecularWeightDa);
  if (da !== null) return { kDa: da > 0 ? da / 1000 : null, reason: "" };
  if (status === "estimated") return { kDa: null, reason: "" };
  return { kDa: calibrated ? numeric(band.molecularWeightKDa) : null, reason: "" };
}

/** Is this band's density known to understate the material in it? */
function isSaturated(band: JsonObject | undefined) {
  if (!band) return false;
  if (band.saturated === true) return true;
  return array(band.flags).some((raw) => /saturat/i.test(`${String(raw.code ?? "")} ${String(raw.title ?? "")}`))
    || (Array.isArray(band.flags) && band.flags.some((raw) => typeof raw === "string" && /saturat/i.test(raw)));
}

/**
 * Which way saturation moves a lane's purity, if any.
 *
 * Saturation never makes a ratio a lower bound on its own — that depends on
 * whether the understated band is the target or a contaminant. See
 * {@link PurityBound}.
 */
function saturationBound(target: JsonObject | undefined, laneBands: JsonObject[]): PurityBound {
  const targetSaturated = isSaturated(target);
  const contaminantSaturated = laneBands.some((band) => band !== target && isSaturated(band));
  if (targetSaturated && contaminantSaturated) return "unreliable";
  if (targetSaturated) return "lower";
  if (contaminantSaturated) return "upper";
  return "measured";
}

function saturationFlag(scope: string, bound: PurityBound, percent: number): ReportFlag {
  const shown = `${percent.toFixed(1)}%`;
  if (bound === "lower") {
    return flag("warning", scope, "The target band is saturated, so purity is a lower bound",
      `The target's integrated density understates the material in it, which pushes the ratio down. True purity is at least ${shown}. Reload the lane with less sample, or re-image at a shorter exposure, to measure it.`);
  }
  if (bound === "upper") {
    return flag("warning", scope, "A contaminant band is saturated, so purity is an upper bound",
      `A contaminant's integrated density understates the material in it, which pushes the ratio up. True purity is at most ${shown}, and may be well below it. Re-image at a shorter exposure before reporting this figure.`);
  }
  return flag("warning", scope, "Both the target and a contaminant are saturated, so purity is unreliable",
    `Saturation understates the target and a contaminant at once, and the two errors move the ratio in opposite directions, so ${shown} is neither an upper nor a lower bound. Re-image the gel at a shorter exposure before reporting a purity for this lane.`);
}

/**
 * Bind each gel lane to at most one purification stage.
 *
 * An explicit `stageId` from the engine wins. Otherwise the lane's printed
 * label is matched against the stage names, and the match must be *unique* —
 * with stages "Pre SEC pool" and "Post SEC pool", a lane called "SEC pool"
 * names both and is left unbound with a caveat rather than silently lending
 * its purity to whichever stage happens to come first.
 */
function bindStages(
  rows: PurityRow[],
  lanes: JsonObject[],
  stages: { id: string; stage: string }[],
  flags: ReportFlag[],
) {
  const explicit = new Set<PurityRow>();
  rows.forEach((row, index) => {
    const lane = lanes[index] ?? {};
    const stageId = String(lane.stageId ?? "");
    if (stageId && stages.some((stage) => stage.id === stageId)) {
      row.matchedStage = stageId;
      explicit.add(row);
      return;
    }
    const needle = String(lane.sampleLabel ?? lane.label ?? row.lane).trim().toLowerCase();
    if (!needle) return;
    const exact = stages.filter((stage) => stage.stage.trim().toLowerCase() === needle);
    const candidates = exact.length
      ? exact
      : stages.filter((stage) => {
        const name = stage.stage.trim().toLowerCase();
        return needle.includes(name) || name.includes(needle);
      });
    if (candidates.length === 1) {
      row.matchedStage = candidates[0].id;
      return;
    }
    if (candidates.length > 1 && !row.isLadder) {
      row.flags.push(flag("caution", `Gel · ${row.lane}`, "Lane name matches more than one purification stage",
        `"${row.lane}" names ${candidates.map((stage) => `"${stage.stage}"`).join(" and ")}, so its purity is not assigned to any of them. Rename the lane to one stage exactly, or bind it to a stage in Gel densitometry.`));
    }
  });

  // Two lanes on one stage is the same ambiguity one level up: the yield table
  // can print one purity per stage, so an inferred collision binds neither.
  for (const stage of stages) {
    const claiming = rows.filter((row) => !row.isLadder && row.matchedStage === stage.id);
    if (claiming.length < 2) continue;
    // An explicit binding is a deliberate assertion, so the first one keeps
    // the stage. Names that merely collide bind nothing.
    const keep = claiming.find((row) => explicit.has(row)) ?? null;
    for (const row of claiming) if (row !== keep) row.matchedStage = "";
    const named = claiming.map((row) => `"${row.lane}"`).join(", ");
    flags.push(flag("caution", "Gel densitometry", `More than one lane claims the "${stage.stage}" stage`,
      keep
        ? `${named} all resolve to this stage. The yield table uses "${keep.lane}", the lane explicitly bound to it; the others are left unassigned.`
        : `${named} all resolve to this stage by name, so none of them is used for its purity. Bind the intended lane to the stage in Gel densitometry.`));
  }

  const unmatched = rows.filter((row) => !row.isLadder && row.purityPercent !== null && !row.matchedStage);
  if (unmatched.length) {
    flags.push(flag("note", "Gel densitometry", `${unmatched.length} quantified lane${unmatched.length === 1 ? "" : "s"} not tied to a purification stage`,
      `Name the lane after the stage it was loaded from (${unmatched.map((row) => row.lane).join(", ")}) so its purity appears in the yield table.`));
  }
}

/* ========================================================================
   SEC molecular mass from the chromatogram
   ======================================================================== */

function buildSec(bundle: ProteinBundle): SecSummary | null {
  const job = bundle.projectJobs.find((value) => value.appType === "chromatogram-studio");
  if (!job) return null;
  const config = job.config;
  const plan = jobConfig(bundle, "purification-sec");
  const fitValue = fitOf(config.calibration);
  const standards = array(config.standards).filter((value) => value.included !== false && (numeric(value.mwDa) ?? 0) > 0);
  const masses = standards.map((value) => (numeric(value.mwDa) ?? 0) / 1000).filter((value) => value > 0).sort((a, b) => a - b);
  const calibratedRangeKDa: [number, number] | null = masses.length >= 2 ? [masses[0], masses[masses.length - 1]] : null;
  const peaks = array(config.peaks);
  const areaTotal = peaks.reduce((sum, peak) => sum + Math.abs(numeric(peak.area) ?? 0), 0);
  const flags: ReportFlag[] = [
    ...engineFlags(config, "Size-exclusion chromatography"),
    ...engineFlags(asObject(config.calibration), "SEC calibration"),
  ];
  const fit = fitValue ? { ...fitValue, standards: standards.length } : null;

  if (!fit) {
    flags.push(flag("warning", "SEC calibration", "The column is not calibrated",
      "No size-exclusion calibration was stored with this chromatogram, so no molecular mass is reported. Enter at least two standards with their elution volumes in Chromatogram Studio."));
  } else {
    if (fit.r2 < 0.98) {
      flags.push(flag("warning", "SEC calibration", `Calibration R² is ${fit.r2.toFixed(4)}`,
        "A Kav against log₁₀(Mr) fit below R² 0.98 does not support a molecular mass to two significant figures. Re-check the standards' elution volumes and the void volume."));
    }
    if (fit.standards < 3) {
      flags.push(flag("caution", "SEC calibration", `Only ${fit.standards} standards are included`,
        "Two points always fit a straight line exactly. Include at least three standards spanning the expected mass before quoting a mass."));
    }
  }

  const peakRows: SecPeakRow[] = peaks.map((peak, index) => {
    const name = String(peak.name ?? `Peak ${index + 1}`);
    const kav = numeric(peak.kav);
    const assigned = assignedMass(peak, fit !== null);
    const mwKDa = assigned.mwKDa;
    const peakFlags: ReportFlag[] = [];
    // A mass the project saved but the calibration cannot support is withheld
    // from the table, and the reason is printed in its place.
    if (assigned.reason && assigned.savedKDa !== null) {
      peakFlags.push(flag("warning", `SEC · ${name}`, "A saved apparent mass is not reported",
        `${assigned.reason} The ${formatMass(assigned.savedKDa)} stored with this peak is withheld rather than printed as a result.`));
    }
    if (kav !== null && kav <= 0) {
      peakFlags.push(flag("warning", `SEC · ${name}`, "Eluted at or before the void volume",
        "Material excluded from the resin has no defined Kav, so no molecular mass can be assigned. This peak is aggregate or void-volume material."));
    } else if (kav !== null && kav >= 1) {
      peakFlags.push(flag("warning", `SEC · ${name}`, "Eluted at or after the total column volume",
        "An elution volume beyond Vt is outside the separation range of the column; the assigned mass is not meaningful."));
    }
    if (mwKDa !== null && calibratedRangeKDa) {
      const [low, high] = calibratedRangeKDa;
      if (mwKDa < low || mwKDa > high) {
        peakFlags.push(flag("warning", `SEC · ${name}`, `Mass is outside the calibrated range`,
          `${formatMass(mwKDa)} is extrapolated beyond the ${formatMass(low)}–${formatMass(high)} window covered by the included standards. Add a standard that brackets this peak.`));
      }
    }
    if (mwKDa !== null && fit && fit.r2 < 0.98) {
      peakFlags.push(flag("caution", `SEC · ${name}`, "Mass inherits the calibration uncertainty",
        `Reported as ${formatMass(mwKDa)} from a fit with R² ${fit.r2.toFixed(4)}.`));
    }
    const expected = numeric(plan.expectedMassKDa);
    if (mwKDa !== null && expected !== null && expected > 0 && (mwKDa / expected > 1.7 || mwKDa / expected < 0.6)) {
      peakFlags.push(flag("caution", `SEC · ${name}`, "Apparent mass differs from the expected mass",
        `${formatMass(mwKDa)} against an expected ${formatMass(expected)}. Consider oligomeric state, a non-globular shape, or a calibration error before reporting either number.`));
    }
    peakFlags.push(...engineFlags(peak, `SEC · ${name}`));
    return {
      id: String(peak.id ?? index),
      name,
      veMl: numeric(peak.apexX),
      kav,
      mwKDa,
      mwSuppressedReason: assigned.reason,
      areaPercent: areaTotal > 0 ? (Math.abs(numeric(peak.area) ?? 0) / areaTotal) * 100 : null,
      fraction: String(peak.fraction ?? ""),
      flags: peakFlags,
    };
  });

  return {
    columnName: String(config.columnName ?? plan.columnName ?? ""),
    voMl: numeric(config.vo),
    vtMl: numeric(config.vt) ?? numeric(plan.vt),
    flowMlMin: numeric(plan.recommendedFlowMlMin),
    sampleVolumeMl: numeric(plan.sampleVolumeMl),
    expectedMassKDa: numeric(plan.expectedMassKDa),
    fit,
    calibratedRangeKDa,
    peaks: peakRows,
    flags,
  };
}

export type MassAssignment = {
  /** The mass the report may print. Null whenever the calibration cannot support one. */
  mwKDa: number | null;
  /** The mass the project has stored, valid or not, for an explanatory caveat. */
  savedKDa: number | null;
  /** Why no mass is printed, when the project has one stored. Empty when none is. */
  reason: string;
};

/**
 * The one place that decides whether a peak's saved apparent mass may be
 * printed at all.
 *
 * A project keeps the last mass it computed. Deleting the standards, or saving
 * a run whose calibration never existed, leaves that number behind — so a
 * report that reads `peak.mwKDa` directly will print "100 kDa" on the same
 * page that says the column is uncalibrated. The table and the figure both
 * route through here so they cannot disagree about which masses are real.
 */
export function assignedMass(peak: JsonObject, calibrated: boolean): MassAssignment {
  const savedKDa = numeric(peak.mwKDa);
  if (savedKDa === null) return { mwKDa: null, savedKDa: null, reason: "" };
  const withheld = (reason: string) => ({ mwKDa: null, savedKDa, reason });
  if (!calibrated) {
    return withheld("The column has no stored size-exclusion calibration, so no elution volume can be converted to a mass.");
  }
  if (savedKDa <= 0) {
    return withheld("The stored mass is not a positive value.");
  }
  const kav = numeric(peak.kav);
  if (kav !== null && (kav <= 0 || kav >= 1)) {
    return withheld("The peak eluted outside the column's separation range, where the calibration does not apply.");
  }
  return { mwKDa: savedKDa, savedKDa, reason: "" };
}

/** Whether a saved chromatogram carries a calibration that can assign masses. */
export function secCalibrated(config: JsonObject): boolean {
  return fitOf(config.calibration) !== null;
}

/* ========================================================================
   Methods a reader could follow
   ======================================================================== */

function buildMethods(bundle: ProteinBundle): MethodBlock[] {
  const blocks: MethodBlock[] = [];
  const host = jobConfig(bundle, "expression-system");
  const vector = jobConfig(bundle, "expression-planning");
  const run = jobConfig(bundle, "transformation-expression");
  const lysis = jobConfig(bundle, "purification-lysis");
  const affinity = jobConfig(bundle, "purification-affinity");
  const cleavage = jobConfig(bundle, "purification-cleavage");
  const cleanup = jobConfig(bundle, "purification-subtractive");
  const sec = jobConfig(bundle, "purification-sec");
  const storage = jobConfig(bundle, "purification-buffer");

  push(blocks, {
    id: "expression",
    title: "Expression",
    summary: "Host, vector, medium, and induction.",
    lines: [
      line("Host strain", text(host.strainName ?? host.hostSystem)),
      line("Host system", text(host.hostSystem)),
      line("Promoter and induction", text(host.promoter)),
      line("Expression vector", text(vector.vectorName ?? host.vectorFamilyName)),
      line("Medium", text(run.mediaName)),
      line("Induction", text(run.inductionSummary ?? run.induction)),
      line("Harvest", text(run.harvestSummary ?? run.harvest)),
    ],
    source: host,
  });

  push(blocks, {
    id: "lysis",
    title: "Lysis and clarification",
    summary: text(lysis.mechanism),
    lines: [
      line("Method", text(lysis.methodName)),
      line("Mechanism", text(lysis.mechanism)),
      ...bufferLines("Lysis buffer", lysis),
    ],
    source: lysis,
  });

  push(blocks, {
    id: "affinity",
    title: "Affinity capture",
    summary: text(affinity.ligand),
    lines: [
      line("Column or resin", text(affinity.columnName ?? affinity.shortName)),
      line("Affinity tag", text(affinity.tag)),
      line("Immobilised ligand", text(affinity.ligand)),
      line("Binding conditions", text(affinity.binding)),
      line("Wash", text(affinity.wash)),
      line("Elution", text(affinity.elution)),
      ...bufferLines("Capture buffer", affinity),
    ],
    source: affinity,
  });

  push(blocks, {
    id: "cleavage",
    title: "Affinity-tag cleavage",
    summary: text(cleavage.summary ?? cleavage.conditions),
    lines: [
      line("Protease", text(cleavage.proteaseName)),
      line("Recognition site", text(cleavage.recognition ?? cleavage.recognitionSite)),
      line("Conditions", text(cleavage.conditions)),
      line("Tag and protease removal", text(cleavage.removal)),
      ...bufferLines("Cleavage buffer", cleavage),
    ],
    source: cleavage,
  });

  push(blocks, {
    id: "cleanup",
    title: "Subtractive cleanup",
    summary: text(cleanup.ligand),
    lines: [
      line("Column or resin", text(cleanup.columnName ?? cleanup.shortName)),
      line("Captured species", text(cleanup.tag)),
      line("Binding conditions", text(cleanup.binding)),
      line("Wash", text(cleanup.wash)),
      line("Elution of bound species", text(cleanup.elution)),
      ...bufferLines("Cleanup buffer", cleanup),
    ],
    source: cleanup,
  });

  push(blocks, {
    id: "sec",
    title: "Size-exclusion polishing",
    summary: text(sec.description),
    lines: [
      line("Column", text(sec.columnName ?? sec.shortName)),
      line("Format", text(sec.format)),
      line("Total column volume", quantity(sec.vt, "mL")),
      line("Fractionation range", sec.minKDa === null || sec.minKDa === undefined ? "" : `${text(sec.minKDa)}–${text(sec.maxKDa)} kDa for globular proteins`),
      line("Flow rate", quantity(sec.recommendedFlowMlMin, "mL/min")),
      line("Injection volume", quantity(sec.sampleVolumeMl, "mL")),
      line("Expected native mass", quantity(sec.expectedMassKDa, "kDa")),
      ...bufferLines("Running buffer", sec),
    ],
    source: sec,
  });

  push(blocks, {
    id: "storage",
    title: "Formulation and storage",
    summary: "",
    lines: [...bufferLines("Storage buffer", storage, storage.presetName)],
    source: storage,
  });

  return blocks;
}

/** A buffer printed as a formula a reader could weigh out. */
function bufferLines(label: string, source: JsonObject, fallbackName?: unknown): MethodLine[] {
  const components = array(source.bufferComponents);
  const name = text(source.bufferName ?? fallbackName);
  const formula = components
    .map((item) => `${text(item.concentration)} ${text(item.unit, "")} ${text(item.name, "")}`.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(", ");
  const pH = source.bufferPH;
  return [
    // A buffer whose catalogue name is just its role ("Lysis buffer") would
    // otherwise print the label twice.
    line(label, name.toLowerCase() === label.toLowerCase() ? "" : name),
    line(`${label} composition`, formula),
    line(`${label} pH`, pH === null || pH === undefined || pH === "" ? "" : String(pH)),
  ];
}

function push(blocks: MethodBlock[], input: { id: string; title: string; summary: string; lines: MethodLine[]; source: JsonObject }) {
  const lines = input.lines.filter((value) => value.value && value.value !== "—");
  if (!lines.length) return;
  const flags: ReportFlag[] = [];
  // A planning job that saved as a draft carries its own blocking findings;
  // a methods section must not read as settled while that is true.
  const status = String(input.source.compatibilityStatus ?? "");
  if (status === "blocked" || status === "review") {
    for (const check of array(input.source.compatibilityChecks)) {
      if (check.level !== "error" && check.level !== "warning") continue;
      flags.push(flag(check.level === "error" ? "warning" : "caution", `Methods · ${input.title}`,
        String(check.title ?? "Compatibility finding"), String(check.detail ?? "")));
    }
  }
  if (!array(input.source.bufferComponents).length && input.source.bufferName) {
    flags.push(flag("note", `Methods · ${input.title}`, "Buffer composition not recorded",
      `${text(input.source.bufferName)} is named but has no component list, so this step cannot be repeated from the report alone.`));
  }
  blocks.push({ id: input.id, title: input.title, summary: input.summary, lines, flags });
}

/* ========================================================================
   Helpers
   ======================================================================== */

/** Engine-supplied flags on any record, read optimistically. */
function engineFlags(record: JsonObject, scope: string): ReportFlag[] {
  const flags: ReportFlag[] = [];
  for (const raw of array(record.flags)) {
    const title = raw.title ? String(raw.title) : humanize(String(raw.code ?? "")) || "Engine flag";
    flags.push(flag(level(raw.level), scope, title, String(raw.message ?? raw.detail ?? "")));
  }
  for (const value of Array.isArray(record.flags) ? record.flags.filter((item) => typeof item === "string") : []) {
    flags.push(flag("warning", scope, humanize(value) || value, "Reported by the analysis engine for this measurement."));
  }
  // Saturation is the one caveat the engines report both ways while the new
  // flag fields land. Printing the boolean as well would say it twice.
  const saturationReported = flags.some((item) => /saturat/i.test(item.title));
  if (record.saturated === true && !saturationReported) {
    // What saturation does to a *ratio* depends on which side of it this
    // measurement sits, so that is decided per lane in saturationBound rather
    // than asserted here.
    flags.push(flag("warning", scope, "Saturated signal",
      `The engine reports this measurement as saturated, so its integrated density understates the material in it. ${reasonText(record.saturationReason)}`.trim()));
  }
  return flags;
}

/** An engine-supplied reason, as a sentence, or nothing when none was given. */
function reasonText(value: unknown) {
  const reason = text(value).trim();
  if (!reason) return "";
  const sentence = /^[a-z_-]+$/.test(reason) ? humanize(reason) : reason;
  return /[.!?]$/.test(sentence) ? sentence : `${sentence}.`;
}

/** `band_saturated` is a key, not a sentence a reader should have to decode. */
function humanize(code: string) {
  const words = code.trim().replace(/[_-]+/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase().trim();
  return words ? words.charAt(0).toUpperCase() + words.slice(1) : "";
}

function level(value: unknown): FlagLevel {
  const name = String(value ?? "").toLowerCase();
  if (name === "warning" || name === "error") return "warning";
  if (name === "note" || name === "info") return "note";
  return "caution";
}

// Flag identity is derived from what the flag says, so re-deriving the report
// from an unchanged project produces the same keys.
function flag(level: FlagLevel, scope: string, title: string, detail: string): ReportFlag {
  return { id: `${scope}::${title}`, level, scope, title, detail };
}

export function jobConfig(bundle: ProteinBundle, appType: string): JsonObject {
  return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {};
}

export function reportJob(bundle: ProteinBundle, appType: string): ProjectJob | undefined {
  return bundle.projectJobs.find((job) => job.appType === appType);
}

function fitOf(value: unknown) {
  const fit = asObject(value);
  const slope = numeric(fit.slope);
  const intercept = numeric(fit.intercept);
  const r2 = numeric(fit.r2 ?? fit.rSquared);
  return slope === null || intercept === null || r2 === null ? null : { slope, intercept, r2 };
}

function hasTypedValue(entry: YieldEntry) {
  return Boolean(entry.volumeMl || entry.concentrationMgMl || entry.totalProteinMg || entry.purityPercent || entry.note);
}

function pick(value: string | undefined, fallback: number | null) {
  const parsed = numeric(value);
  return parsed === null ? fallback : parsed;
}

function numeric(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string" || !value.trim()) return null;
  const parsed = Number(value.trim().replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function line(label: string, value: string): MethodLine {
  return { label, value };
}

function quantity(value: unknown, unit: string) {
  const parsed = numeric(value);
  return parsed === null ? "" : `${trim(parsed)} ${unit}`;
}

function text(value: unknown, fallback = "") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}

function trim(value: number) {
  return Number(value.toFixed(4)).toString();
}

export function formatMass(kDa: number) {
  return kDa >= 100 ? `${kDa.toFixed(0)} kDa` : kDa >= 10 ? `${kDa.toFixed(1)} kDa` : `${kDa.toFixed(2)} kDa`;
}

/**
 * A purity as the reader should see it: a bound prints as a bound, and a
 * figure saturation has made meaningless says so beside the number.
 */
export function formatPurity(percent: number | null, bound: PurityBound) {
  if (percent === null) return "—";
  const shown = `${percent.toFixed(1)}%`;
  if (bound === "lower") return `≥ ${shown}`;
  if (bound === "upper") return `≤ ${shown}`;
  if (bound === "unreliable") return `${shown} (unreliable)`;
  return shown;
}

export function formatNumber(value: number | null, digits: number, unit = "") {
  if (value === null) return "—";
  const body = value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
  return unit ? `${body} ${unit}` : body;
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

export function array(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item))
    : [];
}

/** The yield rows a saved report carries, normalised from notebook data. */
export function loadYieldEntries(value: unknown): YieldEntry[] {
  return array(value).map((raw) => ({
    id: String(raw.id ?? ""),
    stage: String(raw.stage ?? ""),
    volumeMl: String(raw.volumeMl ?? ""),
    concentrationMgMl: String(raw.concentrationMgMl ?? ""),
    totalProteinMg: String(raw.totalProteinMg ?? ""),
    purityPercent: String(raw.purityPercent ?? ""),
    yieldMethod: String(raw.yieldMethod ?? ""),
    purityMethod: String(raw.purityMethod ?? ""),
    note: String(raw.note ?? ""),
  })).filter((entry) => entry.id);
}

export function emptyYieldEntry(id: string, stage: string): YieldEntry {
  return { id, stage, volumeMl: "", concentrationMgMl: "", totalProteinMg: "", purityPercent: "", yieldMethod: "", purityMethod: "", note: "" };
}
