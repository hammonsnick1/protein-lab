"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import { ArrowRight, Boxes, ChevronRight, Circle, CircleDot, Database, GraduationCap, Minus, MoveRight, Pause, Play, RotateCcw, RotateCw, Search, SkipForward, Sparkles, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cite, ReferenceList } from "@/components/ui/citations";
import { citationScope, type CitationId } from "@/lib/citations";
import {
  hasPrediction, spaceGroupHighlights, startingGroup, unresolvedSpaceGroups,
  type PredictorSuggestion, type SpaceGroupHighlight, type SpaceGroupHit,
} from "@/lib/space-group-evidence";
import {
  CRYSTAL_SYSTEM_NOTES, CRYSTAL_SYSTEM_ORDER, IDENTITY, SOHNCKE_GROUPS, SPACE_GROUPS,
  composeOperations, elementSentence, findSpaceGroup, groupElements, multiplicity, operationSteps, searchSpaceGroups,
  spaceGroupSummary, symbolText, symbolTokens,
  type CrystalSystem, type SpaceGroup, type SymmetryCategory, type SymmetryElement, type UnitCell,
} from "@/lib/space-groups";
import {
  animationFrame, defaultCell, diagramFrame, elementDiagram, generalPositions, operationTransform,
  type AxisGlyph, type DiagramElement, type DiagramFrame, type GeneralPosition,
} from "@/lib/space-group-diagram";
import type { ProteinFacts } from "@/lib/protein-facts";

const REFERENCES: CitationId[] = ["ita2016", "ucl-sgp", "gemmi", "wukovitz1995", "mascl2025"];

/** One step of the animation, in milliseconds. */
const STEP_MS = 1500;

export type SpaceGroupExplorerProps = {
  /** What earlier jobs already know; the PDB hits provide the highlights. */
  facts?: ProteinFacts | null;
  /** Drawn on the asymmetric unit and used in the captions. */
  proteinName?: string;
  /** Suggestions from a predictor, e.g. MASCL, once one is available. */
  suggestions?: PredictorSuggestion[];
  /** Why a predictor made no suggestion, shown instead of an empty list. */
  predictorNote?: string;
  /** Group to open with; defaults to the commonest group among the homologues. */
  initialSymbol?: string;
  onSelect?: (group: SpaceGroup) => void;
};

/**
 * Pick a space group and see what it does to your protein.
 *
 * The left column lists the 65 Sohncke groups — the only ones a protein made
 * of L-amino acids can crystallise in — with a teaching mode that opens all
 * 230. The right column draws the two International Tables diagrams for the
 * chosen group and steps through one symmetry operation at a time.
 */
