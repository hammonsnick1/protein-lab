// BLAST hits → pairwise alignment blocks and a query-anchored multiple
// sequence alignment. Pure module: no `@/` imports, so `node --test`
// runs it directly.
//
// Hit shape: each hit carries `hsps[]` with 1-based inclusive
// `queryFrom/queryTo/hitFrom/hitTo` and gapped `qseq/hseq/midline`. Jobs saved
// before that only have the flat best-HSP metrics, so every reader here
// tolerates missing alignment strings.

type JsonObject = Record<string, unknown>;

export type BlastHsp = {
  queryFrom: number;
  queryTo: number;
  hitFrom: number;
  hitTo: number;
  qseq: string;
  hseq: string;
  midline: string;
  identities: number;
  positives: number | null;
  gaps: number;
  alignLength: number;
  evalue: number | null;
  bitScore: number | null;
};

export type BlastHit = {
  /** Stable key within one job: rank plus accession. */
  id: string;
  rank: number;
  accession: string;
  /** UniProt accession when the hit maps to one; links go to UniProt then. */
  uniprotAccession: string;
  description: string;
  organism: string;
  length: number | null;
  identity: number | null;
  coverage: number | null;
  evalue: number | null;
  bitScore: number | null;
  queryStart: number | null;
  queryEnd: number | null;
  /** Only HSPs whose alignment strings were saved; best first. */
  hsps: BlastHsp[];
};

const number = (value: unknown): number | null => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const first = (source: JsonObject, keys: string[]) => keys.map((key) => source[key]).find((value) => value !== undefined && value !== null && value !== "");
const text = (value: unknown) => (typeof value === "string" ? value : value === undefined || value === null ? "" : String(value));
const objects = (value: unknown): JsonObject[] => (Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []);

/** Reads one HSP in the engine shape or the snake/alias spellings other providers use. */
export function readHsp(raw: JsonObject): BlastHsp | null {
  const qseq = text(first(raw, ["qseq", "querySeq", "queryAlignment", "hsp_qseq"])).toUpperCase();
  const hseq = text(first(raw, ["hseq", "hitSeq", "subjectSeq", "hitAlignment", "hsp_hseq"])).toUpperCase();
  if (!qseq || !hseq || qseq.length !== hseq.length) return null;
  const queryFrom = number(first(raw, ["queryFrom", "queryStart", "query_from", "hsp_query_from"])) ?? 1;
  const hitFrom = number(first(raw, ["hitFrom", "hitStart", "subjectFrom", "hit_from", "hsp_hit_from"])) ?? 1;
  const queryResidues = residueCount(qseq), hitResidues = residueCount(hseq);
  let identities = 0, gaps = 0;
  for (let index = 0; index < qseq.length; index += 1) {
    if (qseq[index] === "-" || hseq[index] === "-") gaps += 1;
    else if (qseq[index] === hseq[index]) identities += 1;
  }
  const midline = text(first(raw, ["midline", "hsp_mline", "match"]));
  return {
    queryFrom,
    queryTo: number(first(raw, ["queryTo", "queryEnd", "query_to", "hsp_query_to"])) ?? queryFrom + queryResidues - 1,
    hitFrom,
    hitTo: number(first(raw, ["hitTo", "hitEnd", "subjectTo", "hit_to", "hsp_hit_to"])) ?? hitFrom + hitResidues - 1,
    qseq,
    hseq,
    midline: midline.length === qseq.length ? midline : derivedMidline(qseq, hseq),
    identities: number(first(raw, ["identities", "identityCount", "hsp_identity_count"])) ?? identities,
    positives: number(first(raw, ["positives", "positiveCount", "hsp_positive"])),
    gaps: number(first(raw, ["gaps", "gapCount", "hsp_gaps"])) ?? gaps,
    alignLength: number(first(raw, ["alignLength", "alignmentLength", "align_len", "hsp_align_len"])) ?? qseq.length,
    evalue: number(first(raw, ["evalue", "expect", "hsp_expect"])),
    bitScore: number(first(raw, ["bitScore", "bit_score", "hsp_bit_score"])),
  };
}

function residueCount(sequence: string) { let count = 0; for (const residue of sequence) if (residue !== "-") count += 1; return count; }
function derivedMidline(qseq: string, hseq: string) { let line = ""; for (let index = 0; index < qseq.length; index += 1) line += qseq[index] !== "-" && qseq[index] === hseq[index] ? qseq[index] : " "; return line; }

