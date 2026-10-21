/**
 * Cartoons for the dashboard tiles: a folder for projects, a tree for project
 * trees, and so on, so each tile can be recognised before its title is read.
 *
 * They are drawn in the graphic-novel style of the paper appearance: bold ink
 * outlines over flat fills taken from the --art-* palette, which the
 * monochrome appearances swap for greys. Inline SVG keeps them sharp at any
 * tile size, and they are decorative, so screen readers skip them.
 */

export type TileArtKind = "projects" | "trees" | "job" | "reports" | "team" | "timeline" | "vectors" | "alphafold";

export function TileArt({ kind }: { kind: TileArtKind }) {
  return <span className={`tile-art tile-art-${kind}`} aria-hidden="true">
    <svg viewBox="0 0 120 120">{figure(kind)}</svg>
  </span>;
}

/** The soft ground shadow every cartoon stands on. */
const shadow = (width = 46) => <ellipse cx="60" cy="108" rx={width} ry="4.5" className="art-shade"/>;

/** A head-and-shoulders scientist in a lab coat, for the team. */
function scientist(cx: number, cy: number, r: number, skin: string, hair: string) {
  const bottom = 106;
  return <g>
    <path d={`M${cx - 1.8 * r} ${bottom}C${cx - 1.8 * r} ${cy + 1.7 * r} ${cx - 1.1 * r} ${cy + 1.25 * r} ${cx} ${cy + 1.25 * r}C${cx + 1.1 * r} ${cy + 1.25 * r} ${cx + 1.8 * r} ${cy + 1.7 * r} ${cx + 1.8 * r} ${bottom}Z`} className="art-paper"/>
    <path d={`M${cx - 0.45 * r} ${cy + 1.28 * r}L${cx} ${cy + 2.1 * r}L${cx + 0.45 * r} ${cy + 1.28 * r}Z`} className="art-sky"/>
    <path d={`M${cx} ${cy + 2.1 * r}V${bottom}`} className="art-thin"/>
    <circle cx={cx} cy={cy} r={r} className={skin}/>
    <path d={`M${cx - r} ${cy + 0.1 * r}C${cx - 1.05 * r} ${cy - 1.35 * r} ${cx + 1.05 * r} ${cy - 1.35 * r} ${cx + r} ${cy + 0.1 * r}Q${cx + 0.2 * r} ${cy - 0.55 * r} ${cx - r} ${cy + 0.1 * r}Z`} className={hair}/>
    <circle cx={cx - 0.36 * r} cy={cy + 0.22 * r} r={0.11 * r + 0.5} className="art-ink"/>
    <circle cx={cx + 0.36 * r} cy={cy + 0.22 * r} r={0.11 * r + 0.5} className="art-ink"/>
    <path d={`M${cx - 0.3 * r} ${cy + 0.55 * r}Q${cx} ${cy + 0.8 * r} ${cx + 0.3 * r} ${cy + 0.55 * r}`} className="art-thin"/>
  </g>;
}

