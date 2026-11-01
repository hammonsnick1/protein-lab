// Mol* (MIT) behind a small imperative API for the Structure Viewer. Loaded
// lazily by structure-viewer.tsx so the ~MBs of Mol* stay out of the main
// bundle. Only the 3D canvas is used: Mol*'s own React chrome is never mounted,
// so every control the user sees is ours and follows the app's design tokens.
import { MAQualityAssessment } from "molstar/lib/extensions/model-archive/quality-assessment/behavior";
import { Segmentation } from "molstar/lib/mol-data/int";
import { Vec3 } from "molstar/lib/mol-math/linear-algebra";
import { EmptyLoci, type Loci } from "molstar/lib/mol-model/loci";
import { Structure, StructureElement, StructureProperties, StructureSelection, Unit } from "molstar/lib/mol-model/structure";
import type { StateObjectSelector } from "molstar/lib/mol-state";
import type { PluginStateObject } from "molstar/lib/mol-plugin-state/objects";
import { StateTransforms } from "molstar/lib/mol-plugin-state/transforms";
import { PluginCommands } from "molstar/lib/mol-plugin/commands";
import { PluginContext } from "molstar/lib/mol-plugin/context";
import { DefaultPluginSpec, PluginSpec } from "molstar/lib/mol-plugin/spec";
import type { Expression } from "molstar/lib/mol-script/language/expression";
import { MolScriptBuilder as MS } from "molstar/lib/mol-script/language/builder";
import { Script } from "molstar/lib/mol-script/script";
import { Overpaint } from "molstar/lib/mol-theme/overpaint";
import { Color } from "molstar/lib/mol-util/color";
import { Task } from "molstar/lib/mol-task";
import type { ChainSequence } from "@/lib/conservation-coloring";
import type { ResidueColoring } from "@/lib/structure-coloring";
import type { InterfaceAtom } from "@/lib/structure-interface";
import type { PickedLigandAtom } from "@/lib/ligand-depiction";
import type { LigandAddress, ResidueAddress } from "@/lib/structure-regions";

export type StageRepresentation = "cartoon" | "surface" | "ball-and-stick";
export type StageColor = "chain-id" | "secondary-structure" | "plddt-confidence" | "hydrophobicity";
export type StageStyle = { representation: StageRepresentation; color: StageColor; showLigands: boolean; showWaters: boolean; spin: boolean };
export type StageResidue = { labelAsymId: string; labelSeqId: number; authAsymId: string; authSeqId: number; insCode: string; compId: string; code: string };
export type StageTheme = { highlight: string; select: string; region: string };
export type StageLoad = { residues: StageResidue[]; hasConfidence: boolean; chains: ChainSequence[] };

type StructureCell = StateObjectSelector<PluginStateObject.Molecule.Structure>;
type ReprCell = StateObjectSelector<PluginStateObject.Molecule.Structure.Representation3D>;

/** Camera animation length, or none when the user asks for reduced motion. */
const motion = (ms: number) => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : ms;
const hex = (value: string) => Color(parseInt(value.replace("#", ""), 16));
const ONE_LETTER: Record<string, string> = { ALA: "A", ARG: "R", ASN: "N", ASP: "D", CYS: "C", GLN: "Q", GLU: "E", GLY: "G", HIS: "H", ILE: "I", LEU: "L", LYS: "K", MET: "M", PHE: "F", PRO: "P", SER: "S", THR: "T", TRP: "W", TYR: "Y", VAL: "V", MSE: "M", SEC: "U", PYL: "O" };

export class MolstarStage {
  private structure: StructureCell | null = null;
  private components: Partial<Record<"polymer" | "ligand" | "ion" | "water", StructureCell>> = {};
  private representations: ReprCell[] = [];
  /** Representations of the polymer, which carry the colour layers. */
  private polymerRepresentations: ReprCell[] = [];
  private surface: ReprCell | null = null;
  private surfaceAlpha = 1;
  private coloring: ResidueColoring | null = null;
  private coloringCells: string[] = [];
  private regionComponents: StructureCell[] = [];
  /** The ligand atom picked in the 2D drawing; kept selected across region changes. */
  private ligandAtom: { ligand: LigandAddress; atomName: string } | null = null;
  private subscriptions: { unsubscribe(): void }[] = [];
  // Style and region changes both edit the Mol* state tree; run them one at a time.
  private queue: Promise<unknown> = Promise.resolve();
  private serial<T>(work: () => Promise<T>): Promise<T> { const next = this.queue.then(work, work); this.queue = next.catch(() => undefined); return next; }
  private resizeObserver: ResizeObserver;
  private constructor(readonly plugin: PluginContext, private readonly host: HTMLElement, private readonly theme: StageTheme) {
    this.resizeObserver = new ResizeObserver(() => plugin.handleResize());
    this.resizeObserver.observe(host);
  }

