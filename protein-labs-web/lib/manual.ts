// Parses the in-app user manual (docs/user-manual.md) into blocks the Help
// viewer renders as React elements. It covers the small Markdown subset the
// manual uses and never produces raw HTML, so the manual cannot inject markup.

export type Inline =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "em"; text: string }
  | { kind: "code"; text: string }
  | { kind: "kbd"; text: string }
  | { kind: "link"; text: string; href: string };

export type ManualBlock =
  | { kind: "heading"; level: 2 | 3; id: string; text: string }
  | { kind: "paragraph"; content: Inline[] }
  | { kind: "list"; ordered: boolean; items: Inline[][] }
  | { kind: "figure"; src: string; alt: string; caption: Inline[] }
  | { kind: "note"; tone: "tip" | "note" | "warning"; content: Inline[] }
  | { kind: "table"; header: Inline[][]; rows: Inline[][][] };

export type ManualSection = { id: string; title: string; blocks: ManualBlock[] };
export type Manual = { title: string; intro: ManualBlock[]; sections: ManualSection[] };

export function slugify(text: string): string {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "section";
}

const inlinePattern = /\*\*(.+?)\*\*|`([^`]+)`|<kbd>(.+?)<\/kbd>|\[([^\]]+)\]\(([^)\s]+)\)|\*(.+?)\*/g;

export function parseInline(source: string): Inline[] {
  const parts: Inline[] = [];
  let last = 0;
  for (const match of source.matchAll(inlinePattern)) {
    const at = match.index ?? 0;
    if (at > last) parts.push({ kind: "text", text: source.slice(last, at) });
    if (match[1] !== undefined) parts.push({ kind: "strong", text: match[1] });
    else if (match[2] !== undefined) parts.push({ kind: "code", text: match[2] });
    else if (match[3] !== undefined) parts.push({ kind: "kbd", text: match[3] });
    else if (match[4] !== undefined) parts.push({ kind: "link", text: match[4], href: match[5] });
    else parts.push({ kind: "em", text: match[6] });
    last = at + match[0].length;
  }
  if (last < source.length) parts.push({ kind: "text", text: source.slice(last) });
  return parts;
}

const tableCells = (line: string) => line.trim().replace(/^\||\|$/g, "").split("|").map((cell) => parseInline(cell.trim()));
const isTableRule = (line: string) => /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(line);

export function parseManual(markdown: string): Manual {
  const lines = markdown.replace(/\r\n?/g, "\n").split("\n");
  const manual: Manual = { title: "User manual", intro: [], sections: [] };
  const used = new Map<string, number>();
  const uniqueId = (text: string) => { const base = slugify(text); const count = used.get(base) ?? 0; used.set(base, count + 1); return count ? `${base}-${count + 1}` : base; };
  const target = () => manual.sections.at(-1)?.blocks ?? manual.intro;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index];
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("<!--")) {
      // Skip comments whole so authoring notes never reach the reader.
      if (trimmed.startsWith("<!--")) while (index < lines.length && !lines[index].includes("-->")) index += 1;
      index += 1;
      continue;
    }
    const heading = /^(#{1,3})\s+(.*)$/.exec(trimmed);
    if (heading) {
      const text = heading[2].trim();
      if (heading[1].length === 1) manual.title = text;
      else if (heading[1].length === 2) manual.sections.push({ id: uniqueId(text), title: text, blocks: [] });
      else target().push({ kind: "heading", level: 3, id: uniqueId(text), text });
      index += 1;
      continue;
    }
    const image = /^!\[([^\]]*)\]\(([^)\s]+)\)$/.exec(trimmed);
    if (image) {
      // An italic line straight after an image is its caption.
      const next = lines[index + 1]?.trim() ?? "";
      const caption = /^\*(?!\*)(.+)\*$/.exec(next);
      target().push({ kind: "figure", alt: image[1], src: image[2], caption: caption ? parseInline(caption[1]) : [] });
      index += caption ? 2 : 1;
      continue;
    }
    if (trimmed.startsWith(">")) {
      const quoted: string[] = [];
      while (index < lines.length && lines[index].trim().startsWith(">")) { quoted.push(lines[index].trim().replace(/^>\s?/, "")); index += 1; }
      let text = quoted.join(" ").trim();
      const label = /^\*\*(Tip|Note|Warning):?\*\*:?\s*/i.exec(text);
      const tone = (label?.[1].toLowerCase() ?? "note") as "tip" | "note" | "warning";
      if (label) text = text.slice(label[0].length);
      target().push({ kind: "note", tone, content: parseInline(text) });
      continue;
    }
    if (trimmed.startsWith("|") && isTableRule(lines[index + 1] ?? "")) {
      const header = tableCells(trimmed);
      const rows: Inline[][][] = [];
      index += 2;
      while (index < lines.length && lines[index].trim().startsWith("|")) { rows.push(tableCells(lines[index])); index += 1; }
      target().push({ kind: "table", header, rows });
      continue;
    }
    const listItem = /^(?:([-*])|(\d+)[.)])\s+(.*)$/;
    const first = listItem.exec(trimmed);
    if (first) {
      const ordered = first[2] !== undefined;
      const items: string[] = [];
      while (index < lines.length) {
        const current = lines[index];
        const item = listItem.exec(current.trim());
        if (item && (item[2] !== undefined) === ordered) items.push(item[3]);
        else if (current.trim() && /^\s+/.test(current) && items.length) items[items.length - 1] += ` ${current.trim()}`;
        else break;
        index += 1;
      }
      target().push({ kind: "list", ordered, items: items.map(parseInline) });
      continue;
    }
    const paragraph: string[] = [];
    while (index < lines.length) {
      const current = lines[index].trim();
      if (!current || /^(#{1,3}\s|!\[|>|\||[-*]\s|\d+[.)]\s|<!--)/.test(current)) break;
      paragraph.push(current);
      index += 1;
    }
    target().push({ kind: "paragraph", content: parseInline(paragraph.join(" ")) });
  }
  return manual;
}

// Plain text of a block, used by the manual's search box.
export function blockText(block: ManualBlock): string {
  const text = (parts: Inline[]) => parts.map((part) => part.text).join("");
  switch (block.kind) {
    case "heading": return block.text;
    case "paragraph": case "note": return text(block.content);
    case "list": return block.items.map(text).join(" ");
    case "figure": return `${block.alt} ${text(block.caption)}`;
    case "table": return [block.header, ...block.rows].map((row) => row.map(text).join(" ")).join(" ");
  }
}

export function searchManual(manual: Manual, query: string): ManualSection[] {
  const terms = query.toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return manual.sections;
  return manual.sections.filter((section) => {
    const haystack = `${section.title} ${section.blocks.map(blockText).join(" ")}`.toLowerCase();
    return terms.every((term) => haystack.includes(term));
  });
}
