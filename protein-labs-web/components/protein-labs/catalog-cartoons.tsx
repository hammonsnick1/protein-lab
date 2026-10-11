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
  | "sec-small" | "sec-medium" | "sec-large"
  | "buffer-plain" | "buffer-imidazole" | "buffer-detergent" | "buffer-salt" | "buffer-glycerol"
  | "buffer-calcium" | "buffer-sucrose" | "buffer-phosphate" | "buffer-reducing"
  | "media-rich" | "media-dense" | "media-defined" | "media-dropout" | "media-autoinduction"
  | "media-feed" | "media-respiratory" | "media-suspension" | "media-adherent";

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

type BufferIngredient = { name: string; concentration: string | number; unit: string };

/** A buffer is drawn by the additive that sets it apart, checked from the
 *  most to the least distinctive; Tris, HEPES and modest glycerol are the
 *  common background and do not count. */
export function bufferCartoonKind(components: BufferIngredient[]): CartoonKind {
  const amount = (pattern: RegExp) => {
    const found = components.find((component) => pattern.test(component.name.toLowerCase()));
    return found ? Number.parseFloat(String(found.concentration)) || 0 : null;
  };
  if (amount(/ddm|triton|detergent|lmng|chaps|np-40|tween/) !== null) return "buffer-detergent";
  if (amount(/imidazole/) !== null) return "buffer-imidazole";
  if (amount(/cacl|calcium/) !== null) return "buffer-calcium";
  if (amount(/sucrose/) !== null) return "buffer-sucrose";
  if ((amount(/^nacl|^kcl/) ?? 0) >= 500) return "buffer-salt";
  if ((amount(/glycerol/) ?? 0) >= 10) return "buffer-glycerol";
  if (amount(/phosphate/) !== null) return "buffer-phosphate";
  if (amount(/tcep|dtt|mercapto/) !== null) return "buffer-reducing";
  return "buffer-plain";
}

/** A growth medium is drawn by how it is used: what it feeds, how it
 *  induces, and whether the cells float or attach. */
export function mediaCartoonKind(type: string): CartoonKind {
  const text = type.toLowerCase();
  if (text.includes("autoinduction")) return "media-autoinduction";
  if (text.includes("induction")) return "media-feed";
  if (text.includes("nonfermentable")) return "media-respiratory";
  if (text.includes("adherent") || text.includes("basal")) return "media-adherent";
  if (text.includes("selective")) return "media-dropout";
  if (text.includes("high-density") || text.includes("very rich")) return "media-dense";
  if (text.includes("suspension") || text.includes("serum-free")) return "media-suspension";
  // "Rich undefined" contains "defined", so undefined extracts are ruled out first.
  if (text.includes("undefined")) return "media-rich";
  if (text.includes("defined") || text.includes("minimal")) return "media-defined";
  return "media-rich";
}

const BEAD = "M14 4.4a9.6 9.6 0 1 1 0 19.2 9.6 9.6 0 0 1 0-19.2Z";
// A reagent bottle, and the buffer standing in it.
const BOTTLE = "M11 2.5h6v4.5h1.5a2.5 2.5 0 0 1 2.5 2.5v17a2.5 2.5 0 0 1-2.5 2.5h-9A2.5 2.5 0 0 1 7 26.5v-17A2.5 2.5 0 0 1 9.5 7H11z";
const BOTTLE_LIQUID = "M7.9 13.5h12.2v13a1.6 1.6 0 0 1-1.6 1.6h-9a1.6 1.6 0 0 1-1.6-1.6z";
// An Erlenmeyer flask, and the medium at a normal and a high fill.
const FLASK = "M11 2.5h6M12 2.5v9L5 25.6a2 2 0 0 0 1.8 2.9h14.4a2 2 0 0 0 1.8-2.9L16 11.5v-9";
const FLASK_LIQUID = "M8.3 19.5h11.4l3.2 6.4a1.3 1.3 0 0 1-1.2 1.8H6.3a1.3 1.3 0 0 1-1.2-1.8z";
const FLASK_LIQUID_HIGH = "M10.8 14.5h6.4l5.7 11.4a1.3 1.3 0 0 1-1.2 1.8H6.3a1.3 1.3 0 0 1-1.2-1.8z";