  static async create(host: HTMLDivElement, theme: StageTheme) {
    const spec = DefaultPluginSpec();
    const plugin = new PluginContext({ ...spec, behaviors: [...(spec.behaviors ?? []), PluginSpec.Behavior(MAQualityAssessment)] });
    await plugin.init();
    const canvas = document.createElement("canvas");
    host.replaceChildren(canvas);
    if (!(await plugin.initViewerAsync(canvas, host))) { plugin.dispose(); throw new Error("WebGL is not available, so the 3D structure cannot be drawn on this computer."); }
    const stage = new MolstarStage(plugin, host, theme);
    stage.applyCanvasTheme();
    return stage;
  }

  private applyCanvasTheme() {
    const canvas3d = this.plugin.canvas3d;
    if (!canvas3d) return;
    PluginCommands.Canvas3D.SetSettings(this.plugin, { settings: (props) => {
      props.transparentBackground = true;
      props.renderer.backgroundColor = Color(0xffffff);
      props.renderer.highlightColor = hex(this.theme.highlight);
      props.renderer.selectColor = hex(this.theme.select);
      props.renderer.selectStrength = 0.55;
      props.marking.highlightEdgeColor = hex(this.theme.highlight);
      props.marking.selectEdgeColor = hex(this.theme.select);
      props.camera.helper.axes = { name: "off", params: {} };
    } });
  }

  load(text: string, label: string): Promise<StageLoad> { return this.serial(() => this.applyLoad(text, label)); }

  private async applyLoad(text: string, label: string): Promise<StageLoad> {
    await this.plugin.clear();
    this.components = {}; this.representations = []; this.polymerRepresentations = []; this.surface = null; this.regionComponents = []; this.coloring = null; this.coloringCells = []; this.ligandAtom = null;
    const builders = this.plugin.builders;
    const data = await builders.data.rawData({ data: text, label });
    const trajectory = await builders.structure.parseTrajectory(data, "mmcif");
    const model = await builders.structure.createModel(trajectory);
    this.structure = await builders.structure.createStructure(model, { name: "model", params: {} });
    for (const type of ["polymer", "ligand", "ion", "water"] as const) {
      const component = await builders.structure.tryCreateComponentStatic(this.structure, type);
      if (component) this.components[type] = component;
    }
    return { residues: polymerResidues(this.structure.data), hasConfidence: text.includes("_ma_qa_metric_local"), chains: chainSequences(this.structure.data) };
  }

  setStyle(style: StageStyle, chainColors: readonly string[]) { return this.serial(() => this.applyStyle(style, chainColors)); }

  private async applyStyle(style: StageStyle, chainColors: readonly string[]) {
    if (!this.structure) return;
    const update = this.plugin.build();
    for (const repr of this.representations) update.delete(repr.ref);
    await update.commit();
    this.representations = []; this.polymerRepresentations = []; this.surface = null; this.coloringCells = [];
    const add = (component: StructureCell | undefined, props: Record<string, unknown>) => component ? this.plugin.builders.structure.representation.addRepresentation(component, props as never).then((repr) => { this.representations.push(repr); return repr; }) : Promise.resolve(null);
    const colorParams = style.color === "chain-id" ? { palette: { name: "colors", params: { list: { kind: "set", colors: chainColors.map(hex) } } } } : {};
    const polymer = { color: style.color, colorParams };
    if (style.representation === "surface") {
      // The cartoon shows through as the surface is made transparent.
      const cartoon = await add(this.components.polymer, { type: "cartoon", ...polymer });
      this.surface = await add(this.components.polymer, { type: "molecular-surface", ...polymer, typeParams: { alpha: this.surfaceAlpha } });
      this.polymerRepresentations.push(...[cartoon, this.surface].filter((repr): repr is ReprCell => Boolean(repr)));
    } else {
      const repr = await add(this.components.polymer, { type: style.representation, ...polymer });
      if (repr) this.polymerRepresentations.push(repr);
    }
    if (style.showLigands) {
      await add(this.components.ligand, { type: "ball-and-stick", color: "element-symbol" });
      await add(this.components.ion, { type: "ball-and-stick", color: "element-symbol" });
    }
    if (style.showWaters) await add(this.components.water, { type: "ball-and-stick", color: "element-symbol", typeParams: { alpha: 0.6 } });
    const trackball = this.plugin.canvas3d?.props.trackball;
    if (trackball) PluginCommands.Canvas3D.SetSettings(this.plugin, { settings: { trackball: { ...trackball, animate: style.spin ? { name: "spin", params: { speed: 0.25, axis: Vec3.create(0, -1, 0) } } : { name: "off", params: {} } } } });
    await this.paintColoring();
  }