/** "RecName: Full=Hemoglobin subunit beta; AltName: …" → "Hemoglobin subunit beta". */
export function cleanDescription(value: string) {
  const recName = /RecName:\s*Full=([^;[]+)/.exec(value);
  const base = recName ? recName[1] : value.replace(/\s+OS=.*$/, "").replace(/\s*\[[^\]]+\]\s*$/, "");
  return base.trim();
}

/** Organism from a structured field, else from "OS=… OX=" (EBI) or a trailing "[Homo sapiens]" (NCBI). */
export function organismOf(hit: JsonObject) {
  const named = text(first(hit, ["scientificName", "organism", "sciname"]));
  if (named) return named;
  const description = text(first(hit, ["description", "title"]));
  const os = /\bOS=(.+?)(?:\s+[A-Z]{2}=|$)/.exec(description);
  if (os) return os[1].trim();
  const bracket = /\[([^\]]+)\]\s*$/.exec(description);
  return bracket ? bracket[1].trim() : "";
}

export function normalizeHits(results: unknown): BlastHit[] {
  return objects(results).map((raw, index) => {
    const rank = number(raw.rank) ?? index + 1;
    const accession = text(first(raw, ["accession", "hitId"]));
    const uniprotAccession = text(raw.uniprotAccession);
    const nested = objects(raw.hsps).map(readHsp).filter((hsp): hsp is BlastHsp => hsp !== null);
    // A flat hit (best HSP inlined on the hit itself) also counts.
    const flat = nested.length ? null : readHsp({ ...raw, alignLength: raw.alignmentLength });
    return {
      id: `${rank}:${uniprotAccession || accession}`,
      rank,
      accession: uniprotAccession || accession || `Hit ${rank}`,
      uniprotAccession,
      description: cleanDescription(text(first(raw, ["description", "title"]))),
      organism: organismOf(raw),
      length: number(first(raw, ["hitLength", "length", "hitLen"])),
      identity: number(raw.identity),
      coverage: number(first(raw, ["queryCoverage", "coverage"])),
      evalue: number(raw.evalue),
      bitScore: number(raw.bitScore),
      queryStart: number(raw.queryStart) ?? nested[0]?.queryFrom ?? null,
      queryEnd: number(raw.queryEnd) ?? nested[0]?.queryTo ?? null,
      hsps: nested.length ? nested : flat ? [flat] : [],
    };
  });
}

export type ColumnKind = "identity" | "positive" | "mismatch" | "gap";
export type AlignmentBlock = {
  query: string;
  midline: string;
  subject: string;
  kinds: ColumnKind[];
  /** Residue numbers of the first and last residue in the block; both equal the
   *  previous residue when the block holds only gaps for that sequence. */
  queryStart: number;
  queryEnd: number;
  subjectStart: number;
  subjectEnd: number;
};

/** Splits one HSP into BLAST-style blocks of `width` columns with residue numbers. */
export function alignmentBlocks(hsp: BlastHsp, width = 60): AlignmentBlock[] {
  const blocks: AlignmentBlock[] = [];
  const queryStep = hsp.queryTo < hsp.queryFrom ? -1 : 1, subjectStep = hsp.hitTo < hsp.hitFrom ? -1 : 1;
  let queryNext = hsp.queryFrom, subjectNext = hsp.hitFrom;
  for (let start = 0; start < hsp.qseq.length; start += width) {
    const query = hsp.qseq.slice(start, start + width), subject = hsp.hseq.slice(start, start + width);
    const midline = hsp.midline.slice(start, start + width).padEnd(query.length, " ");
    const kinds = Array.from(query, (residue, index): ColumnKind => {
      if (residue === "-" || subject[index] === "-") return "gap";
      if (residue === subject[index]) return "identity";
      return midline[index] === "+" ? "positive" : "mismatch";
    });
    const queryCount = residueCount(query), subjectCount = residueCount(subject);
    blocks.push({
      query, midline, subject, kinds,
      queryStart: queryCount ? queryNext : queryNext - queryStep,
      queryEnd: queryNext + (queryCount - 1) * queryStep,
      subjectStart: subjectCount ? subjectNext : subjectNext - subjectStep,
      subjectEnd: subjectNext + (subjectCount - 1) * subjectStep,
    });
    queryNext += queryCount * queryStep;
    subjectNext += subjectCount * subjectStep;
  }
  return blocks;
}

