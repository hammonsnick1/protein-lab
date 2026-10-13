"use client";

import { TriangleAlert } from "lucide-react";
import { dedupe } from "@/lib/report-print";
import { formatMass, formatNumber, type PuritySummary, type ReportData, type ReportFlag, type SecSummary, type YieldEntry, type YieldRow } from "@/lib/report-data";

/**
 * The parts of the report that are calculated rather than typed.
 *
 * Each block renders from `ReportData`, the report's single data-access layer,
 * so the screen and the exported document always agree. Numbers that carry a
 * caveat are marked where they are printed and spelled out in full on the
 * caveats page; nothing is rounded into looking clean.
 */

/* ========================================================================
   Yield
   ======================================================================== */

export function YieldBlock({
  rows,
  entries,
  onEntryChange,
}: {
  rows: YieldRow[];
  entries: YieldEntry[];
  onEntryChange: (id: string, patch: Partial<YieldEntry>) => void;
}) {
  if (!rows.length) {
    return <p className="report-missing">
      No purification stages are recorded yet. Build the purification roadmap, or save the
      planning jobs, and every stage appears here as a row to fill in.
    </p>;
  }
  const entryFor = (id: string) => entries.find((value) => value.id === id);
  return <section className="report-data-block">
    <h3>Yield across the purification</h3>
    <table className="report-data-table report-yield-table">
      <thead>
        <tr>
          <th scope="col">Stage</th>
          <th scope="col" className="num">Volume (mL)</th>
          <th scope="col" className="num">Conc. (mg/mL)</th>
          <th scope="col" className="num">Total protein (mg)</th>
          <th scope="col" className="num">Step</th>
          <th scope="col" className="num">Overall</th>
          <th scope="col" className="num">Purity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => {
          const entry = entryFor(row.id);
          return <tr key={row.id}>
            <th scope="row">
              <span className="report-stage-name">{row.stage}<FlagMark flags={row.flags}/></span>
              {row.source && <small>{row.source}</small>}
            </th>
            <td className="num">
              <input
                inputMode="decimal"
                aria-label={`${row.stage} volume in millilitres`}
                value={entry?.volumeMl ?? ""}
                placeholder={row.volumeMl === null ? "—" : formatNumber(row.volumeMl, 1)}
                onChange={(event) => onEntryChange(row.id, { volumeMl: event.target.value })}
              />
            </td>
            <td className="num">
              <input
                inputMode="decimal"
                aria-label={`${row.stage} concentration in milligrams per millilitre`}
                value={entry?.concentrationMgMl ?? ""}
                placeholder={row.concentrationMgMl === null ? "—" : formatNumber(row.concentrationMgMl, 2)}
                onChange={(event) => onEntryChange(row.id, { concentrationMgMl: event.target.value })}
              />
            </td>
            <td className="num">
              <input
                inputMode="decimal"
                aria-label={`${row.stage} total protein in milligrams`}
                value={entry?.totalProteinMg ?? ""}
                placeholder={row.totalProteinMg === null ? "—" : formatNumber(row.totalProteinMg, 2)}
                onChange={(event) => onEntryChange(row.id, { totalProteinMg: event.target.value })}
              />
            </td>
            <td className="num report-derived">{row.stepRecoveryPercent === null ? "—" : `${row.stepRecoveryPercent.toFixed(0)}%`}</td>
            <td className="num report-derived">{row.overallRecoveryPercent === null ? "—" : `${row.overallRecoveryPercent.toFixed(0)}%`}</td>
            <td className="num">
              <input
                inputMode="decimal"
                aria-label={`${row.stage} purity as a percentage`}
                value={entry?.purityPercent ?? ""}
                placeholder={row.purityPercent === null ? "—" : `${row.purityPercent.toFixed(1)}`}
                onChange={(event) => onEntryChange(row.id, { purityPercent: event.target.value })}
              />
            </td>
          </tr>;
        })}
      </tbody>
    </table>
    <p className="report-table-note">
      Enter any two of volume, concentration, and total protein and the third is completed.
      Recovery is calculated against the first and the preceding quantified stage. Purity is
      taken from a matching gel lane where one exists and can be overridden here.
    </p>
  </section>;
}

