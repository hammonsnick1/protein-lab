"use client";

import {
  forwardRef,
  PointerEvent,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  Activity,
  ArrowDown,
  BarChart3,
  CircleAlert,
  Clipboard,
  Crosshair,
  Download,
  Eye,
  EyeOff,
  FileDown,
  FolderOpen,
  Image as ImageIcon,
  LoaderCircle,
  MousePointer2,
  Move,
  Palette,
  Pencil,
  Plus,
  Save,
  Search,
  SlidersHorizontal,
  SquareDashedMousePointer,
  Trash2,
  Upload,
  ZoomIn,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";
import { secColumns } from "@/lib/sec-column-catalog";

type Point = { x: number; y: number };
type Range = { start: number; end: number };
type RegionTransform = Range & { scale: number; offset: number };
type Trace = {
  id: string;
  name: string;
  source: string;
  points: Point[];
  color: string;
  lineWidth: number;
  lineStyle: string;
  opacity: number;
  visible: boolean;
  xShift: number;
  yScale: number;
  yOffset: number;
  smoothing: number;
  baseline: boolean;
  normalization: "none" | "maximum" | "area";
  fillVisible: boolean;
  fillColor: string;
  fillOpacity: number;
  excludedRanges: Range[];
  regionTransforms: RegionTransform[];
};
type Peak = {
  id: string;
  traceId: string;
  name: string;
  start: number;
  end: number;
  apexX: number;
  response: number;
  height: number;
  area: number;
  color: string;
  fillColor: string;
  fillVisible: boolean;
  fillOpacity: number;
  outlineWidth: number;
  calloutVisible: boolean;
  calloutBorder: boolean;
  calloutX: number;
  calloutY: number;
  showVe: boolean;
  showResponse: boolean;
  showArea: boolean;
  showMw: boolean;
  customText: string;
  mwKDa?: number;
  kav?: number;
  fraction?: string;
};
type Standard = {
  id: string;
  protein: string;
  mwDa: number;
  veMl: number;
  included: boolean;
  color: string;
};
type MassStandard = {
  id: string;
  label: string;
  massKDa: number;
  signal: number;
  included: boolean;
  color: string;
};
type MassFigureConfig = {
  view: "calibration" | "histogram";
  source: "pasted" | "x" | "response" | "peaks";
  pastedSignals: string;
  bins: number;
  lineColor: string;
  histogramColor: string;
  histogramOpacity: number;
  title: string;
};
type AnnotationItem = {
  id: string;
  // An arrow carries no text: it is the printed marker for a shoulder or any
  // other feature a reader would otherwise miss.
  kind: "text" | "arrow";
  text: string;
  x: number;
  y: number;
  color: string;
  background: string;
  fontSize: number;
  border: boolean;
  angle: number;
  length: number;
  thickness: number;
};
type SecFit = { slope: number; intercept: number; r2: number } | null;
type FigureConfig = {
  layout: "stacked" | "overlay";
  align: "none" | "peak" | "manual";
  normalization: "none" | "maximum" | "area";
  alignmentStart: string;
  alignmentEnd: string;
  alignmentTarget: string;
  sharedYScale: boolean;
  showPanelLabels: boolean;
  panelGap: number;
  background: string;
  foreground: string;
  theme: string;
  palette: string;
  aspect: string;
  width: number;
  height: number;
  exportDpi: number;
  title: string;
  xLabel: string;
  yLabel: string;
  titleSize: number;
  labelSize: number;
  tickSize: number;
  legendSize: number;
  fontFamily: string;
  fontWeight: string;
  grid: "none" | "major" | "both";
  gridColor: string;
  box: "full" | "left-bottom" | "none";
  majorTicks: number;
  minorTicks: number;
  yMajorTicks: number;
  yMinorTicks: number;
  xMajorSpacing: string;
  yMajorSpacing: string;
  xMinorSpacing: string;
  yMinorSpacing: string;
  figureTitleX: number;
  figureTitleY: number;
  figureTitleAlignment: "start" | "middle" | "end";
  figureTitleRotation: number;
  xLabelX: number;
  xLabelY: number;
  xLabelAlignment: "start" | "middle" | "end";
  xLabelRotation: number;
  yLabelX: number;
  yLabelY: number;
  yLabelAlignment: "start" | "middle" | "end";
  yLabelRotation: number;
  xMin: string;
  xMax: string;
  yMin: string;
  yMax: string;
  showLegend: boolean;
  showSec: boolean;
  panelBadgeVisible: boolean;
  panelBadgeText: string;
  panelBadgeShape: "circle" | "square";
  panelBadgeColor: string;
  panelBadgeTextColor: string;
  panelBadgeX: number;
  panelBadgeY: number;
  panelBadgeSize: number;
};
type StudioTab = "data" | "analysis" | "standard" | "figure" | "export";
type Tool = "select" | "peak" | "adjust" | "fraction" | "zoom" | "annotation" | "arrow";
type Drag = {
  kind: "selection" | "adjust" | "zoom" | "fraction" | "callout" | "annotation";
  startX: number;
  peakId?: string;
  annotationId?: string;
  offsetX?: number;
  offsetY?: number;
} | null;

const traceColors = [
  "#25bba7",
  "#f3a847",
  "#8f75e8",
  "#4b9ce8",
  "#ed6a73",
  "#72bb54",
  "#d16fc0",
  "#7c8d96",
];
const palettes: Record<string, string[]> = {
  "Protein Lab": ["#25bba7", "#f3a847", "#8f75e8", "#4b9ce8", "#ed6a73"],
  "Color-blind safe": [
    "#0072b2",
    "#e69f00",
    "#009e73",
    "#cc79a7",
    "#56b4e9",
    "#d55e00",
  ],
  Publication: ["#111111", "#4575b4", "#d73027", "#66a61e", "#984ea3"],
  Viridis: ["#440154", "#3b528b", "#21918c", "#5ec962", "#fde725"],
};
const columns = secColumns.map(({ name, vt }) => ({ name, vt }));
// The default standards are the Bio-Rad gel filtration set, whose published
// elution volumes belong to a 24 mL analytical column. Defaulting to a 2.4 mL
// column instead left Vo (8 mL) larger than Vt, which makes every Kav negative
// and suppresses the fit entirely.
const defaultColumnName = "Superdex 200 Increase 10/300 GL";
const defaultColumn = columns.find((value) => value.name === defaultColumnName) ?? columns[0];
// Packed gel-filtration beds run about a third of the bed volume in the void,
// so a freshly chosen column starts from that estimate rather than keeping a
// void volume measured on a different column.
const voidEstimate = (columnVt: number) => Number((columnVt / 3).toFixed(2));
const defaultMassFigure: MassFigureConfig = {
  view: "calibration",
  source: "pasted",
  pastedSignals: "",
  bins: 36,
  lineColor: "#f09a32",
  histogramColor: "#63a9df",
  histogramOpacity: 0.48,
  title: "Single-particle mass distribution",
};
// Two publication-ready starting points. Overlay comparisons need a legend and
// peak alignment; stacked panels need per-panel labels and a shared y scale so
// the traces can be compared by eye down the column.
const alignedPreset: Partial<FigureConfig> = {
  layout: "overlay",
  align: "peak",
  showLegend: true,
  showPanelLabels: false,
  sharedYScale: false,
  box: "left-bottom",
  grid: "none",
  title: "Aligned chromatograms",
};
const stackedPreset: Partial<FigureConfig> = {
  layout: "stacked",
  align: "none",
  showLegend: false,
  showPanelLabels: true,
  sharedYScale: true,
  panelGap: 18,
  box: "left-bottom",
  grid: "none",
  title: "Stacked chromatograms",
};
const defaultFigure: FigureConfig = {
  layout: "stacked",
  align: "none",
  normalization: "none",
  alignmentStart: "",
  alignmentEnd: "",
  alignmentTarget: "",
  sharedYScale: false,
  showPanelLabels: true,
  panelGap: 18,
  background: "#ffffff",
  foreground: "#182126",
  theme: "Light publication",
  palette: "Color-blind safe",
  aspect: "4:3",
  width: 1200,
  height: 900,
  exportDpi: 300,
  title: "Aligned chromatograms",
  xLabel: "Retention volume (mL)",
  yLabel: "Response (mAU)",
  titleSize: 22,
  labelSize: 14,
  tickSize: 11,
  legendSize: 10,
  fontFamily: "Arial",
  fontWeight: "400",
  grid: "none",
  gridColor: "#d9dfe2",
  box: "full",
  majorTicks: 6,
  minorTicks: 4,
  yMajorTicks: 5,
  yMinorTicks: 4,
  xMajorSpacing: "",
  yMajorSpacing: "",
  xMinorSpacing: "",
  yMinorSpacing: "",
  figureTitleX: 0.5,
  figureTitleY: 0.05,
  figureTitleAlignment: "middle",
  figureTitleRotation: 0,
  xLabelX: 0.5,
  xLabelY: 0.98,
  xLabelAlignment: "middle",
  xLabelRotation: 0,
  yLabelX: 0.025,
  yLabelY: 0.5,
  yLabelAlignment: "middle",
  yLabelRotation: -90,
  xMin: "",
  xMax: "",
  yMin: "",
  yMax: "",
  showLegend: true,
  showSec: false,
  panelBadgeVisible: false,
  panelBadgeText: "3",
  panelBadgeShape: "circle",
  panelBadgeColor: "#63a9df",
  panelBadgeTextColor: "#ffffff",
  panelBadgeX: 0.055,
  panelBadgeY: 0.075,
  panelBadgeSize: 28,
};

export function ChromatogramStudioJob({
  bundle,
  onChanged,
}: {
  bundle: ProteinBundle;
  onChanged: () => Promise<void>;
}) {
  const saved =
    bundle.projectJobs.find((job) => job.appType === "chromatogram-studio")
      ?.config ?? {};
  const [tab, setTab] = useState<StudioTab>("data");
  const [projectName, setProjectName] = useState(String(saved.projectName ?? `${bundle.protein.name} chromatography`));
  const [traces, setTraces] = useState<Trace[]>(() => loadTraces(saved.traces));
  const [activeTraceId, setActiveTraceId] = useState(
    String(saved.activeTraceId ?? loadTraces(saved.traces)[0]?.id ?? ""),
  );
  const [peaks, setPeaks] = useState<Peak[]>(() => loadPeaks(saved.peaks));
  const [selectedPeakId, setSelectedPeakId] = useState("");
  const [annotations, setAnnotations] = useState<AnnotationItem[]>(() => loadAnnotations(saved.annotations));
  const [selectedAnnotationId, setSelectedAnnotationId] = useState("");
  const [tool, setTool] = useState<Tool>("peak");
  const [drag, setDrag] = useState<Drag>(null);
  const [selection, setSelection] = useState<Range | null>(null);
  const [zoom, setZoom] = useState<Range | null>(null);
  const [fractions, setFractions] = useState<
    (Range & { id: string; name: string; color: string; opacity: number })[]
  >(() => array(saved.fractions) as never[]);
  const [standards, setStandards] = useState<Standard[]>(() =>
    loadStandards(saved.standards),
  );
  const [vo, setVo] = useState(Number(saved.vo ?? voidEstimate(defaultColumn.vt)));
  const [voidMarkerMw, setVoidMarkerMw] = useState(
    Number(saved.voidMarkerMw ?? 2000000),
  );
  const [column, setColumn] = useState(
    String(saved.columnName ?? defaultColumn.name),
  );
  const [vt, setVt] = useState(Number(saved.vt ?? defaultColumn.vt));
  const [fitColor, setFitColor] = useState(String(saved.fitColor ?? "#e36a4a"));
  const [massStandards, setMassStandards] = useState<MassStandard[]>(() => loadMassStandards(saved.massStandards));
  const [massFigure, setMassFigure] = useState<MassFigureConfig>(() => ({ ...defaultMassFigure, ...object(saved.massFigure) }));
  const [figure, setFigure] = useState<FigureConfig>(() => ({
    ...defaultFigure,
    ...object(saved.figure),
  }));
  const [secFigure, setSecFigure] = useState<SecFigureConfig>(() => ({ ...defaultSecFigure, ...object(saved.secFigure) }));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [inspector, setInspector] = useState<
    "trace" | "peak" | "annotation" | "axis" | "figure"
  >("trace");
  const plotRef = useRef<SVGSVGElement>(null);
  const activeTrace =
    traces.find((value) => value.id === activeTraceId) ?? traces[0];
  const selectedPeak = peaks.find((value) => value.id === selectedPeakId);
  const selectedAnnotation = annotations.find((value) => value.id === selectedAnnotationId);
  const fit = useMemo(() => fitSec(standards, vo, vt), [standards, vo, vt]);
  const calibratedPeaks = useMemo(
    () => peaks.map((peak) => calibratePeak(peak, fit, vo, vt)),
    [peaks, fit, vo, vt],
  );
  const allProcessed = useMemo(
    () =>
      Object.fromEntries(
        traces.map((trace) => [trace.id, processTrace(trace)]),
      ),
    [traces],
  );
  useEffect(() => {
    function keyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target?.matches("input, textarea, select, [contenteditable='true']"))
        return;
      if (
        (event.key === "Backspace" || event.key === "Delete") &&
        (selectedPeakId || selectedAnnotationId)
      ) {
        event.preventDefault();
        if (selectedAnnotationId) { setAnnotations((values) => values.filter((value) => value.id !== selectedAnnotationId)); setSelectedAnnotationId(""); }
        else { setPeaks((values) => values.filter((value) => value.id !== selectedPeakId)); setSelectedPeakId(""); }
      }
    }
    window.addEventListener("keydown", keyDown);
    return () => window.removeEventListener("keydown", keyDown);
  }, [selectedAnnotationId, selectedPeakId]);

  async function importFiles(files: FileList | null) {
    if (!files?.length) return;
    setBusy(true);
    try {
      const imported: Trace[] = [];
      for (const file of Array.from(files)) {
        const decoded = decodeData(await file.arrayBuffer());
        const points = parseTrace(decoded);
        if (points.length < 3)
          throw new Error(
            `${file.name}: no two-column numeric data were found.`,
          );
        imported.push({
          id: crypto.randomUUID(),
          name: file.name.replace(/\.[^.]+$/, ""),
          source: file.name,
          points,
          color:
            traceColors[(traces.length + imported.length) % traceColors.length],
          lineWidth: 2,
          lineStyle: "solid",
          opacity: 1,
          visible: true,
          xShift: 0,
          yScale: 1,
          yOffset: 0,
          smoothing: 1,
          baseline: false,
          normalization: "none",
          fillVisible: false,
          fillColor: traceColors[(traces.length + imported.length) % traceColors.length],
          fillOpacity: 0.16,
          excludedRanges: [],
          regionTransforms: [],
        });
      }
      setTraces([...traces, ...imported]);
      setActiveTraceId(imported[0].id);
      setMessage(
        `${imported.length} chromatogram${imported.length === 1 ? "" : "s"} imported.`,
      );
      setTab("analysis");
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  function updateTrace(id: string, patch: Partial<Trace>) {
    setTraces((values) =>
      values.map((value) => (value.id === id ? { ...value, ...patch } : value)),
    );
  }
  function duplicateTrace() {
    if (!activeTrace) return;
    const copy = {
      ...structuredClone(activeTrace),
      id: crypto.randomUUID(),
      name: `${activeTrace.name} copy`,
    };
    setTraces([...traces, copy]);
    setActiveTraceId(copy.id);
  }
  function removeTrace(id: string) {
    setTraces(traces.filter((value) => value.id !== id));
    setPeaks(peaks.filter((value) => value.traceId !== id));
    setActiveTraceId(traces.find((value) => value.id !== id)?.id ?? "");
  }
  function applyPalette(name: string) {
    const colors = palettes[name];
    setFigure({ ...figure, palette: name });
    setTraces(
      traces.map((trace, index) => ({
        ...trace,
        color: colors[index % colors.length],
      })),
    );
    setPeaks(
      peaks.map((peak, index) => ({
        ...peak,
        color: colors[index % colors.length],
        fillColor: colors[index % colors.length],
      })),
    );
  }
  function addExcluded(range: Range | null = selection) {
    if (!activeTrace || !range) return;
    updateTrace(activeTrace.id, {
      excludedRanges: [...activeTrace.excludedRanges, range],
    });
    setSelection(range);
  }
  function addTransform(range: Range | null = selection) {
    if (!activeTrace || !range) return;
    updateTrace(activeTrace.id, {
      regionTransforms: [
        ...activeTrace.regionTransforms,
        { ...range, scale: 1, offset: 0 },
      ],
    });
    setSelection(range);
  }

  function plotX(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const bounds = plotBounds(traces, allProcessed, zoom, figure);
    const svgWidth = 1000;
    const plotLeft = 92;
    const plotRight = 32;
    const svgX = ((event.clientX - rect.left) / Math.max(rect.width, 1)) * svgWidth;
    const plotFraction = Math.max(
      0,
      Math.min(1, (svgX - plotLeft) / (svgWidth - plotLeft - plotRight)),
    );
    return (
      bounds.xMin +
      plotFraction * (bounds.xMax - bounds.xMin)
    );
  }
  function plotY(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const svgHeight = tab === "figure" ? 700 : 590;
    const plotTop = tab === "figure" ? 72 : 34;
    const plotBottom = 70;
    const svgY = ((event.clientY - rect.top) / Math.max(rect.height, 1)) * svgHeight;
    return (
      Math.max(
        0,
        Math.min(1, (svgY - plotTop) / (svgHeight - plotTop - plotBottom)),
      ) * 100
    );
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (!activeTrace) return;
    setMessage("");
    const x = plotX(event);
    if (tool === "annotation" || tool === "arrow") {
      const arrow = tool === "arrow";
      const annotation: AnnotationItem = { id: crypto.randomUUID(), kind: arrow ? "arrow" : "text", text: arrow ? "" : "Double-click to edit", x, y: plotY(event), color: arrow ? "#e03131" : activeTrace.color, background: figure.background === "transparent" ? "#ffffff" : figure.background, fontSize: 12, border: false, angle: 90, length: 46, thickness: 11 };
      setAnnotations([...annotations, annotation]);
      setSelectedAnnotationId(annotation.id); setSelectedPeakId(""); setInspector("annotation");
      setDrag({ kind: "annotation", startX: x, annotationId: annotation.id });
      event.currentTarget.setPointerCapture(event.pointerId); return;
    }
    if (tool === "peak" || tool === "adjust" || tool === "zoom" || tool === "fraction") {
      setDrag({ kind: tool === "peak" ? "selection" : tool, startX: x });
      setSelection({ start: x, end: x });
      event.currentTarget.setPointerCapture(event.pointerId);
    }
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    if (!drag) return;
    const x = plotX(event);
    if (
      drag.kind === "selection" ||
      drag.kind === "adjust" ||
      drag.kind === "zoom" ||
      drag.kind === "fraction"
    )
      setSelection({
        start: Math.min(drag.startX, x),
        end: Math.max(drag.startX, x),
      });
    if (drag.kind === "callout" && drag.peakId) {
      const peak = peaks.find((value) => value.id === drag.peakId);
      if (peak)
        updatePeak(peak.id, { calloutX: plotX(event), calloutY: plotY(event) });
    }
    if (drag.kind === "annotation" && drag.annotationId) {
      // Read the pointer position now: a state updater runs during a later
      // render, by which time the event has been released and currentTarget
      // is null.
      const nextX = plotX(event), nextY = plotY(event);
      setAnnotations((values) => values.map((value) => value.id === drag.annotationId ? { ...value, x: nextX, y: nextY } : value));
    }
  }
  function pointerUp() {
    if (drag?.kind === "callout" || drag?.kind === "annotation") { setDrag(null); return; }
    if (!drag || !selection) {
      setDrag(null);
      return;
    }
    if (drag.kind === "selection") detectPeak(selection);
    if (drag.kind === "adjust") adjustPeak(selection);
    if (drag.kind === "zoom") setZoom(selection);
    if (drag.kind === "fraction")
      setFractions([
        ...fractions,
        {
          ...selection,
          id: crypto.randomUUID(),
          name: `Fraction ${fractions.length + 1}`,
          color: "#f0b94d",
          opacity: 0.18,
        },
      ]);
    setDrag(null);
  }
  function detectPeak(range: Range) {
    if (!activeTrace) return;
    const result = findPeak(allProcessed[activeTrace.id] ?? [], range);
    if (!result) {
      setMessage("No peak maximum was found in that region.");
      return;
    }
    const peak: Peak = {
      id: crypto.randomUUID(),
      traceId: activeTrace.id,
      name: `Peak ${peaks.filter((value) => value.traceId === activeTrace.id).length + 1}`,
      ...result,
      color: activeTrace.color,
      fillColor: activeTrace.color,
      fillVisible: true,
      fillOpacity: 0.25,
      outlineWidth: 2,
      calloutVisible: true,
      calloutBorder: true,
      calloutX: result.apexX,
      calloutY: 8 + (peaks.length % 4) * 22,
      showVe: true,
      showResponse: true,
      showArea: true,
      showMw: true,
      customText: "",
    };
    setPeaks([...peaks, peak]);
    setSelectedPeakId(peak.id);
    setInspector("peak");
  }
  function autoFind() {
    if (!activeTrace) return;
    const found = findAllPeaks(allProcessed[activeTrace.id] ?? [], 5).map(
      (result, index): Peak => ({
        id: crypto.randomUUID(),
        traceId: activeTrace.id,
        name: `Peak ${index + 1}`,
        ...result,
        color: activeTrace.color,
        fillColor: activeTrace.color,
        fillVisible: true,
        fillOpacity: 0.25,
        outlineWidth: 2,
        calloutVisible: true,
        calloutBorder: true,
        calloutX: result.apexX,
        calloutY: 8 + (index % 4) * 22,
        showVe: true,
        showResponse: true,
        showArea: true,
        showMw: true,
        customText: "",
      }),
    );
    setPeaks([
      ...peaks.filter((value) => value.traceId !== activeTrace.id),
      ...found,
    ]);
    setMessage(
      `${found.length} peak${found.length === 1 ? "" : "s"} detected across ${activeTrace.name}.`,
    );
  }
  function updatePeak(id: string, patch: Partial<Peak>) {
    setPeaks((values) =>
      values.map((value) => (value.id === id ? { ...value, ...patch } : value)),
    );
  }
  function adjustPeak(range: Range) {
    if (!selectedPeak || !activeTrace) return;
    const result = findPeak(
      allProcessed[selectedPeak.traceId] ?? [],
      range,
      true,
    );
    if (result) updatePeak(selectedPeak.id, result);
  }
  // Frames the selected peak with a margin either side, which is where figure
  // work on a shoulder or a tailing edge starts.
  function zoomToSelectedPeak() {
    if (!selectedPeak) return;
    const width = Math.max(1e-9, selectedPeak.end - selectedPeak.start);
    setZoom({ start: selectedPeak.start - width * 0.35, end: selectedPeak.end + width * 0.35 });
    setFigure((value) => ({ ...value, yMin: "", yMax: "" }));
    setMessage(`Zoomed to ${selectedPeak.name}. Set a y range in Axes to bring out a shoulder.`);
  }
  function deletePeak() {
    if (!selectedPeak) return;
    setPeaks(peaks.filter((value) => value.id !== selectedPeak.id));
    setSelectedPeakId("");
  }
  function projectSnapshot() {
    return {
      format: "protein-labs.chromatogram-project",
      schemaVersion: 11,
      projectName,
      traces,
      activeTraceId,
      peaks: calibratedPeaks,
      annotations,
      fractions,
      standards,
      vo,
      vt,
      columnName: column,
      voidMarkerMw,
      fitColor,
      massStandards,
      massFigure,
      figure,
      secFigure,
      exportedAt: new Date().toISOString(),
    };
  }
  function exportProject() { downloadText(`${safeFilename(projectName)}.chromproj`, JSON.stringify(projectSnapshot(), null, 2), "application/json"); setMessage("Portable Chromatogram Studio project exported."); }
  async function importProject(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    try {
      const parsed = JSON.parse(decodeData(await file.arrayBuffer())) as JsonObject;
      const source = object(parsed.config ?? parsed.project ?? parsed);
      const loadedTraces = loadTraces(source.traces);
      if (!loadedTraces.length) throw new Error("This project does not contain any chromatogram traces.");
      setProjectName(String(source.projectName ?? source.name ?? file.name.replace(/\.chromproj$/i, "")));
      setTraces(loadedTraces); setActiveTraceId(String(source.activeTraceId ?? loadedTraces[0].id)); setPeaks(loadPeaks(source.peaks ?? source.measurements)); setAnnotations(loadAnnotations(source.annotations));
      setFractions(array(source.fractions).map((raw, index) => ({ id: String(raw.id ?? crypto.randomUUID()), name: String(raw.name ?? `Fraction ${index + 1}`), start: Number(raw.start), end: Number(raw.end), color: String(raw.color ?? "#f0b94d"), opacity: Number(raw.opacity ?? .18) })));
      setStandards(loadStandards(source.standards)); setVo(Number(source.vo ?? voidEstimate(defaultColumn.vt))); setVt(Number(source.vt ?? defaultColumn.vt)); setColumn(String(source.columnName ?? defaultColumn.name)); setVoidMarkerMw(Number(source.voidMarkerMw ?? 2000000)); setFitColor(String(source.fitColor ?? "#e36a4a"));
      setMassStandards(loadMassStandards(source.massStandards)); setMassFigure({ ...defaultMassFigure, ...object(source.massFigure) }); setFigure({ ...defaultFigure, ...object(source.figure ?? source.stacked_figure) }); setSecFigure({ ...defaultSecFigure, ...object(source.secFigure) });
      setSelection(null); setZoom(null); setSelectedPeakId(""); setSelectedAnnotationId(""); setMessage(`Opened ${file.name}.`);
    } catch (reason) { setMessage(`Could not open project: ${errorText(reason)}`); }
  }
  function newProject() {
    if ((traces.length || peaks.length) && !window.confirm("Clear the current Chromatogram Studio workspace? Export or save it first if you want a copy.")) return;
    setProjectName(`${bundle.protein.name} chromatography`); setTraces([]); setActiveTraceId(""); setPeaks([]); setAnnotations([]); setFractions([]); setSelection(null); setZoom(null); setSelectedPeakId(""); setSelectedAnnotationId(""); setTab("data"); setMessage("New empty chromatogram project created.");
  }
  async function save() {
    setBusy(true);
    try {
      const config = {
        schemaVersion: 10,
        projectName,
        traces,
        activeTraceId,
        peaks: calibratedPeaks,
        annotations,
        fractions,
        standards,
        vo,
        vt,
        columnName: column,
        voidMarkerMw,
        fitColor,
        calibration: fit,
        massStandards,
        massFigure,
        figure,
        secFigure,
        savedAt: new Date().toISOString(),
        savedByUser: true,
      };
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      await ensureProjectJob(
        bundle.protein.id,
        latest.projectJobs,
        "chromatogram-studio",
        "Chromatogram Studio project",
        config,
      );
      await onChanged();
      setMessage(
        "Chromatogram project saved with traces, peaks, calibration, and figure settings.",
      );
    } catch (reason) {
      setMessage(errorText(reason));
    } finally {
      setBusy(false);
    }
  }
  function addStandard() {
    setStandards([
      ...standards,
      {
        id: crypto.randomUUID(),
        protein: `Standard ${standards.length + 1}`,
        mwDa: 66000,
        veMl: 12,
        included: true,
        color: traceColors[standards.length % traceColors.length],
      },
    ]);
  }
  function updateStandard(id: string, patch: Partial<Standard>) {
    setStandards(
      standards.map((value) =>
        value.id === id ? { ...value, ...patch } : value,
      ),
    );
  }
  function adoptStandardCurve(curve: StandardCurve) {
    setStandards(curve.standards);
    if (curve.column) setColumn(curve.column);
    if (curve.vt > 0) setVt(curve.vt);
    if (curve.vo > 0) setVo(curve.vo);
  }
  function chooseColumn(name: string) {
    setColumn(name);
    const value = columns.find((item) => item.name === name);
    if (!value) return;
    setVt(value.vt);
    // Carrying a void volume across a column change is how Vo ends up larger
    // than Vt; re-estimate whenever the old value no longer fits the new bed.
    if (!(vo > 0 && vo < value.vt * 0.9)) setVo(voidEstimate(value.vt));
  }
  function exportProcessed() {
    const rows: string[][] = [["trace", "retention_volume", "response"]];
    for (const trace of traces)
      for (const point of allProcessed[trace.id] ?? [])
        rows.push([trace.name, String(point.x), String(point.y)]);
    downloadText(
      "processed-chromatograms.csv",
      rows
        .map((row) =>
          row.map((value) => `"${value.replaceAll('"', '""')}"`).join(","),
        )
        .join("\n"),
      "text/csv",
    );
  }
  function exportStandards() {
    downloadCsv("protein-standards.csv", [
      [
        "Protein",
        "MW (Da)",
        "Ve (mL)",
        "Log Mr",
        "Ve/Vo",
        "Vo",
        "Vt",
        "Kav",
        "Included",
      ],
      ...standards.map((value) => [
        value.protein,
        value.mwDa,
        value.veMl,
        Math.log10(value.mwDa),
        value.veMl / vo,
        vo,
        vt,
        kav(value.veMl, vo, vt),
        value.included,
      ]),
    ]);
  }
  function exportPeaks() {
    downloadCsv("calculated-peak-mw.csv", [
      [
        "Trace",
        "Peak",
        "Start",
        "End",
        "Ve (mL)",
        "Response",
        "Height",
        "Area",
        "Kav",
        "MW (kDa)",
        "Fraction",
      ],
      ...calibratedPeaks.map((value) => [
        traces.find((trace) => trace.id === value.traceId)?.name ?? "",
        value.name,
        value.start,
        value.end,
        value.apexX,
        value.response,
        value.height,
        value.area,
        value.kav ?? "",
        value.mwKDa ?? "",
        value.fraction ?? "",
      ]),
    ]);
  }
  function exportSvg() {
    const source = plotRef.current?.outerHTML;
    if (source)
      downloadText("chromatogram-figure.svg", source, "image/svg+xml");
  }
  const renderPlotCanvas = () => rasterizeSvg(plotRef.current, figure.width, figure.height, figure.exportDpi, figure.background);
  async function exportPng(copy = false) {
    const canvas = await renderPlotCanvas(); if (!canvas) return;
    canvas.toBlob(async (png) => {
      if (!png) return;
      if (copy && navigator.clipboard && "write" in navigator.clipboard) {
        await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]); setMessage("Figure copied to clipboard.");
      } else { downloadBlob("chromatogram-figure.png", png); }
    }, "image/png");
  }
  async function exportTiff() {
    const canvas = await renderPlotCanvas(); if (!canvas) return;
    const context = canvas.getContext("2d")!; const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    downloadBlob("chromatogram-figure.tiff", new Blob([encodeTiffRgba(pixels, figure.exportDpi)], { type: "image/tiff" }));
  }
  async function exportPdf() {
    const canvas = await renderPlotCanvas(); if (!canvas) return;
    canvas.toBlob(async (jpeg) => {
      if (!jpeg) return;
      const bytes = new Uint8Array(await jpeg.arrayBuffer());
      downloadBlob("chromatogram-figure.pdf", new Blob([buildImagePdf(bytes, canvas.width, canvas.height, figure.exportDpi)], { type: "application/pdf" }));
    }, "image/jpeg", .96);
  }

  return (
    <div className="chrom-studio">
      <aside className="chrom-nav">
        <header>
          <Activity />
          <span>
            <strong>Chromatogram Studio</strong>
            <small>
              {traces.length} spectra · {peaks.length} peaks
            </small>
          </span>
        </header>
        <nav>
          {(
            [
              ["data", "Data", Upload],
              ["analysis", "Analysis", SquareDashedMousePointer],
              ["standard", "Standard curve", BarChart3],
              ["figure", "Figures", Palette],
              ["export", "Export", FileDown],
            ] as [StudioTab, string, typeof Activity][]
          ).map(([id, label, Icon]) => (
            <button
              className={tab === id ? "active" : ""}
              key={id}
              onClick={() => {
                setTab(id);
                if (id === "figure") setInspector("figure");
              }}
            >
              <Icon />
              {label}
            </button>
          ))}
        </nav>
        <div className="trace-selector">
          <strong>Spectra</strong>
          {traces.map((trace) => (
            <button
              key={trace.id}
              className={trace.id === activeTraceId ? "active" : ""}
              onClick={() => {
                setActiveTraceId(trace.id);
                setInspector("trace");
              }}
            >
              <i style={{ background: trace.color }} />
              {trace.name}
              {trace.visible ? <Eye /> : <EyeOff />}
            </button>
          ))}
        </div>
        <Button onClick={() => void save()} disabled={busy}>
          {busy ? <LoaderCircle className="spin" /> : <Save />} Save project
        </Button>
      </aside>
      <section className="chrom-center">
        {tab === "data" ? (
          <DataWorkspace
            traces={traces}
            activeTrace={activeTrace}
            selection={selection}
            onImport={importFiles}
            onSelect={setActiveTraceId}
            onUpdate={updateTrace}
            onDuplicate={duplicateTrace}
            onDelete={removeTrace}
            onExclude={addExcluded}
            onTransform={addTransform}
          />
        ) : tab === "standard" ? (
          <StandardWorkspace
            standards={standards}
            vo={vo}
            vt={vt}
            column={column}
            voidMarkerMw={voidMarkerMw}
            fit={fit}
            fitColor={fitColor}
            onVo={setVo}
            onVt={setVt}
            onColumn={chooseColumn}
            onVoidMarker={setVoidMarkerMw}
            onFitColor={setFitColor}
            onAdd={addStandard}
            onUpdate={updateStandard}
            secFigure={secFigure}
            onSecFigure={(patch) => setSecFigure((value) => ({ ...value, ...patch }))}
            onReplaceAll={adoptStandardCurve}
            onMessage={setMessage}
            onDelete={(id) =>
              setStandards(standards.filter((value) => value.id !== id))
            }
          />
        ) : tab === "export" ? (
          <ExportWorkspace
            projectName={projectName}
            onProjectName={setProjectName}
            onNew={newProject}
            onOpen={importProject}
            onProjectSave={exportProject}
            onProcessed={exportProcessed}
            onStandards={exportStandards}
            onPeaks={exportPeaks}
            onSvg={exportSvg}
            onPng={() => void exportPng()}
            onPdf={() => void exportPdf()}
            onTiff={() => void exportTiff()}
            onCopy={() => void exportPng(true)}
          />
        ) : (
          <>
            {tab === "analysis" && (
              <div className="pointer-toolbar">
                <Button
                  size="sm"
                  variant={tool === "select" ? "default" : "outline"}
                  onClick={() => setTool("select")}
                >
                  <MousePointer2 /> Select
                </Button>
                <Button
                  size="sm"
                  variant={tool === "peak" ? "default" : "outline"}
                  onClick={() => setTool("peak")}
                >
                  <SquareDashedMousePointer /> Drag peak
                </Button>
                <Button
                  size="sm"
                  variant={tool === "adjust" ? "default" : "outline"}
                  onClick={() => setTool("adjust")}
                >
                  <Move /> Adjust bounds
                </Button>
                <Button
                  size="sm"
                  variant={tool === "fraction" ? "default" : "outline"}
                  onClick={() => setTool("fraction")}
                >
                  <Plus /> Fraction region
                </Button>
                <Button size="sm" variant={tool === "annotation" ? "default" : "outline"} onClick={() => setTool("annotation")}><Pencil/> Add text</Button>
                <Button size="sm" variant={tool === "arrow" ? "default" : "outline"} onClick={() => setTool("arrow")}><ArrowDown/> Add arrow</Button>
                <Button
                  size="sm"
                  variant={tool === "zoom" ? "default" : "outline"}
                  onClick={() => setTool("zoom")}
                >
                  <ZoomIn /> Zoom
                </Button>
                <Button size="sm" variant="outline" disabled={!selectedPeak} onClick={zoomToSelectedPeak}>
                  <Crosshair /> Zoom to peak
                </Button>
                <Button size="sm" variant="ghost" onClick={() => { setZoom(null); setFigure((value) => ({ ...value, yMin: "", yMax: "" })); }}>
                  Reset zoom
                </Button>
                <Button size="sm" variant="outline" onClick={autoFind}>
                  <Search /> Find peaks
                </Button>
              </div>
            )}
            <ChromPlot
              ref={plotRef}
              traces={traces}
              processed={allProcessed}
              peaks={calibratedPeaks}
              annotations={annotations}
              fractions={fractions}
              standards={standards}
              fit={fit}
              vo={vo}
              vt={vt}
              fitColor={fitColor}
              figure={figure}
              zoom={zoom}
              selection={drag && ["selection", "adjust", "zoom", "fraction"].includes(drag.kind) ? selection : null}
              dragKind={drag?.kind ?? null}
              selectedPeakId={selectedPeakId}
              selectedAnnotationId={selectedAnnotationId}
              figureMode={tab === "figure"}
              onPointerDown={pointerDown}
              onPointerMove={pointerMove}
              onPointerUp={pointerUp}
              onTrace={(id) => {
                setActiveTraceId(id);
                setInspector("trace");
              }}
              onPeak={(id) => {
                setSelectedPeakId(id);
                setSelectedAnnotationId("");
                setInspector("peak");
              }}
              onAnnotation={(id) => { setSelectedAnnotationId(id); setSelectedPeakId(""); setInspector("annotation"); }}
              onAnnotationDrag={(event, id) => { event.stopPropagation(); setSelectedAnnotationId(id); setSelectedPeakId(""); setInspector("annotation"); setDrag({ kind: "annotation", startX: 0, annotationId: id }); event.currentTarget.setPointerCapture(event.pointerId); }}
              onCalloutDrag={(event, id) => {
                event.stopPropagation();
                const peak = peaks.find((value) => value.id === id);
                if (peak) {
                  setSelectedPeakId(id);
                  setInspector("peak");
                  setDrag({
                    kind: "callout",
                    startX: peak.apexX,
                    peakId: id,
                    offsetX: 0,
                    offsetY: 0,
                  });
                  event.currentTarget.setPointerCapture(event.pointerId);
                }
              }}
              onAxis={() => setInspector("axis")}
            />
          </>
        )}
        {message && (
          <div className="chrom-message">
            {message}
            <button onClick={() => setMessage("")}>×</button>
          </div>
        )}
      </section>
      <aside className="chrom-inspector">
        {tab === "figure" &&
        (inspector === "trace" || inspector === "peak" || inspector === "annotation") ? (
          <div className="figure-object-inspector">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setInspector("figure")}
            >
              <Palette /> Figure setup
            </Button>
            <AnalysisInspector
              trace={activeTrace}
              peak={
                selectedPeak
                  ? calibratePeak(selectedPeak, fit, vo, vt)
                  : undefined
              }
              annotation={selectedAnnotation}
              inspector={inspector}
              onInspector={setInspector}
              onTrace={(patch) =>
                activeTrace && updateTrace(activeTrace.id, patch)
              }
              onPeak={(patch) =>
                selectedPeak && updatePeak(selectedPeak.id, patch)
              }
              onAnnotation={(patch) => selectedAnnotation && setAnnotations((values) => values.map((value) => value.id === selectedAnnotation.id ? { ...value, ...patch } : value))}
              onDeleteAnnotation={() => { if (selectedAnnotation) setAnnotations((values) => values.filter((value) => value.id !== selectedAnnotation.id)); setSelectedAnnotationId(""); setInspector("trace"); }}
              onBounds={adjustPeak}
              onDeletePeak={deletePeak}
              fractions={fractions}
              onFractions={setFractions}
            />
          </div>
        ) : tab === "figure" ? (
          <FigureInspector
            key={inspector}
            figure={figure}
            focus={inspector}
            onChange={(patch) => setFigure({ ...figure, ...patch })}
            onPalette={applyPalette}
          />
        ) : tab === "analysis" ? (
          <AnalysisInspector
            trace={activeTrace}
            peak={
              selectedPeak
                ? calibratePeak(selectedPeak, fit, vo, vt)
                : undefined
            }
            annotation={selectedAnnotation}
            inspector={inspector}
            onInspector={setInspector}
            onTrace={(patch) =>
              activeTrace && updateTrace(activeTrace.id, patch)
            }
            onPeak={(patch) =>
              selectedPeak && updatePeak(selectedPeak.id, patch)
            }
            onAnnotation={(patch) => selectedAnnotation && setAnnotations((values) => values.map((value) => value.id === selectedAnnotation.id ? { ...value, ...patch } : value))}
            onDeleteAnnotation={() => { if (selectedAnnotation) setAnnotations((values) => values.filter((value) => value.id !== selectedAnnotation.id)); setSelectedAnnotationId(""); setInspector("trace"); }}
            onBounds={adjustPeak}
            onDeletePeak={deletePeak}
            fractions={fractions}
            onFractions={setFractions}
          />
        ) : tab === "standard" ? (
          <div className="inspector-help">
            <BarChart3 />
            <strong>SEC calibration</strong>
            <p>
              The plot uses Kav on the y-axis and log₁₀ molecular weight on the
              x-axis. Kav is always calculated as (Ve − Vo) / (Vt − Vo).
            </p>
            <code>Kav = (Ve − Vo) / (Vt − Vo)</code>
            <p>
              Peak MW is obtained by inverting the fitted Kav-versus-log Mr
              line.
            </p>
          </div>
        ) : tab === "data" ? (
          <div className="inspector-help">
            <SlidersHorizontal />
            <strong>Non-destructive processing</strong>
            <p>
              Raw points remain stored. Smoothing, baseline correction,
              normalization, exclusions, offsets, and regional transforms are
              applied only to the displayed/processed trace.
            </p>
          </div>
        ) : (
          <div className="inspector-help">
            <Download />
            <strong>Local exports</strong>
            <p>
              Export processed data, standards, peak molecular weights, and
              publication-ready raster or vector figures without a web service.
            </p>
          </div>
        )}
      </aside>
    </div>
  );
}