  /** Surface opacity, 0 (invisible) to 1 (opaque); changes the drawn surface in place, without rebuilding it. */
  setSurfaceOpacity(alpha: number) { return this.serial(() => this.applySurfaceOpacity(alpha)); }

  private async applySurfaceOpacity(alpha: number) {
    this.surfaceAlpha = Math.min(1, Math.max(0, alpha));
    if (!this.surface) return;
    const update = this.plugin.build();
    update.to(this.surface).update((old) => { (old.type.params as { alpha: number }).alpha = this.surfaceAlpha; });
    await update.commit();
  }

  /** Paints per-residue colour layers over the polymer (null restores the colour theme underneath). */
  setColoring(coloring: ResidueColoring | null) { return this.serial(() => { this.coloring = coloring; return this.paintColoring(); }); }

  private async paintColoring() {
    const update = this.plugin.build();
    for (const ref of this.coloringCells) update.delete(ref);
    this.coloringCells = [];
    const root = this.structure?.data;
    const polymer = this.components.polymer?.data;
    if (this.coloring && root && polymer) {
      const layers: Overpaint.Layer<StructureElement.Loci>[] = [];
      if (this.coloring.base) layers.push({ loci: Structure.toStructureElementLoci(polymer), color: hex(this.coloring.base.color), clear: false });
      for (const group of this.coloring.groups) {
        const loci = group.residues.length ? this.loci(selectionExpression(group.residues, null)) : EmptyLoci;
        if (StructureElement.Loci.is(loci) && !StructureElement.Loci.isEmpty(loci)) layers.push({ loci, color: hex(group.color), clear: false });
      }
      // Later layers win, so a group's colour sits on top of the base.
      const bundle = Overpaint.toBundle(Overpaint.filter(Overpaint.merge(Overpaint("element-loci", layers)), polymer) as Overpaint<StructureElement.Loci>);
      for (const repr of this.polymerRepresentations) {
        const cell = update.to(repr).apply(StateTransforms.Representation.OverpaintStructureRepresentation3DFromBundle, bundle);
        this.coloringCells.push(cell.ref);
      }
    }
    await update.commit();
  }

  /** Heavy atoms of every protein chain, for interface detection. */
  proteinHeavyAtoms(): InterfaceAtom[] {
    const structure = this.structure?.data;
    if (!structure) return [];
    const atoms: InterfaceAtom[] = [];
    const location = StructureElement.Location.create(structure);
    for (const unit of structure.units) {
      if (!Unit.isAtomic(unit)) continue;
      location.unit = unit;
      location.element = unit.elements[0];
      if (StructureProperties.entity.type(location) !== "polymer" || !/peptide/i.test(StructureProperties.entity.subtype(location))) continue;
      for (let index = 0; index < unit.elements.length; index++) {
        location.element = unit.elements[index];
        const element = StructureProperties.atom.type_symbol(location);
        if (element === "H" || element === "D") continue;
        atoms.push({ chain: StructureProperties.chain.label_asym_id(location), seq: StructureProperties.residue.label_seq_id(location), x: StructureProperties.atom.x(location), y: StructureProperties.atom.y(location), z: StructureProperties.atom.z(location) });
      }
    }
    return atoms;
  }

  /** Highlights exactly the given residues (and ligand), shows their side chains, and focuses the camera. */
  showRegion(residues: ResidueAddress[], ligand: LigandAddress | null) {
    // Changing the region clears every selection; the atom picked in 2D goes back on afterwards.
    return this.serial(() => this.applyRegion(residues, ligand).finally(() => this.selectLigandAtom()));
  }

