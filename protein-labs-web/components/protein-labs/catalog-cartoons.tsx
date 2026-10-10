"use client";

/**
 * Cartoons for the selectable items in the purification catalogues.
 *
 * Each one draws what the item actually is — the chelated metal on an IMAC
 * bead, biotin on Strep-Tactin, a probe tip and cavitation for sonication —
 * so a card can be recognised before its label is read. They are inline SVG
 * in the item's own accent colour, so they scale and print with the page.
 */

export type CartoonKind =
  | "imac-nickel" | "imac-cobalt" | "glutathione" | "amylose" | "strep-biotin"
  | "antibody" | "fc-binding" | "resin"
  | "protease-site" | "protease-fold" | "self-cleaving" | "no-cleavage"
  | "sonication" | "homogeniser" | "bead-beating" | "enzymatic" | "freeze-thaw" | "detergent"
  | "osmotic" | "cavitation"
  | "sec-small" | "sec-medium" | "sec-large";

/** Picks the cartoon for an affinity or subtractive resin. */
export function resinCartoonKind(category: string, tag: string, name: string): CartoonKind {
  const text = `${category} ${tag} ${name}`.toLowerCase();
  if (text.includes("cobalt") || text.includes("talon") || text.includes("co²")) return "imac-cobalt";
  if (text.includes("polyhistidine") || text.includes("imac") || text.includes("his")) return "imac-nickel";
  if (text.includes("glutathione") || text.includes("gst")) return "glutathione";
  if (text.includes("amylose") || text.includes("dextrin") || text.includes("mbp")) return "amylose";
  if (text.includes("strep") || text.includes("biotin") || text.includes("avi")) return "strep-biotin";
  if (text.includes("immunoglobulin") || text.includes("protein a") || text.includes("protein g")) return "fc-binding";
  if (text.includes("epitope") || text.includes("anti-")) return "antibody";
  return "resin";
}

/** Picks the cartoon for a cleavage strategy. */
export function proteaseCartoonKind(category: string, name: string): CartoonKind {
  const text = `${category} ${name}`.toLowerCase();
  if (text.includes("no cleavage") || text.includes("no enzyme")) return "no-cleavage";
  if (text.includes("self-cleaving") || text.includes("intein")) return "self-cleaving";
  if (text.includes("folded")) return "protease-fold";
  return "protease-site";
}

/** Picks the cartoon for a lysis method. The method name decides it; the
 *  category is only a fallback, since several methods share one category. */
export function lysisCartoonKind(category: string, name: string): CartoonKind {
  const method = name.toLowerCase();
  if (method.includes("sonic")) return "sonication";
  if (method.includes("homogeni") || method.includes("french") || method.includes("microfluid") || method.includes("pressure")) return "homogeniser";
  if (method.includes("bead")) return "bead-beating";
  if (method.includes("detergent") || method.includes("chemical")) return "detergent";
  if (method.includes("enzym") || method.includes("lysozyme")) return "enzymatic";
  if (method.includes("freeze") || method.includes("thaw")) return "freeze-thaw";
  if (method.includes("osmotic") || method.includes("periplasm")) return "osmotic";
  if (method.includes("cavitation") || method.includes("nitrogen")) return "cavitation";
  const group = category.toLowerCase();
  if (group.includes("biochemical")) return "enzymatic";
  if (group.includes("physical")) return "freeze-thaw";
  if (group.includes("selective")) return "osmotic";
  return "bead-beating";
}

/** Pore size is what a size-exclusion column is chosen for. */
export function secCartoonKind(maxKDa: number | null): CartoonKind {
  if (maxKDa === null) return "sec-medium";
  if (maxKDa <= 100) return "sec-small";
  if (maxKDa <= 1000) return "sec-medium";
  return "sec-large";
}

const BEAD = "M14 4.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2Z";

export function CatalogCartoon({ kind, className = "" }: { kind: CartoonKind; className?: string }) {
  return <span className={`catalog-cartoon ${className}`} aria-hidden="true">
    <svg viewBox="0 0 28 32" fill="none">{figure(kind)}</svg>
  </span>;
}