export function SpaceGroupExplorer({
  facts = null, proteinName = "your protein", suggestions = [], predictorNote, initialSymbol, onSelect,
}: SpaceGroupExplorerProps) {
  const hits = useMemo(() => crystalForms(facts), [facts]);
  const highlights = useMemo(() => spaceGroupHighlights(hits, suggestions), [hits, suggestions]);
  const unresolved = useMemo(() => unresolvedSpaceGroups(hits), [hits]);
  // Whether a prediction actually landed on a group in the table, not merely
  // whether one was passed in: an unresolvable symbol flags nothing.
  const predicted = useMemo(() => hasPrediction(highlights), [highlights]);
  const start = startingGroup(highlights, initialSymbol);
  const [teaching, setTeaching] = useState(() => findSpaceGroup(start)?.sohncke === false);
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState(start);
  const [elementId, setElementId] = useState<string | null>(null);

  const group = findSpaceGroup(selected) ?? SOHNCKE_GROUPS[0];
  const pool = teaching ? SPACE_GROUPS : SOHNCKE_GROUPS;
  const matches = useMemo(() => searchSpaceGroups(pool, query), [pool, query]);
  const bySystem = useMemo(() => CRYSTAL_SYSTEM_ORDER
    .map((system) => ({ system, groups: matches.filter((entry) => entry.system === system) }))
    .filter((row) => row.groups.length > 0), [matches]);

  const cell = useMemo(() => highlights.get(group.n)?.unitCell ?? defaultCell(group), [group, highlights]);
  const frame = useMemo(() => diagramFrame(cell, 232), [cell]);
  const wideFrame = useMemo(() => diagramFrame(cell, 232, 58), [cell]);
  const drawn = useMemo(() => elementDiagram(group, frame), [group, frame]);
  const positions = useMemo(() => generalPositions(group, frame), [group, frame]);
  const elements = useMemo(() => groupElements(group), [group]);
  const classes = useMemo(() => operationClasses(elements), [elements]);
  const chosen = (classes.find((entry) => entry.id === elementId) ?? classes[Math.min(1, classes.length - 1)]).element;

  const choose = useCallback((entry: SpaceGroup) => {
    setSelected(entry.short);
    setElementId(null);
    onSelect?.(entry);
  }, [onSelect]);

  const scope = citationScope("space-groups", REFERENCES);
  const copies = multiplicity(group);
  const evidence = highlights.get(group.n);

  return <div className="sg-explorer">
    <section className="crystallize-section sg-intro" aria-labelledby="sg-intro-heading">
      <header className="sg-head">
        <span className="sg-head-icon"><Boxes aria-hidden="true"/></span>
        <div>
          <h3 id="sg-intro-heading">Space group</h3>
          <small>
            A crystal is one copy of {proteinName} — the <em>asymmetric unit</em> — repeated by a fixed set of
            rotations, screw axes and translations. The 230 space groups are every set that fills space;
            only the 65 <em>Sohncke</em> groups leave a protein's handedness alone, so those are the ones a
            protein crystal can use<Cite scope={scope} id="ita2016"/>. A few of the 65 turn up far more often
            than the rest, for packing reasons<Cite scope={scope} id="wukovitz1995"/>.
          </small>
        </div>
      </header>
    </section>

    <section className="crystallize-section sg-chooser" aria-labelledby="sg-chooser-heading">
      <header>
        <h3 id="sg-chooser-heading">Pick a group</h3>
        <small>Groups your own PDB homologues crystallised in are flagged in the list. The group you pick is saved with the project and is the one the lattice builder packs. Its two International Tables plates are drawn on the right.</small>
      </header>
      <div className="sg-body">
      <div className="sg-picker">
        <div className="sg-mode" role="radiogroup" aria-label="Which groups to list">
          {[false, true].map((mode) => <button
            key={String(mode)}
            type="button"
            role="radio"
            aria-checked={teaching === mode}
            className={teaching === mode ? "active" : ""}
            onClick={() => setTeaching(mode)}
          >{mode ? <><GraduationCap aria-hidden="true"/>All 230</> : <>65 for proteins</>}</button>)}
        </div>
        <p className="sg-mode-note">{teaching
          ? "Teaching mode. The extra 165 groups mirror or invert their contents, which would turn L-amino acids into D-amino acids: real protein crystals never adopt them."
          : "The 65 groups built only from rotations, screw axes and translations."}
        </p>
        <label className="sg-search">
          <Search aria-hidden="true"/>
          <input
            type="search"
            value={query}
            placeholder="Symbol, number or system"
            aria-label="Search space groups"
            onChange={(event) => setQuery(event.target.value)}
          />
        </label>
        <div className="sg-list" role="listbox" aria-label="Space groups">
          {bySystem.map(({ system, groups }) => <div key={system} className="sg-list-system">
            <h4 title={CRYSTAL_SYSTEM_NOTES[system]}>{systemLabel(system)}<span>{groups.length}</span></h4>
            <ul>
              {groups.map((entry) => <li key={entry.n}>
                <button
                  type="button"
                  role="option"
                  aria-selected={entry.n === group.n}
                  className={entry.n === group.n ? "selected" : ""}
                  onClick={() => choose(entry)}
                >
                  <HmSymbol group={entry}/>
                  <span className="sg-list-number">{entry.n}</span>
                  {highlights.get(entry.n) && <HighlightFlag highlight={highlights.get(entry.n)!}/>}
                </button>
              </li>)}
            </ul>
          </div>)}
          {bySystem.length === 0 && <p className="sg-list-empty">No group matches “{query}”. Try a symbol such as P212121, a number from 1 to 230, or a crystal system.</p>}
        </div>
      </div>

      <div className="sg-detail">
        <div className="sg-detail-head">
          <h4 className="sg-symbol" aria-label={`Space group ${symbolText(group)}, number ${group.n}`}><HmSymbol group={group}/></h4>
          <dl className="sg-facts">
            <div><dt>Number</dt><dd>{group.n} of 230</dd></div>
            <div><dt>Crystal system</dt><dd title={CRYSTAL_SYSTEM_NOTES[group.system]}>{systemLabel(group.system)}</dd></div>
            <div><dt>Point group</dt><dd>{group.pointGroup}</dd></div>
            <div><dt>Copies per cell</dt><dd>{copies}</dd></div>
            <div><dt>Asymmetric unit</dt><dd>1/{copies} of the cell</dd></div>
          </dl>
        </div>
        <p className="sg-summary">{spaceGroupSummary(group)}<Cite scope={scope} id="gemmi"/></p>

        <Evidence group={group} highlight={evidence} predictorNote={predictorNote} predicted={predicted} hits={hits} unresolved={unresolved} scope={scope}/>

        {/* The two plates stay beside the list: they are what reading the
            chosen group means, and they fill the column the list sets. */}
        <div className="sg-diagrams">
          <ElementFigure group={group} frame={frame} drawn={drawn} chosen={chosen} scope={scope}/>
          <PositionFigure group={group} frame={frame} positions={positions} proteinName={proteinName}/>
        </div>
      </div>
      </div>
    </section>

    <section className="crystallize-section sg-operations" aria-labelledby="sg-operations-heading">
      <header>
        <h3 id="sg-operations-heading">Symmetry operations<span>{elements.length}</span></h3>
        <small>
          Each one makes one copy of {proteinName} in the cell. Pick one to see it move.
          {classes.length < elements.length && ` They come in ${classes.length} kinds; a chip marked ×n stands for n of the same kind in different places.`}
        </small>
      </header>
      <ul>
        {classes.map((entry) => <li key={entry.id}>
          <button
            type="button"
            aria-pressed={entry.element === chosen}
            className={`sg-op ${entry.element.category}${entry.element === chosen ? " selected" : ""}`}
            onClick={() => setElementId(entry.id)}
          >
            <CategoryMark category={entry.element.category} order={entry.element.order}/>
            <span className="sg-op-symbol">{entry.element.symbol}</span>
            <span className="sg-op-where">{operationLabel(entry.element)}</span>
            {entry.count > 1 && <span className="sg-op-count">×{entry.count}</span>}
          </button>
        </li>)}
      </ul>
    </section>

    <Animation group={group} element={chosen} frame={wideFrame} cell={cell} proteinName={proteinName}/>

    <ReferenceList scope={scope} className="sg-references"/>
  </div>;
}