  private async applyRegion(residues: ResidueAddress[], ligand: LigandAddress | null) {
    if (this.regionComponents.length) { const update = this.plugin.build(); for (const component of this.regionComponents) update.delete(component.ref); await update.commit(); this.regionComponents = []; }
    this.plugin.managers.interactivity.lociSelects.deselectAll();
    if (!this.structure || (!residues.length && !ligand)) return;
    const loci = this.loci(selectionExpression(residues, ligand));
    if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return;
    const builders = this.plugin.builders.structure;
    // Region residues: side chains with primary-coloured carbons, and the selection mark on the cartoon.
    if (residues.length) {
      const component = await builders.tryCreateComponentFromExpression(this.structure, selectionExpression(residues, null), "region-residues", { label: "Region residues" });
      if (component) {
        this.regionComponents.push(component);
        await builders.representation.addRepresentation(component, { type: "ball-and-stick", color: "element-symbol", colorParams: { carbonColor: { name: "uniform", params: { value: hex(this.theme.region) } } }, typeParams: { sizeFactor: 0.25 } } as never);
      }
      this.plugin.managers.interactivity.lociSelects.selectOnly({ loci: this.loci(selectionExpression(residues, null)) });
    }
    // The ligand keeps element colours and is drawn even with the Ligands toggle off, so it stays distinct from its contacts.
    if (ligand) {
      const component = await builders.tryCreateComponentFromExpression(this.structure, selectionExpression([], ligand), "region-ligand", { label: "Region ligand" });
      if (component) {
        this.regionComponents.push(component);
        await builders.representation.addRepresentation(component, { type: "ball-and-stick", color: "element-symbol", typeParams: { sizeFactor: 0.36 } } as never);
      }
    }
    this.plugin.managers.camera.focusLoci(loci, { minRadius: 8, extraRadius: 4, durationMs: motion(450) });
  }

  /** Marks one atom of a ligand instance (from the 2D drawing) with the selection colour; null clears it. */
  showLigandAtom(ligand: LigandAddress | null, atomName: string | null, focus: boolean) {
    return this.serial(async () => {
      const previous = this.ligandAtom ? this.loci(ligandAtomExpression(this.ligandAtom.ligand, this.ligandAtom.atomName)) : EmptyLoci;
      if (StructureElement.Loci.is(previous)) this.plugin.managers.interactivity.lociSelects.deselect({ loci: previous });
      this.ligandAtom = ligand && atomName ? { ligand, atomName } : null;
      const loci = this.selectLigandAtom();
      if (focus && loci) this.plugin.managers.camera.focusLoci(loci, { minRadius: 9, extraRadius: 4, durationMs: motion(350) });
    });
  }

  /** Transient hover highlight of one ligand atom, e.g. from the 2D drawing. */
  hoverLigandAtom(ligand: LigandAddress | null, atomName: string | null) {
    const loci = ligand && atomName && this.structure ? this.loci(ligandAtomExpression(ligand, atomName)) : EmptyLoci;
    this.plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
  }

  private selectLigandAtom(): StructureElement.Loci | null {
    if (!this.ligandAtom || !this.structure) return null;
    const loci = this.loci(ligandAtomExpression(this.ligandAtom.ligand, this.ligandAtom.atomName));
    if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return null;
    this.plugin.managers.interactivity.lociSelects.select({ loci });
    return loci;
  }

  /** Transient hover highlight, e.g. from the sequence strip. */
  hoverResidue(residue: ResidueAddress | null) {
    const loci = residue && this.structure ? this.loci(selectionExpression([residue], null)) : EmptyLoci;
    this.plugin.managers.interactivity.lociHighlights.highlightOnly({ loci });
  }

  focusResidue(residue: ResidueAddress) { this.focusResidues([residue]); }

  /** Selects the residues and turns the camera to them, without adding side chains. */
  focusResidues(residues: ResidueAddress[]) {
    if (!this.structure || !residues.length) return;
    const loci = this.loci(selectionExpression(residues, null));
    this.plugin.managers.interactivity.lociSelects.selectOnly({ loci });
    this.plugin.managers.camera.focusLoci(loci, { minRadius: 8, extraRadius: 4, durationMs: motion(350) });
  }

  /** Residue under the pointer in 3D (null when off the protein). */
  onHover(listener: (residue: StageResidue | null) => void) {
    this.subscriptions.push(this.plugin.behaviors.interaction.hover.subscribe(({ current }) => listener(residueFromLoci(current.loci))));
  }

  onClick(listener: (residue: StageResidue | null) => void) {
    this.subscriptions.push(this.plugin.behaviors.interaction.click.subscribe(({ current }) => listener(residueFromLoci(current.loci))));
  }