/** A regular polygon's outline, for ring structures. */
function ring(cx: number, cy: number, radius: number, sides: number, rotate = -90) {
  return Array.from({ length: sides }, (_, index) => {
    const angle = ((rotate + (360 / sides) * index) * Math.PI) / 180;
    return `${index ? "L" : "M"}${(cx + Math.cos(angle) * radius).toFixed(2)} ${(cy + Math.sin(angle) * radius).toFixed(2)}`;
  }).join("") + "Z";
}

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

    // Buffers: a bottle, and the additive that defines it.
    case "buffer-plain":
      return <>{bottle()}<path d="M10.5 21.5c1.2-1.2 2.3-1.2 3.5 0s2.3 1.2 3.5 0" className="cartoon-line"/></>;
    case "buffer-imidazole":
      // Imidazole's five-membered ring, the His-tag competitor.
      return <>{bottle()}<path d={ring(14, 21, 3.8, 5)} className="cartoon-line"/><circle cx="14" cy="17.2" r="1.3" className="cartoon-fill"/></>;
    case "buffer-detergent":
      return <>{bottle()}{[0, 72, 144, 216, 288].map((angle) => {
        const radians = (angle * Math.PI) / 180;
        return <g key={angle}>
          <path d={`M${14 + Math.cos(radians) * 1.2} ${21 + Math.sin(radians) * 1.2}L${14 + Math.cos(radians) * 3.6} ${21 + Math.sin(radians) * 3.6}`} className="cartoon-line"/>
          <circle cx={14 + Math.cos(radians) * 4} cy={21 + Math.sin(radians) * 4} r="1.3" className="cartoon-fill"/>
        </g>;
      })}</>;
    case "buffer-salt":
      // Cubic salt crystals.
      return <>{bottle()}<path d="M9.8 19h3.4v3.4H9.8zM14.8 18h3.4v3.4h-3.4zM12.3 23.2h3.4v3.4h-3.4z" className="cartoon-fill"/></>;
    case "buffer-glycerol":
      // A slow, viscous drop.
      return <>{bottle()}<path d="M14 16.5c2.4 3 3.6 4.8 3.6 6.4a3.6 3.6 0 0 1-7.2 0c0-1.6 1.2-3.4 3.6-6.4z" className="cartoon-fill"/></>;
    case "buffer-calcium":
      // The divalent ion and its charge.
      return <>{bottle()}<circle cx="12.5" cy="22" r="3" className="cartoon-fill"/><path d="M16.4 17.5h2.6M17.7 16.2v2.6M16.4 21h2.6M17.7 19.7v2.6" className="cartoon-line"/></>;
    case "buffer-sucrose":
      // Sucrose: a glucose hexagon joined to a fructose pentagon.
      return <>{bottle()}<path d={ring(10.4, 21, 2.4, 6, 0)} className="cartoon-line"/><path d="M12.8 21h2.6" className="cartoon-line"/><path d={ring(17.7, 21, 2.2, 5, 180)} className="cartoon-line"/></>;
    case "buffer-phosphate":
      // Phosphate: a central P with four oxygens.
      return <>{bottle()}<path d="M14 17.2v7.6M10.2 21h7.6" className="cartoon-line"/><circle cx="14" cy="21" r="2" className="cartoon-fill"/>
        {[[14, 17], [14, 25], [10, 21], [18, 21]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.2" className="cartoon-fill"/>)}</>;
    case "buffer-reducing":
      // A disulfide held open by the reductant.
      return <>{bottle()}<circle cx="10.8" cy="21.5" r="2" className="cartoon-fill"/><circle cx="17.2" cy="21.5" r="2" className="cartoon-fill"/><path d="M14 17.5v8" className="cartoon-cut"/></>;

    // Growth media: a flask, and what makes the medium different.
    case "media-rich":
      // Undefined extracts leave the broth cloudy with particles.
      return <>{flask()}{[[9.6, 22.6, 1.2], [13.2, 21.4, .9], [16.8, 22.8, 1.3], [7.8, 25.8, 1], [11.6, 25.2, 1.4], [15.4, 25.8, .9], [19.6, 25.6, 1.2]].map(([x, y, r]) => <circle key={`${x}-${y}`} cx={x} cy={y} r={r} className="cartoon-fill"/>)}</>;
    case "media-dense":
      // High-density culture: a fuller flask, thick with cells.
      return <>{flask(true)}{[[10.5, 18], [14.5, 17.4], [9, 22], [13, 21.6], [17, 21], [7.4, 25.4], [11.4, 25.4], [15.4, 25.2], [19.6, 25.4]].map(([x, y]) => <circle key={`${x}-${y}`} cx={x} cy={y} r="1.15" className="cartoon-fill"/>)}</>;
    case "media-defined":
      // Every component known: a clear medium and a single defined molecule.
      return <>{flask()}<path d={ring(14, 23.8, 3.3, 6, 0)} className="cartoon-line"/></>;
    case "media-dropout":
      // A defined mix with one nutrient left out for selection.
      return <>{flask()}<path d={ring(9.6, 24.2, 1.9, 6, 0)} className="cartoon-line"/><path d={ring(18.4, 24.2, 1.9, 6, 0)} className="cartoon-line"/><path d={ring(14, 24.2, 1.9, 6, 0)} className="cartoon-cut"/></>;
    case "media-autoinduction":
      // Induction switches itself on once the preferred sugar runs out.
      return <>{flask()}<path d="M23.5 1.5l-2.8 5h3.6l-2.8 5" className="cartoon-spark"/><circle cx="11" cy="24" r="1" className="cartoon-fill"/><circle cx="16.5" cy="23" r="1" className="cartoon-fill"/></>;
    case "media-feed":
      // Grown on glycerol, then fed methanol to induce.
      return <>{flask()}<path d="M22.5 1.8c1.5 1.9 2.3 3 2.3 4a2.3 2.3 0 0 1-4.6 0c0-1 .8-2.1 2.3-4z" className="cartoon-fill"/><path d="M20 10.5l-2.2 2" className="cartoon-line"/></>;
    case "media-respiratory":
      // Respiratory growth: oxygen bubbles rising through the medium.
      return <>{flask()}<circle cx="11.5" cy="24.5" r="1.5" className="cartoon-line"/><circle cx="16" cy="22" r="1.1" className="cartoon-line"/><circle cx="14" cy="15" r="1" className="cartoon-line"/></>;
    case "media-suspension":
      // Cells kept floating in a shaking flask.
      return <>{flask()}<circle cx="10.5" cy="23.6" r="1.6" className="cartoon-line"/><circle cx="16.8" cy="24.6" r="1.6" className="cartoon-line"/><path d="M3 31c3.5 1.4 18.5 1.4 22 0" className="cartoon-base"/></>;
    case "media-adherent":
      // A culture flask laid flat, cells spread on its floor.
      return <>
        <path d="M2.5 10h17l4-3h3v6h-3l-1 1v12h-20z" className="cartoon-bead"/>
        <path d="M3.5 25.2c.4-3 4.4-3 4.8 0zM9.3 25.2c.4-3 4.4-3 4.8 0zM15.1 25.2c.4-3 4.4-3 4.8 0z" className="cartoon-fill"/>
      </>;
    default:
      return null;
  }
}

function bottle() {
  return <><path d={BOTTLE} className="cartoon-bead"/><path d={BOTTLE_LIQUID} className="cartoon-liquid"/></>;
}

function flask(high = false) {
  return <><path d={high ? FLASK_LIQUID_HIGH : FLASK_LIQUID} className="cartoon-liquid"/><path d={FLASK} className="cartoon-line"/></>;
}
