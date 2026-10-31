"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, CircleAlert, Info, Lightbulb, Search } from "lucide-react";
import manualSource from "@/docs/user-manual.md?raw";
import { type Inline, type ManualBlock, parseManual, searchManual } from "@/lib/manual";

// Help > User manual. The text lives in docs/user-manual.md and its figures in
// desktop/public/manual, so the manual ships inside the app and works offline.
const manual = parseManual(manualSource);

// A heading counts as "being read" once it passes this line below the top bar.
const READING_LINE = 120;

function scrollBehavior(): ScrollBehavior {
  return window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}

// Scroll to a section or sub-heading. Returns false when it is not on the page.
// Figures above the target can still be decoding and push it down while the
// page scrolls, so once the scroll ends the target is put back in place.
function jumpTo(id: string, behavior: ScrollBehavior = scrollBehavior()) {
  const target = document.getElementById(`manual-${id}`);
  if (!target) return false;
  target.scrollIntoView({ behavior, block: "start" });
  const realign = () => {
    const offset = target.getBoundingClientRect().top - parseFloat(getComputedStyle(target).scrollMarginTop || "0");
    const atBottom = window.innerHeight + window.scrollY >= document.documentElement.scrollHeight - 2;
    if (Math.abs(offset) > 4 && !atBottom) target.scrollIntoView({ behavior: "auto", block: "start" });
  };
  if (behavior === "smooth") window.addEventListener("scrollend", realign, { once: true });
  else void Promise.all([...document.querySelectorAll<HTMLImageElement>(".manual-body figure img")].map((image) => image.decode().catch(() => undefined))).then(realign);
  return true;
}

export function UserManual({ initialSection }: { initialSection?: string }) {
  const [query, setQuery] = useState("");
  const [active, setActive] = useState({ section: initialSection ?? manual.sections[0]?.id ?? "", heading: "" });
  const body = useRef<HTMLElement>(null);
  // After a contents click, keep that entry highlighted instead of
  // flickering through every section the scroll passes.
  const pinned = useRef<string | null>(null);
  const sections = useMemo(() => searchManual(manual, query), [query]);

  function show(section: string, heading = "") {
    pinned.current = section;
    setActive({ section, heading });
    if (!jumpTo(heading || section)) pinned.current = null;
  }

  useEffect(() => { if (initialSection) jumpTo(initialSection, "auto"); }, [initialSection]);

  // Highlight the section, and the sub-heading inside it, being read.
  useEffect(() => {
    const root = body.current;
    if (!root) return;
    let frame = 0;
    const measure = () => {
      frame = 0;
      if (pinned.current) return;
      const above = (selector: string, scope: ParentNode) => [...scope.querySelectorAll<HTMLElement>(selector)].filter((element) => element.getBoundingClientRect().top <= READING_LINE).at(-1);
      const section = above("section[id^='manual-']", root) ?? root.querySelector<HTMLElement>("section[id^='manual-']");
      if (!section) return;
      const heading = above("h3[id^='manual-']", section);
      setActive({ section: section.id.replace(/^manual-/, ""), heading: heading?.id.replace(/^manual-/, "") ?? "" });
    };
    const onScroll = () => { if (!frame) frame = requestAnimationFrame(measure); };
    // The reader scrolling by wheel, key, touch or scrollbar takes over from
    // a contents jump. Until then the jumped-to entry stays highlighted, also
    // when it is near the end and cannot reach the reading line.
    const release = () => { pinned.current = null; };
    const takeOver = ["wheel", "keydown", "pointerdown", "touchstart"] as const;
    window.addEventListener("scroll", onScroll, { passive: true });
    for (const type of takeOver) window.addEventListener(type, release, { passive: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      for (const type of takeOver) window.removeEventListener(type, release);
    };
  }, [sections]);

  // In narrow windows the contents are one scrolling row; keep the section
  // being read in view there.
  const contents = useRef<HTMLElement>(null);
  useEffect(() => {
    const nav = contents.current;
    const link = nav?.querySelector<HTMLElement>("li.current > a");
    if (!nav || !link || nav.scrollWidth <= nav.clientWidth) return;
    const left = link.offsetLeft - nav.offsetLeft;
    if (left < nav.scrollLeft || left + link.offsetWidth > nav.scrollLeft + nav.clientWidth) nav.scrollTo({ left: left - 24, behavior: scrollBehavior() });
  }, [active.section]);

  return <main className="user-manual">
    <aside className="manual-contents" aria-label="Manual contents">
      <label className="manual-search"><Search aria-hidden="true"/><span className="sr-only">Search the manual</span><input type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search the manual"/></label>
      <nav ref={contents}>
        <ol>
          {sections.map((section) => {
            const current = active.section === section.id;
            const headings = section.blocks.filter((block): block is Extract<ManualBlock, { kind: "heading" }> => block.kind === "heading");
            return <li key={section.id} className={current ? "current" : ""}>
              <a href={`#manual-${section.id}`} aria-current={current && !active.heading ? "location" : undefined} onClick={(event) => { event.preventDefault(); show(section.id); }}>{section.title}</a>
              {current && headings.length > 0 && <ol className="manual-subheadings">
                {headings.map((heading) => <li key={heading.id}><a href={`#manual-${heading.id}`} aria-current={active.heading === heading.id ? "location" : undefined} onClick={(event) => { event.preventDefault(); show(section.id, heading.id); }}>{heading.text}</a></li>)}
              </ol>}
            </li>;
          })}
        </ol>
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

const notes = { tip: { icon: Lightbulb, label: "Tip" }, note: { icon: Info, label: "Note" }, warning: { icon: CircleAlert, label: "Warning" } };

function Block({ block }: { block: ManualBlock }) {
  switch (block.kind) {
    case "heading": return <h3 id={`manual-${block.id}`}>{block.text}</h3>;
    case "paragraph": return <p><Inlines parts={block.content}/></p>;
    case "list": { const List = block.ordered ? "ol" : "ul"; return <List>{block.items.map((item, index) => <li key={index}><Inlines parts={item}/></li>)}</List>; }
    // Each figure ships a light and a dark screenshot, and CSS shows the one
    // that matches the appearance. They load eagerly from the app bundle so
    // the page does not reflow under a contents jump.
    case "figure": return <figure>
      <img className="manual-shot light" src={block.src} alt={block.alt} decoding="async"/>
      <img className="manual-shot dark" src={block.darkSrc} alt={block.alt} decoding="async"/>
      {block.caption.length > 0 && <figcaption><Inlines parts={block.caption}/></figcaption>}
    </figure>;
    case "note": { const { icon: Icon, label } = notes[block.tone]; return <aside className={`manual-note ${block.tone}`} aria-label={label}><Icon aria-hidden="true"/><div><strong className="manual-note-label">{label}</strong><p><Inlines parts={block.content}/></p></div></aside>; }
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
        if (part.href.startsWith("#")) return <a key={index} href={`#manual-${part.href.slice(1)}`} onClick={(event) => { event.preventDefault(); jumpTo(part.href.slice(1)); }}>{part.text}</a>;
        return /^https?:\/\//.test(part.href) ? <a key={index} href={part.href} target="_blank" rel="noreferrer">{part.text}</a> : <Fragment key={index}>{part.text}</Fragment>;
      default: return <Fragment key={index}>{part.text}</Fragment>;
    }
  })}</>;
}