/**
 * The operations of a group, gathered into kinds. A cubic group has 96
 * operations but only a dozen kinds, and the extra copies are the same
 * movement somewhere else in the cell, so the list stays readable.
 */
function operationClasses(elements: SymmetryElement[]): { id: string; element: SymmetryElement; count: number }[] {
  const classes = new Map<string, { id: string; element: SymmetryElement; count: number }>();
  for (const element of elements) {
    const id = element.kind === "identity" ? "identity"
      : element.kind === "translation" ? `t|${element.intrinsic.join(",")}`
      : `${element.symbol}|${element.axis?.join(",") ?? ""}`;
    const existing = classes.get(id);
    if (existing) existing.count += 1;
    else classes.set(id, { id, element, count: 1 });
  }
  return [...classes.values()];
}

function systemLabel(system: CrystalSystem): string {
  return system.charAt(0).toUpperCase() + system.slice(1);
}

/** Where the element sits, short enough for a chip. */
function operationLabel(element: SymmetryElement): string {
  if (element.kind === "identity") return "the copy you started from";
  if (element.kind === "translation") return "centring translation";
  const axis = element.axis ? axisLabel(element.axis) : "";
  if (element.kind === "mirror" || element.kind === "glide") return `plane ⟂ ${axis}`;
  if (element.kind === "inversion") return "centre of inversion";
  return `along ${axis}`;
}

function axisLabel(axis: readonly number[]): string {
  const named: Record<string, string> = { "1,0,0": "a", "0,1,0": "b", "0,0,1": "c" };
  return named[axis.join(",")] ?? `[${axis.map((value) => (value < 0 ? `${Math.abs(value)}̅` : value)).join("")}]`;
}

/** The Hermann–Mauguin symbol with real subscripts and overbars. */
function HmSymbol({ group }: { group: SpaceGroup }) {
  return <span className="sg-hm">{symbolTokens(group).map((token, index) => <span key={index} className={token.bar ? "barred" : undefined}>
    {token.text}{token.subscript && <sub>{token.subscript}</sub>}
  </span>)}</span>;
}

// ── Highlights from earlier jobs ────────────────────────────────────────────

/**
 * A group can be both: used by a homologue and named by a predictor. The
 * evidence badge comes first and the prediction follows it, so neither is
 * hidden by the other.
 */
function HighlightFlag({ highlight }: { highlight: SpaceGroupHighlight }) {
  const predicted = highlight.predictor;
  return <>
    {highlight.kind === "pdb" && <span className="sg-flag pdb" title={highlight.detail}>
      <Database aria-hidden="true"/>{highlight.pdbIds.length} PDB
    </span>}
    {predicted && <span className="sg-flag predictor" title={predicted.detail}>
      <Sparkles aria-hidden="true"/>{predicted.source}
    </span>}
  </>;
}