function figure(kind: TileArtKind) {
  switch (kind) {
    case "projects":
      // A folder with project pages sticking out, one showing a protein trace.
      return <>
        {shadow()}
        <path d="M16 30h28l8 9h50a5 5 0 0 1 5 5v56a5 5 0 0 1-5 5H16a5 5 0 0 1-5-5V35a5 5 0 0 1 5-5Z" className="art-sky-deep"/>
        <rect x="22" y="16" width="58" height="56" rx="3" transform="rotate(-8 51 44)" className="art-paper"/>
        <rect x="38" y="10" width="58" height="56" rx="3" transform="rotate(6 67 38)" className="art-paper"/>
        <path d="M46 22l38 4M45.4 29.5l24 2.5" className="art-thin"/>
        <path d="M45 50c5-11 8-11 11 0s7 11 10 0 7-10 12 1" className="art-coral-line"/>
        <path d="M9 67a5 5 0 0 1 5-5h92a5 5 0 0 1 5 5l-5 34a5 5 0 0 1-5 4.4H19a5 5 0 0 1-5-4.4Z" className="art-sky"/>
        <rect x="45" y="74" width="30" height="12" rx="3" className="art-paper"/>
        <path d="M51 80h18" className="art-thin"/>
      </>;
    case "trees":
      // A leafy tree whose fruit are the linked projects.
      return <>
        {shadow(44)}
        <path d="M14 106c10-10 82-10 92 0Z" className="art-leaf-deep"/>
        <path d="M53 104c3-14 3-25-2-38l7 3 2-13 4 13 7-5c-5 13-5 26-2 40Z" className="art-wood"/>
        <path d="M31 64c-13 0-17-15-7-21-4-12 8-22 18-18 4-12 24-14 30-4 10-6 24 2 22 14 12 4 10 22-2 24-2 10-16 12-22 6-6 8-20 8-24 0-6 4-16 2-15-1Z" className="art-leaf"/>
        <path d="M38 45q6-6 12 0M66 35q6-6 12 0M55 55q5-5 10 0M79 54q4-4 8 0" className="art-thin"/>
        <circle cx="37" cy="54" r="4.5" className="art-coral"/>
        <circle cx="62" cy="27" r="4.5" className="art-sun"/>
        <circle cx="86" cy="43" r="4.5" className="art-coral"/>
      </>;
    case "job":
      // A flask bubbling away on the bench: work in progress.
      return <>
        {shadow(36)}
        <path d="M52 22h16v22l24 48a6 6 0 0 1-5.4 9H33.4a6 6 0 0 1-5.4-9l24-48Z" className="art-glass"/>
        <path d="M39 70q5.25-4 10.5 0t10.5 0 10.5 0 10.5 0L92 92a6 6 0 0 1-5.4 9H33.4a6 6 0 0 1-5.4-9Z" className="art-coral"/>
        <path d="M52 22h16v22l24 48a6 6 0 0 1-5.4 9H33.4a6 6 0 0 1-5.4-9l24-48Z" className="art-outline"/>
        <rect x="47" y="16" width="26" height="7" rx="3.5" className="art-paper"/>
        <path d="M36 89l7-13" className="art-gloss"/>
        <circle cx="50" cy="86" r="3" className="art-paper"/>
        <circle cx="66" cy="91" r="2.5" className="art-paper"/>
        <circle cx="72" cy="80" r="3.5" className="art-paper"/>
        <circle cx="61" cy="55" r="3.5" className="art-paper"/>
        <circle cx="56" cy="35" r="3" className="art-paper"/>
        <circle cx="66" cy="8" r="4.5" className="art-paper"/>
        <circle cx="55" cy="3" r="2.5" className="art-paper"/>
      </>;
    case "reports":
      // A printed report with its figure, and the pen that signs it off.
      return <>
        {shadow(40)}
        <rect x="32" y="12" width="62" height="86" rx="4" transform="rotate(7 63 55)" className="art-paper"/>
        <rect x="22" y="16" width="62" height="88" rx="4" className="art-paper"/>
        <rect x="30" y="25" width="30" height="7" rx="3.5" className="art-coral"/>
        <path d="M30 39h44" className="art-thin"/>
        <path d="M32 48v34h42" className="art-thin"/>
        <rect x="38" y="67" width="8" height="15" className="art-sky"/>
        <rect x="50" y="59" width="8" height="23" className="art-sun"/>
        <rect x="62" y="52" width="8" height="30" className="art-coral"/>
        <path d="M30 92h36M30 97h22" className="art-thin"/>
        <g transform="rotate(32 98 70)">
          <rect x="93" y="36" width="11" height="46" rx="2" className="art-sun"/>
          <rect x="93" y="42" width="11" height="7" className="art-coral"/>
          <path d="M93 82l5.5 13 5.5-13Z" className="art-paper"/>
          <path d="M96.8 91l1.7 4 1.7-4Z" className="art-ink"/>
        </g>
      </>;
    case "team":
      // Three scientists working side by side.
      return <>
        {shadow(48)}
        {scientist(30, 50, 12, "art-skin-2", "art-wood")}
        {scientist(90, 50, 12, "art-skin-3", "art-ink")}
        {scientist(60, 42, 15, "art-skin-1", "art-sun")}
      </>;
    case "timeline":
      // A desk calendar with stages marked on it, and the clock that keeps it.
      return <>
        {shadow(44)}
        <rect x="14" y="22" width="88" height="80" rx="6" className="art-paper"/>
        <path d="M14 28a6 6 0 0 1 6-6h76a6 6 0 0 1 6 6v14H14Z" className="art-coral"/>
        <rect x="32" y="13" width="7" height="17" rx="3.5" className="art-paper"/>
        <rect x="77" y="13" width="7" height="17" rx="3.5" className="art-paper"/>
        {[0, 1, 2].flatMap((row) => [0, 1, 2, 3, 4].map((column) => {
          const fill = row === 1 && column === 1 ? "art-coral" : row === 0 && column === 3 ? "art-sky" : row === 2 && column === 2 ? "art-sun" : row === 2 && column === 0 ? "art-leaf" : "art-none";
          return <rect key={`${row}-${column}`} x={22 + column * 15.5} y={50 + row * 15} width="10" height="9" rx="2" className={`${fill} art-thin`}/>;
        }))}
        <circle cx="96" cy="92" r="15" className="art-sun"/>
        <path d="M96 83v9l6 4" className="art-ink-line"/>
      </>;
    case "vectors":
      // A shelf of books and a plasmid ring with its genes and direction.
      return <>
        {shadow(48)}
        <rect x="14" y="40" width="14" height="62" rx="2" className="art-sky"/>
        <rect x="30" y="28" width="15" height="74" rx="2" className="art-coral"/>
        <rect x="47" y="44" width="12" height="58" rx="2" className="art-sun"/>
        <path d="M14 50h14M14 92h14M30 38h15M30 92h15M47 52h12M47 94h12" className="art-thin"/>
        <circle cx="84" cy="76" r="20" className="art-ring-outline"/>
        <circle cx="84" cy="76" r="20" className="art-ring"/>
        <path d="M84 56a20 20 0 0 1 17.3 10" className="art-gene-coral"/>
        <path d="M94.8 69.8l13-7.5-2 11.5Z" className="art-coral art-thin"/>
        <path d="M95.5 92.4A20 20 0 0 1 66.7 86" className="art-gene-leaf"/>
        <path d="M8 104h104" className="art-outline"/>
      </>;
    case "alphafold":
      // A browser window showing a predicted fold: a helix and a strand.
      return <>
        {shadow(44)}
        <rect x="10" y="18" width="100" height="82" rx="6" className="art-paper"/>
        <path d="M10 24a6 6 0 0 1 6-6h88a6 6 0 0 1 6 6v10H10Z" className="art-sky"/>
        <circle cx="19" cy="26" r="2.4" className="art-paper"/>
        <circle cx="27" cy="26" r="2.4" className="art-paper"/>
        <circle cx="35" cy="26" r="2.4" className="art-paper"/>
        <rect x="44" y="22.5" width="56" height="7" rx="3.5" className="art-paper art-thin"/>
        <path d="M24 74c6-26 14-26 12 0s10 26 12 0 12-26 12 0c-1 12 6 18 12 14" className="art-ribbon-outline"/>
        <path d="M24 74c6-26 14-26 12 0s10 26 12 0 12-26 12 0c-1 12 6 18 12 14" className="art-ribbon"/>
        <path d="M74 90l14-26-4-2 14-10 0 17-4-2-14 26Z" className="art-sun"/>
        <path d="M92 40l2 6 6 2-6 2-2 6-2-6-6-2 6-2Z" className="art-sun"/>
      </>;
  }
}