export type MsaRow = {
  id: string;
  label: string;
  residues: string;
  /** Query positions this row aligns to (residue or deletion). */
  covered: number;
  /** Identical residues ÷ covered positions; the query row is 1. */
  identity: number;
  /** Hit residues that fall between query positions and so cannot be shown. */
  insertions: number;
};

/**
 * Query-anchored MSA: one column per query residue. Each hit's HSPs are laid
 * onto query coordinates best first; a later HSP only fills columns no better
 * HSP covered, residues inserted relative to the query are counted but not
 * drawn, and HSP columns that fall outside the query are clipped. Unaligned and
 * deleted positions are both "-".
 */
export function buildMsa(query: string, hits: BlastHit[]): MsaRow[] {
  const sequence = query.toUpperCase().replace(/[^A-Z*]/g, "");
  const length = sequence.length;
  const rows: MsaRow[] = [{ id: "query", label: "Query", residues: sequence, covered: length, identity: 1, insertions: 0 }];
  for (const hit of hits) {
    const cells = new Array<string>(length).fill("-"), filled = new Array<boolean>(length).fill(false);
    let insertions = 0;
    for (const hsp of hit.hsps) {
      const step = hsp.queryTo < hsp.queryFrom ? -1 : 1;
      let position = hsp.queryFrom, contributed = 0, inserted = 0;
      for (let column = 0; column < hsp.qseq.length; column += 1) {
        const queryResidue = hsp.qseq[column], hitResidue = hsp.hseq[column];
        if (queryResidue === "-") { if (hitResidue !== "-") inserted += 1; continue; }
        const index = position - 1;
        position += step;
        if (index < 0 || index >= length || filled[index]) continue;
        cells[index] = hitResidue;
        filled[index] = true;
        contributed += 1;
      }
      if (contributed) insertions += inserted;
    }
    let covered = 0, identical = 0;
    for (let index = 0; index < length; index += 1) {
      if (!filled[index]) continue;
      covered += 1;
      if (cells[index] === sequence[index]) identical += 1;
    }
    rows.push({ id: hit.id, label: hit.organism ? `${hit.accession} ${hit.organism}` : hit.accession, residues: cells.join(""), covered, identity: covered ? identical / covered : 0, insertions });
  }
  return rows;
}

export type ClustalColour = "" | "blue" | "red" | "magenta" | "green" | "pink" | "orange" | "yellow" | "cyan";

const HYDROPHOBIC = "WLVIMAFCHP";

/**
 * ClustalX colouring (the Jalview rule table): a residue is coloured only when
 * its column is conserved enough for its class. Fractions count every row,
 * gaps included, so thinly covered columns stay pale.
 */
export function clustalColours(rows: string[]): ClustalColour[][] {
  const length = rows.reduce((longest, row) => Math.max(longest, row.length), 0);
  const total = rows.length;
  const colours: ClustalColour[][] = rows.map(() => new Array<ClustalColour>(length).fill(""));
  for (let column = 0; column < length; column += 1) {
    const counts = new Map<string, number>();
    for (const row of rows) { const residue = row[column] ?? "-"; counts.set(residue, (counts.get(residue) ?? 0) + 1); }
    const fraction = (set: string) => { let sum = 0; for (const residue of set) sum += counts.get(residue) ?? 0; return sum / total; };
    const anyAbove = (set: string, threshold: number) => [...set].some((residue) => (counts.get(residue) ?? 0) / total > threshold);
    const hydrophobic = fraction(HYDROPHOBIC) > 0.6, basic = fraction("KR") > 0.6;
    const cache = new Map<string, ClustalColour>();
    const colourOf = (residue: string): ClustalColour => {
      switch (residue) {
        case "A": case "I": case "L": case "M": case "F": case "W": case "V": return hydrophobic ? "blue" : "";
        case "C": return anyAbove("C", 0.85) ? "pink" : hydrophobic ? "blue" : "";
        case "K": case "R": return basic || anyAbove("KRQ", 0.85) ? "red" : "";
        case "E": return basic || fraction("QE") > 0.5 || anyAbove("EQD", 0.85) ? "magenta" : "";
        case "D": return basic || anyAbove("KRQ", 0.85) || fraction("ED") > 0.5 ? "magenta" : "";
        case "N": return fraction("N") > 0.5 || anyAbove("NY", 0.85) ? "green" : "";
        case "Q": return basic || fraction("QE") > 0.5 || anyAbove("QEKR", 0.85) ? "green" : "";
        case "S": case "T": return hydrophobic || fraction("TS") > 0.5 || anyAbove("ST", 0.85) ? "green" : "";
        case "G": return "orange";
        case "P": return "yellow";
        case "H": case "Y": return hydrophobic || anyAbove("WYACPQFHILMV", 0.85) ? "cyan" : "";
        default: return "";
      }
    };
    rows.forEach((row, index) => {
      const residue = row[column] ?? "-";
      if (!cache.has(residue)) cache.set(residue, colourOf(residue));
      colours[index][column] = cache.get(residue)!;
    });
  }
  return colours;
}