/**
 * A shape per change category, so the categories survive greyscale: a turning
 * arrow for a rotation, a screw's arrow with a step, a straight arrow for a
 * centring translation, a line for a plane, a dot for an inversion centre.
 */
const CATEGORY_MARKS: Record<SymmetryCategory, { icon: ReactNode; label: string }> = {
  identity: { icon: <Circle aria-hidden="true"/>, label: "the copy you started from" },
  rotation: { icon: <RotateCw aria-hidden="true"/>, label: "rotation axis" },
  screw: { icon: <MoveRight aria-hidden="true"/>, label: "screw axis: turn and slide" },
  centring: { icon: <ArrowRight aria-hidden="true"/>, label: "centring translation" },
  reflection: { icon: <Minus aria-hidden="true"/>, label: "mirror or glide plane: impossible for a protein" },
  inversion: { icon: <CircleDot aria-hidden="true"/>, label: "inversion: impossible for a protein" },
};

function CategoryMark({ category, order }: { category: SymmetryCategory; order: number }) {
  const mark = CATEGORY_MARKS[category];
  return <span className={`sg-cat ${category}`} title={`${mark.label}${order > 1 && (category === "rotation" || category === "screw") ? `, ${order}-fold` : ""}`}>
    {mark.icon}
  </span>;
}

/** The saved PDB homologues that record a crystal form, from the shared facts. */
function crystalForms(facts: ProteinFacts | null): SpaceGroupHit[] {
  if (!facts || facts.pdbHits.status !== "known") return [];
  return facts.pdbHits.value.hits
    .filter((hit) => hit.spaceGroup)
    .map((hit) => ({ pdbId: hit.pdbId, spaceGroup: hit.spaceGroup, unitCell: hit.unitCell }));
}

function Evidence({ group, highlight, predictorNote, predicted = false, hits, unresolved, scope }: {
  group: SpaceGroup;
  highlight?: SpaceGroupHighlight;
  predictorNote?: string;
  /** True once a predictor really suggested something, so the note stops saying none did. */
  predicted?: boolean;
  hits: SpaceGroupHit[];
  unresolved: string[];
  scope: ReturnType<typeof citationScope>;
}) {
  const missing = hits.length === 0;
  return <div className="sg-evidence">
    <h5>What your protein's relatives did</h5>
    {highlight?.kind === "pdb" && <p className="found">
      <Database aria-hidden="true"/>
      <span>
        {highlight.pdbIds.length === 1 ? "A saved PDB homologue" : `${highlight.pdbIds.length} saved PDB homologues`} crystallised in {group.short}: {highlight.pdbIds.join(", ")}.
        {highlight.unitCell && ` Cell ${formatCell(highlight.unitCell)}, used for the distances below.`}
      </span>
    </p>}
    {highlight?.predictor && <p className="found">
      <Sparkles aria-hidden="true"/><span>{highlight.predictor.source} suggests {group.short}. {highlight.predictor.detail}</span>
    </p>}
    {!highlight && !missing && <p className="quiet">None of the saved PDB homologues used {group.short}. That is not an argument against it — it only says this group is not in your evidence.</p>}
    {missing && <p className="quiet">
      No saved PDB homologue records a space group yet. Run the Sequence research job and choose a reference match,
      and the groups your relatives used will be flagged in the list.
    </p>}
    {unresolved.length > 0 && <p className="quiet">
      {unresolved.length === 1 ? "One saved homologue reports a space group" : `${unresolved.length} saved homologues report space groups`} this table does not recognise ({unresolved.join(", ")}). They are left unflagged rather than guessed at.
    </p>}
    <p className="quiet">
      {predictorNote ?? (predicted
        ? <>MASCL predicts likely space groups by docking the protein against itself<Cite scope={scope} id="mascl2025"/>; the groups it ranked are flagged in the list. A prediction is not evidence — only the groups your own homologues really crystallised in are.</>
        : <>MASCL predicts likely space groups from symmetrical docking<Cite scope={scope} id="mascl2025"/>, but no redistributable MASCL model ships with this installation, so nothing here is a prediction — only what your own evidence says.</>)}
    </p>
  </div>;
}

function formatCell(cell: UnitCell): string {
  return `${cell.a.toFixed(1)} × ${cell.b.toFixed(1)} × ${cell.c.toFixed(1)} Å, ${cell.alpha.toFixed(0)}° ${cell.beta.toFixed(0)}° ${cell.gamma.toFixed(0)}°`;
}