function DataWorkspace({
  traces,
  activeTrace,
  selection,
  onImport,
  onSelect,
  onUpdate,
  onDuplicate,
  onDelete,
  onExclude,
  onTransform,
}: {
  traces: Trace[];
  activeTrace?: Trace;
  selection: Range | null;
  onImport: (files: FileList | null) => void;
  onSelect: (id: string) => void;
  onUpdate: (id: string, patch: Partial<Trace>) => void;
  onDuplicate: () => void;
  onDelete: (id: string) => void;
  onExclude: () => void;
  onTransform: () => void;
}) {
  return (
    <div className="data-workspace">
      <header>
        <div>
          <span className="eyebrow">DATA & PROCESSING</span>
          <h2>Imported chromatograms</h2>
          <p>
            Overlay any number of traces and apply reversible processing to each
            spectrum.
          </p>
        </div>
        <label className="upload-button">
          <Upload /> Import CSV / TSV / DAT
          <input
            type="file"
            multiple
            accept=".csv,.tsv,.txt,.dat"
            onChange={(event) => onImport(event.target.files)}
          />
        </label>
      </header>
      <div className="data-grid">
        <section className="trace-table">
          <div>
            <b>Visible</b>
            <b>Spectrum</b>
            <b>Points</b>
            <b>Color</b>
            <b />
          </div>
          {traces.map((trace) => (
            <button
              key={trace.id}
              className={trace.id === activeTrace?.id ? "selected" : ""}
              onClick={() => onSelect(trace.id)}
            >
              <span
                onClick={(event) => {
                  event.stopPropagation();
                  onUpdate(trace.id, { visible: !trace.visible });
                }}
              >
                {trace.visible ? <Eye /> : <EyeOff />}
              </span>
              <strong>
                {trace.name}
                <small>{trace.source}</small>
              </strong>
              <span>{trace.points.length.toLocaleString()}</span>
              <input
                type="color"
                value={trace.color}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) =>
                  onUpdate(trace.id, { color: event.target.value })
                }
              />
              <span />
            </button>
          ))}
        </section>
        {activeTrace && (
          <section className="processing-panel">
            <h3>{activeTrace.name}</h3>
            <label>
              Name
              <input
                value={activeTrace.name}
                onChange={(event) =>
                  onUpdate(activeTrace.id, { name: event.target.value })
                }
              />
            </label>
            <div className="processing-grid">
              <label>
                X shift
                <input
                  type="number"
                  step=".01"
                  value={activeTrace.xShift}
                  onChange={(event) =>
                    onUpdate(activeTrace.id, {
                      xShift: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Y scale
                <input
                  type="number"
                  step=".01"
                  value={activeTrace.yScale}
                  onChange={(event) =>
                    onUpdate(activeTrace.id, {
                      yScale: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Y offset
                <input
                  type="number"
                  step=".01"
                  value={activeTrace.yOffset}
                  onChange={(event) =>
                    onUpdate(activeTrace.id, {
                      yOffset: Number(event.target.value),
                    })
                  }
                />
              </label>
              <label>
                Smoothing
                <input
                  type="number"
                  min="1"
                  step="2"
                  value={activeTrace.smoothing}
                  onChange={(event) =>
                    onUpdate(activeTrace.id, {
                      smoothing: Math.max(1, Number(event.target.value)),
                    })
                  }
                />
              </label>
            </div>
            <label className="check-row">
              <input
                type="checkbox"
                checked={activeTrace.baseline}
                onChange={(event) =>
                  onUpdate(activeTrace.id, { baseline: event.target.checked })
                }
              />{" "}
              Baseline correction
            </label>
            <label>
              Normalization
              <select value={activeTrace.normalization} onChange={(event) => onUpdate(activeTrace.id, { normalization: event.target.value as Trace["normalization"] })}>
                <option value="none">None</option><option value="maximum">Maximum to 100%</option><option value="area">Unit integrated area</option>
              </select>
            </label>
            <hr />
            <h4>Selected data region</h4>
            <p>
              {selection
                ? `${selection.start.toFixed(3)}–${selection.end.toFixed(3)}`
                : "Drag a region in Analysis first."}
            </p>
            <div className="row-actions">
              <Button
                variant="outline"
                disabled={!selection}
                onClick={onExclude}
              >
                Exclude points
              </Button>
              <Button
                variant="outline"
                disabled={!selection}
                onClick={onTransform}
              >
                Add regional rescale
              </Button>
            </div>
            {activeTrace.excludedRanges.map((range, index) => (
              <div className="range-row" key={index}>
                <span>
                  Excluded {range.start.toFixed(2)}–{range.end.toFixed(2)}
                </span>
                <button
                  onClick={() =>
                    onUpdate(activeTrace.id, {
                      excludedRanges: activeTrace.excludedRanges.filter(
                        (_, i) => i !== index,
                      ),
                    })
                  }
                >
                  <Trash2 />
                </button>
              </div>
            ))}
            {activeTrace.regionTransforms.map((range, index) => (
              <div className="region-transform" key={index}>
                <span>
                  {range.start.toFixed(2)}–{range.end.toFixed(2)}
                </span>
                <label>
                  Scale
                  <input
                    type="number"
                    step=".1"
                    value={range.scale}
                    onChange={(event) =>
                      onUpdate(activeTrace.id, {
                        regionTransforms: activeTrace.regionTransforms.map(
                          (value, i) =>
                            i === index
                              ? { ...value, scale: Number(event.target.value) }
                              : value,
                        ),
                      })
                    }
                  />
                </label>
                <label>
                  Offset
                  <input
                    type="number"
                    step=".1"
                    value={range.offset}
                    onChange={(event) =>
                      onUpdate(activeTrace.id, {
                        regionTransforms: activeTrace.regionTransforms.map(
                          (value, i) =>
                            i === index
                              ? { ...value, offset: Number(event.target.value) }
                              : value,
                        ),
                      })
                    }
                  />
                </label>
              </div>
            ))}
            <div className="row-actions">
              <Button variant="outline" onClick={onDuplicate}>
                Duplicate trace
              </Button>
              <Button
                variant="ghost"
                className="danger-text"
                onClick={() => onDelete(activeTrace.id)}
              >
                <Trash2 /> Delete
              </Button>
            </div>
          </section>
        )}
      </div>
    </div>
  );
}

type SecFigureConfig = {
  title: string;
  xLabel: string;
  yLabel: string;
  background: string;
  foreground: string;
  fontFamily: string;
  titleSize: number;
  labelSize: number;
  tickSize: number;
  pointSize: number;
  lineWidth: number;
  showNames: boolean;
  showEquation: boolean;
  showBand: boolean;
  grid: boolean;
  width: number;
  height: number;
  exportDpi: number;
};
const defaultSecFigure: SecFigureConfig = {
  title: "Size-exclusion calibration",
  xLabel: "Log Mr (Da)",
  yLabel: "Kav",
  background: "#ffffff",
  foreground: "#182126",
  fontFamily: "Arial",
  titleSize: 18,
  labelSize: 15,
  tickSize: 12,
  pointSize: 7,
  lineWidth: 2.5,
  showNames: true,
  showEquation: true,
  showBand: true,
  grid: false,
  width: 900,
  height: 640,
  exportDpi: 300,
};
// A calibration a researcher can keep, reopen and hand to someone else.
type StandardCurve = {
  id: string;
  name: string;
  column: string;
  vo: number;
  vt: number;
  note: string;
  savedAt: string;
  standards: Standard[];
};
const curveLibraryKey = "protein-labs.sec-standard-curves";
const curveFormat = "protein-labs.sec-standard-curve";
function readCurveLibrary(): StandardCurve[] {
  // Browser storage can be unavailable or cleared; an empty library is a
  // perfectly good state, so a failure here must never break the tab.
  try {
    const raw = window.localStorage.getItem(curveLibraryKey);
    return raw ? array(JSON.parse(raw)).map(loadCurve) : [];
  } catch { return []; }
}
function writeCurveLibrary(curves: StandardCurve[]) {
  try { window.localStorage.setItem(curveLibraryKey, JSON.stringify(curves)); return true; }
  catch { return false; }
}
function loadCurve(raw: JsonObject): StandardCurve {
  return {
    id: String(raw.id ?? crypto.randomUUID()),
    name: String(raw.name ?? "Standard curve"),
    column: String(raw.column ?? raw.columnName ?? ""),
    vo: Number(raw.vo ?? 0),
    vt: Number(raw.vt ?? 0),
    note: String(raw.note ?? ""),
    savedAt: String(raw.savedAt ?? new Date().toISOString()),
    standards: loadStandards(raw.standards),
  };
}
// Why a standard is or is not in the fit, stated in the table rather than left
// to the reader to work out from a missing point.
function standardStatus(value: Standard, vo: number, vt: number) {
  if (!(value.mwDa > 0)) return { ok: false, note: "MW must be above zero" };
  if (!(vt > vo)) return { ok: false, note: "Vt must exceed Vo" };
  if (value.veMl <= vo) return { ok: false, note: "Elutes in the void (Ve ≤ Vo)" };
  if (value.veMl >= vt) return { ok: false, note: "Beyond the total volume (Ve ≥ Vt)" };
  if (!value.included) return { ok: false, note: "Excluded by hand" };
  return { ok: true, note: "In the fit" };
}

const SecCurveFigure = forwardRef<SVGSVGElement, {
  standards: Standard[];
  vo: number;
  vt: number;
  fit: SecFit;
  fitColor: string;
  config: SecFigureConfig;
}>(function SecCurveFigure({ standards, vo, vt, fit, fitColor, config }, ref) {
  const usable = standards.filter((value) => standardStatus(value, vo, vt).ok);
  const plotted = standards.filter((value) => value.mwDa > 0 && vt > vo);
  const W = config.width, H = config.height;
  const left = 96, right = 34, top = 56, bottom = 82;
  const plotW = W - left - right, plotH = H - top - bottom;
  // The axes follow the standards actually entered rather than a fixed
  // 1 kDa–1 MDa window, so the calibration fills the figure whatever the
  // column fractionates.
  const logs = plotted.map((value) => Math.log10(value.mwDa));
  const kavs = plotted.map((value) => kav(value.veMl, vo, vt));
  const xPad = Math.max(0.1, (Math.max(...logs, 0) - Math.min(...logs, 0)) * 0.06);
  const yPad = Math.max(0.02, (Math.max(...kavs, 0) - Math.min(...kavs, 0)) * 0.08);
  const xScale = niceScale(logs.length ? Math.min(...logs) - xPad : 3, logs.length ? Math.max(...logs) + xPad : 6);
  // Kav cannot be negative on a sound calibration, so the axis starts at zero
  // unless a standard actually elutes before the void.
  const kavFloor = kavs.length && Math.min(...kavs) < 0 ? Math.min(...kavs) - yPad : 0;
  const yScale = niceScale(kavFloor, kavs.length ? Math.max(...kavs) + yPad : 1);
  const xMin = xScale.min, xMax = xScale.max, yMin = yScale.min, yMax = yScale.max;
  const sx = (value: number) => left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * plotW;
  const sy = (value: number) => top + plotH - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * plotH;
  const xTicks = xScale.ticks, yTicks = yScale.ticks;
  const clipId = `sec-clip-${Math.abs(Math.round((xMin + yMax) * 1e6))}`;
  const residuals = fit ? usable.map((value) => kav(value.veMl, vo, vt) - (fit.slope * Math.log10(value.mwDa) + fit.intercept)) : [];
  const spread = residuals.length ? Math.sqrt(residuals.reduce((sum, value) => sum + value * value, 0) / residuals.length) : 0;
  return <svg
    ref={ref}
    className="sec-curve-figure"
    viewBox={`0 0 ${W} ${H}`}
    xmlns="http://www.w3.org/2000/svg"
    style={{ fontFamily: config.fontFamily, background: config.background }}
  >
    <rect width={W} height={H} fill={config.background} />
    {config.title && <text x={W / 2} y={34} textAnchor="middle" fontSize={config.titleSize} fontWeight="600" fill={config.foreground}>{config.title}</text>}
    {config.grid && xTicks.map((value) => <line key={`gx-${value}`} x1={sx(value)} x2={sx(value)} y1={top} y2={top + plotH} stroke={config.foreground} opacity=".12" />)}
    {config.grid && yTicks.map((value) => <line key={`gy-${value}`} x1={left} x2={left + plotW} y1={sy(value)} y2={sy(value)} stroke={config.foreground} opacity=".12" />)}
    <clipPath id={clipId}><rect x={left} y={top} width={plotW} height={plotH} /></clipPath>
    {fit && config.showBand && spread > 0 && <path
      clipPath={`url(#${clipId})`}
      d={`M${sx(xMin)} ${sy(fit.slope * xMin + fit.intercept + spread)} L${sx(xMax)} ${sy(fit.slope * xMax + fit.intercept + spread)} L${sx(xMax)} ${sy(fit.slope * xMax + fit.intercept - spread)} L${sx(xMin)} ${sy(fit.slope * xMin + fit.intercept - spread)} Z`}
      fill={fitColor}
      opacity=".13"
    />}
    {fit && <line
      clipPath={`url(#${clipId})`}
      x1={sx(xMin)} y1={sy(fit.slope * xMin + fit.intercept)}
      x2={sx(xMax)} y2={sy(fit.slope * xMax + fit.intercept)}
      stroke={fitColor} strokeWidth={config.lineWidth}
    />}
    <line x1={left} x2={left + plotW} y1={top + plotH} y2={top + plotH} stroke={config.foreground} strokeWidth="1.4" />
    <line x1={left} x2={left} y1={top} y2={top + plotH} stroke={config.foreground} strokeWidth="1.4" />
    {xTicks.map((value) => <g key={`x-${value}`}>
      <line x1={sx(value)} x2={sx(value)} y1={top + plotH} y2={top + plotH + 7} stroke={config.foreground} />
      <text x={sx(value)} y={top + plotH + 26} textAnchor="middle" fontSize={config.tickSize} fill={config.foreground}>{formatTick(value, xTicks)}</text>
    </g>)}
    {yTicks.map((value) => <g key={`y-${value}`}>
      <line x1={left - 7} x2={left} y1={sy(value)} y2={sy(value)} stroke={config.foreground} />
      <text x={left - 12} y={sy(value) + 4} textAnchor="end" fontSize={config.tickSize} fill={config.foreground}>{formatTick(value, yTicks)}</text>
    </g>)}
    <text x={left + plotW / 2} y={H - 26} textAnchor="middle" fontSize={config.labelSize} fontWeight="600" fill={config.foreground}>{config.xLabel}</text>
    <text transform={`translate(${left - 62} ${top + plotH / 2}) rotate(-90)`} textAnchor="middle" fontSize={config.labelSize} fontWeight="600" fill={config.foreground}>{config.yLabel}</text>
    {plotted.map((value) => {
      const inFit = standardStatus(value, vo, vt).ok;
      const x = sx(Math.log10(value.mwDa)), y = sy(kav(value.veMl, vo, vt));
      return <g key={value.id}>
        <circle cx={x} cy={y} r={config.pointSize} fill={inFit ? value.color : config.background} stroke={value.color} strokeWidth="2" opacity={inFit ? 1 : .75} />
        {config.showNames && <text x={x} y={y - config.pointSize - 7} textAnchor="middle" fontSize={config.tickSize} fill={config.foreground}>{value.protein}</text>}
      </g>;
    })}
    {config.showEquation && fit && <text x={left + plotW - 8} y={top + 20} textAnchor="end" fontSize={config.tickSize + 1} fill={config.foreground}>
      Kav = {fit.slope.toFixed(4)} · Log Mr {fit.intercept >= 0 ? "+" : "−"} {Math.abs(fit.intercept).toFixed(4)}
    </text>}
    {config.showEquation && fit && <text x={left + plotW - 8} y={top + 20 + config.tickSize + 6} textAnchor="end" fontSize={config.tickSize + 1} fill={config.foreground}>
      R² = {fit.r2.toFixed(4)} · n = {usable.length}
    </text>}
  </svg>;
});

function StandardWorkspace({
  standards,
  vo,
  vt,
  column,
  voidMarkerMw,
  fit,
  fitColor,
  secFigure,
  onVo,
  onVt,
  onColumn,
  onVoidMarker,
  onFitColor,
  onSecFigure,
  onAdd,
  onUpdate,
  onDelete,
  onReplaceAll,
  onMessage,
}: {
  standards: Standard[];
  vo: number;
  vt: number;
  column: string;
  voidMarkerMw: number;
  fit: SecFit;
  fitColor: string;
  secFigure: SecFigureConfig;
  onVo: (v: number) => void;
  onVt: (v: number) => void;
  onColumn: (v: string) => void;
  onVoidMarker: (v: number) => void;
  onFitColor: (v: string) => void;
  onSecFigure: (patch: Partial<SecFigureConfig>) => void;
  onAdd: () => void;
  onUpdate: (id: string, p: Partial<Standard>) => void;
  onDelete: (id: string) => void;
  onReplaceAll: (curve: StandardCurve) => void;
  onMessage: (text: string) => void;
}) {
  const [library, setLibrary] = useState<StandardCurve[]>([]);
  const [curveName, setCurveName] = useState("");
  const [pasted, setPasted] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const figureRef = useRef<SVGSVGElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  // Browser storage is only readable once mounted, so the library arrives
  // after the first paint rather than during render.
  useEffect(() => { setLibrary(readCurveLibrary()); }, []);
  const voInvalid = !(vt > vo) || vo <= 0;
  const usable = standards.filter((value) => standardStatus(value, vo, vt).ok);

  function currentCurve(name: string): StandardCurve {
    return { id: crypto.randomUUID(), name, column, vo, vt, note: "", savedAt: new Date().toISOString(), standards };
  }
  function saveToLibrary() {
    const name = curveName.trim() || `${column} · ${new Date().toLocaleDateString()}`;
    const next = [currentCurve(name), ...library.filter((value) => value.name !== name)].slice(0, 40);
    setLibrary(next);
    onMessage(writeCurveLibrary(next)
      ? `“${name}” saved. It is available in every project on this computer.`
      : `“${name}” could not be stored by the browser; export it to a file instead.`);
    setCurveName("");
  }
  function openCurve(curve: StandardCurve) {
    onReplaceAll(curve);
    onMessage(`Loaded “${curve.name}” (${curve.standards.length} standards, ${curve.column || "no column recorded"}).`);
  }
  function deleteCurve(id: string) {
    const next = library.filter((value) => value.id !== id);
    setLibrary(next); writeCurveLibrary(next);
  }
  function exportCurve() {
    const name = curveName.trim() || column || "standard-curve";
    downloadText(`${safeFilename(name)}.seccurve`, JSON.stringify({ format: curveFormat, version: 1, ...currentCurve(name) }, null, 2), "application/json");
    onMessage("Standard curve exported. The file can be opened by anyone running Protein Lab.");
  }
  async function copyCurve() {
    const text = JSON.stringify({ format: curveFormat, version: 1, ...currentCurve(curveName.trim() || column) });
    try { await navigator.clipboard.writeText(text); onMessage("Standard curve copied. Paste it into a message to share it."); }
    catch { onMessage("The clipboard is unavailable; export the curve to a file instead."); }
  }
  function adoptParsed(raw: unknown, origin: string) {
    const source = object(raw);
    const curve = loadCurve(object(source.curve ?? source));
    if (!curve.standards.length) throw new Error("no protein standards were found");
    onReplaceAll(curve);
    onMessage(`Loaded ${curve.standards.length} standards from ${origin}.`);
  }
  async function importCurve(files: FileList | null) {
    const file = files?.[0]; if (!file) return;
    try { adoptParsed(JSON.parse(decodeData(await file.arrayBuffer())), file.name); }
    catch (reason) { onMessage(`Could not open that standard curve: ${errorText(reason)}`); }
    finally { if (fileRef.current) fileRef.current.value = ""; }
  }
  function importPasted() {
    try { adoptParsed(JSON.parse(pasted), "the pasted curve"); setPasted(""); setShowPaste(false); }
    catch (reason) { onMessage(`That text is not a standard curve: ${errorText(reason)}`); }
  }
  async function exportFigure(kind: "svg" | "png" | "pdf" | "tiff") {
    const name = safeFilename(secFigure.title || "standard-curve");
    if (kind === "svg") {
      const source = figureRef.current?.outerHTML;
      if (source) { downloadText(`${name}.svg`, source, "image/svg+xml"); onMessage("Standard-curve figure exported as vector SVG."); }
      return;
    }
    const canvas = await rasterizeSvg(figureRef.current, secFigure.width, secFigure.height, secFigure.exportDpi, secFigure.background);
    if (!canvas) return;
    if (kind === "tiff") {
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height);
      downloadBlob(`${name}.tiff`, new Blob([encodeTiffRgba(pixels, secFigure.exportDpi)], { type: "image/tiff" }));
      onMessage(`Standard-curve TIFF exported at ${secFigure.exportDpi} dpi.`);
      return;
    }
    canvas.toBlob((blob) => {
      if (!blob) return;
      if (kind === "png") { downloadBlob(`${name}.png`, blob); onMessage(`Standard-curve PNG exported at ${secFigure.exportDpi} dpi.`); return; }
      void blob.arrayBuffer().then((buffer) => {
        downloadBlob(`${name}.pdf`, new Blob([buildImagePdf(new Uint8Array(buffer), canvas.width, canvas.height, secFigure.exportDpi)], { type: "application/pdf" }));
        onMessage("Standard-curve PDF exported.");
      });
    }, kind === "png" ? "image/png" : "image/jpeg", .96);
  }

  return (
    <div className="standard-workspace">
      <header>
        <span className="eyebrow">SIZE-EXCLUSION CALIBRATION</span>
        <h2>Protein standards and SEC curve</h2>
        <p>
          Enter only retention volume and molecular weight. Derived Log Mr,
          Ve/Vo, and Kav update automatically.
        </p>
      </header>
      <div className="sec-settings">
        <label>
          Prepacked column
          <select value={column} onChange={(event) => onColumn(event.target.value)}>
            {columns.map((value) => (
              <option key={value.name}>{value.name}</option>
            ))}
          </select>
        </label>
        <label>
          Total geometric column volume Vt (mL)
          <input type="number" step=".01" value={vt} onChange={(event) => onVt(Number(event.target.value))} />
        </label>
        <label>
          Void volume Vo (mL)
          <input type="number" step=".01" value={vo} onChange={(event) => onVo(Number(event.target.value))} />
        </label>
        <label>
          Void-marker MW (Da)
          <input type="number" value={voidMarkerMw} onChange={(event) => onVoidMarker(Number(event.target.value))} />
        </label>
        <label>
          Fit-line color
          <input type="color" value={fitColor} onChange={(event) => onFitColor(event.target.value)} />
        </label>
      </div>
      {voInvalid && <div className="warning-note">
        <CircleAlert /> Kav needs 0 &lt; Vo &lt; Vt. Vo is {vo} mL and Vt is {vt} mL, so no Kav can be calculated — set the void volume measured on this column.
      </div>}

      <div className="curve-library">
        <div className="curve-library-actions">
          <label className="curve-name">Curve name<input value={curveName} placeholder={`${column} · today`} onChange={(event) => setCurveName(event.target.value)} /></label>
          <Button variant="outline" size="sm" onClick={saveToLibrary}><Save /> Save curve</Button>
          <label className="upload-button compact"><FolderOpen /> Open .seccurve<input ref={fileRef} type="file" accept=".seccurve,application/json" onChange={(event) => void importCurve(event.target.files)} /></label>
          <Button variant="outline" size="sm" onClick={exportCurve}><Download /> Export to share</Button>
          <Button variant="outline" size="sm" onClick={() => void copyCurve()}><Clipboard /> Copy curve</Button>
          <Button variant="ghost" size="sm" onClick={() => setShowPaste((value) => !value)}>Paste a shared curve</Button>
        </div>
        {showPaste && <div className="curve-paste">
          <textarea rows={3} value={pasted} placeholder="Paste the copied standard curve here" onChange={(event) => setPasted(event.target.value)} />
          <Button size="sm" disabled={!pasted.trim()} onClick={importPasted}>Load pasted curve</Button>
        </div>}
        {library.length > 0 && <div className="curve-list">
          {library.map((curve) => <article key={curve.id}>
            <span>
              <strong>{curve.name}</strong>
              <small>{curve.standards.length} standards · {curve.column || "no column"} · Vo {curve.vo} / Vt {curve.vt} mL</small>
            </span>
            <Button size="sm" variant="outline" onClick={() => openCurve(curve)}>Load</Button>
            <button className="curve-delete" title="Remove from this computer" onClick={() => deleteCurve(curve.id)}><Trash2 /></button>
          </article>)}
        </div>}
      </div>

      <div className="standard-layout">
        <section>
          <div className="standard-table">
            <div>
              <b>Use</b>
              <b>Protein standard</b>
              <b>MW (Da)</b>
              <b>Ve (mL)</b>
              <b>Log Mr</b>
              <b>Ve/Vo</b>
              <b>Kav</b>
              <b>Status</b>
              <b>Color</b>
              <b />
            </div>
            {standards.map((value) => {
              const status = standardStatus(value, vo, vt);
              return (
                <div key={value.id} className={status.ok ? "" : "excluded"}>
                  <input type="checkbox" checked={value.included} onChange={(event) => onUpdate(value.id, { included: event.target.checked })} />
                  <input value={value.protein} onChange={(event) => onUpdate(value.id, { protein: event.target.value })} />
                  <input type="number" value={value.mwDa} onChange={(event) => onUpdate(value.id, { mwDa: Number(event.target.value) })} />
                  <input type="number" step=".01" value={value.veMl} onChange={(event) => onUpdate(value.id, { veMl: Number(event.target.value) })} />
                  <span>{value.mwDa > 0 ? Math.log10(value.mwDa).toFixed(4) : "—"}</span>
                  <span>{vo > 0 ? (value.veMl / vo).toFixed(4) : "—"}</span>
                  <span>{vt > vo ? kav(value.veMl, vo, vt).toFixed(4) : "—"}</span>
                  <span className={status.ok ? "standard-ok" : "standard-why"}>{status.note}</span>
                  <input type="color" value={value.color} onChange={(event) => onUpdate(value.id, { color: event.target.value })} />
                  <button onClick={() => onDelete(value.id)}>
                    <Trash2 />
                  </button>
                </div>
              );
            })}
          </div>
          <Button variant="outline" onClick={onAdd}>
            <Plus /> Add standard
          </Button>
        </section>
        <section className="sec-plot">
          <SecCurveFigure ref={figureRef} standards={standards} vo={vo} vt={vt} fit={fit} fitColor={fitColor} config={secFigure} />
          {fit ? (
            <div>
              <strong>
                Kav = {fit.slope.toFixed(4)} Log Mr {fit.intercept >= 0 ? "+" : "−"} {Math.abs(fit.intercept).toFixed(4)}
              </strong>
              <span>R² = {fit.r2.toFixed(5)} from {usable.length} standards</span>
            </div>
          ) : (
            <div className="warning-note">
              <CircleAlert /> Include at least two standards that elute between Vo and Vt.
            </div>
          )}
          <div className="sec-figure-controls">
            <label>Figure title<input value={secFigure.title} onChange={(event) => onSecFigure({ title: event.target.value })} /></label>
            <div className="coordinate-row">
              <label>X axis label<input value={secFigure.xLabel} onChange={(event) => onSecFigure({ xLabel: event.target.value })} /></label>
              <label>Y axis label<input value={secFigure.yLabel} onChange={(event) => onSecFigure({ yLabel: event.target.value })} /></label>
            </div>
            <div className="coordinate-row">
              <label>Font
                <select value={secFigure.fontFamily} onChange={(event) => onSecFigure({ fontFamily: event.target.value })}>
                  <option>Arial</option><option>Helvetica</option><option>Inter</option><option>Georgia</option><option>Times New Roman</option>
                </select>
              </label>
              <label>Export DPI
                <select value={secFigure.exportDpi} onChange={(event) => onSecFigure({ exportDpi: Number(event.target.value) })}>
                  <option value={150}>150</option><option value={300}>300</option><option value={600}>600</option><option value={1200}>1200</option>
                </select>
              </label>
            </div>
            <div className="coordinate-row">
              <label>Width (px)<input type="number" min="400" max="4000" value={secFigure.width} onChange={(event) => onSecFigure({ width: Number(event.target.value) })} /></label>
              <label>Height (px)<input type="number" min="300" max="4000" value={secFigure.height} onChange={(event) => onSecFigure({ height: Number(event.target.value) })} /></label>
            </div>
            <div className="sec-figure-toggles">
              <label className="check-row"><input type="checkbox" checked={secFigure.showNames} onChange={(event) => onSecFigure({ showNames: event.target.checked })} /> Label each standard</label>
              <label className="check-row"><input type="checkbox" checked={secFigure.showEquation} onChange={(event) => onSecFigure({ showEquation: event.target.checked })} /> Show equation and R²</label>
              <label className="check-row"><input type="checkbox" checked={secFigure.showBand} onChange={(event) => onSecFigure({ showBand: event.target.checked })} /> Show residual band</label>
              <label className="check-row"><input type="checkbox" checked={secFigure.grid} onChange={(event) => onSecFigure({ grid: event.target.checked })} /> Grid lines</label>
            </div>
            <div className="sec-figure-exports">
              <Button size="sm" variant="outline" onClick={() => void exportFigure("svg")}>SVG</Button>
              <Button size="sm" variant="outline" onClick={() => void exportFigure("png")}>PNG</Button>
              <Button size="sm" variant="outline" onClick={() => void exportFigure("tiff")}>TIFF</Button>
              <Button size="sm" variant="outline" onClick={() => void exportFigure("pdf")}>PDF</Button>
            </div>
          </div>
        </section>
      </div>
    </div>
  );
}

// Kept only so older saved project payloads remain source-compatible; this
// legacy renderer is intentionally not mounted or exposed as a Studio tab.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function MassFiguresWorkspace({
  standards,
  config,
  trace,
  processed,
  peaks,
  onStandards,
  onConfig,
}: {
  standards: MassStandard[];
  config: MassFigureConfig;
  trace?: Trace;
  processed: Point[];
  peaks: Peak[];
  onStandards: (values: MassStandard[]) => void;
  onConfig: (patch: Partial<MassFigureConfig>) => void;
}) {
  const svgRef = useRef<SVGSVGElement>(null);
  const fit = useMemo(() => fitMass(standards), [standards]);
  const signals = useMemo(() => {
    if (config.source === "x") return processed.map((point) => point.x);
    if (config.source === "response") return processed.map((point) => point.y);
    if (config.source === "peaks") return peaks.map((peak) => peak.response);
    return parseNumberList(config.pastedSignals);
  }, [config.pastedSignals, config.source, peaks, processed]);
  const masses = useMemo(() => fit && fit.slope ? signals.map((signal) => (signal - fit.intercept) / fit.slope).filter((value) => Number.isFinite(value) && value >= 0) : [], [fit, signals]);
  const histogram = useMemo(() => histogramBins(masses, config.bins), [masses, config.bins]);

  function updateStandard(id: string, patch: Partial<MassStandard>) { onStandards(standards.map((value) => value.id === id ? { ...value, ...patch } : value)); }
  function addStandard() { onStandards([...standards, { id: crypto.randomUUID(), label: `Standard ${standards.length + 1}`, massKDa: 100, signal: .02, included: true, color: traceColors[standards.length % traceColors.length] }]); }
  function exportSvg() { if (!svgRef.current) return; const source = new XMLSerializer().serializeToString(svgRef.current); downloadText(config.view === "calibration" ? "mass-calibration.svg" : "mass-histogram.svg", source, "image/svg+xml"); }
  async function exportPng() {
    if (!svgRef.current) return;
    const source = new XMLSerializer().serializeToString(svgRef.current);
    const url = URL.createObjectURL(new Blob([source], { type: "image/svg+xml" }));
    const image = new Image();
    image.onload = () => {
      const canvas = document.createElement("canvas"); canvas.width = 1600; canvas.height = 960;
      const context = canvas.getContext("2d"); if (!context) return;
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); context.drawImage(image, 0, 0, canvas.width, canvas.height);
      canvas.toBlob((blob) => { if (!blob) return; const link = document.createElement("a"); const png = URL.createObjectURL(blob); link.href = png; link.download = config.view === "calibration" ? "mass-calibration.png" : "mass-histogram.png"; link.click(); URL.revokeObjectURL(png); }, "image/png");
      URL.revokeObjectURL(url);
    };
    image.src = url;
  }

  return <div className="mass-figure-workspace">
    <header><span className="eyebrow">MASS-PHOTOMETRY STYLE FIGURES</span><h2>Calibration and mass distribution</h2><p>Build the linear contrast-to-mass relationship shown in Figure 3, then create the count histogram shown in Figure 4.</p></header>
    <div className="mass-figure-tabs"><button className={config.view === "calibration" ? "active" : ""} onClick={() => onConfig({ view: "calibration" })}><b>3</b><span><strong>Mass calibration</strong><small>Known mass versus measured contrast</small></span></button><button className={config.view === "histogram" ? "active" : ""} onClick={() => onConfig({ view: "histogram" })}><b>4</b><span><strong>Mass histogram</strong><small>Counts from calibrated measurements</small></span></button></div>
    <div className="mass-figure-layout">
      <section className="mass-figure-controls">
        <h3>Calibration standards</h3>
        <div className="mass-standard-table"><div><b>Use</b><b>Label</b><b>Mass (kDa)</b><b>Contrast / response</b><b>Color</b><b/></div>{standards.map((value) => <div key={value.id}><input type="checkbox" checked={value.included} onChange={(event) => updateStandard(value.id, { included: event.target.checked })}/><input value={value.label} onChange={(event) => updateStandard(value.id, { label: event.target.value })}/><input type="number" min="0" value={value.massKDa} onChange={(event) => updateStandard(value.id, { massKDa: Number(event.target.value) })}/><input type="number" step=".0001" value={value.signal} onChange={(event) => updateStandard(value.id, { signal: Number(event.target.value) })}/><input type="color" value={value.color} onChange={(event) => updateStandard(value.id, { color: event.target.value })}/><button onClick={() => onStandards(standards.filter((item) => item.id !== value.id))}><Trash2/></button></div>)}</div>
        <Button variant="outline" size="sm" onClick={addStandard}><Plus/> Add standard</Button>
        <h3>Single-particle measurements</h3>
        <label>Measurement source<select value={config.source} onChange={(event) => onConfig({ source: event.target.value as MassFigureConfig["source"] })}><option value="pasted">Pasted contrast / response values</option><option value="x">Active spectrum X values</option><option value="response">Active spectrum response values</option><option value="peaks">Detected peak responses</option></select></label>
        {config.source === "pasted" ? <label>Paste one value per line or a delimited row<textarea rows={6} value={config.pastedSignals} onChange={(event) => onConfig({ pastedSignals: event.target.value })} placeholder={"0.0082\n0.0104\n0.0111\n…"}/></label> : <div className="mass-source-summary"><Activity/><span><strong>{trace?.name ?? "No active spectrum"}</strong><small>{signals.length} values available from {config.source}</small></span></div>}
        <div className="mass-style-grid"><label>Fit line<input type="color" value={config.lineColor} onChange={(event) => onConfig({ lineColor: event.target.value })}/></label><label>Histogram<input type="color" value={config.histogramColor} onChange={(event) => onConfig({ histogramColor: event.target.value })}/></label><label>Bins<input type="number" min="5" max="150" value={config.bins} onChange={(event) => onConfig({ bins: Math.max(5, Math.min(150, Number(event.target.value))) })}/></label><label>Opacity<input type="range" min="0" max="1" step=".05" value={config.histogramOpacity} onChange={(event) => onConfig({ histogramOpacity: Number(event.target.value) })}/></label></div>
      </section>
      <section className="mass-figure-preview">
        {config.view === "calibration" ? <MassCalibrationSvg ref={svgRef} standards={standards} fit={fit} lineColor={config.lineColor}/> : <MassHistogramSvg ref={svgRef} bins={histogram} color={config.histogramColor} opacity={config.histogramOpacity} title={config.title}/>} 
        <footer><div>{fit ? <><strong>Contrast = {fit.slope.toPrecision(5)} × mass + {fit.intercept.toPrecision(4)}</strong><small>R² {fit.r2.toFixed(5)} · {masses.length} calibrated measurements</small></> : <><strong>Add at least two standards</strong><small>A valid linear calibration is required to calculate mass.</small></>}</div><Button variant="outline" size="sm" onClick={exportSvg}><FileDown/> SVG</Button><Button variant="outline" size="sm" onClick={() => void exportPng()}><ImageIcon/> PNG</Button></footer>
      </section>
    </div>
  </div>;
}

