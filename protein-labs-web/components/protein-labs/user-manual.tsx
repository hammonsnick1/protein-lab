"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CircleAlert, Info, Lightbulb, Search } from "lucide-react";
import manualSource from "@/docs/user-manual.md?raw";
import { type Inline, type ManualBlock, parseManual, searchManual } from "@/lib/manual";

// Help > User manual. The text lives in docs/user-manual.md and its figures in
// desktop/public/manual, so the manual ships inside the app and works offline.
const manual = parseManual(manualSource);

export function UserManual({ initialSection }: { initialSection?: string }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(initialSection ?? manual.sections[0]?.id ?? "");
  const body = useRef<HTMLElement>(null);
  const sections = useMemo(() => searchManual(manual, query), [query]);

  function show(id: string) {
    setActive(id);
    document.getElementById(`manual-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  }

  useEffect(() => { if (initialSection) document.getElementById(`manual-${initialSection}`)?.scrollIntoView({ block: "start" }); }, [initialSection]);

  // Highlight the section being read in the contents list.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    const observer = new IntersectionObserver((entries) => {
      const visible = entries.filter((entry) => entry.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (visible) setActive(visible.target.id.replace(/^manual-/, ""));
    }, { rootMargin: "-80px 0px -65% 0px" });
    root.querySelectorAll("section[id^='manual-']").forEach((section) => observer.observe(section));
    return () => observer.disconnect();
  }, [sections]);

  return <main className="user-manual">
    <aside className="manual-contents" aria-label="Manual contents">
      <label className="manual-search"><Search aria-hidden="true"/><span className="sr-only">Search the manual</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the manual"/></label>
      <nav>
        {sections.map((section) => <button key={section.id} className={active === section.id ? "active" : ""} aria-current={active === section.id ? "true" : undefined} onClick={() => show(section.id)}>{section.title}</button>)}
        {sections.length === 0 && <p className="manual-empty">No section mentions “{query.trim()}”.</p>}
      </nav>
    </aside>
    <article className="manual-body" ref={body}>
      <header className="manual-heading">
        <span className="eyebrow"><BookOpen aria-hidden="true"/> HELP</span>
        <h1>{manual.title}</h1>
        {manual.intro.map((block, index) => <Block key={index} block={block}/>)}
      </header>
      {sections.map((section) => <section key={section.id} id={`manual-${section.id}`} aria-labelledby={`manual-${section.id}-title`}>
        <h2 id={`manual-${section.id}-title`}>{section.title}</h2>
        {section.blocks.map((block, index) => <Block key={index} block={block}/>)}
      </section>)}
      {sections.length === 0 && <section className="manual-empty"><p>Nothing in the manual matches “{query.trim()}”. Try a single word such as <strong>gel</strong>, <strong>report</strong> or <strong>folder</strong>.</p><button onClick={() => setQuery("")}>Clear the search</button></section>}
    </article>
  </main>;
}

const noteIcons = { tip: Lightbulb, note: Info, warning: CircleAlert };

function Block({ block }: { block: ManualBlock }) {
  switch (block.kind) {
    case "heading": return <h3 id={`manual-${block.id}`}>{block.text}</h3>;
    case "paragraph": return <p><Inlines parts={block.content}/></p>;
    case "list": { const List = block.ordered ? "ol" : "ul"; return <List>{block.items.map((item, index) => <li key={index}><Inlines parts={item}/></li>)}</List>; }
    case "figure": return <figure><img src={block.src} alt={block.alt} loading="lazy"/>{block.caption.length > 0 && <figcaption><Inlines parts={block.caption}/></figcaption>}</figure>;
    case "note": { const Icon = noteIcons[block.tone]; return <aside className={`manual-note ${block.tone}`}><Icon aria-hidden="true"/><p><Inlines parts={block.content}/></p></aside>; }
    case "table": return <div className="manual-table"><table><thead><tr>{block.header.map((cell, index) => <th key={index}><Inlines parts={cell}/></th>)}</tr></thead><tbody>{block.rows.map((row, rowIndex) => <tr key={rowIndex}>{row.map((cell, index) => <td key={index}><Inlines parts={cell}/></td>)}</tr>)}</tbody></table></div>;
  }
}

function Inlines({ parts }: { parts: Inline[] }) {
  return <>{parts.map((part, index) => {
    switch (part.kind) {
      case "strong": return <strong key={index}>{part.text}</strong>;
      case "em": return <em key={index}>{part.text}</em>;
      case "code": return <code key={index}>{part.text}</code>;
      case "kbd": return <kbd key={index}>{part.text}</kbd>;
      // "#section" links jump within the manual; web links open in the
      // browser (Electron's window-open handler); anything else stays text.
      case "link":
        if (part.href.startsWith("#")) return <a key={index} href={`#manual-${part.href.slice(1)}`} onClick={(event) => { event.preventDefault(); document.getElementById(`manual-${part.href.slice(1)}`)?.scrollIntoView({ behavior: "smooth", block: "start" }); }}>{part.text}</a>;
        return /^https?:\/\//.test(part.href) ? <a key={index} href={part.href} target="_blank" rel="noreferrer">{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>;
      default: return <Fragment key={index}>{part.text}</Fragment>;
    }
  })}</>;
}