// ── Diagrams ────────────────────────────────────────────────────────────────

/** The glyph for an axis coming out of the page, as the Tables draw it. */
function AxisMark({ glyph, screw }: { glyph: AxisGlyph; screw: boolean }) {
  const shapes: Record<AxisGlyph, string> = {
    lens: "M0 -6 Q4.2 0 0 6 Q-4.2 0 0 -6 Z",
    triangle: "M0 -6 L5.2 3 L-5.2 3 Z",
    square: "M-4.6 -4.6 H4.6 V4.6 H-4.6 Z",
    hexagon: "M0 -6 L5.2 -3 L5.2 3 L0 6 L-5.2 3 L-5.2 -3 Z",
  };
  return <>
    <path d={shapes[glyph]} className="sg-axis-glyph"/>
    {screw && <path d="M0 -9 L7 -9 M0 9 L-7 9" className="sg-axis-tail"/>}
  </>;
}

/** Along a, b or c: the directions that stay legible in a crowded cell. */
function principal(item: DiagramElement): boolean {
  const axis = item.element.axis;
  if (!axis) return true;
  return axis.filter((value) => value !== 0).length === 1;
}

const CROWDED = 60;

/**
 * The Tables draw an axis lying in the page as an arrow: both barbs for a
 * rotation, one barb for a screw. That keeps rotation and screw apart without
 * relying on colour, which the monochrome appearances do not have.
 */
function AxisArrow({ from, to, half }: { from: [number, number]; to: [number, number]; half: boolean }) {
  const [dx, dy] = [to[0] - from[0], to[1] - from[1]];
  const length = Math.hypot(dx, dy) || 1;
  const [ux, uy] = [dx / length, dy / length];
  const at: [number, number] = [from[0] + dx * 0.66, from[1] + dy * 0.66];
  const barb = (side: number) => `M${at[0]} ${at[1]} L${at[0] - ux * 7 - uy * 4 * side} ${at[1] - uy * 7 + ux * 4 * side}`;
  return <path d={half ? barb(1) : `${barb(1)} ${barb(-1)}`} className="sg-axis-arrow"/>;
}

function ElementFigure({ group, frame, drawn, chosen, scope }: {
  group: SpaceGroup; frame: DiagramFrame; drawn: DiagramElement[]; chosen: SymmetryElement;
  scope: ReturnType<typeof citationScope>;
}) {
  const [showAll, setShowAll] = useState(false);
  const crowded = drawn.length > CROWDED;
  const shown = crowded && !showAll ? drawn.filter(principal) : drawn;
  const labelled = shown.length <= 40;
  const chosenAxis = chosen.axis?.join(",") ?? "";
  const isChosen = (item: DiagramElement) =>
    item.symbol === chosen.symbol && (item.element.axis?.join(",") ?? "") === chosenAxis;
  return <figure className="sg-figure">
    <figcaption>
      <strong>Symmetry elements</strong>
      <span>Where the axes and planes of {group.short} sit in one cell, seen down <b>c</b> with <b>a</b> down the page<Cite scope={scope} id="ucl-sgp"/>.</span>
      {crowded && <span className="sg-figure-toggle">
        {showAll
          ? `All ${drawn.length} elements, as crowded as the printed plate.`
          : `${group.short} has ${drawn.length} elements in one cell. Showing the ${shown.length} along a, b and c.`}
        <Button type="button" size="xs" variant="outline" onClick={() => setShowAll(!showAll)}>{showAll ? "Only a, b, c" : "Show all"}</Button>
      </span>}
    </figcaption>
    <svg width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img"
      aria-label={`Symmetry-element diagram of space group ${symbolText(group)}: ${drawn.length} elements in one unit cell`}>
      <Cell frame={frame}/>
      {shown.map((item) => {
        const highlight = isChosen(item) ? " highlight" : "";
        const className = `sg-el ${item.category}${item.shifted ? " shifted" : ""}${highlight}`;
        // The element itself, then its copies on the opposite cell edges.
        const places: [number, number][] = [[0, 0], ...item.repeats];
        if (item.shape === "line" && item.from && item.to) {
          const [from, to] = [item.from, item.to];
          return <g key={item.id} className={className}>{places.map(([dx, dy], index) => <g key={index} transform={`translate(${dx} ${dy})`}>
            <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]}/>
            {item.category !== "reflection" && <AxisArrow from={from} to={to} half={item.shifted}/>}
            {item.height && labelled && <text x={(from[0] + to[0]) / 2} y={(from[1] + to[1]) / 2 - 4}>{item.height}</text>}
          </g>)}</g>;
        }
        if (item.shape === "face" && item.at) {
          return <g key={item.id} className={className}>
            <path d={`M${item.at[0] - 4} ${item.at[1] + 10} v-10 h10`} className="sg-face-mark"/>
            <text x={item.at[0] + 9} y={item.at[1] + 2}>{item.symbol}</text>
          </g>;
        }
        if (!item.at) return null;
        const at = item.at;
        return <g key={item.id} className={className}>{places.map(([dx, dy], index) => <g key={index} transform={`translate(${at[0] + dx} ${at[1] + dy})`}>
          {item.glyph ? <AxisMark glyph={item.glyph} screw={item.shifted}/> : <circle r="3.4" className="sg-inversion-mark"/>}
        </g>)}</g>;
      })}
    </svg>
    <ul className="sg-legend">
      {legendFor(shown).map((entry) => <li key={entry.label} className={entry.category}>
        <svg width="18" height="18" viewBox="-9 -9 18 18" aria-hidden="true">{entry.mark}</svg>
        {entry.label}
      </li>)}
    </ul>
  </figure>;
}

