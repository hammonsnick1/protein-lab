"use client";

import { Check, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CatalogCartoon, type CartoonKind } from "@/components/protein-labs/catalog-cartoons";

/** Shared pieces of the purification catalogue pages: the page intro, the
 *  card for the current choice, and the inspector that opens on a card. */

export function PlannerIntro({ title, subtitle }: { title: string; subtitle: string }) {
  return <header className="planner-intro"><span className="eyebrow">PURIFICATION DESIGN</span><h2>{title}</h2><p>{subtitle}</p></header>;
}

export function CurrentChoice({ color, cartoon, label, title, subtitle, children }: { color: string; cartoon: CartoonKind; label: string; title: string; subtitle: string; children: React.ReactNode }) {
  return <aside className="catalog-details catalog-current-choice" style={{ "--catalog-color": color } as React.CSSProperties}>
    <span className="eyebrow">{label}</span>
    <div className="catalog-hero"><span className="resin-cartoon"><CatalogCartoon kind={cartoon}/></span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
    <small>Click another card to inspect its complete details before changing this selection.</small>
    {children}
  </aside>;
}

export function ChoiceInspector({ color, cartoon, eyebrow, title, subtitle, rows, onClose, onChoose }: { color: string; cartoon: CartoonKind; eyebrow: string; title: string; subtitle: string; rows: string[][]; onClose: () => void; onChoose: () => void }) {
  return <aside className="selection-inspector purification-selection-inspector" style={{ "--catalog-color": color } as React.CSSProperties}>
    <header><span><small>{eyebrow}</small><strong>{title}</strong></span><Button variant="ghost" size="icon" onClick={onClose}><X/></Button></header>
    <div className="selection-inspector-body">
      <div className="catalog-hero"><span className="resin-cartoon"><CatalogCartoon kind={cartoon}/></span><div><h2>{title}</h2><p>{subtitle}</p></div></div>
      <dl className="inspector-detail-list">{rows.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
    </div>
    <footer><Button variant="outline" onClick={onClose}>Close</Button><Button onClick={onChoose}><Check/> Use this option</Button></footer>
  </aside>;
}