function figure(kind: CartoonKind) {
  switch (kind) {
    // A porous bead carrying its ligand, which is what distinguishes one
    // affinity medium from another.
    case "imac-nickel":
    case "imac-cobalt":
      // A chelating claw holding the metal ion. Cobalt carries a second
      // shell rather than a label, so nothing is written at micro type.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M14 14h5.2M19.2 14l3 -3M19.2 14l3 3" className="cartoon-line"/>
        <circle cx="23.4" cy="14" r="3.1" className="cartoon-fill"/>
        {kind === "imac-cobalt" && <circle cx="23.4" cy="14" r="5.4" className="cartoon-line"/>}
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "glutathione":
      // Glutathione: three residues in a row on the bead surface.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M13 14h8" className="cartoon-line"/>
        <circle cx="15" cy="14" r="2.1" className="cartoon-fill"/>
        <circle cx="19" cy="14" r="2.1" className="cartoon-fill"/>
        <circle cx="23" cy="14" r="2.1" className="cartoon-fill"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "amylose":
      // Amylose: linked sugar rings.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M14 14h2.4" className="cartoon-line"/>
        <path d="M18.6 11.6h3.2l1.6 2.4-1.6 2.4h-3.2L17 14Z" className="cartoon-fill"/>
        <path d="M23.4 14h1.6" className="cartoon-line"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "strep-biotin":
      // Biotin: fused bicyclic head with its valerate tail.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M14 14h3" className="cartoon-line"/>
        <path d="M17.4 11.4h4.2v5.2h-4.2z" className="cartoon-fill"/>
        <path d="M19.5 11.4v5.2" className="cartoon-base"/>
        <path d="M21.6 14h3.4" className="cartoon-line"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "antibody":
      // An immobilised antibody capturing an epitope tag.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M15 14h2.6l3 -3.6M17.6 14l3 3.6" className="cartoon-line"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "fc-binding":
      // Protein A/G presents the arms and grips the Fc stem.
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M24 14h-2.6l-3 -3.6M21.4 14l-3 3.6" className="cartoon-line"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;
    case "resin":
      return <>
        <path d={BEAD} className="cartoon-bead"/>
        <path d="M14 14h7" className="cartoon-line"/>
        <circle cx="22.4" cy="14" r="2.4" className="cartoon-fill"/>
        <path d="M6 26.5h16" className="cartoon-base"/>
      </>;

    // Cleavage: the chain, where the cut falls, and what makes it.
    case "protease-site":
      return <>
        <path d="M2 16h10M16 16h10" className="cartoon-line"/>
        <circle cx="6" cy="16" r="2.1" className="cartoon-fill"/>
        <circle cx="22" cy="16" r="2.1" className="cartoon-fill"/>
        <path d="M14 7v18" className="cartoon-cut"/>
        <path d="M11 6.5l5 6M17 6.5l-5 6" className="cartoon-line"/>
        <circle cx="10.4" cy="5.6" r="1.7" className="cartoon-bead"/>
        <circle cx="17.6" cy="5.6" r="1.7" className="cartoon-bead"/>
      </>;
    case "protease-fold":
      // A folded partner recognised by shape rather than by sequence.
      return <>
        <path d="M2 16h7" className="cartoon-line"/>
        <path d="M9 10.5c5-3 9 2 5.4 5.5 3.6 3.5-.4 8.5-5.4 5.5z" className="cartoon-bead"/>
        <path d="M19 16h7" className="cartoon-line"/>
        <circle cx="23.5" cy="16" r="2.1" className="cartoon-fill"/>
        <path d="M17 9v14" className="cartoon-cut"/>
      </>;
    case "self-cleaving":
      // The chain breaks itself; no enzyme is drawn.
      return <>
        <path d="M2 16h9M17 16h9" className="cartoon-line"/>
        <circle cx="6" cy="16" r="2.1" className="cartoon-fill"/>
        <circle cx="22" cy="16" r="2.1" className="cartoon-fill"/>
        <path d="M14 8.5l-2.6 6h4L12.8 23" className="cartoon-spark"/>
      </>;
    case "no-cleavage":
      return <>
        <path d="M2 16h24" className="cartoon-line"/>
        <circle cx="7" cy="16" r="2.3" className="cartoon-fill"/>
        <circle cx="14" cy="16" r="2.3" className="cartoon-fill"/>
        <circle cx="21" cy="16" r="2.3" className="cartoon-fill"/>
      </>;

    // Lysis: the mechanism that opens the cell.
    case "sonication":
      return <>
        <path d="M12 2h4v11h-4z" className="cartoon-bead"/>
        <path d="M12 13h4l-2 4z" className="cartoon-fill"/>
        <path d="M8.5 21a6 6 0 0 1 11 0" className="cartoon-line"/>
        <path d="M5.5 25.5a9.5 9.5 0 0 1 17 0" className="cartoon-line"/>
      </>;
    case "homogeniser":
      // Cells forced through a narrow valve gap.
      return <>
        <path d="M3 8h16a5 5 0 0 1 0 6H3z" className="cartoon-bead"/>
        <path d="M22 5v5M22 16v5" className="cartoon-base"/>
        <path d="M20 24h6M14 24h3M8 24h3" className="cartoon-line"/>
        <circle cx="8" cy="11" r="1.8" className="cartoon-fill"/>
        <circle cx="13.5" cy="11" r="1.8" className="cartoon-fill"/>
      </>;
    case "bead-beating":
      return <>
        <path d="M5 6h18v20a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" className="cartoon-bead"/>
        <circle cx="10" cy="13" r="2.4" className="cartoon-fill"/>
        <circle cx="18" cy="16" r="2.4" className="cartoon-fill"/>
        <circle cx="12" cy="22" r="2.4" className="cartoon-fill"/>
        <path d="M2 10l2.5 2M26 10l-2.5 2" className="cartoon-line"/>
      </>;
    case "enzymatic":
      // An enzyme chewing through the cell wall.
      return <>
        <path d="M4 16a9 9 0 0 1 18 0 9 9 0 0 1-18 0" className="cartoon-bead"/>
        <path d="M22 16l5-4v8z" className="cartoon-fill"/>
        <path d="M8 13.5h7M8 18.5h5" className="cartoon-line"/>
      </>;
    case "freeze-thaw":
      return <>
        <path d="M14 3v22M5 9l18 10M23 9L5 19" className="cartoon-line"/>
        <path d="M14 3l-2.6 3M14 3l2.6 3" className="cartoon-line"/>
        <circle cx="14" cy="28" r="2.4" className="cartoon-fill"/>
      </>;
    case "detergent":
      // A micelle: heads out, tails in.
      return <>
        <circle cx="14" cy="16" r="9.6" className="cartoon-bead"/>
        {[0, 60, 120, 180, 240, 300].map((angle) => {
          const radians = (angle * Math.PI) / 180;
          const x = 14 + Math.cos(radians) * 9.6, y = 16 + Math.sin(radians) * 9.6;
          const ix = 14 + Math.cos(radians) * 4.4, iy = 16 + Math.sin(radians) * 4.4;
          return <g key={angle}>
            <path d={`M${ix} ${iy}L${x} ${y}`} className="cartoon-line"/>
            <circle cx={x} cy={y} r="2.2" className="cartoon-fill"/>
          </g>;
        })}
      </>;

    case "osmotic":
      // Water rushing in and the periplasmic contents released.
      return <>
        <circle cx="14" cy="17" r="8.6" className="cartoon-bead"/>
        <path d="M14 1.5v4.5M5 5l2.4 3.4M23 5l-2.4 3.4" className="cartoon-line"/>
        <circle cx="11" cy="17" r="1.8" className="cartoon-fill"/>
        <circle cx="17" cy="19" r="1.8" className="cartoon-fill"/>
        <path d="M22 23.5l4 3M6 23.5l-4 3" className="cartoon-line"/>
      </>;
    case "cavitation":
      // Dissolved gas expands and bursts the cell as pressure drops.
      return <>
        <path d="M5 4h18v12a9 9 0 0 1-18 0z" className="cartoon-bead"/>
        <circle cx="11" cy="12" r="2.6" className="cartoon-fill"/>
        <circle cx="18" cy="15" r="1.9" className="cartoon-fill"/>
        <circle cx="13" cy="19" r="1.5" className="cartoon-fill"/>
        <path d="M14 25.5v4M9 26l-1.6 3M19 26l1.6 3" className="cartoon-line"/>
      </>;

    // Size exclusion: the pore size the column separates by.
    case "sec-small":
    case "sec-medium":
    case "sec-large": {
      const pore = kind === "sec-small" ? 1.3 : kind === "sec-medium" ? 2.1 : 3;
      const beads = [[9, 9], [18, 10], [10, 17], [19, 18], [9, 25], [18, 25]];
      return <>
        <path d="M6 3h16v26H6z" className="cartoon-bead"/>
        <path d="M6 7h16" className="cartoon-base"/>
        {beads.map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={pore} className="cartoon-fill"/>)}
      </>;
    }
    default:
      return null;
  }
}