type LegendEntry = { label: string; category: SymmetryCategory; mark: ReactNode };

/** One row per kind of element actually drawn, with its own shape. */
function legendFor(drawn: DiagramElement[]): LegendEntry[] {
  const entries: LegendEntry[] = [];
  const seen = new Set<string>();
  for (const item of drawn) {
    const key = `${item.kind}-${item.order}-${item.shape}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const label = item.kind === "screw" ? `${item.order}-fold screw axis`
      : item.kind === "rotation" ? `${item.order}-fold rotation axis`
      : item.kind === "mirror" ? "mirror plane"
      : item.kind === "glide" ? "glide plane"
      : item.kind === "inversion" ? "centre of inversion"
      : `${item.order}-fold rotoinversion axis`;
    if (seen.has(label)) continue;
    seen.add(label);
    const mark = item.shape === "point" && item.glyph
      ? <g className={`sg-el ${item.category}${item.shifted ? " shifted" : ""}`}><AxisMark glyph={item.glyph} screw={item.shifted}/></g>
      : item.shape === "point"
        ? <g className={`sg-el ${item.category}`}><circle r="3.4" className="sg-inversion-mark"/></g>
        : <g className={`sg-el ${item.category}${item.shifted ? " shifted" : ""}`}>
          <line x1="-8" y1="0" x2="8" y2="0"/>
          {item.category !== "reflection" && <AxisArrow from={[-8, 0]} to={[10, 0]} half={item.shifted}/>}
        </g>;
    entries.push({ label, category: item.category, mark });
  }
  return entries;
}

function Cell({ frame, lattice = false }: { frame: DiagramFrame; lattice?: boolean }) {
  const points = frame.corners.map((corner) => corner.join(",")).join(" ");
  return <g className="sg-cell">
    {lattice && <polygon points={points} className="sg-cell-ghost" transform={`translate(${frame.basis.bx} ${frame.basis.by})`}/>}
    <polygon points={points}/>
    <text x={frame.labels.a[0]} y={frame.labels.a[1]}>a</text>
    <text x={frame.labels.b[0]} y={frame.labels.b[1]}>b</text>
    <text x={frame.labels.origin[0]} y={frame.labels.origin[1]}>o</text>
  </g>;
}

/** A chiral blob: a protein drawn so its mirror image is obvious. */
function Motif({ className = "", scale = 1 }: { className?: string; scale?: number }) {
  return <g className={`sg-motif ${className}`.trim()} transform={scale === 1 ? undefined : `scale(${scale})`}>
    <path d="M-7.5 -3.4 C-5 -9.5 4.5 -9.5 7.6 -3.6 C10.4 1.7 5.6 8.6 -0.6 8.2 C-6.4 7.8 -9.6 1.8 -7.5 -3.4 Z"/>
    <path d="M1.4 -5.4 C5 -3 4.4 2.4 0.6 4.4" className="sg-motif-helix"/>
    <circle cx="-3.4" cy="1.6" r="1.7" className="sg-motif-site"/>
  </g>;
}

/** Smaller copies once the cell is busy, so the motifs do not overlap. */
function motifScale(copies: number): number {
  return copies <= 4 ? 1.5 : copies <= 12 ? 1.15 : copies <= 32 ? 0.85 : 0.6;
}

function PositionFigure({ group, frame, positions, proteinName }: {
  group: SpaceGroup; frame: DiagramFrame; positions: GeneralPosition[]; proteinName: string;
}) {
  const scale = motifScale(positions.length);
  return <figure className="sg-figure">
    <figcaption>
      <strong>General positions</strong>
      <span>{positions.length} {positions.length === 1 ? "copy" : "copies"} of {proteinName} in one cell. The number beside each copy is its height above the page; a copy drawn flipped is a mirror image.</span>
    </figcaption>
    <svg width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img"
      aria-label={`General-position diagram of space group ${symbolText(group)}: ${positions.length} copies of the asymmetric unit`}>
      <Cell frame={frame}/>
      {positions.map((position, index) => <g key={position.id} className={`sg-copy${position.mirrored ? " mirrored" : ""}${index === 0 ? " origin" : ""}`}
        transform={`translate(${position.at[0]} ${position.at[1]}) matrix(${position.transform.a} ${position.transform.c} ${position.transform.b} ${position.transform.d} 0 0)`}>
        <Motif scale={scale}/>
      </g>)}
      {positions.length <= 16 && positions.map((position) => <text key={`h-${position.id}`} className="sg-height" x={position.at[0] + 8 + 7 * scale} y={position.at[1] - 4 - 5 * scale}>{position.height}</text>)}
    </svg>
    <p className="sg-figure-note">Coordinates: {positions.slice(0, 4).map((position) => position.triplet).join("; ")}{positions.length > 4 ? ` … (${positions.length - 4} more)` : ""}</p>
  </figure>;
}

// ── One operation, step by step ─────────────────────────────────────────────

function Animation({ group, element, frame, cell, proteinName }: {
  group: SpaceGroup; element: SymmetryElement; frame: DiagramFrame; cell: UnitCell; proteinName: string;
}) {
  const steps = useMemo(() => operationSteps(element, cell), [element, cell]);
  const [step, setStep] = useState(0);
  const [progress, setProgress] = useState(0);
  const [playing, setPlaying] = useState(false);
  const reduced = useReducedMotion();
  const raf = useRef(0);
  const started = useRef(0);

  useEffect(() => { setStep(0); setProgress(0); setPlaying(false); }, [element]);

  useEffect(() => {
    if (!playing) return;
    started.current = performance.now() - progress * STEP_MS;
    const tick = (now: number) => {
      const next = Math.min(1, (now - started.current) / STEP_MS);
      setProgress(next);
      if (next < 1) {
        raf.current = requestAnimationFrame(tick);
        return;
      }
      if (step + 1 >= steps.length) {
        setPlaying(false);
        return;
      }
      setStep((value) => value + 1);
      setProgress(0);
      started.current = now;
      raf.current = requestAnimationFrame(tick);
    };
    raf.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf.current);
    // `progress` is read once to resume from where a pause left it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, step, steps.length]);

  const positions = useMemo(() => generalPositions(group, frame), [group, frame]);
  const scale = motifScale(positions.length);
  const from = step === 0 ? SEED : steps[step - 1].position;
  const live = animationFrame(element, reduced ? 1 : progress, frame, from);
  const startTransform = useMemo(() => operationTransform(powerOf(element, step), frame), [element, step, frame]);
  const endTransform = useMemo(() => operationTransform(powerOf(element, step + 1), frame), [element, step, frame]);
  const spin = live.degrees !== 0;
  const motif = spin
    ? { ...startTransform, rotate: live.degrees }
    : { ...lerpTransform(startTransform, endTransform, reduced ? 1 : progress), rotate: 0 };
  const caption = steps[Math.min(step, steps.length - 1)].caption;

  return <section className="crystallize-section sg-animation" aria-labelledby="sg-animation-heading">
    <header className="sg-animation-head">
      <h3 id="sg-animation-heading">Step through <span className="sg-op-symbol">{element.symbol}</span> {operationLabel(element)}</h3>
      <div className="sg-animation-controls">
        <Button type="button" size="sm" variant={playing ? "secondary" : "default"} onClick={() => setPlaying(!playing)} disabled={reduced}>
          {playing ? <><Pause aria-hidden="true"/>Pause</> : <><Play aria-hidden="true"/>Play</>}
        </Button>
        <Button type="button" size="sm" variant="outline" onClick={() => {
          setPlaying(false);
          setProgress(0);
          setStep((value) => (value + 1 >= steps.length ? 0 : value + 1));
        }}><SkipForward aria-hidden="true"/>Next step</Button>
        <Button type="button" size="sm" variant="ghost" onClick={() => { setPlaying(false); setStep(0); setProgress(0); }}>
          <RotateCcw aria-hidden="true"/>Reset
        </Button>
        <span className="sg-animation-count">Step {Math.min(step + 1, steps.length)} of {steps.length}</span>
      </div>
    </header>
    <div className="sg-animation-stage">
      <svg width={frame.width} height={frame.height} viewBox={`0 0 ${frame.width} ${frame.height}`} role="img"
        aria-label={`${element.symbol} operation of ${symbolText(group)}, step ${Math.min(step + 1, steps.length)} of ${steps.length}`}>
        <Cell frame={frame} lattice/>
        {positions.map((position) => <g key={position.id} className="sg-copy ghost"
          transform={`translate(${position.at[0]} ${position.at[1]}) matrix(${position.transform.a} ${position.transform.c} ${position.transform.b} ${position.transform.d} 0 0)`}>
          <Motif scale={scale}/>
        </g>)}
        <ElementMark element={element} frame={frame}/>
        <g className={`sg-copy moving${live.mirrored ? " mirrored" : ""}`}
          transform={`translate(${live.at[0]} ${live.at[1]}) rotate(${motif.rotate}) matrix(${motif.a} ${motif.c} ${motif.b} ${motif.d} 0 0)`}>
          <Motif scale={Math.max(scale, 1)}/>
        </g>
        <text className="sg-height moving" x={live.at[0] + 12} y={live.at[1] - 8}>{formatHeight(live.point[2])}</text>
      </svg>
      <div className="sg-animation-words">
        <p className="sg-step-caption">{caption}</p>
        <p className="sg-step-what">{elementSentence(element, cell)}</p>
        {!element.rigid && <p className="sg-step-warning"><TriangleAlert aria-hidden="true"/>{proteinName} cannot do this. Mirroring swaps every L-amino acid for a D-amino acid, which is why protein crystals use only the 65 Sohncke groups.</p>}
        {reduced && <p className="sg-step-what">Reduced motion is on, so each step is shown finished rather than animated. Use <b>Next step</b> to walk through them.</p>}
        <p className="sg-step-hint"><ChevronRight aria-hidden="true"/>The copy may leave the cell. The faint cell next door shows where it reappears: the lattice repeats for ever.</p>
      </div>
    </div>
  </section>;
}

const SEED: [number, number, number] = [0.22, 0.14, 0.12];

function ElementMark({ element, frame }: { element: SymmetryElement; frame: DiagramFrame }) {
  if (!element.axis || !element.point) return null;
  const point = element.point.map((value) => value / 12) as [number, number, number];
  if (element.axis[0] === 0 && element.axis[1] === 0) {
    const [x, y] = frame.project([point[0], point[1], 0]);
    return <g className={`sg-el ${element.category} highlight`} transform={`translate(${x} ${y})`}>
      <AxisMark glyph={element.order === 3 ? "triangle" : element.order === 4 ? "square" : element.order === 6 ? "hexagon" : "lens"} screw={element.kind === "screw"}/>
    </g>;
  }
  const from = frame.project([point[0], point[1], 0]);
  const to = frame.project([point[0] + element.axis[0], point[1] + element.axis[1], 0]);
  return <g className={`sg-el ${element.category} highlight`}>
    <line x1={from[0]} y1={from[1]} x2={to[0]} y2={to[1]}/>
    {element.category !== "reflection" && <AxisArrow from={from} to={to} half={element.kind === "screw"}/>}
  </g>;
}

/** The operation applied `times` over, for the orientation of a later copy. */
function powerOf(element: SymmetryElement, times: number) {
  let result = IDENTITY;
  for (let step = 0; step < times; step += 1) result = composeOperations(result, element.op);
  return result;
}

function lerpTransform(from: GeneralPosition["transform"], to: GeneralPosition["transform"], at: number) {
  const mix = (left: number, right: number) => left + (right - left) * at;
  return { a: mix(from.a, to.a), b: mix(from.b, to.b), c: mix(from.c, to.c), d: mix(from.d, to.d) };
}

function formatHeight(z: number): string {
  const wrapped = z - Math.floor(z);
  return wrapped.toFixed(2).replace(/^0/, "");
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeToMotion(onChange: () => void): () => void {
  if (typeof window === "undefined" || !window.matchMedia) return () => {};
  const query = window.matchMedia(REDUCED_MOTION);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** True while the desktop asks for reduced motion; the steps then stay still. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeToMotion,
    () => (typeof window !== "undefined" && window.matchMedia ? window.matchMedia(REDUCED_MOTION).matches : false),
    () => false,
  );
}