/** Share of all rows carrying the column's most common residue (gaps never count as conserved). */
export function columnConservation(rows: string[]): number[] {
  const length = rows.reduce((longest, row) => Math.max(longest, row.length), 0);
  return Array.from({ length }, (_, column) => {
    const counts = new Map<string, number>();
    for (const row of rows) { const residue = row[column]; if (residue && residue !== "-") counts.set(residue, (counts.get(residue) ?? 0) + 1); }
    return rows.length ? Math.max(0, ...counts.values()) / rows.length : 0;
  });
}

export function msaFasta(rows: Pick<MsaRow, "label" | "residues">[], width = 60) {
  return rows.map((row) => {
    const lines = [];
    for (let start = 0; start < row.residues.length; start += width) lines.push(row.residues.slice(start, start + width));
    return `>${row.label.replace(/\s+/g, " ").trim()}\n${lines.join("\n")}`;
  }).join("\n") + "\n";
}

export type SortKey = "rank" | "accession" | "organism" | "identity" | "coverage" | "evalue" | "bitScore" | "length";
export type SortDirection = "asc" | "desc";

/** Sorts hits by one column; missing values always sort last. */
export function sortHits(hits: BlastHit[], key: SortKey, direction: SortDirection) {
  const sign = direction === "asc" ? 1 : -1;
  return [...hits].sort((a, b) => {
    const left = a[key], right = b[key];
    if (left === null || left === "") return right === null || right === "" ? a.rank - b.rank : 1;
    if (right === null || right === "") return -1;
    const order = typeof left === "number" && typeof right === "number" ? left - right : String(left).localeCompare(String(right));
    return order ? order * sign : a.rank - b.rank;
  });
}

export function formatEvalue(value: number | null) {
  if (value === null) return "—";
  if (value === 0) return "0";
  return value < 1e-3 ? value.toExponential(1) : value < 10 ? value.toPrecision(2) : value.toFixed(0);
}

export type Tier = "high" | "mid" | "low";
export const identityTier = (value: number | null): Tier => (value ?? 0) >= 0.9 ? "high" : (value ?? 0) >= 0.4 ? "mid" : "low";
export const coverageTier = (value: number | null): Tier => (value ?? 0) >= 0.9 ? "high" : (value ?? 0) >= 0.6 ? "mid" : "low";
export const evalueTier = (value: number | null): Tier => value === null ? "low" : value <= 1e-50 ? "high" : value <= 1e-5 ? "mid" : "low";

// Remote job stages. Pass the engine's `stageId` when the job has
// one; older jobs only carry `status` (waiting/complete/…) and stage text.
export const BLAST_STEPS = ["Submitting", "Queued", "Running", "Parsing hits", "Done"] as const;
const TERMINAL = new Set(["complete", "done", "failed", "canceled", "cancelled", "unknown"]);
export const isTerminalStatus = (status: string) => TERMINAL.has(status.toLowerCase());

export function blastStepIndex(status: string, stage = "") {
  switch (status.toLowerCase()) {
    case "submitting": case "submitted": case "pending": return 0;
    case "waiting": case "queued": return 1;
    case "running": return 2;
    case "parsing": return 3;
    case "complete": case "done": return 4;
  }
  if (/pars|import/i.test(stage)) return 3;
  if (/running/i.test(stage)) return 2;
  return 1;
}

export function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000));
  const hours = Math.floor(seconds / 3600), minutes = Math.floor((seconds % 3600) / 60), rest = seconds % 60;
  const pad = (value: number) => String(value).padStart(2, "0");
  return hours ? `${hours}:${pad(minutes)}:${pad(rest)}` : `${minutes}:${pad(rest)}`;
}