  /** Atom of a non-polymer, non-water residue under the pointer (null otherwise). */
  onLigandHover(listener: (atom: PickedLigandAtom | null) => void) {
    this.subscriptions.push(this.plugin.behaviors.interaction.hover.subscribe(({ current }) => listener(ligandAtomFromLoci(current.loci))));
  }

  onLigandClick(listener: (atom: PickedLigandAtom | null) => void) {
    this.subscriptions.push(this.plugin.behaviors.interaction.click.subscribe(({ current }) => listener(ligandAtomFromLoci(current.loci))));
  }

  resetCamera() { PluginCommands.Camera.Reset(this.plugin, { durationMs: motion(350) }); }

  /** Puts the latest representations in the scene now and frames them, for a picture taken without a visible canvas. */
  async frameForImage() {
    await this.queue;
    const canvas3d = this.plugin.canvas3d;
    if (!canvas3d) throw new Error("The 3D view is not ready yet.");
    canvas3d.commit(true);
    await PluginCommands.Camera.Reset(this.plugin, { durationMs: 0 });
    canvas3d.commit(true);
  }

  zoom(factor: number) {
    const camera = this.plugin.canvas3d?.camera;
    if (!camera) return;
    const { position, target } = camera.getSnapshot();
    const offset = Vec3.scale(Vec3(), Vec3.sub(Vec3(), position, target), factor);
    this.plugin.managers.camera.setSnapshot({ position: Vec3.add(Vec3(), target, offset) }, motion(160));
  }

  /** PNG of the current view on white at twice the on-screen size, cropped to the molecule. */
  async imageDataUri({ autocrop = false } = {}) {
    const helper = this.plugin.helpers.viewportScreenshot;
    if (!helper) throw new Error("The 3D view is not ready yet.");
    const { width, height } = this.host.getBoundingClientRect();
    helper.behaviors.values.next({ ...helper.behaviors.values.value, transparent: false, axes: { name: "off", params: {} }, resolution: { name: "custom", params: { width: Math.max(1, Math.round(width * 2)), height: Math.max(1, Math.round(height * 2)) } } });
    // Mol* measures the molecule's extent from a preview; without one, the picture keeps the empty margins.
    if (autocrop) { helper.behaviors.cropParams.next({ auto: true, relativePadding: 0.04 }); await this.plugin.runTask(Task.create("Measure the molecule", (ctx) => helper.getPreview(ctx))); }
    return helper.getImageDataUri();
  }

  dispose() {
    for (const subscription of this.subscriptions) subscription.unsubscribe();
    this.resizeObserver.disconnect();
    this.plugin.dispose();
    this.host.replaceChildren();
  }

  private loci(expression: Expression): Loci {
    const data = this.structure?.data;
    if (!data) return EmptyLoci;
    return StructureSelection.toLociWithSourceUnits(Script.getStructureSelection(expression, data));
  }
}