const MassCalibrationSvg = forwardRef<SVGSVGElement, { standards: MassStandard[]; fit: ReturnType<typeof fitMass>; lineColor: string }>(function MassCalibrationSvg({ standards, fit, lineColor }, ref) {
  const valid = standards.filter((value) => value.massKDa >= 0 && Number.isFinite(value.signal));
  const xMax = Math.max(1, ...valid.map((value) => value.massKDa)) * 1.12;
  const yValues = valid.map((value) => value.signal); const yMin = Math.min(0, ...yValues); const yMax = Math.max(.01, ...yValues) * 1.15;
  const sx = (value: number) => 78 + value / xMax * 650; const sy = (value: number) => 404 - (value - yMin) / Math.max(1e-9, yMax - yMin) * 330;
  return <svg ref={ref} className="mass-publication-figure" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="480" fill="#fff"/><circle cx="48" cy="46" r="26" fill="#63a9df"/><text x="48" y="56" textAnchor="middle" fontSize="29" fontWeight="800" fill="#fff">3</text><text x="400" y="48" textAnchor="middle" fontSize="18" fontWeight="700" fill="#17435a">Interference contrast scales linearly with particle mass</text><line x1="78" x2="742" y1="404" y2="404" stroke="#17435a" strokeWidth="4"/><line x1="78" x2="78" y1="70" y2="404" stroke="#17435a" strokeWidth="4"/>{Array.from({ length: 6 }, (_, index) => index * xMax / 5).map((value) => <g key={value}><line x1={sx(value)} x2={sx(value)} y1="404" y2="411" stroke="#17435a" strokeWidth="2"/><text x={sx(value)} y="432" textAnchor="middle" fontSize="12" fill="#17435a">{value.toFixed(0)}</text></g>)}{fit && <><line x1={sx(0)} y1={sy(fit.intercept)} x2={sx(xMax)} y2={sy(fit.slope * xMax + fit.intercept)} stroke="#121b20" strokeWidth="9" opacity=".2"/><line x1={sx(0)} y1={sy(fit.intercept)} x2={sx(xMax)} y2={sy(fit.slope * xMax + fit.intercept)} stroke={lineColor} strokeWidth="5"/></>}{valid.map((value) => <g key={value.id}><circle cx={sx(value.massKDa)} cy={sy(value.signal)} r="10" fill={value.color} stroke="#17242b" strokeWidth="3"/><text x={sx(value.massKDa)} y={sy(value.signal)-16} textAnchor="middle" fontSize="11" fontWeight="700" fill="#17435a">{value.label}</text></g>)}<text x="410" y="466" textAnchor="middle" fontSize="17" fontWeight="700" fill="#17435a">Mass (kDa)</text><text transform="translate(25 240) rotate(-90)" textAnchor="middle" fontSize="17" fontWeight="700" fill="#17435a">Contrast / response</text></svg>;
});

