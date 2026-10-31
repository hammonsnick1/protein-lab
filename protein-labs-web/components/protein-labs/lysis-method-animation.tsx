"use client";

import type { CSSProperties, ReactNode } from "react";
import { lysisAnimationFor, type LysisAnimationKind } from "@/lib/lysis-animations";

/**
 * A small looping schematic of how a lysis method opens cells, drawn as inline
 * SVG and moved by the `lysis-*` keyframes in globals.css. The tool is drawn
 * in the method's accent colour and the cells in theme tokens. Every drawing
 * is a meaningful static frame on its own: with reduced motion the keyframes
 * are switched off and the intact and broken cells stay side by side.
 */
export function LysisMethodAnimation({ methodId }: { methodId: string }) {
  const animation = lysisAnimationFor(methodId);
  if (!animation) return null;
  return <figure className="lysis-anim">
    <svg viewBox="0 0 240 120" role="img" aria-label={animation.caption}>{drawings[animation.kind]()}</svg>
    <figcaption>{animation.caption}</figcaption>
  </figure>;
}

/** Motion settings read by the keyframes: offset, duration and delay. */
function motion(dx = 0, dy = 0, duration = 3, delay = 0): CSSProperties {
  return { "--dx": `${dx}px`, "--dy": `${dy}px`, "--dur": `${duration}s`, "--delay": `${delay}s` } as CSSProperties;
}

function Cell({ cx, cy, rx, ry }: { cx: number; cy: number; rx: number; ry: number }) {
  return <>
    <ellipse cx={cx} cy={cy} rx={rx} ry={ry} className="la-cell"/>
    <circle cx={cx - rx * .4} cy={cy - ry * .2} r="1.8" className="la-content"/>
    <circle cx={cx + rx * .15} cy={cy + ry * .3} r="1.8" className="la-content"/>
    <circle cx={cx + rx * .45} cy={cy - ry * .25} r="1.8" className="la-content"/>
  </>;
}

/** A cell torn open: two curled halves of envelope and its released contents. */
function Fragments({ x, y }: { x: number; y: number }) {
  return <g transform={`translate(${x} ${y})`}>
    <path d="M-14 -2 Q-12 -9 -3 -8" className="la-shard"/>
    <path d="M14 3 Q11 9 2 8" className="la-shard"/>
    <circle cx="-6" cy="3" r="1.8" className="la-content"/>
    <circle cx="5" cy="-4" r="1.8" className="la-content"/>
    <circle cx="10" cy="-9" r="1.4" className="la-content"/>
  </g>;
}