/* ========================================================================
   Purity
   ======================================================================== */

export function PurityBlock({ purity }: { purity: PuritySummary | null }) {
  if (!purity) {
    return <p className="report-missing">
      No gel densitometry is saved for this project. Quantify a gel in Gel densitometry and
      the per-stage purity table appears here.
    </p>;
  }
  const rows = purity.rows.filter((row) => !row.isLadder);
  return <section className="report-data-block">
    <h3>Purity by stage</h3>
    {rows.length ? <table className="report-data-table">
      <thead>
        <tr>
          <th scope="col">Lane / stage</th>
          <th scope="col">Target band</th>
          <th scope="col" className="num">Apparent mass</th>
          <th scope="col" className="num">Bands</th>
          <th scope="col" className="num">Lane purity</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((row) => <tr key={row.id}>
          <th scope="row"><span className="report-stage-name">{row.lane}<FlagMark flags={row.flags}/></span></th>
          <td>{row.targetBand || "Not marked"}</td>
          <td className="num">{row.targetMwKDa === null ? "—" : formatMass(row.targetMwKDa)}</td>
          <td className="num">{row.bandCount}</td>
          <td className="num">{row.purityPercent === null ? "—" : `${row.purityPercent.toFixed(1)}%`}</td>
        </tr>)}
      </tbody>
    </table> : <p className="report-missing">The saved gel has no quantified sample lanes.</p>}
    <dl className="report-property-grid">
      <div><dt>Method</dt><dd>{purity.method}</dd></div>
      <div><dt>Ladder</dt><dd>{purity.ladderPreset || "Not recorded"}</dd></div>
      <div className="report-wide-fact">
        <dt>Ladder calibration</dt>
        <dd>{purity.calibration
          ? `log₁₀(Mr) = ${purity.calibration.slope.toFixed(4)} Rf + ${purity.calibration.intercept.toFixed(4)} · R² ${purity.calibration.r2.toFixed(4)}`
          : "Not calibrated"}</dd>
      </div>
    </dl>
    <p className="report-table-note">
      Lane purity is the integrated density of the target band as a fraction of every band
      detected in that lane.
    </p>
  </section>;
}

/* ========================================================================
   SEC molecular mass
   ======================================================================== */