const MassHistogramSvg = forwardRef<SVGSVGElement, { bins: { start: number; end: number; count: number }[]; color: string; opacity: number; title: string }>(function MassHistogramSvg({ bins, color, opacity, title }, ref) {
  const xMin = bins[0]?.start ?? 0, xMax = bins.at(-1)?.end ?? 1, maxCount = Math.max(1, ...bins.map((value) => value.count));
  const sx = (value: number) => 78 + (value - xMin) / Math.max(1e-9, xMax - xMin) * 650; const sy = (value: number) => 404 - value / maxCount * 320;
  const curve = bins.map((value, index) => `${index ? "L" : "M"}${sx((value.start + value.end) / 2).toFixed(2)} ${sy(value.count).toFixed(2)}`).join(" ");
  return <svg ref={ref} className="mass-publication-figure" viewBox="0 0 800 480" xmlns="http://www.w3.org/2000/svg"><rect width="800" height="480" fill="#fff"/><circle cx="48" cy="46" r="26" fill="#63a9df"/><text x="48" y="56" textAnchor="middle" fontSize="29" fontWeight="800" fill="#fff">4</text><text x="410" y="48" textAnchor="middle" fontSize="19" fontWeight="700" fill="#17435a">{title}</text><line x1="78" x2="742" y1="404" y2="404" stroke="#17435a" strokeWidth="4"/><line x1="78" x2="78" y1="70" y2="404" stroke="#17435a" strokeWidth="4"/>{bins.map((value, index) => <rect key={index} x={sx(value.start)} y={sy(value.count)} width={Math.max(1, sx(value.end)-sx(value.start)-.6)} height={404-sy(value.count)} fill={color} fillOpacity={opacity} stroke={color} strokeWidth=".8"/>)}{curve && <path d={curve} fill="none" stroke="#245f8c" strokeWidth="3" strokeLinejoin="round"/>}{Array.from({ length: 6 }, (_, index) => xMin + index * (xMax-xMin)/5).map((value) => <g key={value}><line x1={sx(value)} x2={sx(value)} y1="404" y2="411" stroke="#17435a" strokeWidth="2"/><text x={sx(value)} y="432" textAnchor="middle" fontSize="12" fill="#17435a">{value.toFixed(0)}</text></g>)}<text x="410" y="466" textAnchor="middle" fontSize="17" fontWeight="700" fill="#17435a">Mass (kDa)</text><text transform="translate(25 240) rotate(-90)" textAnchor="middle" fontSize="17" fontWeight="700" fill="#17435a">Counts</text></svg>;
});