const drawings: Record<LysisAnimationKind, () => ReactNode> = {
  sonication: () => <>
    <rect x="108" y="-2" width="24" height="44" rx="3" className="la-tool"/>
    <path d="M108 42h24l-4 8h-16z" className="la-tool-solid"/>
    {[0, 1, 2].map((index) => <path key={index} d={`M${92 - index * 10} ${60 + index * 12}Q120 ${74 + index * 14} ${148 + index * 10} ${60 + index * 12}`} className="la-line la-drift" style={motion(0, 14, 1.8, index * .6)}/>)}
    {[[104, 96, 0], [138, 102, .5], [121, 110, 1]].map(([cx, cy, delay]) => <g key={cx} transform={`translate(${cx} ${cy})`}><circle r="4.5" className="la-bubble la-grow" style={motion(0, 0, 1.5, delay)}/></g>)}
    <g className="la-shake" style={motion(0, 0, .3)}><Cell cx={44} cy={88} rx={22} ry={10}/></g>
    <g className="la-drift" style={motion(10, -4, 2.4, .4)}><Fragments x={198} y={88}/></g>
  </>,

  homogenizer: () => <>
    <path d="M0 26H86L128 55H152L194 26H240M0 94H86L128 65H152L194 94H240" className="la-wall-line"/>
    <path d="M128 55H152M128 65H152" className="la-tool-edge"/>
    <path d="M6 60h22m-6-6 6 6-6 6" className="la-line la-pulse" style={motion(0, 0, 1.2)}/>
    <g className="la-drift" style={motion(72, 0, 2.4)}><Cell cx={44} cy={48} rx={13} ry={8}/></g>
    <g className="la-drift" style={motion(66, -10, 2.4, 1.2)}><Cell cx={56} cy={74} rx={13} ry={8}/></g>
    <g className="la-drift" style={motion(34, -12, 2.4, .6)}><Fragments x={186} y={52}/></g>
    <g className="la-drift" style={motion(34, 10, 2.4, 1.8)}><Fragments x={180} y={74}/></g>
  </>,

  "bead-mill": () => <>
    <rect x="36" y="8" width="168" height="104" rx="16" className="la-vessel"/>
    {[[72, 36, 16, 12, .9], [156, 82, -14, -10, 1.1], [104, 88, 10, -16, .8], [174, 34, -12, 14, 1]].map(([cx, cy, dx, dy, duration]) => <g key={cx} transform={`translate(${cx} ${cy})`}><circle r="11" className="la-bead la-swing" style={motion(dx, dy, duration)}/></g>)}
    <g className="la-shake" style={motion(0, 0, .25)}><Cell cx={118} cy={52} rx={18} ry={9}/></g>
    <path d="M118 43l-3 5 4 3-3 6" className="la-crack la-pulse" style={motion(0, 0, .9)}/>
    <Fragments x={70} y={80}/>
  </>,

  enzymatic: () => <>
    <ellipse cx="120" cy="60" rx="74" ry="38" className="la-wall la-digest" style={motion(0, 0, 4)}/>
    <Cell cx={120} cy={60} rx={64} ry={29}/>
    {[[46, 60, 0], [140, 22, .5], [176, 92, 1]].map(([x, y, delay]) => <g key={x} transform={`translate(${x} ${y})`}><path d="M0 0L8-5A9.4 9.4 0 1 0 8 5Z" className="la-enzyme la-chomp" style={motion(0, 0, .6, delay)}/></g>)}
    <g transform="translate(194 52)"><circle r="2" className="la-content la-drift" style={motion(22, -10, 4, 2)}/></g>
    <g transform="translate(196 66)"><circle r="2" className="la-content la-drift" style={motion(24, 12, 4, 2.6)}/></g>
  </>,

  detergent: () => <>
    <circle cx="96" cy="60" r="36" className="la-cell la-dissolve" style={motion(0, 0, 4)}/>
    <circle cx="86" cy="54" r="1.8" className="la-content"/><circle cx="104" cy="68" r="1.8" className="la-content"/>
    {[0, 50, 100, 150, 200, 250, 300].map((angle) => {
      const radians = (angle * Math.PI) / 180, x = 96 + Math.cos(radians) * 50, y = 60 + Math.sin(radians) * 50;
      return <g key={angle} transform={`translate(${x} ${y}) rotate(${angle})`}>
        <g className="la-drift" style={motion(-10, 0, 4, angle / 200)}><path d="M-1 0h-9" className="la-line"/><circle cx="2" r="3.4" className="la-tool-solid"/></g>
      </g>;
    })}
    {[[184, 30, 0], [210, 72, .8], [172, 96, 1.6]].map(([x, y, delay]) => <g key={x} transform={`translate(${x} ${y})`}>
      <g className="la-grow" style={motion(0, 0, 4, delay)}>
        <circle r="7" className="la-tool"/>
        {[0, 60, 120, 180, 240, 300].map((angle) => <circle key={angle} cx={Math.cos(angle * Math.PI / 180) * 9} cy={Math.sin(angle * Math.PI / 180) * 9} r="2.4" className="la-tool-solid"/>)}
      </g>
    </g>)}
  </>,

  dounce: () => <>
    <path d="M76 6V96Q76 114 120 114Q164 114 164 96V6" className="la-vessel"/>
    <g className="la-swing" style={motion(0, -26, 2.4)}>
      <rect x="114" y="-40" width="12" height="94" rx="4" className="la-tool"/>
      <ellipse cx="120" cy="80" rx="36" ry="17" className="la-tool-solid la-soft"/>
    </g>
    <g transform="translate(90 102)"><ellipse rx="8" ry="5" className="la-cell la-squash" style={motion(0, 0, 2.4)}/></g>
    <g transform="translate(150 102)"><ellipse rx="8" ry="5" className="la-cell la-squash" style={motion(0, 0, 2.4)}/></g>
    <Fragments x={120} y={106}/>
    <Cell cx={204} cy={44} rx={17} ry={14}/>
    <path d="M186 74h36" className="la-faint"/>
    <Fragments x={204} y={92}/>
  </>,

  nitrogen: () => <>
    <rect x="46" y="24" width="148" height="90" rx="14" className="la-vessel"/>
    <rect x="112" y="12" width="16" height="12" rx="2" className="la-tool"/>
    <path d="M114 9l-4-7M120 9V1M126 9l4-7" className="la-line la-vent" style={motion(0, 0, 4)}/>
    {[[66, 42, 24, 12], [66, 96, 24, -12], [176, 42, -26, 12], [176, 96, -26, -12], [120, 36, 0, 18], [120, 104, 0, -18]].map(([x, y, dx, dy]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><circle r="3" className="la-tool-solid la-diffuse" style={motion(dx, dy, 4)}/></g>)}
    <g transform="translate(120 66)"><g className="la-burst" style={motion(0, 0, 4)}><Cell cx={0} cy={0} rx={30} ry={18}/></g></g>
    <g className="la-reveal" style={motion(0, 0, 4)}><Fragments x={70} y={68}/><Fragments x={172} y={68}/></g>
  </>,

  osmotic: () => <>
    <g transform="translate(120 60)"><ellipse rx="70" ry="36" className="la-tool la-swell" style={motion(0, 0, 3.6)}/></g>
    <Cell cx={120} cy={60} rx={48} ry={20}/>
    {[[64, 46, -26, -16], [176, 74, 26, 16], [120, 31, 0, -26], [120, 89, 0, 24], [64, 76, -28, 14]].map(([x, y, dx, dy]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><circle r="2.6" className="la-tool-solid la-drift" style={motion(dx, dy, 3.6, 1)}/></g>)}
    <path d="M6 60h20m-6-6 6 6-6 6M234 60h-20m6-6-6 6 6 6" className="la-line la-pulse" style={motion(0, 0, 1.8)}/>
  </>,

  "freeze-thaw": () => <>
    <rect x="14" y="12" width="12" height="84" rx="6" className="la-vessel"/>
    <circle cx="20" cy="102" r="9" className="la-tool-solid"/>
    <g transform="translate(20 96)"><rect x="-3" y="-76" width="6" height="76" className="la-tool-solid la-thermo" style={motion(0, 0, 5)}/></g>
    <Cell cx={132} cy={60} rx={58} ry={30}/>
    {[[80, 40, 0], [168, 34, .3], [190, 74, .6], [112, 90, .9], [138, 60, 1.2]].map(([x, y, delay]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}>
      <path d="M0-9V9M-7.8-4.5 7.8 4.5M7.8-4.5-7.8 4.5" className="la-ice la-freeze" style={motion(0, 0, 5, delay)}/>
    </g>)}
    {[[198, 50, 14, -8], [70, 70, -16, 6], [150, 96, 6, 14]].map(([x, y, dx, dy]) => <g key={`${x}-${y}`} transform={`translate(${x} ${y})`}><circle r="2" className="la-content la-leak" style={motion(dx, dy, 5)}/></g>)}
  </>,
};