export function SecBlock({ sec }: { sec: SecSummary | null }) {
  if (!sec) {
    return <p className="report-missing">
      No chromatogram is saved for this project, so no size-exclusion molecular mass is
      reported. Save a Chromatogram Studio project with SEC standards to fill this in.
    </p>;
  }
  return <section className="report-data-block">
    <h3>Size-exclusion molecular mass</h3>
    <dl className="report-property-grid">
      <div><dt>Column</dt><dd>{sec.columnName || "Not recorded"}</dd></div>
      <div><dt>V₀ / Vt</dt><dd>{sec.voMl === null || sec.vtMl === null ? "—" : `${formatNumber(sec.voMl, 2)} / ${formatNumber(sec.vtMl, 2)} mL`}</dd></div>
      <div><dt>Flow rate</dt><dd>{sec.flowMlMin === null ? "—" : `${formatNumber(sec.flowMlMin, 2)} mL/min`}</dd></div>
      <div><dt>Injection volume</dt><dd>{sec.sampleVolumeMl === null ? "—" : `${formatNumber(sec.sampleVolumeMl, 3)} mL`}</dd></div>
      <div><dt>Expected native mass</dt><dd>{sec.expectedMassKDa === null ? "—" : formatMass(sec.expectedMassKDa)}</dd></div>
      <div>
        <dt>Fit quality</dt>
        <dd>{sec.fit ? `R² ${sec.fit.r2.toFixed(4)} · n = ${sec.fit.standards}` : "Not calibrated"}</dd>
      </div>
      <div className="report-wide-fact">
        <dt>Calibration</dt>
        <dd>{sec.fit
          ? `Kav = ${sec.fit.slope.toFixed(4)} log₁₀(Mr) + ${sec.fit.intercept.toFixed(4)}`
          : "No standards with elution volumes are included"}</dd>
      </div>
      <div className="report-wide-fact">
        <dt>Calibrated mass range</dt>
        <dd>{sec.calibratedRangeKDa
          ? `${formatMass(sec.calibratedRangeKDa[0])} – ${formatMass(sec.calibratedRangeKDa[1])}`
          : "Fewer than two standards"}</dd>
      </div>
    </dl>
    {sec.peaks.length ? <table className="report-data-table">
      <thead>
        <tr>
          <th scope="col">Peak</th>
          <th scope="col" className="num">Vₑ (mL)</th>
          <th scope="col" className="num">Kav</th>
          <th scope="col" className="num">Apparent mass</th>
          <th scope="col" className="num">Area</th>
          <th scope="col">Fraction</th>
        </tr>
      </thead>
      <tbody>
        {sec.peaks.map((peak) => <tr key={peak.id}>
          <th scope="row"><span className="report-stage-name">{peak.name}<FlagMark flags={peak.flags}/></span></th>
          <td className="num">{formatNumber(peak.veMl, 2)}</td>
          <td className="num">{peak.kav === null ? "—" : peak.kav.toFixed(3)}</td>
          <td className="num">{peak.mwKDa === null ? "Not assigned" : formatMass(peak.mwKDa)}</td>
          <td className="num">{peak.areaPercent === null ? "—" : `${peak.areaPercent.toFixed(1)}%`}</td>
          <td>{peak.fraction || "—"}</td>
        </tr>)}
      </tbody>
    </table> : <p className="report-missing">No peaks were integrated on the saved chromatogram.</p>}
    <p className="report-table-note">
      Apparent mass comes from the Kav against log₁₀(Mr) calibration and refers to globular
      standards; it is an elution behaviour, not a mass measurement.
    </p>
  </section>;
}

/* ========================================================================
   Methods
   ======================================================================== */

export function MethodsBlock({ data }: { data: ReportData }) {
  if (!data.methods.length) {
    return <p className="report-missing">
      No purification steps are planned yet, so there is nothing to describe as a method.
    </p>;
  }
  return <div className="report-methods">
    {data.methods.map((block) => <section key={block.id} className="report-data-block">
      <h3>{block.title}</h3>
      {block.summary && <p className="report-method-summary">{block.summary}</p>}
      <dl className="report-property-grid report-method-grid">
        {block.lines.map((line) => <div key={line.label} className="report-wide-fact">
          <dt>{line.label}</dt><dd>{line.value}</dd>
        </div>)}
      </dl>
    </section>)}
  </div>;
}

/* ========================================================================
   Caveats
   ======================================================================== */

export function CaveatsBlock({ flags }: { flags: ReportFlag[] }) {
  const unique = dedupe(flags);
  if (!unique.length) {
    return <p className="report-missing">
      The analysis engines raised no flags on the numbers in this report.
    </p>;
  }
  return <section className="report-data-block">
    <h3>Caveats and engine flags</h3>
    <ul className="report-flag-list">
      {unique.map((item) => <li key={item.id} className={`level-${item.level}`}>
        <p className="report-flag-head">
          <span>{item.level === "warning" ? "Flag" : item.level === "caution" ? "Caution" : "Note"}</span>
          {item.scope}
        </p>
        <strong>{item.title}</strong>
        {item.detail && <small>{item.detail}</small>}
      </li>)}
    </ul>
  </section>;
}

/** The mark that follows a flagged number wherever it is printed. */
export function FlagMark({ flags }: { flags: ReportFlag[] }) {
  if (!flags.length) return null;
  const worst = flags.some((item) => item.level === "warning") ? "warning" : "caution";
  const title = flags.map((item) => item.title).join(" · ");
  return <span className={`report-flag-mark ${worst}`} title={title} aria-label={`Flagged: ${title}`}>
    <TriangleAlert aria-hidden="true"/>
  </span>;
}