/** MolScript for a set of polymer residues (label numbering) plus an optional ligand instance. */
export function selectionExpression(residues: ResidueAddress[], ligand: LigandAddress | null): Expression {
  const byChain = new Map<string, number[]>();
  for (const residue of residues) byChain.set(residue.labelAsymId, [...(byChain.get(residue.labelAsymId) ?? []), residue.labelSeqId]);
  const groups = [...byChain].map(([asym, ids]) => MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), asym]),
    "residue-test": MS.core.set.has([MS.set(...ids), MS.ammp("label_seq_id")]),
  }));
  if (ligand) {
    const tests = [MS.core.rel.eq([MS.ammp("auth_seq_id"), Number(ligand.authSeqId)]), MS.core.rel.eq([MS.ammp("label_comp_id"), ligand.compId])];
    if (ligand.insertionCode) tests.push(MS.core.rel.eq([MS.ammp("pdbx_PDB_ins_code"), ligand.insertionCode]));
    groups.push(MS.struct.generator.atomGroups({ "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), ligand.labelAsymId]), "residue-test": MS.core.logic.and(tests) }));
  }
  return groups.length === 1 ? groups[0] : MS.struct.combinator.merge(groups);
}

/** One named atom of a ligand instance; alternate locations of that atom are all included. */
export function ligandAtomExpression(ligand: LigandAddress, atomName: string): Expression {
  const tests = [MS.core.rel.eq([MS.ammp("auth_seq_id"), Number(ligand.authSeqId)]), MS.core.rel.eq([MS.ammp("label_comp_id"), ligand.compId])];
  if (ligand.insertionCode) tests.push(MS.core.rel.eq([MS.ammp("pdbx_PDB_ins_code"), ligand.insertionCode]));
  return MS.struct.generator.atomGroups({
    "chain-test": MS.core.rel.eq([MS.ammp("label_asym_id"), ligand.labelAsymId]),
    "residue-test": MS.core.logic.and(tests),
    "atom-test": MS.core.rel.eq([MS.ammp("label_atom_id"), atomName]),
  });
}

function polymerResidues(structure: Structure | undefined): StageResidue[] {
  if (!structure) return [];
  const residues: StageResidue[] = [];
  const seen = new Set<string>();
  const location = StructureElement.Location.create(structure);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    location.unit = unit;
    const segments = Segmentation.transientSegments(unit.model.atomicHierarchy.residueAtomSegments, unit.elements);
    while (segments.hasNext) {
      const segment = segments.move();
      location.element = unit.elements[segment.start];
      if (StructureProperties.entity.type(location) !== "polymer") continue;
      const labelAsymId = StructureProperties.chain.label_asym_id(location);
      const labelSeqId = StructureProperties.residue.label_seq_id(location);
      const key = `${labelAsymId}:${labelSeqId}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const compId = StructureProperties.atom.label_comp_id(location);
      residues.push({ labelAsymId, labelSeqId, authAsymId: StructureProperties.chain.auth_asym_id(location), authSeqId: StructureProperties.residue.auth_seq_id(location), insCode: StructureProperties.residue.pdbx_PDB_ins_code(location), compId, code: ONE_LETTER[compId] ?? "X" });
    }
  }
  return residues;
}

/** Each protein chain's full sequence (SEQRES, modelled or not) with the label_seq_id of every letter. */
function chainSequences(structure: Structure | undefined): ChainSequence[] {
  if (!structure) return [];
  const chains: ChainSequence[] = [];
  const seen = new Set<string>();
  const location = StructureElement.Location.create(structure);
  for (const unit of structure.units) {
    if (!Unit.isAtomic(unit)) continue;
    location.unit = unit;
    location.element = unit.elements[0];
    if (StructureProperties.entity.type(location) !== "polymer" || !/peptide/i.test(StructureProperties.entity.subtype(location))) continue;
    const labelAsymId = StructureProperties.chain.label_asym_id(location);
    if (seen.has(labelAsymId)) continue;
    seen.add(labelAsymId);
    const entity = unit.model.sequence.byEntityKey[StructureProperties.entity.key(location)];
    if (!entity) continue;
    const { code, seqId, length } = entity.sequence;
    let sequence = "";
    const seqIds: number[] = [];
    for (let index = 0; index < length; index++) { sequence += (code.value(index) || "X").toUpperCase(); seqIds.push(seqId.value(index)); }
    chains.push({ labelAsymId, authAsymId: StructureProperties.chain.auth_asym_id(location), sequence, seqIds });
  }
  return chains;
}

function residueFromLoci(loci: Loci): StageResidue | null {
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return null;
  const location = StructureElement.Loci.getFirstLocation(loci);
  if (!location || !Unit.isAtomic(location.unit) || StructureProperties.entity.type(location) !== "polymer") return null;
  const compId = StructureProperties.atom.label_comp_id(location);
  return { labelAsymId: StructureProperties.chain.label_asym_id(location), labelSeqId: StructureProperties.residue.label_seq_id(location), authAsymId: StructureProperties.chain.auth_asym_id(location), authSeqId: StructureProperties.residue.auth_seq_id(location), insCode: StructureProperties.residue.pdbx_PDB_ins_code(location), compId, code: ONE_LETTER[compId] ?? "X" };
}

function ligandAtomFromLoci(loci: Loci): PickedLigandAtom | null {
  if (!StructureElement.Loci.is(loci) || StructureElement.Loci.isEmpty(loci)) return null;
  const location = StructureElement.Loci.getFirstLocation(loci);
  if (!location || !Unit.isAtomic(location.unit) || !["non-polymer", "branched"].includes(StructureProperties.entity.type(location))) return null;
  const insertionCode = StructureProperties.residue.pdbx_PDB_ins_code(location);
  return {
    chainId: StructureProperties.chain.auth_asym_id(location), authSeqId: String(StructureProperties.residue.auth_seq_id(location)), insertionCode: insertionCode || null,
    ccdId: StructureProperties.atom.label_comp_id(location), atomName: StructureProperties.atom.label_atom_id(location),
  };
}