function AnalysisInspector({
  trace,
  peak,
  annotation,
  inspector,
  onInspector,
  onTrace,
  onPeak,
  onAnnotation,
  onDeleteAnnotation,
  onBounds,
  onDeletePeak,
  fractions,
  onFractions,
}: {
  trace?: Trace;
  peak?: Peak;
  annotation?: AnnotationItem;
  inspector: string;
  onInspector: (v: "trace" | "peak" | "annotation" | "axis" | "figure") => void;
  onTrace: (p: Partial<Trace>) => void;
  onPeak: (p: Partial<Peak>) => void;
  onAnnotation: (p: Partial<AnnotationItem>) => void;
  onDeleteAnnotation: () => void;
  onBounds: (r: Range) => void;
  onDeletePeak: () => void;
  fractions: (Range & {
    id: string;
    name: string;
    color: string;
    opacity: number;
  })[];
  onFractions: (
    v: (Range & { id: string; name: string; color: string; opacity: number })[],
  ) => void;
}) {
  return (
    <>
      <div className="inspector-tabs">
        <button
          className={inspector === "trace" ? "active" : ""}
          onClick={() => onInspector("trace")}
        >
          Spectrum
        </button>
        <button
          className={inspector === "peak" ? "active" : ""}
          onClick={() => onInspector("peak")}
        >
          Peak
        </button>
        <button className={inspector === "annotation" ? "active" : ""} onClick={() => onInspector("annotation")}>Marker</button>
      </div>
      {inspector === "annotation" && annotation ? (
        annotation.kind === "arrow" ? (
        <div className="object-inspector">
          <h3>Arrow marker</h3>
          <p className="inspector-note">The tip sits on the arrow&rsquo;s own coordinates. Drag it onto the shoulder, then set the direction it points from.</p>
          <label>Color<input type="color" value={annotation.color} onChange={(event) => onAnnotation({ color: event.target.value })}/></label>
          <label>Direction · {annotation.angle}°<input type="range" min="0" max="350" step="10" value={annotation.angle} onChange={(event) => onAnnotation({ angle: Number(event.target.value) })}/></label>
          <div className="coordinate-row">
            <label>Length<input type="number" min="12" max="220" value={annotation.length} onChange={(event) => onAnnotation({ length: Number(event.target.value) })}/></label>
            <label>Thickness<input type="number" min="3" max="40" value={annotation.thickness} onChange={(event) => onAnnotation({ thickness: Number(event.target.value) })}/></label>
          </div>
          <div className="coordinate-row">
            <label>X position<input type="number" step=".01" value={annotation.x} onChange={(event) => onAnnotation({ x: Number(event.target.value) })}/></label>
            <label>Y position (%)<input type="number" min="0" max="100" value={annotation.y} onChange={(event) => onAnnotation({ y: Number(event.target.value) })}/></label>
          </div>
          <Button variant="ghost" className="danger-text" onClick={onDeleteAnnotation}><Trash2/> Delete arrow</Button>
        </div>
        ) : (
        <div className="object-inspector"><h3>Text annotation</h3><label>Text<textarea value={annotation.text} onChange={(event) => onAnnotation({ text: event.target.value })}/></label><label>Text color<input type="color" value={annotation.color} onChange={(event) => onAnnotation({ color: event.target.value })}/></label><label>Background<input type="color" value={annotation.background} onChange={(event) => onAnnotation({ background: event.target.value })}/></label><label>Font size · {annotation.fontSize}px<input type="range" min="7" max="36" value={annotation.fontSize} onChange={(event) => onAnnotation({ fontSize: Number(event.target.value) })}/></label><label className="check-row"><input type="checkbox" checked={annotation.border} onChange={(event) => onAnnotation({ border: event.target.checked })}/> Show background and border</label><div className="coordinate-row"><label>X position<input type="number" step=".01" value={annotation.x} onChange={(event) => onAnnotation({ x: Number(event.target.value) })}/></label><label>Y position (%)<input type="number" min="0" max="100" value={annotation.y} onChange={(event) => onAnnotation({ y: Number(event.target.value) })}/></label></div><Button variant="ghost" className="danger-text" onClick={onDeleteAnnotation}><Trash2/> Delete annotation</Button></div>
        )
      ) : inspector === "peak" && peak ? (
        <div className="object-inspector">
          <h3>{peak.name}</h3>
          <label>
            Name
            <input
              value={peak.name}
              onChange={(event) => onPeak({ name: event.target.value })}
            />
          </label>
          <div className="coordinate-row">
            <label>
              Start
              <input
                type="number"
                step=".01"
                value={peak.start}
                onChange={(event) =>
                  onBounds({ start: Number(event.target.value), end: peak.end })
                }
              />
            </label>
            <label>
              End
              <input
                type="number"
                step=".01"
                value={peak.end}
                onChange={(event) =>
                  onBounds({
                    start: peak.start,
                    end: Number(event.target.value),
                  })
                }
              />
            </label>
          </div>
          <h4>Highlighted area</h4>
          <label>
            Fill color
            <input
              type="color"
              value={peak.fillColor}
              onChange={(event) => onPeak({ fillColor: event.target.value })}
            />
          </label>
          <label>
            Fill opacity · {Math.round(peak.fillOpacity * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step=".01"
              value={peak.fillOpacity}
              onChange={(event) =>
                onPeak({ fillOpacity: Number(event.target.value) })
              }
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={peak.fillVisible}
              onChange={(event) =>
                onPeak({ fillVisible: event.target.checked })
              }
            />{" "}
            Show area fill
          </label>
          <label>
            Peak and annotation color
            <input
              type="color"
              value={peak.color}
              onChange={(event) => onPeak({ color: event.target.value })}
            />
          </label>
          <label>
            Peak outline width · {peak.outlineWidth.toFixed(1)} px
            <input
              type="range"
              min="0"
              max="8"
              step=".25"
              value={peak.outlineWidth}
              onChange={(event) =>
                onPeak({ outlineWidth: Number(event.target.value) })
              }
            />
          </label>
          <h4>Statistics box</h4>
          {[
            ["showVe", "Retention volume"],
            ["showResponse", "Response"],
            ["showArea", "Area"],
            ["showMw", "Relative MW"],
          ].map(([key, label]) => (
            <label className="check-row" key={key}>
              <input
                type="checkbox"
                checked={Boolean(peak[key as keyof Peak])}
                onChange={(event) => onPeak({ [key]: event.target.checked })}
              />
              {label}
            </label>
          ))}
          <label>
            Custom text
            <textarea
              value={peak.customText}
              onChange={(event) => onPeak({ customText: event.target.value })}
            />
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={peak.calloutVisible}
              onChange={(event) =>
                onPeak({ calloutVisible: event.target.checked })
              }
            />{" "}
            Show annotation box
          </label>
          <label className="check-row">
            <input
              type="checkbox"
              checked={peak.calloutBorder}
              onChange={(event) =>
                onPeak({ calloutBorder: event.target.checked })
              }
            />{" "}
            Show box and connector lines
          </label>
          <div className="peak-readout">
            <span>
              Ve <b>{peak.apexX.toFixed(3)} mL</b>
            </span>
            <span>
              Response <b>{peak.response.toFixed(3)}</b>
            </span>
            <span>
              Area <b>{peak.area.toFixed(3)}</b>
            </span>
            <span>
              Integrated <b>{peak.start.toFixed(3)} – {peak.end.toFixed(3)} mL</b>
            </span>
            <span>
              MW{" "}
              <b>
                {peak.mwKDa ? `${peak.mwKDa.toFixed(2)} kDa` : "Outside Vo–Vt"}
              </b>
            </span>
          </div>
          <Button
            variant="ghost"
            className="danger-text"
            onClick={onDeletePeak}
          >
            <Trash2 /> Delete peak
          </Button>
        </div>
      ) : trace ? (
        <div className="object-inspector">
          <h3>{trace.name}</h3>
          <label>
            Line color
            <input
              type="color"
              value={trace.color}
              onChange={(event) => onTrace({ color: event.target.value })}
            />
          </label>
          <label>
            Width
            <input
              type="range"
              min=".5"
              max="8"
              step=".25"
              value={trace.lineWidth}
              onChange={(event) =>
                onTrace({ lineWidth: Number(event.target.value) })
              }
            />
          </label>
          <label>
            Style
            <select
              value={trace.lineStyle}
              onChange={(event) => onTrace({ lineStyle: event.target.value })}
            >
              <option value="solid">Solid</option>
              <option value="dashed">Dashed</option>
              <option value="dotted">Dotted</option>
              <option value="dashdot">Dash-dot</option>
            </select>
          </label>
          <label>
            Opacity · {Math.round(trace.opacity * 100)}%
            <input
              type="range"
              min="0"
              max="1"
              step=".01"
              value={trace.opacity}
              onChange={(event) =>
                onTrace({ opacity: Number(event.target.value) })
              }
            />
          </label>
          <label className="check-row"><input type="checkbox" checked={trace.fillVisible} onChange={(event) => onTrace({ fillVisible: event.target.checked })}/> Fill under spectrum</label>
          {trace.fillVisible && <><label>Area color<input type="color" value={trace.fillColor} onChange={(event) => onTrace({ fillColor: event.target.value })}/></label><label>Area opacity · {Math.round(trace.fillOpacity * 100)}%<input type="range" min="0" max="1" step=".01" value={trace.fillOpacity} onChange={(event) => onTrace({ fillOpacity: Number(event.target.value) })}/></label></>}
          <hr />
          <h4>Fraction regions</h4>
          {fractions.map((value) => (
            <div className="fraction-row" key={value.id}>
              <input
                value={value.name}
                onChange={(event) =>
                  onFractions(
                    fractions.map((item) =>
                      item.id === value.id
                        ? { ...item, name: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <input
                type="color"
                value={value.color}
                onChange={(event) =>
                  onFractions(
                    fractions.map((item) =>
                      item.id === value.id
                        ? { ...item, color: event.target.value }
                        : item,
                    ),
                  )
                }
              />
              <button
                onClick={() =>
                  onFractions(fractions.filter((item) => item.id !== value.id))
                }
              >
                <Trash2 />
              </button>
            </div>
          ))}
        </div>
      ) : (
        <div className="inspector-help">
          <MousePointer2 />
          <strong>Select a spectrum or peak</strong>
        </div>
      )}
    </>
  );
}

function FigureInspector({
  figure,
  focus,
  onChange,
  onPalette,
}: {
  figure: FigureConfig;
  focus: string;
  onChange: (p: Partial<FigureConfig>) => void;
  onPalette: (name: string) => void;
}) {
  const [section, setSection] = useState(focus === "axis" ? "axes" : "layout");
  return (
    <div className="figure-inspector">
      <header>
        <strong>Figure setup</strong>
      </header>
      {[
        ["layout", "Spectra layout"],
        ["style", "Style"],
        ["axes", "Axes"],
        ["fonts", "Fonts"],
        ["export", "Canvas"],
      ].map(([id, label]) => (
        <section key={id}>
          <button
            className="accordion-button"
            onClick={() => setSection(section === id ? "" : id)}
          >
            <span>{label}</span>
            <b>{section === id ? "−" : "+"}</b>
          </button>
          {section === id && (
            <div className="accordion-content">
              {id === "layout" && (
                <>
                  <div className="figure-presets">
                    <Button size="sm" variant="outline" onClick={() => onChange(alignedPreset)}>Aligned overlay</Button>
                    <Button size="sm" variant="outline" onClick={() => onChange(stackedPreset)}>Stacked panels</Button>
                  </div>
                  <p className="inspector-note">A preset sets the layout, alignment, legend and box style for that figure type; everything stays editable afterwards.</p>
                  <label>
                    Layout
                    <select
                      value={figure.layout}
                      onChange={(event) =>
                        onChange({
                          layout: event.target.value as FigureConfig["layout"],
                        })
                      }
                    >
                      <option value="stacked">Stacked panels</option>
                      <option value="overlay">Overlaid spectra</option>
                    </select>
                  </label>
                  <label>
                    Alignment
                    <select
                      value={figure.align}
                      onChange={(event) =>
                        onChange({
                          align: event.target.value as FigureConfig["align"],
                        })
                      }
                    >
                      <option value="none">Original x positions</option>
                      <option value="peak">Align strongest peaks</option>
                      <option value="manual">Use per-trace x shift</option>
                    </select>
                  </label>
                  <label>Figure-only normalization<select value={figure.normalization} onChange={(event) => onChange({ normalization: event.target.value as FigureConfig["normalization"] })}><option value="none">None</option><option value="maximum">Maximum</option><option value="area">Area</option></select></label>
                  {figure.align === "peak" && <div className="coordinate-row"><label>Alignment window start<input value={figure.alignmentStart} onChange={(event) => onChange({ alignmentStart: event.target.value })} placeholder="auto"/></label><label>Window end<input value={figure.alignmentEnd} onChange={(event) => onChange({ alignmentEnd: event.target.value })} placeholder="auto"/></label><label>Target X<input value={figure.alignmentTarget} onChange={(event) => onChange({ alignmentTarget: event.target.value })} placeholder="first spectrum"/></label></div>}
                  <label>
                    Panel gap · {figure.panelGap}px
                    <input
                      type="range"
                      min="0"
                      max="60"
                      value={figure.panelGap}
                      onChange={(event) =>
                        onChange({ panelGap: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={figure.showLegend}
                      onChange={(event) =>
                        onChange({ showLegend: event.target.checked })
                      }
                    />{" "}
                    Show legend
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={figure.showSec}
                      onChange={(event) =>
                        onChange({ showSec: event.target.checked })
                      }
                    />{" "}
                    Include standard curve inset
                  </label>
                  <label className="check-row"><input type="checkbox" checked={figure.sharedYScale} onChange={(event) => onChange({ sharedYScale: event.target.checked })}/> Shared Y scale</label>
                  <label className="check-row"><input type="checkbox" checked={figure.showPanelLabels} onChange={(event) => onChange({ showPanelLabels: event.target.checked })}/> Panel labels</label>
                </>
              )}
              {id === "style" && (
                <>
                  <label>
                    Quick theme
                    <select
                      value={figure.theme}
                      onChange={(event) => {
                        const theme = event.target.value;
                        onChange(
                          theme === "Dark"
                            ? {
                                theme,
                                background: "#071217",
                                foreground: "#f2f7f7",
                              }
                            : theme === "Transparent"
                              ? {
                                  theme,
                                  background: "transparent",
                                  foreground: "#182126",
                                }
                              : {
                                  theme,
                                  background: "#ffffff",
                                  foreground: "#182126",
                                },
                        );
                      }}
                    >
                      <option>Light publication</option>
                      <option>Dark</option>
                      <option>Transparent</option>
                    </select>
                  </label>
                  <label>
                    Premade palette
                    <select
                      value={figure.palette}
                      onChange={(event) => onPalette(event.target.value)}
                    >
                      {Object.keys(palettes).map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </label>
                  <label>
                    Background
                    <input
                      type="color"
                      value={
                        figure.background === "transparent"
                          ? "#ffffff"
                          : figure.background
                      }
                      onChange={(event) =>
                        onChange({ background: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Foreground
                    <input
                      type="color"
                      value={figure.foreground}
                      onChange={(event) =>
                        onChange({ foreground: event.target.value })
                      }
                    />
                  </label>
                  <label className="check-row">
                    <input
                      type="checkbox"
                      checked={figure.panelBadgeVisible}
                      onChange={(event) =>
                        onChange({ panelBadgeVisible: event.target.checked })
                      }
                    />{" "}
                    Show figure number / panel badge
                  </label>
                  {figure.panelBadgeVisible && (
                    <div className="panel-badge-controls">
                      <div className="coordinate-row">
                        <label>
                          Badge text
                          <input
                            value={figure.panelBadgeText}
                            maxLength={4}
                            onChange={(event) =>
                              onChange({ panelBadgeText: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Shape
                          <select
                            value={figure.panelBadgeShape}
                            onChange={(event) =>
                              onChange({
                                panelBadgeShape: event.target
                                  .value as FigureConfig["panelBadgeShape"],
                              })
                            }
                          >
                            <option value="circle">Circle</option>
                            <option value="square">Rounded square</option>
                          </select>
                        </label>
                      </div>
                      <div className="coordinate-row">
                        <label>
                          Badge color
                          <input
                            type="color"
                            value={figure.panelBadgeColor}
                            onChange={(event) =>
                              onChange({ panelBadgeColor: event.target.value })
                            }
                          />
                        </label>
                        <label>
                          Text color
                          <input
                            type="color"
                            value={figure.panelBadgeTextColor}
                            onChange={(event) =>
                              onChange({ panelBadgeTextColor: event.target.value })
                            }
                          />
                        </label>
                      </div>
                      <label>
                        Badge size · {figure.panelBadgeSize}px
                        <input
                          type="range"
                          min="12"
                          max="60"
                          value={figure.panelBadgeSize}
                          onChange={(event) =>
                            onChange({ panelBadgeSize: Number(event.target.value) })
                          }
                        />
                      </label>
                      <div className="coordinate-row">
                        <label>
                          Horizontal position
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={figure.panelBadgeX}
                            onChange={(event) =>
                              onChange({ panelBadgeX: Number(event.target.value) })
                            }
                          />
                        </label>
                        <label>
                          Vertical position
                          <input
                            type="number"
                            min="0"
                            max="1"
                            step="0.01"
                            value={figure.panelBadgeY}
                            onChange={(event) =>
                              onChange({ panelBadgeY: Number(event.target.value) })
                            }
                          />
                        </label>
                      </div>
                    </div>
                  )}
                </>
              )}
              {id === "axes" && (
                <>
                  <label>
                    Figure title
                    <input
                      value={figure.title}
                      onChange={(event) =>
                        onChange({ title: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    X-axis title
                    <input
                      value={figure.xLabel}
                      onChange={(event) =>
                        onChange({ xLabel: event.target.value })
                      }
                    />
                  </label>
                  <label>
                    Y-axis title
                    <input
                      value={figure.yLabel}
                      onChange={(event) =>
                        onChange({ yLabel: event.target.value })
                      }
                    />
                  </label>
                  <div className="coordinate-row">
                    <label>
                      X major tick count
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={figure.majorTicks}
                        onChange={(event) =>
                          onChange({ majorTicks: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Y major tick count
                      <input
                        type="number"
                        min="2"
                        max="20"
                        value={figure.yMajorTicks}
                        onChange={(event) =>
                          onChange({ yMajorTicks: Number(event.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <div className="coordinate-row">
                    <label>
                      X minor ticks per interval
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={figure.minorTicks}
                        onChange={(event) =>
                          onChange({ minorTicks: Number(event.target.value) })
                        }
                      />
                    </label>
                    <label>
                      Y minor ticks per interval
                      <input
                        type="number"
                        min="0"
                        max="10"
                        value={figure.yMinorTicks}
                        onChange={(event) =>
                          onChange({ yMinorTicks: Number(event.target.value) })
                        }
                      />
                    </label>
                  </div>
                  <div className="coordinate-row">
                    <label>
                      X major spacing (optional)
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={figure.xMajorSpacing}
                        placeholder="Automatic"
                        onChange={(event) =>
                          onChange({ xMajorSpacing: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Y major spacing (optional)
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={figure.yMajorSpacing}
                        placeholder="Automatic"
                        onChange={(event) =>
                          onChange({ yMajorSpacing: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="coordinate-row">
                    <label>
                      X minor spacing (optional)
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={figure.xMinorSpacing}
                        placeholder="Automatic"
                        onChange={(event) =>
                          onChange({ xMinorSpacing: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      Y minor spacing (optional)
                      <input
                        type="number"
                        min="0"
                        step="any"
                        value={figure.yMinorSpacing}
                        placeholder="Automatic"
                        onChange={(event) =>
                          onChange({ yMinorSpacing: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <details className="axis-position-controls">
                    <summary>Title and axis-label positions</summary>
                    <LabelPositionControls prefix="Figure title" x={figure.figureTitleX} y={figure.figureTitleY} alignment={figure.figureTitleAlignment} rotation={figure.figureTitleRotation} onChange={(patch)=>onChange({figureTitleX:patch.x??figure.figureTitleX,figureTitleY:patch.y??figure.figureTitleY,figureTitleAlignment:patch.alignment??figure.figureTitleAlignment,figureTitleRotation:patch.rotation??figure.figureTitleRotation})}/>
                    <LabelPositionControls prefix="X-axis title" x={figure.xLabelX} y={figure.xLabelY} alignment={figure.xLabelAlignment} rotation={figure.xLabelRotation} onChange={(patch)=>onChange({xLabelX:patch.x??figure.xLabelX,xLabelY:patch.y??figure.xLabelY,xLabelAlignment:patch.alignment??figure.xLabelAlignment,xLabelRotation:patch.rotation??figure.xLabelRotation})}/>
                    <LabelPositionControls prefix="Y-axis title" x={figure.yLabelX} y={figure.yLabelY} alignment={figure.yLabelAlignment} rotation={figure.yLabelRotation} onChange={(patch)=>onChange({yLabelX:patch.x??figure.yLabelX,yLabelY:patch.y??figure.yLabelY,yLabelAlignment:patch.alignment??figure.yLabelAlignment,yLabelRotation:patch.rotation??figure.yLabelRotation})}/>
                  </details>
                  <label>
                    Grid
                    <select
                      value={figure.grid}
                      onChange={(event) =>
                        onChange({
                          grid: event.target.value as FigureConfig["grid"],
                        })
                      }
                    >
                      <option value="none">No grid</option>
                      <option value="major">Major grid</option>
                      <option value="both">Major + minor</option>
                    </select>
                  </label>
                  <label>
                    Axes box
                    <select
                      value={figure.box}
                      onChange={(event) =>
                        onChange({
                          box: event.target.value as FigureConfig["box"],
                        })
                      }
                    >
                      <option value="full">Full box</option>
                      <option value="left-bottom">Left and bottom</option>
                      <option value="none">No box</option>
                    </select>
                  </label>
                  <div className="coordinate-row">
                    <label>
                      X minimum
                      <input
                        value={figure.xMin}
                        onChange={(event) =>
                          onChange({ xMin: event.target.value })
                        }
                      />
                    </label>
                    <label>
                      X maximum
                      <input
                        value={figure.xMax}
                        onChange={(event) =>
                          onChange({ xMax: event.target.value })
                        }
                      />
                    </label>
                  </div>
                  <div className="coordinate-row">
                    <label>
                      Y minimum
                      <input
                        value={figure.yMin}
                        placeholder="auto"
                        onChange={(event) => onChange({ yMin: event.target.value })}
                      />
                    </label>
                    <label>
                      Y maximum
                      <input
                        value={figure.yMax}
                        placeholder="auto"
                        onChange={(event) => onChange({ yMax: event.target.value })}
                      />
                    </label>
                  </div>
                  <p className="inspector-note">Leave the y range on auto to fit each trace. Setting a low maximum expands the baseline so shoulders and minor components become visible, and the traces are clipped at the axes.</p>
                </>
              )}
              {id === "fonts" && (
                <>
                  <label>
                    Font family
                    <select
                      value={figure.fontFamily}
                      onChange={(event) =>
                        onChange({ fontFamily: event.target.value })
                      }
                    >
                      <option>Arial</option>
                      <option>Helvetica</option>
                      <option>Inter</option>
                      <option>Georgia</option>
                      <option>Times New Roman</option>
                      <option>Courier New</option>
                    </select>
                  </label>
                  <label>
                    Font weight
                    <select
                      value={figure.fontWeight}
                      onChange={(event) =>
                        onChange({ fontWeight: event.target.value })
                      }
                    >
                      <option value="400">Regular</option>
                      <option value="600">Semibold</option>
                      <option value="700">Bold</option>
                    </select>
                  </label>
                  <label>
                    Title size
                    <input
                      type="number"
                      value={figure.titleSize}
                      onChange={(event) =>
                        onChange({ titleSize: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Axis label size
                    <input
                      type="number"
                      value={figure.labelSize}
                      onChange={(event) =>
                        onChange({ labelSize: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Tick size
                    <input
                      type="number"
                      value={figure.tickSize}
                      onChange={(event) =>
                        onChange({ tickSize: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Legend size
                    <input
                      type="number"
                      value={figure.legendSize}
                      onChange={(event) =>
                        onChange({ legendSize: Number(event.target.value) })
                      }
                    />
                  </label>
                </>
              )}
              {id === "export" && (
                <>
                  <label>
                    Aspect ratio
                    <select
                      value={figure.aspect}
                      onChange={(event) => {
                        const aspect = event.target.value;
                        const ratio =
                          aspect === "16:9"
                            ? 16 / 9
                            : aspect === "1:1"
                              ? 1
                              : aspect === "3:2"
                                ? 1.5
                                : 4 / 3;
                        onChange({
                          aspect,
                          height: Math.round(figure.width / ratio),
                        });
                      }}
                    >
                      <option>4:3</option>
                      <option>3:2</option>
                      <option>16:9</option>
                      <option>1:1</option>
                      <option>Custom</option>
                    </select>
                  </label>
                  <label>
                    Width (px)
                    <input
                      type="number"
                      value={figure.width}
                      onChange={(event) =>
                        onChange({ width: Number(event.target.value) })
                      }
                    />
                  </label>
                  <label>
                    Height (px)
                    <input
                      type="number"
                      value={figure.height}
                      onChange={(event) =>
                        onChange({
                          height: Number(event.target.value),
                          aspect: "Custom",
                        })
                      }
                    />
                  </label>
                  <label>Export resolution<select value={figure.exportDpi} onChange={(event) => onChange({ exportDpi: Number(event.target.value) })}><option value="72">72 DPI · screen</option><option value="150">150 DPI · draft</option><option value="300">300 DPI · print</option><option value="600">600 DPI · publication</option></select></label>
                </>
              )}
            </div>
          )}
        </section>
      ))}
    </div>
  );
}

type LabelPositionPatch = {
  x?: number;
  y?: number;
  alignment?: "start" | "middle" | "end";
  rotation?: number;
};

function LabelPositionControls({
  prefix,
  x,
  y,
  alignment,
  rotation,
  onChange,
}: {
  prefix: string;
  x: number;
  y: number;
  alignment: "start" | "middle" | "end";
  rotation: number;
  onChange: (patch: LabelPositionPatch) => void;
}) {
  return (
    <fieldset className="label-position-grid">
      <legend>{prefix}</legend>
      <label>
        Horizontal · {Math.round(x * 100)}%
        <input
          type="range"
          min="0"
          max="1"
          step=".005"
          value={x}
          onChange={(event) => onChange({ x: Number(event.target.value) })}
        />
      </label>
      <label>
        Vertical · {Math.round(y * 100)}%
        <input
          type="range"
          min="0"
          max="1"
          step=".005"
          value={y}
          onChange={(event) => onChange({ y: Number(event.target.value) })}
        />
      </label>
      <label>
        Alignment
        <select
          value={alignment}
          onChange={(event) =>
            onChange({
              alignment: event.target.value as LabelPositionPatch["alignment"],
            })
          }
        >
          <option value="start">Left</option>
          <option value="middle">Center</option>
          <option value="end">Right</option>
        </select>
      </label>
      <label>
        Rotation
        <input
          type="number"
          min="-180"
          max="180"
          value={rotation}
          onChange={(event) =>
            onChange({ rotation: Number(event.target.value) })
          }
        />
      </label>
      <Button
        type="button"
        variant="outline"
        size="sm"
        onClick={() => onChange({ x: 0.5, alignment: "middle" })}
      >
        Center horizontally
      </Button>
    </fieldset>
  );
}

function ExportWorkspace({
  projectName,
  onProjectName,
  onNew,
  onOpen,
  onProjectSave,
  onProcessed,
  onStandards,
  onPeaks,
  onSvg,
  onPng,
  onPdf,
  onTiff,
  onCopy,
}: {
  projectName: string;
  onProjectName: (value: string) => void;
  onNew: () => void;
  onOpen: (files: FileList | null) => void;
  onProjectSave: () => void;
  onProcessed: () => void;
  onStandards: () => void;
  onPeaks: () => void;
  onSvg: () => void;
  onPng: () => void;
  onPdf: () => void;
  onTiff: () => void;
  onCopy: () => void;
}) {
  return (
    <div className="export-workspace">
      <header>
        <span className="eyebrow">LOCAL EXPORTS</span>
        <h2>Data, tables, and publication figures</h2>
        <p>All exports are generated on this computer.</p>
      </header>
      <div>
        <section>
          <Save />
          <h3>Portable project</h3>
          <p>Move raw data, non-destructive processing, peaks, calibration, figure styling, and fractions together.</p>
          <label className="export-project-name">Project name<input value={projectName} onChange={(event) => onProjectName(event.target.value)}/></label>
          <Button variant="outline" onClick={onNew}>New empty project</Button>
          <label className="upload-button compact"><FolderOpen/> Open .chromproj<input type="file" accept=".chromproj,application/json" onChange={(event) => onOpen(event.target.files)}/></label>
          <Button variant="outline" onClick={onProjectSave}><Save/> Save .chromproj</Button>
        </section>
        <section>
          <FileDown />
          <h3>Data tables</h3>
          <p>
            Processed spectra, the protein standards table, and calculated
            relative molecular weights for each peak.
          </p>
          <Button variant="outline" onClick={onProcessed}>
            Processed spectra CSV
          </Button>
          <Button variant="outline" onClick={onStandards}>
            Protein standards CSV
          </Button>
          <Button variant="outline" onClick={onPeaks}>
            Peak MW table CSV
          </Button>
        </section>
        <section>
          <ImageIcon />
          <h3>Figure exports</h3>
          <p>
            Vector SVG, PDF, PNG, or TIFF using the current canvas size and selected DPI.
          </p>
          <Button variant="outline" onClick={onSvg}>
            Export vector SVG
          </Button>
          <Button variant="outline" onClick={onPng}>
            Export raster PNG
          </Button>
          <Button variant="outline" onClick={onTiff}>Export publication TIFF</Button>
          <Button variant="outline" onClick={onPdf}>Export PDF</Button>
          <Button variant="outline" onClick={onCopy}>
            <Clipboard /> Copy PNG to clipboard
          </Button>
        </section>
      </div>
    </div>
  );
}

const InternalChromPlot = forwardRefPlot();
const ChromPlot = forwardRef<
  SVGSVGElement,
  Parameters<typeof InternalChromPlot>[0]
>((props, ref) => InternalChromPlot(props, ref));
ChromPlot.displayName = "ChromPlot";
function forwardRefPlot() {
  return function Plot(
    {
      traces,
      processed,
      peaks,
      annotations,
      fractions,
      standards,
      fit,
      vo,
      vt,
      fitColor,
      figure,
      zoom,
      selection,
      dragKind,
      selectedPeakId,
      selectedAnnotationId,
      figureMode,
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onTrace,
      onPeak,
      onAnnotation,
      onAnnotationDrag,
      onCalloutDrag,
      onAxis,
    }: {
      traces: Trace[];
      processed: Record<string, Point[]>;
      peaks: Peak[];
      annotations: AnnotationItem[];
      fractions: (Range & {
        id: string;
        name: string;
        color: string;
        opacity: number;
      })[];
      standards: Standard[];
      fit: SecFit;
      vo: number;
      vt: number;
      fitColor: string;
      figure: FigureConfig;
      zoom: Range | null;
      selection: Range | null;
      dragKind: NonNullable<Drag>["kind"] | null;
      selectedPeakId: string;
      selectedAnnotationId: string;
      figureMode: boolean;
      onPointerDown: (e: PointerEvent<SVGSVGElement>) => void;
      onPointerMove: (e: PointerEvent<SVGSVGElement>) => void;
      onPointerUp: () => void;
      onTrace: (id: string) => void;
      onPeak: (id: string) => void;
      onAnnotation: (id: string) => void;
      onAnnotationDrag: (e: PointerEvent<SVGGElement>, id: string) => void;
      onCalloutDrag: (e: PointerEvent<SVGGElement>, id: string) => void;
      onAxis: () => void;
    },
    ref?: React.ForwardedRef<SVGSVGElement>,
  ) {
    const visible = traces.filter((value) => value.visible);
    const bounds = plotBounds(traces, processed, zoom, figure);
    const W = 1000,
      H = figureMode ? 700 : 590,
      left = 92,
      right = 32,
      top = figureMode ? 72 : 34,
      bottom = 70,
      plotW = W - left - right,
      plotH = H - top - bottom;
    const panels =
      figureMode && figure.layout === "stacked"
        ? Math.max(1, visible.length)
        : 1;
    const panelH = (plotH - (panels - 1) * figure.panelGap) / panels;
    const sx = (x: number) =>
      left +
      ((x - bounds.xMin) / Math.max(1e-12, bounds.xMax - bounds.xMin)) * plotW;
    const dash = (style: string) =>
      style === "dashed"
        ? "9 6"
        : style === "dotted"
          ? "2 5"
          : style === "dashdot"
            ? "9 4 2 4"
            : "";
    const strongest = (points: Point[]) => {
      const start = Number(figure.alignmentStart), end = Number(figure.alignmentEnd);
      const windowed = Number.isFinite(start) && Number.isFinite(end) && end > start ? points.filter((point) => point.x >= start && point.x <= end) : points;
      return windowed.reduce(
        (best, p) => (p.y > best.y ? p : best),
        windowed[0] ?? points[0] ?? { x: 0, y: 0 },
      ).x;
    };
    const normalizeFigurePoints = (points: Point[]) => {
      if (!figureMode || figure.normalization === "none" || !points.length) return points;
      const factor = figure.normalization === "maximum" ? Math.max(...points.map((point) => Math.abs(point.y)), 1e-12) : Math.max(integratedArea(points), 1e-12);
      return points.map((point) => ({ ...point, y: point.y / factor }));
    };
    const sharedValues = visible.flatMap((trace) => normalizeFigurePoints(processed[trace.id] ?? []).map((point) => point.y));
    const sharedMaximum = dataMaximum(sharedValues.map((y) => ({ x: 0, y }))),
      sharedMinimum = dataMinimum(sharedValues.map((y) => ({ x: 0, y })));
    const xMajorValues = majorTickValues(
      bounds.xMin,
      bounds.xMax,
      figure.majorTicks,
      Number(figure.xMajorSpacing),
    );
    const xMinorValues = minorTickValues(
      bounds.xMin,
      bounds.xMax,
      xMajorValues,
      figure.minorTicks,
      Number(figure.xMinorSpacing),
    );
    return (
      <svg
        ref={ref}
        className={`chromatogram-canvas ${figureMode ? "figure-mode" : ""}`}
        viewBox={`0 0 ${W} ${H}`}
        style={{
          background: figure.background,
          color: figure.foreground,
          fontFamily: figure.fontFamily,
          fontWeight: figure.fontWeight,
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={(event) => {
          event.preventDefault();
        }}
      >
        {figureMode && (
          <text
            x={figure.figureTitleX * W}
            y={figure.figureTitleY * H}
            textAnchor={figure.figureTitleAlignment}
            fontSize={figure.titleSize}
            fill={figure.foreground}
            transform={`rotate(${figure.figureTitleRotation} ${figure.figureTitleX * W} ${figure.figureTitleY * H})`}
            onClick={onAxis}
          >
            {figure.title}
          </text>
        )}
        {figureMode && figure.panelBadgeVisible && <g className="figure-panel-badge" transform={`translate(${figure.panelBadgeX * W} ${figure.panelBadgeY * H})`}>
          {figure.panelBadgeShape === "circle" ? <circle r={figure.panelBadgeSize} fill={figure.panelBadgeColor}/> : <rect x={-figure.panelBadgeSize} y={-figure.panelBadgeSize} width={figure.panelBadgeSize * 2} height={figure.panelBadgeSize * 2} rx={figure.panelBadgeSize * .2} fill={figure.panelBadgeColor}/>} 
          <text x="0" y={figure.panelBadgeSize * .34} textAnchor="middle" fill={figure.panelBadgeTextColor} fontSize={figure.panelBadgeSize * 1.05} fontWeight="800">{figure.panelBadgeText}</text>
        </g>}
        {xMajorValues.map((value, index) => {
          const x = sx(value);
          return (
            <g key={index}>
              {figure.grid !== "none" && (
                <line
                  x1={x}
                  x2={x}
                  y1={top}
                  y2={top + plotH}
                  stroke={figure.gridColor}
                />
              )}
              <line
                x1={x}
                x2={x}
                y1={top + plotH}
                y2={top + plotH + 7}
                stroke={figure.foreground}
              />
              <text
                x={x}
                y={top + plotH + 25}
                textAnchor="middle"
                fontSize={figure.tickSize}
                fill={figure.foreground}
              >
                {formatTick(value, xMajorValues)}
              </text>
            </g>
          );
        })}
        {xMinorValues.map((value, index) => {
            const x = sx(value);
            return (
              <g key={`x-minor-${index}`}>
                {figure.grid === "both" && (
                  <line
                    x1={x}
                    x2={x}
                    y1={top}
                    y2={top + plotH}
                    stroke={figure.gridColor}
                    opacity=".45"
                  />
                )}
                <line
                  x1={x}
                  x2={x}
                  y1={top + plotH}
                  y2={top + plotH + 4}
                  stroke={figure.foreground}
                />
              </g>
            );
          })}
        {fractions.map((value) => (
          <g key={value.id}>
            <rect
              x={sx(value.start)}
              y={top}
              width={Math.max(1, sx(value.end) - sx(value.start))}
              height={plotH}
              fill={value.color}
              opacity={value.opacity}
            />
            <text
              x={(sx(value.start) + sx(value.end)) / 2}
              y={top + 14}
              textAnchor="middle"
              fill={value.color}
              fontSize="10"
            >
              {value.name}
            </text>
          </g>
        ))}
        {visible.map((trace, index) => {
          let points = processed[trace.id] ?? [];
          const requestedTarget = Number(figure.alignmentTarget);
          const targetPeak = Number.isFinite(requestedTarget) && figure.alignmentTarget.trim() !== "" ? requestedTarget : strongest(processed[visible[0]?.id] ?? []);
          const alignShift =
            figureMode && figure.align === "peak"
              ? targetPeak - strongest(points)
              : 0;
          points = points
            .map((p) => ({ ...p, x: p.x + alignShift }))
            .filter((p) => p.x >= bounds.xMin && p.x <= bounds.xMax);
          points = normalizeFigurePoints(points);
          const panel = figureMode && figure.layout === "stacked" ? index : 0;
          const pTop = top + panel * (panelH + figure.panelGap);
          const requestedMin = figure.yMin.trim() === "" ? NaN : Number(figure.yMin);
          const requestedMax = figure.yMax.trim() === "" ? NaN : Number(figure.yMax);
          const autoMax = figureMode && figure.sharedYScale ? sharedMaximum : dataMaximum(points);
          const autoMin = figureMode && figure.sharedYScale ? sharedMinimum : dataMinimum(points);
          const localMax = Number.isFinite(requestedMax) ? requestedMax : autoMax,
            localMin = Number.isFinite(requestedMin) ? requestedMin : autoMin;
          const sy = (y: number) =>
            pTop +
            panelH -
            ((y - localMin) / Math.max(1e-12, localMax - localMin)) *
              panelH *
              0.86;
          const d = pathFor(points, sx, sy);
          const fillBaseline = sy(localMin);
          const spectrumArea = points.length ? `${d} L${sx(points.at(-1)!.x)},${fillBaseline} L${sx(points[0].x)},${fillBaseline} Z` : "";
          const showYTicks = figure.layout === "stacked" || index === 0;
          const yMajorValues = majorTickValues(
            localMin,
            localMax,
            figure.yMajorTicks,
            Number(figure.yMajorSpacing),
          );
          const yMinorValues = minorTickValues(
            localMin,
            localMax,
            yMajorValues,
            figure.yMinorTicks,
            Number(figure.yMinorSpacing),
          );
          return (
            <g key={trace.id}>
              {showYTicks &&
                yMajorValues.map((value, tickIndex) => {
                  const y = sy(value);
                  return (
                    <g key={`y-major-${tickIndex}`}>
                      {figure.grid !== "none" && (
                        <line
                          x1={left}
                          x2={left + plotW}
                          y1={y}
                          y2={y}
                          stroke={figure.gridColor}
                        />
                      )}
                      <line
                        x1={left - 7}
                        x2={left}
                        y1={y}
                        y2={y}
                        stroke={figure.foreground}
                      />
                      <text
                        x={left - 11}
                        y={y + 4}
                        textAnchor="end"
                        fontSize={figure.tickSize}
                        fill={figure.foreground}
                      >
                        {formatTick(value, yMajorValues)}
                      </text>
                    </g>
                  );
                })}
              {showYTicks &&
                yMinorValues.map((value, tickIndex) => {
                    const y = sy(value);
                    return (
                      <g key={`y-minor-${tickIndex}`}>
                        {figure.grid === "both" && (
                          <line
                            x1={left}
                            x2={left + plotW}
                            y1={y}
                            y2={y}
                            stroke={figure.gridColor}
                            opacity=".45"
                          />
                        )}
                        <line
                          x1={left - 4}
                          x2={left}
                          y1={y}
                          y2={y}
                          stroke={figure.foreground}
                        />
                      </g>
                    );
                  })}
              {figureMode && figure.layout === "stacked" && (
                <rect
                  x={left}
                  y={pTop}
                  width={plotW}
                  height={panelH}
                  fill="none"
                  stroke={figure.box === "none" ? "none" : figure.foreground}
                  opacity=".5"
                />
              )}
              {/* A y zoom crops the trace at the axes instead of letting it
                  run across the rest of the figure. */}
              <clipPath id={`panel-clip-${trace.id}`}>
                <rect x={left} y={pTop - 1} width={plotW} height={panelH + 2} />
              </clipPath>
              {trace.fillVisible && spectrumArea && <path d={spectrumArea} clipPath={`url(#panel-clip-${trace.id})`} fill={trace.fillColor} opacity={trace.fillOpacity} stroke="none" pointerEvents="none"/>}
              <path
                clipPath={`url(#panel-clip-${trace.id})`}
                d={d}
                fill="none"
                stroke={trace.color}
                strokeWidth={trace.lineWidth}
                strokeDasharray={dash(trace.lineStyle)}
                opacity={trace.opacity}
                vectorEffect="non-scaling-stroke"
                onClick={(event) => {
                  event.stopPropagation();
                  onTrace(trace.id);
                }}
              />
              <text
                x={left + plotW - 5}
                y={pTop + 15}
                textAnchor="end"
                fill={trace.color}
                fontSize={figure.legendSize}
              >
                {figureMode && figure.layout === "stacked" && figure.showPanelLabels ? trace.name : ""}
              </text>
              {(() => {
                // Lay the callout boxes out once per panel: boxes that would
                // sit on top of each other step down instead, so "Find peaks"
                // produces a readable figure without hand-dragging each label.
                const panelPeaks = peaks.filter((peak) => peak.traceId === trace.id);
                const boxes = panelPeaks
                  .map((peak) => {
                    const lines = peakLines(peak);
                    return {
                      id: peak.id,
                      cx: sx(peak.calloutX + alignShift),
                      cy: pTop + (peak.calloutY / 100) * panelH,
                      width: Math.max(96, ...lines.map((line) => line.length * 5.4)) + 16,
                      height: lines.length * 16 + 10,
                    };
                  })
                  .sort((a, b) => a.cx - b.cx);
                const placed: typeof boxes = [];
                for (const box of boxes) {
                  for (const other of placed) {
                    const overlapX = Math.abs(box.cx - other.cx) < (box.width + other.width) / 2;
                    const overlapY = Math.abs(box.cy - other.cy) < (box.height + other.height) / 2;
                    if (overlapX && overlapY) box.cy = other.cy + (other.height + box.height) / 2 + 4;
                  }
                  placed.push(box);
                }
                const layout = new Map(placed.map((box) => [box.id, box]));
                return panelPeaks.map((peak) => {
                  const region = points.filter(
                    (p) =>
                      p.x >= peak.start + alignShift &&
                      p.x <= peak.end + alignShift,
                  );
                  if (!region.length) return null;
                  const baselineY = sy(
                    Math.min(region[0].y, region.at(-1)?.y ?? region[0].y),
                  );
                  const area = `${pathFor(region, sx, sy)} L${sx(region.at(-1)!.x)},${baselineY} L${sx(region[0].x)},${baselineY} Z`;
                  const clip = `url(#panel-clip-${trace.id})`;
                  const box = layout.get(peak.id);
                  const calloutX = box?.cx ?? sx(peak.calloutX + alignShift),
                    calloutY = box?.cy ?? pTop + (peak.calloutY / 100) * panelH;
                  const lines = peakLines(peak);
                  const calloutW = box?.width ?? Math.max(96, ...lines.map((line) => line.length * 5.4)) + 16;
                  return (
                    <g
                      key={peak.id}
                      className={
                        peak.id === selectedPeakId ? "selected-peak" : ""
                      }
                    >
                      <path
                        d={area}
                        clipPath={clip}
                        fill={peak.fillVisible ? peak.fillColor : "none"}
                        opacity={peak.fillOpacity}
                        stroke={peak.color}
                        strokeWidth={peak.outlineWidth}
                        onClick={(event) => {
                          event.stopPropagation();
                          onPeak(peak.id);
                        }}
                      />
                      {peak.calloutVisible && (
                        <>
                        <line x1={sx(peak.apexX + alignShift)} y1={sy(peak.response)} x2={calloutX} y2={calloutY} stroke={peak.calloutBorder ? peak.color : "none"} strokeWidth="1.25" pointerEvents="none"/>
                        <g
                          className="peak-callout"
                          transform={`translate(${calloutX} ${calloutY})`}
                          onPointerDown={(event) =>
                            onCalloutDrag(event, peak.id)
                          }
                        >
                          <rect
                            x={-calloutW / 2}
                            y={-lines.length * 8 - 8}
                            width={calloutW}
                            height={lines.length * 16 + 10}
                            rx="6"
                            fill={
                              figure.background === "transparent"
                                ? "white"
                                : figure.background
                            }
                            stroke={peak.calloutBorder ? peak.color : "none"}
                          />
                          {lines.map((line, i) => (
                            <text
                              key={i}
                              x="0"
                              y={-lines.length * 8 + 4 + i * 14}
                              textAnchor="middle"
                              fill={peak.color}
                              fontSize="10"
                            >
                              {line}
                            </text>
                          ))}
                        </g>
                        </>
                      )}
                    </g>
                  );
                });
              })()}
            </g>
          );
        })}
        {selection && (
          <rect
            className={`chrom-drag-region ${dragKind ?? ""}`}
            x={sx(selection.start)}
            y={top}
            width={sx(selection.end) - sx(selection.start)}
            height={plotH}
            fill="var(--primary)"
            fillOpacity=".08"
            stroke="var(--primary)"
            strokeOpacity=".95"
            strokeWidth="2"
            strokeDasharray={dragKind === "zoom" ? "8 5" : "5 3"}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
        )}
        {annotations.map((annotation) => {
          if (annotation.kind === "arrow") {
            const x = sx(annotation.x), y = top + (annotation.y / 100) * plotH;
            return <g
              key={annotation.id}
              className={`free-annotation ${selectedAnnotationId === annotation.id ? "selected" : ""}`}
              transform={`translate(${x} ${y}) rotate(${annotation.angle - 90})`}
              onPointerDown={(event) => onAnnotationDrag(event, annotation.id)}
              onClick={(event) => { event.stopPropagation(); onAnnotation(annotation.id); }}
            >
              <path d={arrowPath(annotation.length, annotation.thickness)} fill={annotation.color} stroke={selectedAnnotationId === annotation.id ? annotation.color : "none"} strokeWidth="6" strokeOpacity=".25" strokeLinejoin="round"/>
            </g>;
          }
          const lines = annotation.text.split(/\r?\n/).filter(Boolean).slice(0, 8);
          const width = Math.max(70, ...lines.map((line) => line.length * annotation.fontSize * .58)) + 16;
          const height = Math.max(1, lines.length) * (annotation.fontSize + 3) + 12;
          const x = sx(annotation.x), y = top + annotation.y / 100 * plotH;
          return <g key={annotation.id} className={`free-annotation ${selectedAnnotationId === annotation.id ? "selected" : ""}`} transform={`translate(${x} ${y})`} onPointerDown={(event) => onAnnotationDrag(event, annotation.id)} onClick={(event) => { event.stopPropagation(); onAnnotation(annotation.id); }}>
            <rect x={-width / 2} y={-height / 2} width={width} height={height} rx="5" fill={annotation.border ? annotation.background : "transparent"} stroke={annotation.border || selectedAnnotationId === annotation.id ? annotation.color : "none"} strokeWidth={selectedAnnotationId === annotation.id ? 2 : 1}/>
            {(lines.length ? lines : ["Text annotation"]).map((line, index) => <text key={index} x="0" y={(index - (Math.max(1, lines.length) - 1) / 2) * (annotation.fontSize + 3) + 4} textAnchor="middle" fontSize={annotation.fontSize} fontWeight="600" fill={annotation.color}>{line}</text>)}
          </g>;
        })}
        <line
          x1={left}
          x2={left + plotW}
          y1={top + plotH}
          y2={top + plotH}
          stroke={figure.box === "none" ? "none" : figure.foreground}
        />
        <line
          x1={left}
          x2={left}
          y1={top}
          y2={top + plotH}
          stroke={figure.box === "none" ? "none" : figure.foreground}
        />
        {figure.box === "full" && (
          <>
            <line
              x1={left}
              x2={left + plotW}
              y1={top}
              y2={top}
              stroke={figure.foreground}
            />
            <line
              x1={left + plotW}
              x2={left + plotW}
              y1={top}
              y2={top + plotH}
              stroke={figure.foreground}
            />
          </>
        )}
        <text
          x={figure.xLabelX * W}
          y={figure.xLabelY * H}
          textAnchor={figure.xLabelAlignment}
          fontSize={figure.labelSize}
          fill={figure.foreground}
          transform={`rotate(${figure.xLabelRotation} ${figure.xLabelX * W} ${figure.xLabelY * H})`}
          onClick={onAxis}
        >
          {figure.xLabel}
        </text>
        <text
          x={figure.yLabelX * W}
          y={figure.yLabelY * H}
          transform={`rotate(${figure.yLabelRotation} ${figure.yLabelX * W} ${figure.yLabelY * H})`}
          textAnchor={figure.yLabelAlignment}
          fontSize={figure.labelSize}
          fill={figure.foreground}
          onClick={onAxis}
        >
          {figure.yLabel}
        </text>
        {/* A compact calibration inset, so a size-exclusion figure can carry
            the curve the reported masses came from. */}
        {figureMode && figure.showSec && fit && (() => {
          const usable = standards.filter((value) => value.included && value.mwDa > 0 && value.veMl > vo && value.veMl < vt);
          if (!usable.length) return null;
          const boxW = 212, boxH = 150, boxX = left + plotW - boxW - 14, boxY = top + 14;
          const padLeft = 38, padBottom = 26, padTop = 12, padRight = 10;
          const logs = usable.map((value) => Math.log10(value.mwDa));
          const kavs = usable.map((value) => kav(value.veMl, vo, vt));
          const xScale = niceScale(Math.min(...logs) - 0.1, Math.max(...logs) + 0.1, 3);
          const yScale = niceScale(Math.min(0, ...kavs), Math.max(...kavs) + 0.03, 3);
          const ix = (value: number) => boxX + padLeft + ((value - xScale.min) / Math.max(1e-12, xScale.max - xScale.min)) * (boxW - padLeft - padRight);
          const iy = (value: number) => boxY + boxH - padBottom - ((value - yScale.min) / Math.max(1e-12, yScale.max - yScale.min)) * (boxH - padBottom - padTop);
          return <g className="sec-inset">
            <rect x={boxX} y={boxY} width={boxW} height={boxH} rx="6" fill={figure.background === "transparent" ? "#ffffff" : figure.background} stroke={figure.foreground} strokeOpacity=".35" />
            <line x1={boxX + padLeft} x2={boxX + boxW - padRight} y1={boxY + boxH - padBottom} y2={boxY + boxH - padBottom} stroke={figure.foreground} />
            <line x1={boxX + padLeft} x2={boxX + padLeft} y1={boxY + padTop} y2={boxY + boxH - padBottom} stroke={figure.foreground} />
            {xScale.ticks.map((value) => <g key={`ix-${value}`}>
              <line x1={ix(value)} x2={ix(value)} y1={boxY + boxH - padBottom} y2={boxY + boxH - padBottom + 4} stroke={figure.foreground} />
              <text x={ix(value)} y={boxY + boxH - padBottom + 14} textAnchor="middle" fontSize="8" fill={figure.foreground}>{formatTick(value, xScale.ticks)}</text>
            </g>)}
            {yScale.ticks.map((value) => <g key={`iy-${value}`}>
              <line x1={boxX + padLeft - 4} x2={boxX + padLeft} y1={iy(value)} y2={iy(value)} stroke={figure.foreground} />
              <text x={boxX + padLeft - 6} y={iy(value) + 3} textAnchor="end" fontSize="8" fill={figure.foreground}>{formatTick(value, yScale.ticks)}</text>
            </g>)}
            <line x1={ix(xScale.min)} y1={iy(fit.slope * xScale.min + fit.intercept)} x2={ix(xScale.max)} y2={iy(fit.slope * xScale.max + fit.intercept)} stroke={fitColor} strokeWidth="1.8" clipPath="none" />
            {usable.map((value) => <circle key={value.id} cx={ix(Math.log10(value.mwDa))} cy={iy(kav(value.veMl, vo, vt))} r="3.2" fill={value.color} />)}
            <text x={boxX + boxW / 2} y={boxY + boxH - 3} textAnchor="middle" fontSize="8" fill={figure.foreground}>Log Mr (Da)</text>
            <text transform={`translate(${boxX + 11} ${boxY + (boxH - padBottom) / 2 + padTop}) rotate(-90)`} textAnchor="middle" fontSize="8" fill={figure.foreground}>Kav</text>
            <text x={boxX + padLeft + 4} y={boxY + padTop + 2} fontSize="8" fill={figure.foreground}>R² = {fit.r2.toFixed(3)}</text>
          </g>;
        })()}
        {figureMode && figure.showLegend && figure.layout === "overlay" && (
          <g transform={`translate(${left + plotW - 150} ${top + 16})`}>
            {visible.map((trace, index) => (
              <g key={trace.id} transform={`translate(0 ${index * 18})`}>
                <line
                  x1="0"
                  x2="25"
                  y1="0"
                  y2="0"
                  stroke={trace.color}
                  strokeWidth="3"
                />
                <text
                  x="32"
                  y="4"
                  fill={figure.foreground}
                  fontSize={figure.legendSize}
                >
                  {trace.name}
                </text>
              </g>
            ))}
          </g>
        )}
      </svg>
    );
  };
}

function processTrace(trace: Trace) {
  let points = trace.points
    .map((p) => ({
      x: p.x + trace.xShift,
      y: p.y * trace.yScale + trace.yOffset,
    }))
    .filter(
      (p) =>
        !trace.excludedRanges.some(
          (range) => p.x >= range.start && p.x <= range.end,
        ),
    );
  for (const region of trace.regionTransforms)
    points = points.map((p) =>
      p.x >= region.start && p.x <= region.end
        ? { ...p, y: p.y * region.scale + region.offset }
        : p,
    );
  if (trace.smoothing > 1)
    points = movingAverage(points, Math.round(trace.smoothing));
  if (trace.baseline && points.length) {
    const baseline = quantile(
      points.map((p) => p.y),
      0.05,
    );
    points = points.map((p) => ({ ...p, y: p.y - baseline }));
  }
  if (trace.normalization === "maximum" && points.length) {
    const max = Math.max(...points.map((p) => Math.abs(p.y)));
    if (max) points = points.map((p) => ({ ...p, y: (p.y / max) * 100 }));
  }
  if (trace.normalization === "area" && points.length) {
    const area = integratedArea(points);
    if (area) points = points.map((p) => ({ ...p, y: p.y / area }));
  }
  return points;
}
// The peak record keeps a stable apex while its left and right baseline bounds expand.
//
// The expansion is never allowed to leave `limit`, which defaults to the region
// the researcher dragged. Without that clamp a shoulder on the flank of a much
// larger peak swallows the rest of the chromatogram: walking away from the
// shoulder apex the signal climbs into the neighbour and never returns to the
// shoulder's own baseline, so the walk runs to the end of the trace.
function findPeak(points: Point[], range: Range, exact = false, limit: Range = range) {
  const candidates = points
    .map((p, i) => ({ ...p, i }))
    .filter((p) => p.x >= range.start && p.x <= range.end);
  if (!candidates.length) return null;
  const apex = candidates.reduce(
    (best, p) => (p.y > best.y ? p : best),
    candidates[0],
  );
  const limitLeft = Math.min(
    apex.i,
    Math.max(0, points.findIndex((p) => p.x >= limit.start)),
  );
  const limitRight = Math.max(
    apex.i,
    (() => {
      for (let i = points.length - 1; i >= 0; i--) if (points[i].x <= limit.end) return i;
      return points.length - 1;
    })(),
  );
  let left = exact ? candidates[0].i : apex.i,
    right = exact ? candidates.at(-1)!.i : apex.i;
  if (!exact) {
    const local = points
        .slice(Math.max(0, apex.i - 100), Math.min(points.length, apex.i + 101))
        .map((p) => p.y),
      noise = Math.max(1e-12, mad(local));
    // Measured from the edges the walk may actually reach, so auto-detection
    // (whose limits are the neighbouring valleys) gets a baseline-level
    // threshold rather than one taken from its few-point detection window.
    const edge = Math.min(points[limitLeft].y, points[limitRight].y);
    const threshold = edge + (apex.y - edge) * 0.025;
    // Three consecutive points, so a single noisy sample cannot end the peak.
    const confirm = 3;
    let rising = 0;
    while (left > limitLeft) {
      if (
        points[left].y <= threshold ||
        points[left - 1].y > points[left].y + noise * 0.25
      ) {
        rising++;
        if (rising >= confirm) { left += confirm - 1; break; }
      } else rising = 0;
      left--;
    }
    left = Math.min(apex.i, Math.max(limitLeft, left));
    rising = 0;
    while (right < limitRight) {
      if (
        points[right].y <= threshold ||
        points[right + 1].y > points[right].y + noise * 0.25
      ) {
        rising++;
        if (rising >= confirm) { right -= confirm - 1; break; }
      } else rising = 0;
      right++;
    }
    right = Math.max(apex.i, Math.min(limitRight, right));
  }
  const region = points.slice(left, right + 1),
    baselineA = region[0].y,
    baselineB = region.at(-1)!.y,
    span = Math.max(1e-12, region.at(-1)!.x - region[0].x);
  let area = 0;
  for (let i = 1; i < region.length; i++) {
    const y0 = Math.max(
        0,
        region[i - 1].y -
          (baselineA +
            ((baselineB - baselineA) * (region[i - 1].x - region[0].x)) / span),
      ),
      y1 = Math.max(
        0,
        region[i].y -
          (baselineA +
            ((baselineB - baselineA) * (region[i].x - region[0].x)) / span),
      );
    area += ((region[i].x - region[i - 1].x) * (y0 + y1)) / 2;
  }
  const baselineAtApex =
    baselineA + ((baselineB - baselineA) * (apex.x - region[0].x)) / span;
  return {
    start: region[0].x,
    end: region.at(-1)!.x,
    apexX: apex.x,
    response: apex.y,
    height: apex.y - baselineAtApex,
    area,
  };
}
function findAllPeaks(points: Point[], count: number) {
  if (points.length < 3) return [];
  const smooth = movingAverage(points, 7);
  const threshold = quantile(
    smooth.map((p) => p.y),
    0.65,
  );
  const candidates = smooth
    .map((p, i) => ({ ...p, i }))
    .filter(
      (p, i) =>
        i > 0 &&
        i < smooth.length - 1 &&
        p.y > threshold &&
        p.y >= smooth[i - 1].y &&
        p.y > smooth[i + 1].y,
    )
    .sort((a, b) => b.y - a.y);
  const chosen: typeof candidates = [];
  for (const value of candidates) {
    if (
      chosen.every(
        (other) => Math.abs(other.i - value.i) > points.length * 0.03,
      )
    )
      chosen.push(value);
    if (chosen.length >= count) break;
  }
  // Each detected peak may grow until it meets its neighbour: the midpoint
  // between adjacent apices is the valley that separates them.
  const ordered = [...chosen].sort((a, b) => a.i - b.i);
  return ordered
    .map((value, index) =>
      findPeak(
        points,
        {
          start: points[Math.max(0, value.i - 3)].x,
          end: points[Math.min(points.length - 1, value.i + 3)].x,
        },
        false,
        {
          start: index ? (ordered[index - 1].x + value.x) / 2 : points[0].x,
          end: index < ordered.length - 1 ? (value.x + ordered[index + 1].x) / 2 : points.at(-1)!.x,
        },
      ),
    )
    .filter(Boolean)
    .sort((a, b) => a!.apexX - b!.apexX) as NonNullable<
    ReturnType<typeof findPeak>
  >[];
}
function fitSec(standards: Standard[], vo: number, vt: number): SecFit {
  const valid = standards.filter(
    (s) => s.included && s.mwDa > 0 && s.veMl > vo && s.veMl < vt,
  );
  if (valid.length < 2 || vt <= vo) return null;
  const xs = valid.map((s) => Math.log10(s.mwDa)),
    ys = valid.map((s) => kav(s.veMl, vo, vt)),
    mx = mean(xs),
    my = mean(ys),
    den = xs.reduce((sum, x) => sum + (x - mx) ** 2, 0);
  if (!den) return null;
  const slope =
      xs.reduce((sum, x, i) => sum + (x - mx) * (ys[i] - my), 0) / den,
    intercept = my - slope * mx,
    pred = xs.map((x) => slope * x + intercept),
    ssRes = ys.reduce((sum, y, i) => sum + (y - pred[i]) ** 2, 0),
    ssTot = ys.reduce((sum, y) => sum + (y - my) ** 2, 0);
  return { slope, intercept, r2: ssTot ? 1 - ssRes / ssTot : 1 };
}
function fitMass(standards: MassStandard[]) {
  const valid = standards.filter((value) => value.included && value.massKDa >= 0 && Number.isFinite(value.signal));
  if (valid.length < 2) return null;
  const xs = valid.map((value) => value.massKDa), ys = valid.map((value) => value.signal), mx = mean(xs), my = mean(ys);
  const denominator = xs.reduce((sum, value) => sum + (value - mx) ** 2, 0);
  if (!denominator) return null;
  const slope = xs.reduce((sum, value, index) => sum + (value - mx) * (ys[index] - my), 0) / denominator;
  const intercept = my - slope * mx;
  const residual = ys.reduce((sum, value, index) => sum + (value - (slope * xs[index] + intercept)) ** 2, 0);
  const total = ys.reduce((sum, value) => sum + (value - my) ** 2, 0);
  return { slope, intercept, r2: total ? 1 - residual / total : 1 };
}
function parseNumberList(value: string) {
  return (value.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(Number).filter(Number.isFinite);
}
function histogramBins(values: number[], requested: number) {
  if (!values.length) return [];
  const count = Math.max(5, Math.min(150, Math.round(requested) || 30));
  let minimum = Math.min(...values), maximum = Math.max(...values);
  if (maximum <= minimum) { minimum = Math.max(0, minimum - .5); maximum += .5; }
  const width = (maximum - minimum) / count;
  const bins = Array.from({ length: count }, (_, index) => ({ start: minimum + index * width, end: minimum + (index + 1) * width, count: 0 }));
  for (const value of values) bins[Math.min(count - 1, Math.max(0, Math.floor((value - minimum) / width)))].count += 1;
  return bins;
}
function calibratePeak(peak: Peak, fit: SecFit, vo: number, vt: number): Peak {
  if (!fit || !fit.slope) return peak;
  const value = kav(peak.apexX, vo, vt);
  if (!(peak.apexX > vo && peak.apexX < vt)) return { ...peak, kav: value, mwKDa: undefined };
  const logMr = (value - fit.intercept) / fit.slope;
  return { ...peak, kav: value, mwKDa: 10 ** logMr / 1000 };
}
function majorTickValues(
  minimum: number,
  maximum: number,
  requestedCount: number,
  requestedSpacing: number,
) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum)
    return [minimum || 0, maximum || 1];
  if (Number.isFinite(requestedSpacing) && requestedSpacing > 0) {
    const first = Math.ceil(minimum / requestedSpacing) * requestedSpacing;
    const values: number[] = [];
    for (
      let value = first;
      value <= maximum + requestedSpacing * 1e-7 && values.length < 250;
      value += requestedSpacing
    )
      values.push(Number(value.toPrecision(12)));
    return values.length ? values : [minimum, maximum];
  }
  // Round steps rather than an exact division of the data range, so an axis
  // reads 0, 1, 2, 3 instead of 0.00, 0.92, 1.84, 2.76. Ticks that fall outside
  // the data stay off the axis, which keeps the plotted range honest.
  const count = Math.max(2, Math.min(50, Math.round(requestedCount) || 2));
  const nice = niceScale(minimum, maximum, count - 1).ticks.filter(
    (value) => value >= minimum - (maximum - minimum) * 1e-9 && value <= maximum + (maximum - minimum) * 1e-9,
  );
  return nice.length >= 2
    ? nice
    : Array.from({ length: count }, (_, index) => minimum + (index / (count - 1)) * (maximum - minimum));
}

function minorTickValues(
  minimum: number,
  maximum: number,
  majors: number[],
  perInterval: number,
  requestedSpacing: number,
) {
  if (Number.isFinite(requestedSpacing) && requestedSpacing > 0) {
    const first = Math.ceil(minimum / requestedSpacing) * requestedSpacing;
    const majorTolerance = requestedSpacing * 1e-5;
    const values: number[] = [];
    for (
      let value = first;
      value <= maximum + requestedSpacing * 1e-7 && values.length < 1000;
      value += requestedSpacing
    ) {
      if (!majors.some((major) => Math.abs(major - value) <= majorTolerance))
        values.push(Number(value.toPrecision(12)));
    }
    return values;
  }
  const count = Math.max(0, Math.min(20, Math.round(perInterval) || 0));
  const values: number[] = [];
  for (let index = 0; index < majors.length - 1; index += 1) {
    for (let minor = 1; minor <= count; minor += 1) {
      values.push(
        majors[index] +
          (minor / (count + 1)) * (majors[index + 1] - majors[index]),
      );
    }
  }
  return values.filter((value) => value >= minimum && value <= maximum);
}

// A solid block arrow whose tip sits on the annotation's own coordinates, so
// it points exactly at the feature it marks.
function arrowPath(length: number, thickness: number) {
  const headWidth = thickness * 0.95, headLength = thickness * 1.5, shaft = thickness * 0.4;
  const tail = -Math.max(length, headLength + 4);
  return [
    "M0 0",
    `L${-headWidth} ${-headLength}`,
    `L${-shaft} ${-headLength}`,
    `L${-shaft} ${tail}`,
    `L${shaft} ${tail}`,
    `L${shaft} ${-headLength}`,
    `L${headWidth} ${-headLength}`,
    "Z",
  ].join(" ");
}
// Round tick steps (1, 2 or 5 times a power of ten) and a domain widened to
// land on them, so a calibration axis reads 3.0, 3.5, 4.0 rather than
// 2.664248, 3.389830.
function niceScale(minimum: number, maximum: number, target = 6) {
  if (!Number.isFinite(minimum) || !Number.isFinite(maximum) || maximum <= minimum) return { min: minimum || 0, max: (minimum || 0) + 1, ticks: [minimum || 0, (minimum || 0) + 1] };
  const raw = (maximum - minimum) / Math.max(2, target);
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((factor) => factor * magnitude).find((candidate) => candidate >= raw) ?? 10 * magnitude;
  const min = Math.floor(minimum / step) * step, max = Math.ceil(maximum / step) * step;
  const ticks: number[] = [];
  for (let value = min; value <= max + step * 1e-7 && ticks.length < 60; value += step) ticks.push(Number(value.toPrecision(12)));
  return { min, max, ticks };
}
// Enough decimals to tell neighbouring ticks apart, and no more: an elution
// axis stepping by 1 mL reads "3", while an absorbance axis stepping by
// 0.0005 AU reads "0.0005".
function formatTick(value: number, ticks: number[]) {
  const steps = ticks.slice(1).map((tick, index) => Math.abs(tick - ticks[index])).filter((step) => step > 0);
  const step = steps.length ? Math.min(...steps) : Math.abs(value) || 1;
  if (step >= 1e6 || (step > 0 && step < 1e-5)) return value.toExponential(1);
  // The fewest decimals that still write the step exactly, so 0.25 keeps two
  // and 0.0005 keeps four.
  let decimals = 0;
  while (decimals < 8 && Math.abs(step - Number(step.toFixed(decimals))) > step * 1e-6) decimals++;
  return value.toFixed(decimals);
}
// Absorbance traces peak well below 1, so the y range has to follow the data;
// an empty panel is the only case that needs an arbitrary range.
function dataMaximum(points: Point[]) {
  if (!points.length) return 1;
  const maximum = Math.max(...points.map((p) => p.y));
  const minimum = Math.min(...points.map((p) => p.y));
  return maximum > minimum ? maximum : maximum + Math.max(Math.abs(maximum), 1) * 0.1;
}
function dataMinimum(points: Point[]) {
  if (!points.length) return 0;
  return Math.min(0, ...points.map((p) => p.y));
}
function plotBounds(
  traces: Trace[],
  processed: Record<string, Point[]>,
  zoom: Range | null,
  figure: FigureConfig,
) {
  const visible = traces
    .filter((t) => t.visible)
    .flatMap((t) => processed[t.id] ?? []);
  const all = visible.length
    ? visible
    : [
        { x: 0, y: 0 },
        { x: 1, y: 1 },
      ];
  const rawMin = Math.min(...all.map((p) => p.x)),
    rawMax = Math.max(...all.map((p) => p.x));
  return {
    xMin: zoom?.start ?? (figure.xMin !== "" ? Number(figure.xMin) : rawMin),
    xMax: zoom?.end ?? (figure.xMax !== "" ? Number(figure.xMax) : rawMax),
  };
}
function pathFor(
  points: Point[],
  sx: (x: number) => number,
  sy: (y: number) => number,
) {
  return points
    .map(
      (p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(2)} ${sy(p.y).toFixed(2)}`,
    )
    .join(" ");
}
function peakLines(peak: Peak) {
  return [
    peak.name,
    peak.showVe ? `Ve ${peak.apexX.toFixed(2)} mL` : "",
    peak.showResponse ? `Response ${peak.response.toFixed(2)}` : "",
    peak.showArea ? `Area ${peak.area.toFixed(2)}` : "",
    peak.showMw
      ? peak.mwKDa
        ? `MW ${peak.mwKDa.toFixed(1)} kDa`
        : "MW: outside the SEC calibration"
      : "",
    peak.customText,
  ].filter(Boolean);
}
function loadTraces(value: unknown): Trace[] {
  return array(value).map((raw, index) => ({
    id: String(raw.id ?? crypto.randomUUID()),
    name: String(raw.name ?? `Trace ${index + 1}`),
    source: String(raw.source ?? raw.name ?? ""),
    points: Array.isArray(raw.points)
      ? raw.points.map((p) => {
          const q = p as JsonObject;
          return { x: Number(q.x), y: Number(q.y) };
        })
      : [],
    color: String(raw.color ?? traceColors[index % traceColors.length]),
    lineWidth: Number(raw.lineWidth ?? 2),
    lineStyle: String(raw.lineStyle ?? "solid"),
    opacity: Number(raw.opacity ?? 1),
    visible: raw.visible !== false,
    xShift: Number(raw.xShift ?? 0),
    yScale: Number(raw.yScale ?? 1),
    yOffset: Number(raw.yOffset ?? 0),
    smoothing: Number(raw.smoothing ?? 1),
    baseline: raw.baseline === true,
    normalization: raw.normalization === "area" ? "area" : raw.normalization === "maximum" || raw.normalize === true ? "maximum" : "none",
    fillVisible: raw.fillVisible === true,
    fillColor: String(raw.fillColor ?? raw.color ?? traceColors[index % traceColors.length]),
    fillOpacity: Number(raw.fillOpacity ?? .16),
    excludedRanges: array(raw.excludedRanges).map((r) => ({
      start: Number(r.start),
      end: Number(r.end),
    })),
    regionTransforms: array(raw.regionTransforms).map((r) => ({
      start: Number(r.start),
      end: Number(r.end),
      scale: Number(r.scale ?? 1),
      offset: Number(r.offset ?? 0),
    })),
  }));
}
function loadPeaks(value: unknown): Peak[] {
  return array(value).map((raw, index) => ({
    id: String(raw.id ?? crypto.randomUUID()),
    traceId: String(raw.traceId ?? ""),
    name: String(raw.name ?? `Peak ${index + 1}`),
    start: Number(raw.start ?? 0),
    end: Number(raw.end ?? 0),
    apexX: Number(raw.apexX ?? raw.retentionVolume ?? 0),
    response: Number(raw.response ?? 0),
    height: Number(raw.height ?? 0),
    area: Number(raw.area ?? 0),
    color: String(raw.color ?? raw.outlineColor ?? "#25bba7"),
    fillColor: String(raw.fillColor ?? "#25bba7"),
    fillVisible: raw.fillVisible !== false,
    fillOpacity: Number(raw.fillOpacity ?? 0.25),
    outlineWidth: Number(raw.outlineWidth ?? 2),
    calloutVisible: raw.calloutVisible !== false,
    calloutBorder: raw.calloutBorder !== false,
    calloutX: Number(raw.calloutX ?? raw.apexX ?? 0),
    calloutY: Number(raw.calloutY ?? 12),
    showVe: raw.showVe !== false,
    showResponse: raw.showResponse !== false,
    showArea: raw.showArea !== false,
    showMw: raw.showMw !== false,
    customText: String(raw.customText ?? ""),
    mwKDa: raw.mwKDa === undefined ? undefined : Number(raw.mwKDa),
    kav: raw.kav === undefined ? undefined : Number(raw.kav),
    fraction: raw.fraction ? String(raw.fraction) : undefined,
  }));
}
function loadStandards(value: unknown): Standard[] {
  const loaded = array(value).map((raw, index) => ({
    id: String(raw.id ?? crypto.randomUUID()),
    protein: String(raw.protein ?? `Standard ${index + 1}`),
    mwDa: Number(raw.mwDa ?? 66000),
    veMl: Number(raw.veMl ?? 12),
    included: raw.included !== false,
    color: String(raw.color ?? traceColors[index % traceColors.length]),
  }));
  return loaded.length
    ? loaded
    : [
        {
          id: crypto.randomUUID(),
          protein: "Thyroglobulin",
          mwDa: 670000,
          veMl: 8.5,
          included: true,
          color: "#0072b2",
        },
        {
          id: crypto.randomUUID(),
          protein: "γ-globulin",
          mwDa: 158000,
          veMl: 10.5,
          included: true,
          color: "#e69f00",
        },
        {
          id: crypto.randomUUID(),
          protein: "Ovalbumin",
          mwDa: 44000,
          veMl: 13.2,
          included: true,
          color: "#009e73",
        },
        {
          id: crypto.randomUUID(),
          protein: "Myoglobin",
          mwDa: 17000,
          veMl: 15.5,
          included: true,
          color: "#cc79a7",
        },
        {
          id: crypto.randomUUID(),
          protein: "Vitamin B12",
          mwDa: 1350,
          veMl: 19.2,
          included: true,
          color: "#56b4e9",
        },
      ];
}
function loadMassStandards(value: unknown): MassStandard[] {
  const loaded = array(value).map((raw, index) => ({
    id: String(raw.id ?? crypto.randomUUID()),
    label: String(raw.label ?? `Standard ${index + 1}`),
    massKDa: Number(raw.massKDa ?? 100),
    signal: Number(raw.signal ?? .02),
    included: raw.included !== false,
    color: String(raw.color ?? traceColors[index % traceColors.length]),
  }));
  return loaded.length ? loaded : [
    { id: crypto.randomUUID(), label: "Low mass", massKDa: 66, signal: .011, included: true, color: "#4b9ce8" },
    { id: crypto.randomUUID(), label: "Middle mass", massKDa: 150, signal: .024, included: true, color: "#25bba7" },
    { id: crypto.randomUUID(), label: "High mass", massKDa: 300, signal: .047, included: true, color: "#f3a847" },
  ];
}
function loadAnnotations(value: unknown): AnnotationItem[] {
  return array(value).map((raw) => ({ id: String(raw.id ?? crypto.randomUUID()), kind: raw.kind === "arrow" ? "arrow" : "text", text: String(raw.text ?? raw.label ?? "Annotation"), x: Number(raw.x ?? 0), y: Number(raw.y ?? raw.yPercent ?? 20), color: String(raw.color ?? "#25bba7"), background: String(raw.background ?? "#ffffff"), fontSize: Number(raw.fontSize ?? 12), border: raw.border === true, angle: Number(raw.angle ?? 90), length: Number(raw.length ?? 46), thickness: Number(raw.thickness ?? 11) }));
}
function decodeData(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  if (bytes[0] === 0xff && bytes[1] === 0xfe)
    return new TextDecoder("utf-16le").decode(bytes.subarray(2));
  if (bytes[0] === 0xfe && bytes[1] === 0xff)
    return new TextDecoder("utf-16be").decode(bytes.subarray(2));
  try {
    return new TextDecoder("utf-8", { fatal: true })
      .decode(bytes)
      .replace(/^\uFEFF/, "");
  } catch {
    return new TextDecoder("windows-1252").decode(bytes);
  }
}
function parseTrace(raw: string) {
  const rows: Point[] = [];
  for (const line of raw.split(/\r?\n/)) {
    const numbers = (line.match(/[-+]?\d*\.?\d+(?:[eE][-+]?\d+)?/g) ?? []).map(
      Number,
    );
    if (
      numbers.length >= 2 &&
      Number.isFinite(numbers[0]) &&
      Number.isFinite(numbers[1])
    )
      rows.push({ x: numbers[0], y: numbers[1] });
  }
  return rows.sort((a, b) => a.x - b.x);
}
function movingAverage(points: Point[], window: number) {
  const radius = Math.max(0, Math.floor(window / 2));
  return points.map((p, i) => ({
    ...p,
    y: mean(
      points
        .slice(Math.max(0, i - radius), Math.min(points.length, i + radius + 1))
        .map((v) => v.y),
    ),
  }));
}
function integratedArea(points: Point[]) {
  let area = 0;
  for (let index = 1; index < points.length; index += 1) area += Math.abs((points[index].x - points[index - 1].x) * (points[index].y + points[index - 1].y) / 2);
  return area;
}
function mean(values: number[]) {
  return values.length ? values.reduce((a, b) => a + b, 0) / values.length : 0;
}
function quantile(values: number[], fraction: number) {
  const sorted = [...values].sort((a, b) => a - b),
    position = (sorted.length - 1) * fraction,
    low = Math.floor(position),
    high = Math.ceil(position);
  return sorted[low] * (high - position) + sorted[high] * (position - low);
}
function mad(values: number[]) {
  const m = quantile(values, 0.5);
  return (
    quantile(
      values.map((v) => Math.abs(v - m)),
      0.5,
    ) * 1.4826
  );
}
function kav(ve: number, vo: number, vt: number) {
  return (ve - vo) / Math.max(1e-12, vt - vo);
}
function array(value: unknown): JsonObject[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is JsonObject =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}
function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}
function errorText(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
async function rasterizeSvg(element: SVGSVGElement | null, width: number, height: number, dpi: number, background: string) {
  const source = element?.outerHTML;
  if (!source) return null;
  const blob = new Blob([source], { type: "image/svg+xml" }), url = URL.createObjectURL(blob), image = new window.Image();
  return await new Promise<HTMLCanvasElement>((resolve, reject) => {
    image.onerror = () => { URL.revokeObjectURL(url); reject(new Error("The figure could not be rendered.")); };
    image.onload = () => {
      const scale = Math.max(1, dpi / 96);
      const canvas = document.createElement("canvas");
      canvas.width = Math.round(width * scale); canvas.height = Math.round(height * scale);
      const context = canvas.getContext("2d")!;
      // A transparent figure still needs an opaque page behind it in TIFF,
      // PDF and the clipboard.
      if (background === "transparent") { context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height); }
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    image.src = url;
  });
}
function downloadText(filename: string, content: string, type: string) {
  downloadBlob(filename, new Blob([content], { type }));
}
function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob),
    link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}
function encodeTiffRgba(image: ImageData, dpi: number) {
  const entries = 14, ifdOffset = 8, ifdLength = 2 + entries * 12 + 4;
  const bitsOffset = ifdOffset + ifdLength, xResolutionOffset = bitsOffset + 8, yResolutionOffset = xResolutionOffset + 8, pixelOffset = yResolutionOffset + 8;
  const pixelBytes = image.width * image.height * 4;
  const buffer = new ArrayBuffer(pixelOffset + pixelBytes), view = new DataView(buffer), bytes = new Uint8Array(buffer);
  view.setUint8(0, 0x49); view.setUint8(1, 0x49); view.setUint16(2, 42, true); view.setUint32(4, ifdOffset, true); view.setUint16(ifdOffset, entries, true);
  let cursor = ifdOffset + 2;
  const entry = (tag: number, type: number, count: number, value: number, short = false) => { view.setUint16(cursor, tag, true); view.setUint16(cursor + 2, type, true); view.setUint32(cursor + 4, count, true); if (short) { view.setUint16(cursor + 8, value, true); view.setUint16(cursor + 10, 0, true); } else view.setUint32(cursor + 8, value, true); cursor += 12; };
  entry(256, 4, 1, image.width); entry(257, 4, 1, image.height); entry(258, 3, 4, bitsOffset); entry(259, 3, 1, 1, true); entry(262, 3, 1, 2, true); entry(273, 4, 1, pixelOffset); entry(277, 3, 1, 4, true); entry(278, 4, 1, image.height); entry(279, 4, 1, pixelBytes); entry(282, 5, 1, xResolutionOffset); entry(283, 5, 1, yResolutionOffset); entry(284, 3, 1, 1, true); entry(296, 3, 1, 2, true); entry(338, 3, 1, 2, true);
  view.setUint32(cursor, 0, true); [8, 8, 8, 8].forEach((value, index) => view.setUint16(bitsOffset + index * 2, value, true));
  view.setUint32(xResolutionOffset, Math.max(1, Math.round(dpi)), true); view.setUint32(xResolutionOffset + 4, 1, true); view.setUint32(yResolutionOffset, Math.max(1, Math.round(dpi)), true); view.setUint32(yResolutionOffset + 4, 1, true); bytes.set(image.data, pixelOffset);
  return new Uint8Array(buffer);
}
function buildImagePdf(jpeg: Uint8Array, widthPx: number, heightPx: number, dpi: number) {
  const encoder = new TextEncoder(), width = widthPx / Math.max(1, dpi) * 72, height = heightPx / Math.max(1, dpi) * 72;
  const content = `q ${width.toFixed(3)} 0 0 ${height.toFixed(3)} 0 0 cm /Im0 Do Q`;
  const objects: Uint8Array[] = [
    encoder.encode("<< /Type /Catalog /Pages 2 0 R >>"),
    encoder.encode("<< /Type /Pages /Kids [3 0 R] /Count 1 >>"),
    encoder.encode(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${width.toFixed(3)} ${height.toFixed(3)}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`),
    concatBytes(encoder.encode(`<< /Type /XObject /Subtype /Image /Width ${widthPx} /Height ${heightPx} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>\nstream\n`), jpeg, encoder.encode("\nendstream")),
    encoder.encode(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`),
  ];
  const parts: Uint8Array[] = [encoder.encode("%PDF-1.4\n%ProteinLabs\n")], offsets = [0]; let length = parts[0].length;
  objects.forEach((object, index) => { offsets.push(length); const wrapped = concatBytes(encoder.encode(`${index + 1} 0 obj\n`), object, encoder.encode("\nendobj\n")); parts.push(wrapped); length += wrapped.length; });
  const xref = length; let table = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`; for (let index = 1; index < offsets.length; index += 1) table += `${String(offsets[index]).padStart(10, "0")} 00000 n \n`; table += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  parts.push(encoder.encode(table)); return concatBytes(...parts);
}
function concatBytes(...parts: Uint8Array[]) { const result = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0)); let offset = 0; for (const part of parts) { result.set(part, offset); offset += part.length; } return result; }
function downloadCsv(filename: string, rows: (string | number | boolean)[][]) {
  downloadText(
    filename,
    rows
      .map((row) =>
        row
          .map((value) => `"${String(value).replaceAll('"', '""')}"`)
          .join(","),
      )
      .join("\n"),
    "text/csv",
  );
}
function safeFilename(value: string) { return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "chromatogram-project"; }
