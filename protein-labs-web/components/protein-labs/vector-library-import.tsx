"use client";

import { useEffect, useRef } from "react";
import { CircleAlert, Copy, FileText, LoaderCircle, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatBp } from "@/lib/vector-library";
import {
  RESOLUTION_LABEL, defaultResolution, importSummary, resolutionChoices,
  type ImportPreviewRow, type ImportResolution,
} from "@/lib/vector-library-organize";

/** Every file inside dropped folders, with its path, using the WebKit entry API Electron and Chromium share. */
export async function filesFromDrop(dataTransfer: DataTransfer): Promise<{ file: File; path: string }[]> {
  const entries = [...dataTransfer.items]
    .map((item) => (item.kind === "file" && typeof item.webkitGetAsEntry === "function" ? item.webkitGetAsEntry() : null))
    .filter((entry): entry is FileSystemEntry => Boolean(entry));
  if (!entries.length) return [...dataTransfer.files].map((file) => ({ file, path: file.name }));
  const out: { file: File; path: string }[] = [];
  const walk = async (entry: FileSystemEntry, prefix: string): Promise<void> => {
    if (entry.isFile) {
      const file = await new Promise<File>((resolve, reject) => (entry as FileSystemFileEntry).file(resolve, reject));
      out.push({ file, path: `${prefix}${file.name}` });
    } else if (entry.isDirectory) {
      const reader = (entry as FileSystemDirectoryEntry).createReader();
      // readEntries returns the directory in batches until it returns none.
      for (;;) {
        const batch = await new Promise<FileSystemEntry[]>((resolve, reject) => reader.readEntries(resolve, reject));
        if (!batch.length) break;
        for (const child of batch) await walk(child, `${prefix}${entry.name}/`);
      }
    }
  };
  for (const entry of entries) await walk(entry, "");
  return out;
}

export type ReviewState =
  | { stage: "reading"; count: number }
  | { stage: "review"; rows: ImportPreviewRow[]; ignored: string[] }
  | { stage: "importing"; rows: ImportPreviewRow[]; ignored: string[] };

export function ImportReview({ state, resolutions, onResolve, onResolveAll, onCancel, onCommit }: {
  state: ReviewState;
  resolutions: Record<string, ImportResolution>;
  onResolve: (filename: string, resolution: ImportResolution) => void;
  onResolveAll: (resolution: ImportResolution) => void;
  onCancel: () => void;
  onCommit: () => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, [state.stage]);
  const rows = state.stage === "reading" ? [] : state.rows;
  const duplicates = rows.filter((row) => row.status === "duplicate");
  const errors = rows.filter((row) => row.status === "error");
  const resolved = (row: ImportPreviewRow) => resolutions[row.filename] ?? defaultResolution(row);
  const acting = rows.filter((row) => resolved(row) !== "skip").length;
  const busy = state.stage !== "review";

  return <div className="vl-sheet-backdrop" onClick={busy ? undefined : onCancel}>
    <div ref={ref} className="vl-sheet" role="dialog" aria-modal="true" aria-labelledby="vl-import-title" tabIndex={-1} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Escape" && !busy) { event.preventDefault(); onCancel(); }
    }}>
      <header>
        <span>
          <strong id="vl-import-title">Review import</strong>
          <small>{state.stage === "reading"
            ? `Reading ${state.count} file${state.count === 1 ? "" : "s"}…`
            : `${rows.length} file${rows.length === 1 ? "" : "s"} · ${duplicates.length} already in the library${errors.length ? ` · ${errors.length} unreadable` : ""}`}</small>
        </span>
        <Button variant="ghost" size="icon-sm" onClick={onCancel} disabled={busy} aria-label="Cancel import"><X/></Button>
      </header>

      {state.stage === "reading"
        ? <div className="vl-sheet-loading"><LoaderCircle className="spin"/><span>Checking each file against the library…</span></div>
        : <>
          {duplicates.length > 1 && <div className="vl-sheet-bulk">
            <span>All {duplicates.length} duplicates:</span>
            {(["skip", "keepBoth", "merge"] as ImportResolution[]).map((resolution) => <button key={resolution} disabled={busy} onClick={() => onResolveAll(resolution)}>{RESOLUTION_LABEL[resolution]}</button>)}
          </div>}
          <ul className="vl-sheet-rows">
            {rows.map((row) => {
              const choices = resolutionChoices(row);
              const current = resolved(row);
              return <li key={row.filename} className={`vl-sheet-row status-${row.status}`}>
                <span className="vl-sheet-icon">{row.status === "error" ? <CircleAlert/> : row.status === "duplicate" ? <Copy/> : <FileText/>}</span>
                <span className="vl-sheet-file">
                  <strong title={row.filename}>{row.name || row.filename.split("/").pop()}</strong>
                  <small title={row.filename}>{row.filename}{row.lengthBp ? ` · ${formatBp(row.lengthBp)}` : ""}{row.featureCount != null ? ` · ${row.featureCount} features` : ""}</small>
                  {row.status === "duplicate" && row.duplicateOf && <small className="vl-sheet-dup">Same sequence as <b>{row.duplicateOf.name}</b>{row.duplicateOf.isStandard ? " (standard catalogue)" : ""}</small>}
                  {row.status === "error" && <small className="vl-sheet-err">{row.error || "This file could not be read."}</small>}
                </span>
                <span className="vl-segment" role="radiogroup" aria-label={`What to do with ${row.filename}`}>
                  {choices.map((choice) => <button key={choice} role="radio" aria-checked={current === choice} disabled={busy || choices.length === 1} onClick={() => onResolve(row.filename, choice)}>{RESOLUTION_LABEL[choice]}</button>)}
                </span>
              </li>;
            })}
          </ul>
          {state.ignored.length > 0 && <p className="vl-sheet-note">Not sequence files, left out: {state.ignored.slice(0, 6).join(", ")}{state.ignored.length > 6 ? ` and ${state.ignored.length - 6} more` : ""}.</p>}
          {duplicates.length > 0 && <p className="vl-sheet-note"><b>Keep both</b> adds a second record with the same sequence. <b>Merge</b> keeps the existing record and adds the file&apos;s name, notes and tags to it.</p>}
        </>}

      <footer>
        <small>{state.stage === "reading" ? "" : importSummary(rows, resolutions)}</small>
        <div>
          <Button variant="outline" size="sm" onClick={onCancel} disabled={busy}>Cancel</Button>
          <Button size="sm" onClick={onCommit} disabled={busy || acting === 0}>{state.stage === "importing" ? <LoaderCircle className="spin"/> : null}{acting ? `Import ${acting}` : "Nothing to import"}</Button>
        </div>
      </footer>
    </div>
  </div>;
}
