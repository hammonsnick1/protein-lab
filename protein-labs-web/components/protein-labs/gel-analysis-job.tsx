"use client";

import { PointerEvent, useMemo, useRef, useState } from "react";
import {
  CircleAlert,
  Download,
  Info,
  LoaderCircle,
  MousePointer2,
  Plus,
  Save,
  ScanLine,
  TestTubeDiagonal,
  Trash2,
  Upload,
  WandSparkles,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import type {
  GelAnalyzeRequest,
  GelBand,
  GelLadderCalibration,
  GelLane,
  GelQuantification,
} from "@/lib/gel-api";
import { gelApi } from "@/lib/gel-api";
import type { DetectionSettings } from "@/lib/gel-quantification";
import {
  bandQuantification,
  bandQuantificationNote,
  bandsInLane,
  calibrationStale,
  formatDensity,
  formatSignalFraction,
  gelCsvRows,
  invalidateLaneFractions,
  ladderCalibrationSummary,
  ladderMassesError,
  ladderMassesKDa,
  laneQuantification,
  LADDER_PRESETS,
  MAX_BACKGROUND_RADIUS_PX,
  MIN_BACKGROUND_RADIUS_PX,
  molecularWeightLabel,
  normalizationBasisDetail,
  readGelAnalysis,
  readGelJobConfig,
  reanalysisReasons,
  SIGNAL_FRACTION_CAVEAT,
} from "@/lib/gel-quantification";

type Mode = "select" | "lane" | "band";
type Panel = "setup" | "ladder" | "method";
type Tone = "info" | "error";

// Every number this studio shows is read from the Python densitometry engine.
// The three rules that shape the component:
//   1. A density, lane fraction or molecular weight the engine withheld is
//      shown as unavailable with its reason. It is never replaced by 0, by a
//      local re-normalization over the bands that did quantify, or by a local
//      ladder fit.
//   2. Editing a lane retires that lane's engine-reported fractions instead of
//      recomputing them, because the normalization covered the band set the
//      engine actually integrated.
//   3. Changing a detection or ladder input marks the result out of date and
//      asks for re-detection rather than extrapolating from the old fit.
export function GelAnalysisJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = useMemo(
    () => readGelJobConfig(bundle.projectJobs.find((job) => job.appType === "gel-analysis")?.config ?? {}),
    [bundle.projectJobs],
  );

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState(saved.previewBase64 ? `data:image/png;base64,${saved.previewBase64}` : "");
  const [filename, setFilename] = useState(saved.filename);
  const [gelType, setGelType] = useState(saved.gelType);
  const [origin, setOrigin] = useState(saved.origin);
  const [front, setFront] = useState(saved.dyeFront);
  const [sensitivity, setSensitivity] = useState(saved.sensitivity);
  const [backgroundRadius, setBackgroundRadius] = useState(saved.backgroundRadiusPx);
  const [ladderPreset, setLadderPreset] = useState(saved.ladderPreset);
  const [customWeights, setCustomWeights] = useState(
    saved.customWeights || saved.ladderMassesKDa.join(", ") || "250, 150, 100, 75, 50, 37, 25, 20, 15, 10",
  );
  const [lanes, setLanes] = useState<GelLane[]>(saved.lanes);
  const [bands, setBands] = useState<GelBand[]>(saved.bands);
  const [quantification, setQuantification] = useState<GelQuantification | null>(saved.quantification);
  const [calibration, setCalibration] = useState<GelLadderCalibration | null>(saved.ladderCalibration);
  // The inputs the displayed result was actually produced from. Null until this
  // image has been analyzed in this session or a saved analysis was reloaded.
  const [analyzed, setAnalyzed] = useState<DetectionSettings | null>(
    saved.bands.length
      ? {
          sensitivity: saved.sensitivity,
          backgroundRadiusPx: saved.backgroundRadiusPx,
          ladderMassesKDa: saved.ladderMassesKDa,
          ladderLaneId: saved.ladderLaneId,
        }
      : null,
  );
  const [selectedLane, setSelectedLane] = useState(saved.lanes[0]?.id ?? "");
  const [selectedBand, setSelectedBand] = useState("");
  const [mode, setMode] = useState<Mode>("select");
  const [panel, setPanel] = useState<Panel>("setup");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState(
    saved.bands.length
      ? `Reloaded ${saved.bands.length} bands measured by the engine on ${saved.filename}.`
      : "Import an SDS-PAGE or Native PAGE image to begin.",
  );
  const [tone, setTone] = useState<Tone>("info");
  const stage = useRef<HTMLDivElement>(null);
  const drag = useRef<number | null>(null);

  const masses = useMemo(() => ladderMassesKDa(ladderPreset, customWeights), [ladderPreset, customWeights]);
  const massError = ladderMassesError(masses);
  const ladderLaneId = lanes.find((lane) => lane.isLadder)?.id ?? "";
  const settings: DetectionSettings = {
    sensitivity,
    backgroundRadiusPx: backgroundRadius,
    ladderMassesKDa: masses,
    ladderLaneId,
  };
  const pending = reanalysisReasons(settings, analyzed);
  const weightsStale = calibrationStale(settings, analyzed);
  const lane = lanes.find((item) => item.id === selectedLane);
  const laneBands = bandsInLane(bands, selectedLane);
  const band = bands.find((item) => item.id === selectedBand);
  const verdict = laneQuantification(laneBands);
  const calibrationSummary = ladderCalibrationSummary(calibration);
  const canAnalyze = Boolean(file) && !busy;

  function report(text: string, next: Tone = "info") {
    setMessage(text);
    setTone(next);
  }

  function choose(value: File | null) {
    setFile(value);
    if (!value) return;
    // A TIFF cannot be shown by the browser; the engine returns a PNG preview.
    if (!/\.tiff?$/i.test(value.name)) setPreview(URL.createObjectURL(value));
    setFilename(value.name);
    setLanes([]);
    setBands([]);
    setQuantification(null);
    setCalibration(null);
    setAnalyzed(null);
    setSelectedLane("");
    setSelectedBand("");
    report(`${value.name} is ready. Detect lanes and bands to measure it.`);
  }

  async function analyze(curatedLanes: GelLane[]) {
    if (!file) {
      report("Re-import the original image to run detection on it.", "error");
      return;
    }
    setBusy(true);
    report("Measuring lane profiles, rolling-ball background and band integrals on the engine…");
    try {
      const body: GelAnalyzeRequest = {
        filename: file.name,
        imageBase64: await fileToBase64(file),
        sensitivity,
        backgroundRadiusPx: backgroundRadius,
        ...(curatedLanes.length ? { lanes: curatedLanes } : {}),
        // Sent in full, top to bottom. The engine reports a count mismatch
        // rather than pairing a truncated list against detected markers.
        ...(massError ? {} : { ladderMassesKDa: masses }),
      };
      const analysis = readGelAnalysis(await gelApi.analyze(body));
      setLanes(analysis.lanes);
      setBands(analysis.bands);
      setQuantification(analysis.quantification);
      setCalibration(analysis.ladderCalibration);
      setAnalyzed({
        sensitivity,
        backgroundRadiusPx: backgroundRadius,
        ladderMassesKDa: massError ? [] : masses,
        ladderLaneId: analysis.lanes.find((item) => item.isLadder)?.id ?? "",
      });
      setSelectedLane(analysis.lanes[0]?.id ?? "");
      setSelectedBand("");
      if (analysis.previewBase64) setPreview(`data:image/png;base64,${analysis.previewBase64}`);
      const refused = analysis.bands.filter((item) => item.quantificationRefused).length;
      report(
        `${analysis.lanes.length} lanes and ${analysis.bands.length} bands measured.` +
          (refused ? ` ${refused} saturated band${refused === 1 ? "" : "s"} left unquantified.` : "") +
          (massError ? " Molecular weights need a valid ladder mass list." : ""),
      );
    } catch (reason) {
      report(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }

  function normalized(event: PointerEvent) {
    const rect = stage.current!.getBoundingClientRect();
    return {
      x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)),
    };
  }

  function pointerDown(event: PointerEvent<HTMLDivElement>) {
    if (mode === "lane") {
      drag.current = normalized(event).x;
      event.currentTarget.setPointerCapture(event.pointerId);
      return;
    }
    if (mode !== "band" || !selectedLane) return;
    const point = normalized(event);
    const id = `band-manual-${crypto.randomUUID()}`;
    // A hand-drawn outline is not a measurement: it carries no density,
    // fraction or molecular weight, and it retires the lane's fractions until
    // the engine has integrated the lane as it now stands.
    const manual: GelBand = {
      id,
      laneId: selectedLane,
      label: `Band ${laneBands.length + 1}`,
      yStart: Math.max(0, point.y - 0.009),
      yEnd: Math.min(1, point.y + 0.009),
      centerY: point.y,
      peakSignal: null,
      density: null,
      laneFraction: null,
      laneFractionUncertainty: null,
      normalizationBasis: null,
      quantificationRefused: false,
      saturationReason: null,
      molecularWeightDa: null,
      molecularWeightStatus: null,
      ladderMarkerMassDa: null,
      autoDetected: false,
      isTarget: false,
      laneFractionStaleReason: null,
    };
    setBands([
      ...invalidateLaneFractions(bands, selectedLane, "A band was added by hand after the last detection."),
      manual,
    ]);
    setSelectedBand(id);
    report("Manual band added. Re-detect in lanes so the engine measures it before any fraction is reported.");
  }

  function pointerUp(event: PointerEvent<HTMLDivElement>) {
    if (drag.current === null) return;
    const x = normalized(event).x;
    const start = Math.min(drag.current, x);
    const end = Math.max(drag.current, x);
    drag.current = null;
    if (end - start < 0.015) return;
    const id = `lane-manual-${crypto.randomUUID()}`;
    setLanes([...lanes, { id, label: `Lane ${lanes.length + 1}`, xStart: start, xEnd: end, isLadder: false }]);
    setSelectedLane(id);
    setSelectedBand("");
    report("Lane added. Re-detect in lanes to measure it.");
  }

  function updateLane(id: string, patch: Partial<GelLane>) {
    setLanes(lanes.map((item) => (item.id === id ? { ...item, ...patch } : item)));
  }

  function markLadder(id: string, isLadder: boolean) {
    // One ladder lane at a time, or the engine has no unambiguous marker set.
    setLanes(lanes.map((item) => ({ ...item, isLadder: item.id === id ? isLadder : false })));
  }

  function deleteLane(id: string) {
    setLanes(lanes.filter((item) => item.id !== id));
    setBands(bands.filter((item) => item.laneId !== id));
    setSelectedLane("");
    setSelectedBand("");
  }

  function deleteBand(target: GelBand) {
    setBands(
      invalidateLaneFractions(
        bands.filter((item) => item.id !== target.id),
        target.laneId,
        `"${target.label}" was removed after the last detection.`,
      ),
    );
    setSelectedBand("");
    report("Band removed. The lane fraction is unavailable until the engine re-integrates this lane.");
  }

  function selectTarget(target: GelBand, checked: boolean) {
    // Target choice only labels a band. It never changes a measurement, and it
    // cannot make an unquantifiable lane report a fraction.
    setBands(
      bands.map((item) =>
        item.laneId === target.laneId ? { ...item, isTarget: item.id === target.id && checked } : item,
      ),
    );
  }

  async function save() {
    if (!preview) {
      report("Import and analyze a gel first.", "error");
      return;
    }
    setBusy(true);
    try {
      const config: JsonObject = {
        schemaVersion: 3,
        filename,
        previewBase64: preview.startsWith("data:image/png;base64,")
          ? preview.split(",")[1]
          : saved.previewBase64,
        gelType,
        origin,
        dyeFront: front,
        sensitivity: analyzed?.sensitivity ?? sensitivity,
        backgroundRadiusPx: analyzed?.backgroundRadiusPx ?? backgroundRadius,
        ladderPreset,
        customWeights,
        ladderMassesKDa: analyzed?.ladderMassesKDa ?? [],
        ladderLaneId: analyzed?.ladderLaneId ?? "",
        lanes,
        bands,
        quantification,
        ladderCalibration: calibration,
        calibrationIsStale: weightsStale,
        source: filename,
        savedAt: new Date().toISOString(),
        savedByUser: true,
      };
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "gel-analysis", `${gelType} analysis`, config);
      await onChanged();
      report(
        "Saved the engine's densities, refusals, uncertainties, ladder calibration and method metadata with the annotations.",
      );
    } catch (reason) {
      report(errorText(reason), "error");
    } finally {
      setBusy(false);
    }
  }

  function exportTable() {
    downloadCsv(
      `${safeName(filename)}-bands.csv`,
      gelCsvRows({ lanes, bands, quantification, ladderCalibration: calibration, calibrationIsStale: weightsStale }),
    );
  }

  return (
    <div className="gel-analysis-full">
      <section className="gel-control-panel">
        <nav>
          <button className={panel === "setup" ? "active" : ""} onClick={() => setPanel("setup")}>Setup</button>
          <button className={panel === "ladder" ? "active" : ""} onClick={() => setPanel("ladder")}>Ladder</button>
          <button className={panel === "method" ? "active" : ""} onClick={() => setPanel("method")}>Method</button>
        </nav>

        {panel === "setup" && (
          <div className="gel-controls">
            <label className="upload-button">
              <Upload /> Import PNG, JPEG, or TIFF
              <input
                type="file"
                accept="image/png,image/jpeg,image/tiff,.tif,.tiff"
                onChange={(event) => choose(event.target.files?.[0] ?? null)}
              />
            </label>
            <label>
              Gel type
              <select value={gelType} onChange={(event) => setGelType(event.target.value)}>
                <option>SDS-PAGE</option>
                <option>Native PAGE</option>
              </select>
            </label>
            <label>
              Band sensitivity · {sensitivity.toFixed(2)}
              <input
                type="range"
                min="0"
                max="1"
                step=".01"
                value={sensitivity}
                onChange={(event) => setSensitivity(Number(event.target.value))}
              />
            </label>
            <label>
              Rolling-ball radius · {backgroundRadius} px
              <input
                type="range"
                min={MIN_BACKGROUND_RADIUS_PX}
                max={MAX_BACKGROUND_RADIUS_PX}
                step="1"
                value={backgroundRadius}
                onChange={(event) => setBackgroundRadius(Number(event.target.value))}
              />
            </label>
            <label>
              Well origin guide · {(origin * 100).toFixed(1)}%
              <input
                type="range"
                min="0"
                max=".5"
                step=".005"
                value={origin}
                onChange={(event) => setOrigin(Number(event.target.value))}
              />
            </label>
            <label>
              Dye front guide · {(front * 100).toFixed(1)}%
              <input
                type="range"
                min=".5"
                max="1"
                step=".005"
                value={front}
                onChange={(event) => setFront(Number(event.target.value))}
              />
            </label>
            <p className="gel-hint">
              The origin and dye-front lines are drawing guides. The engine measures mobility as a fraction of the
              image height, so moving them changes no measurement.
            </p>
            <Button disabled={!canAnalyze} onClick={() => void analyze([])}>
              {busy ? <LoaderCircle className="spin" /> : <WandSparkles />} Detect lanes &amp; bands
            </Button>
            <Button variant="outline" disabled={!canAnalyze || !lanes.length} onClick={() => void analyze(lanes)}>
              <ScanLine /> Re-detect in lanes
            </Button>
          </div>
        )}

        {panel === "ladder" && (
          <div className="gel-controls">
            <label>
              Ladder preset
              <select value={ladderPreset} onChange={(event) => setLadderPreset(event.target.value)}>
                {Object.keys(LADDER_PRESETS).map((value) => (
                  <option key={value}>{value}</option>
                ))}
              </select>
            </label>
            <label>
              Marker masses, top to bottom (kDa)
              <textarea
                value={ladderPreset === "Custom" ? customWeights : masses.join(", ")}
                readOnly={ladderPreset !== "Custom"}
                onChange={(event) => setCustomWeights(event.target.value)}
              />
            </label>
            {massError ? (
              <div className="warning-note">
                <CircleAlert /> {massError}
              </div>
            ) : (
              <p className="gel-hint">
                {masses.length} masses are sent to the engine. It needs one for every ladder band it detects, and
                reports a mismatch instead of assigning a shortened list.
              </p>
            )}
            {ladderPreset !== "Custom" && (
              <p className="gel-hint">Choose “Custom” to add or remove markers for this gel.</p>
            )}
            <div className={`calibration-card ${calibrationSummary.tone === "warning" ? "warning" : ""}`}>
              <strong>{calibrationSummary.headline}</strong>
              <span>{calibrationSummary.detail}</span>
            </div>
          </div>
        )}

        {panel === "method" && (
          <div className="gel-controls">
            {quantification ? (
              <>
                <dl className="gel-method-list">
                  <div>
                    <dt>Background</dt>
                    <dd>
                      {quantification.backgroundMethod} · {quantification.backgroundRadiusPx} px ·{" "}
                      {quantification.backgroundBoundary}
                    </dd>
                  </div>
                  <div>
                    <dt>Lane geometry</dt>
                    <dd>{quantification.laneGeometry}</dd>
                  </div>
                  <div>
                    <dt>Normalization</dt>
                    <dd>{quantification.normalizationBasis}</dd>
                  </div>
                  <div>
                    <dt>Uncertainty</dt>
                    <dd>{quantification.uncertaintyMethod}</dd>
                  </div>
                  <div>
                    <dt>Linear range</dt>
                    <dd>
                      {quantification.linearDynamicRange.minSignal}–{quantification.linearDynamicRange.maxSignal}{" "}
                      {quantification.linearDynamicRange.unit}
                    </dd>
                  </div>
                  <div>
                    <dt>Image</dt>
                    <dd>
                      {quantification.imageProcessing.originalWidth ?? "?"}×
                      {quantification.imageProcessing.originalHeight ?? "?"} px ·{" "}
                      {quantification.imageProcessing.downscaled
                        ? `downscaled ×${quantification.imageProcessing.scaleFactor ?? "?"}`
                        : "not downscaled"}
                    </dd>
                  </div>
                </dl>
                <ul className="gel-caveats">
                  {quantification.caveats.map((caveat) => (
                    <li key={caveat}>
                      <Info /> {caveat}
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="gel-hint">
                The engine reports its background method, linear range, uncertainty basis and caveats with every
                analysis. Detect lanes and bands to see them here.
              </p>
            )}
          </div>
        )}
      </section>

      <section className="gel-image-workspace">
        <div className="gel-pointer-toolbar">
          <Button size="sm" variant={mode === "select" ? "default" : "outline"} onClick={() => setMode("select")}>
            <MousePointer2 /> Select
          </Button>
          <Button size="sm" variant={mode === "lane" ? "default" : "outline"} onClick={() => setMode("lane")}>
            <Plus /> Add lane
          </Button>
          <Button size="sm" variant={mode === "band" ? "default" : "outline"} onClick={() => setMode("band")}>
            <Plus /> Add band
          </Button>
          <span>
            {mode === "lane"
              ? "Drag horizontally over a lane"
              : mode === "band"
                ? "Select a lane, then click a band"
                : "Click lanes and bands to edit"}
          </span>
        </div>
        <div
          ref={stage}
          className={`gel-image-stage mode-${mode}`}
          onPointerDown={pointerDown}
          onPointerUp={pointerUp}
        >
          {preview ? (
            <img src={preview} alt="Imported PAGE gel" />
          ) : (
            <div className="gel-empty">
              <TestTubeDiagonal />
              <strong>Import a gel image</strong>
              <small>TIFF files are converted to a display-safe PNG by the local backend.</small>
            </div>
          )}
          <div className="gel-guide origin" style={{ top: `${origin * 100}%` }}>
            <span>Origin</span>
          </div>
          <div className="gel-guide front" style={{ top: `${front * 100}%` }}>
            <span>Dye front</span>
          </div>
          {lanes.map((item) => (
            <button
              key={item.id}
              className={`gel-lane ${item.id === selectedLane ? "selected" : ""} ${item.isLadder ? "ladder" : ""}`}
              style={{ left: `${item.xStart * 100}%`, width: `${(item.xEnd - item.xStart) * 100}%` }}
              onClick={(event) => {
                event.stopPropagation();
                setSelectedLane(item.id);
                setSelectedBand("");
              }}
            >
              <span>{item.label}</span>
              {bandsInLane(bands, item.id).map((member) => (
                <i
                  key={member.id}
                  className={`${member.id === selectedBand ? "selected" : ""} ${member.isTarget ? "target" : ""} ${bandFlag(member)}`}
                  style={{ top: `${member.centerY * 100}%` }}
                  title={bandQuantificationNote(member) ?? `${member.label} · density ${formatDensity(member.density)}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setSelectedLane(item.id);
                    setSelectedBand(member.id);
                  }}
                />
              ))}
            </button>
          ))}
        </div>
        <div className="gel-stage-footer">
          <span>{filename || "No image selected"}</span>
          <span>
            {lanes.length} lanes · {bands.length} bands ·{" "}
            {bands.filter((item) => item.quantificationRefused).length} refused
          </span>
        </div>
      </section>

      <aside className="gel-results-panel">
        <header>
          <strong>Annotations &amp; results</strong>
          <Button size="icon-sm" variant="ghost" disabled={!bands.length} onClick={exportTable} title="Export CSV">
            <Download />
          </Button>
        </header>

        {pending.length > 0 && (
          <div className="gel-stale-note">
            <CircleAlert />
            <div>
              <strong>Results are out of date</strong>
              <ul>
                {pending.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
              <Button size="sm" variant="outline" disabled={!canAnalyze} onClick={() => void analyze(lanes)}>
                <ScanLine /> Re-detect with these settings
              </Button>
            </div>
          </div>
        )}

        {lane ? (
          <section>
            <h3>Selected lane</h3>
            <label>
              Name
              <input value={lane.label} onChange={(event) => updateLane(lane.id, { label: event.target.value })} />
            </label>
            <label className="check-field">
              <input
                type="checkbox"
                checked={lane.isLadder}
                onChange={(event) => markLadder(lane.id, event.target.checked)}
              />{" "}
              Molecular-weight ladder
            </label>
            <Button variant="ghost" className="danger-text" onClick={() => deleteLane(lane.id)}>
              <Trash2 /> Delete lane
            </Button>
          </section>
        ) : (
          <p>Select a lane to annotate it.</p>
        )}

        {band && (
          <section>
            <h3>Selected band</h3>
            <label>
              Band label
              <input
                value={band.label}
                onChange={(event) =>
                  setBands(bands.map((item) => (item.id === band.id ? { ...item, label: event.target.value } : item)))
                }
              />
            </label>
            <div className="gel-band-metrics">
              <span>
                Mobility from top <b>{band.centerY.toFixed(4)}</b>
              </span>
              <span>
                Molecular weight <b>{molecularWeightLabel(band, weightsStale)}</b>
              </span>
              <span>
                Integrated density <b>{formatDensity(band.density)}</b>
              </span>
              <span>
                Lane signal fraction{" "}
                <b>
                  {band.laneFraction === null
                    ? "Unavailable"
                    : formatSignalFraction(band.laneFraction, band.laneFractionUncertainty)}
                </b>
              </span>
              {band.ladderMarkerMassDa !== null && (
                <span>
                  Assigned marker <b>{(band.ladderMarkerMassDa / 1000).toFixed(1)} kDa</b>
                </span>
              )}
            </div>
            {bandQuantificationNote(band) && (
              <p className={`gel-band-flag ${bandQuantification(band) === "refused_saturated" ? "refused" : ""}`}>
                <CircleAlert /> {bandQuantificationNote(band)}
              </p>
            )}
            <label className="check-field">
              <input
                type="checkbox"
                checked={band.isTarget}
                onChange={(event) => selectTarget(band, event.target.checked)}
              />{" "}
              Protein-of-interest band
            </label>
            <Button variant="ghost" className="danger-text" onClick={() => deleteBand(band)}>
              <Trash2 /> Delete false band
            </Button>
          </section>
        )}

        <section>
          <h3>Target signal fraction</h3>
          {verdict.kind === "available" ? (
            <div className="gel-quant-card">
              <strong>{formatSignalFraction(verdict.fraction, verdict.uncertainty)}</strong>
              <span>
                {lane?.label ?? "Lane"} · {laneBands.find((item) => item.isTarget)?.label}
              </span>
              <small>{normalizationBasisDetail(verdict.basis)}</small>
              <small>{SIGNAL_FRACTION_CAVEAT}</small>
            </div>
          ) : verdict.kind === "unavailable" ? (
            <div className="gel-quant-card unavailable">
              <strong>Unavailable</strong>
              <span>{verdict.headline}</span>
              <ul>
                {verdict.detail.map((detail) => (
                  <li key={detail}>{detail}</li>
                ))}
              </ul>
            </div>
          ) : (
            <div className="gel-quant-card">
              <strong>—</strong>
              <span>
                {verdict.kind === "no_bands"
                  ? "No bands in this lane yet."
                  : "Select the protein-of-interest band in this lane."}
              </span>
            </div>
          )}
        </section>

        {laneBands.length > 0 && (
          <section>
            <h3>Bands in this lane</h3>
            <table className="gel-band-table">
              <thead>
                <tr>
                  <th>Band</th>
                  <th>MW</th>
                  <th>Density</th>
                  <th>Fraction</th>
                </tr>
              </thead>
              <tbody>
                {laneBands.map((item) => (
                  <tr
                    key={item.id}
                    className={`${item.id === selectedBand ? "selected" : ""} ${item.quantificationRefused ? "refused" : ""}`}
                    onClick={() => setSelectedBand(item.id)}
                  >
                    <td>
                      {item.label}
                      {item.isTarget && <b title="Protein of interest"> ●</b>}
                    </td>
                    <td>{molecularWeightLabel(item, weightsStale)}</td>
                    <td>{formatDensity(item.density)}</td>
                    <td>
                      {item.laneFraction === null
                        ? "—"
                        : formatSignalFraction(item.laneFraction, item.laneFractionUncertainty)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        )}

        <Button disabled={busy || !preview} onClick={() => void save()}>
          {busy ? <LoaderCircle className="spin" /> : <Save />} Save gel job
        </Button>
        {message && <div className={`gel-message ${tone}`}>{message}</div>}
      </aside>
    </div>
  );
}

function bandFlag(band: GelBand) {
  const state = bandQuantification(band);
  return state === "refused_saturated" ? "refused" : state === "quantified" ? "" : "unmeasured";
}

function errorText(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}

function safeName(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "gel";
}

function downloadCsv(filename: string, rows: string[][]) {
  const blob = new Blob(
    [rows.map((row) => row.map((value) => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\n")],
    { type: "text/csv" },
  );
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
