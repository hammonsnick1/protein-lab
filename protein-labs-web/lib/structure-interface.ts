// Chain–chain interfaces of a loaded structure. The Mol* stage hands over the
// heavy atoms of every protein chain; this module finds the residues with any
// heavy atom within the cutoff of another chain. Pure, so it can be tested
// without WebGL.
import { HIGHLIGHT_COLORS, MUTED_RESIDUE_COLOR, type ResidueColoring } from "./structure-coloring.ts";

/** One heavy (non-hydrogen) atom of a protein chain, in label numbering. */
export type InterfaceAtom = { chain: string; seq: number; x: number; y: number; z: number };

export type InterfacePair = {
  /** The two chains (label_asym_id), in the order they appear in the structure. */
  chains: [string, string];
  /** Interface residues (label_seq_id, ascending) of chains[0] and chains[1]. */
  residues: [number[], number[]];
  /** Closest heavy-atom distance between the two chains, in Å. */
  minDistance: number;
};

export type InterfaceResult = {
  cutoff: number;
  /** Protein chains in the structure, in order of appearance. */
  chains: string[];
  /** Only pairs that touch; chains that touch nothing have no pair. */
  pairs: InterfacePair[];
};

// Two molecules touch when any pair of their atoms is closer than 4.5 Å, the
// rule used by crystal-packing surveys (Carugo et al. 2017, citation `carugo2017`).
export const DEFAULT_INTERFACE_CUTOFF = 4.5;
export const INTERFACE_CUTOFF_RANGE = { min: 3, max: 6, step: 0.5 } as const;

export function clampCutoff(value: number) {
  if (!Number.isFinite(value)) return DEFAULT_INTERFACE_CUTOFF;
  const { min, max, step } = INTERFACE_CUTOFF_RANGE;
  return Math.min(max, Math.max(min, Math.round(value / step) * step));
}

/** Residues on each side of every chain pair with a heavy atom within `cutoff` Å of the other chain. */
export function findInterfaces(atoms: readonly InterfaceAtom[], cutoff = DEFAULT_INTERFACE_CUTOFF): InterfaceResult {
  const chainOrder = new Map<string, number>();
  for (const atom of atoms) if (!chainOrder.has(atom.chain)) chainOrder.set(atom.chain, chainOrder.size);
  const chains = [...chainOrder.keys()];
  if (chains.length < 2 || !(cutoff > 0)) return { cutoff, chains, pairs: [] };

  // Uniform grid with cell edge = cutoff: every contact lies in the same or a neighbouring cell.
  const cell = (value: number) => Math.floor(value / cutoff);
  const grid = new Map<string, number[]>();
  atoms.forEach((atom, index) => {
    const key = `${cell(atom.x)},${cell(atom.y)},${cell(atom.z)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index); else grid.set(key, [index]);
  });

  const limit = cutoff * cutoff;
  const found = new Map<string, { a: string; b: string; sideA: Set<number>; sideB: Set<number>; min: number }>();
  atoms.forEach((atom, index) => {
    const order = chainOrder.get(atom.chain)!;
    const cx = cell(atom.x), cy = cell(atom.y), cz = cell(atom.z);
    for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
      for (const other of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
        const partner = atoms[other];
        // Each cross-chain atom pair once: from the chain that appears first.
        if (other === index || chainOrder.get(partner.chain)! <= order) continue;
        const distance = (atom.x - partner.x) ** 2 + (atom.y - partner.y) ** 2 + (atom.z - partner.z) ** 2;
        if (distance > limit) continue;
        const key = `${atom.chain}\u0000${partner.chain}`;
        let pair = found.get(key);
        if (!pair) { pair = { a: atom.chain, b: partner.chain, sideA: new Set(), sideB: new Set(), min: Infinity }; found.set(key, pair); }
        pair.sideA.add(atom.seq); pair.sideB.add(partner.seq);
        pair.min = Math.min(pair.min, distance);
      }
    }
  });

  const ascending = (values: Set<number>) => [...values].sort((x, y) => x - y);
  const pairs = [...found.values()]
    .sort((x, y) => chainOrder.get(x.a)! - chainOrder.get(y.a)! || chainOrder.get(x.b)! - chainOrder.get(y.b)!)
    .map((pair): InterfacePair => ({ chains: [pair.a, pair.b], residues: [ascending(pair.sideA), ascending(pair.sideB)], minDistance: Math.sqrt(pair.min) }));
  return { cutoff, chains, pairs };
}

/** Interface residues of each chain across all its partners, ascending; chains without contacts are absent. */
export function interfaceResiduesByChain(result: InterfaceResult): Map<string, number[]> {
  const byChain = new Map<string, Set<number>>();
  for (const pair of result.pairs) pair.chains.forEach((chain, side) => {
    const set = byChain.get(chain) ?? new Set<number>();
    for (const seq of pair.residues[side]) set.add(seq);
    byChain.set(chain, set);
  });
  return new Map(result.chains.filter((chain) => byChain.has(chain)).map((chain) => [chain, [...byChain.get(chain)!].sort((x, y) => x - y)]));
}

/** Colour for a chain's interface side: one hue per protein chain, by order of appearance. */
export function interfaceChainColor(result: InterfaceResult, chain: string) {
  const index = result.chains.indexOf(chain);
  return HIGHLIGHT_COLORS[(index < 0 ? 0 : index) % HIGHLIGHT_COLORS.length];
}

/**
 * Colour layers for the viewer: every chain's interface residues in that chain's hue, everything else grey.
 * `chainLabel` turns a label_asym_id into what the user sees (the author chain ID).
 */
export function interfaceColoring(result: InterfaceResult, chainLabel: (chain: string) => string = (chain) => chain): ResidueColoring {
  const byChain = interfaceResiduesByChain(result);
  return {
    id: "interface",
    title: `Chain interface (${formatCutoff(result.cutoff)})`,
    base: { label: "Not at an interface", color: MUTED_RESIDUE_COLOR },
    groups: [...byChain].map(([chain, seqs]) => ({ key: `interface-${chain}`, label: `Chain ${chainLabel(chain)} interface`, color: interfaceChainColor(result, chain), residues: seqs.map((labelSeqId) => ({ labelAsymId: chain, labelSeqId })) })),
  };
}

export const formatCutoff = (cutoff: number) => `${cutoff.toFixed(1)} Å`;
