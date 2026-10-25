"use client";

import { useRef } from "react";
import { Disc3, FolderCog, FolderSearch, HardDrive, TestTubes, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { VectorLibrary } from "@/components/protein-labs/vector-library";
import { ProteinLibrary } from "@/components/protein-labs/protein-library";
import type { ProteinRecord } from "@/lib/protein-labs-api";
import { LIBRARY_TABS, nextLibraryTab, storageSentence, type LibraryStorage, type LibraryTab } from "@/lib/library-hub";

const TAB_ICON = { vectors: Disc3, proteins: TestTubes } as const;

/**
 * The vector and protein library: a tab for each library over the existing
 * library pages, with where that library is saved above it. Only the chosen
 * library is mounted, so its own shortcuts (/, arrows, Ctrl+A) never fire in
 * the hidden one.
 */
export function LibraryHub({ tab, onTabChange, proteins, storage, onOpenVectorProject, onRevealStorage, onChangeStorage }: {
  tab: LibraryTab;
  onTabChange: (tab: LibraryTab) => void;
  proteins: ProteinRecord[];
  storage: LibraryStorage;
  onOpenVectorProject: (proteinId: string) => void;
  onRevealStorage: () => void;
  onChangeStorage: () => void;
}) {
  const tabRefs = useRef<Partial<Record<LibraryTab, HTMLButtonElement | null>>>({});

  function onTabKey(event: React.KeyboardEvent) {
    const next = nextLibraryTab(tab, event.key);
    if (!next) return;
    event.preventDefault();
    onTabChange(next);
    tabRefs.current[next]?.focus();
  }

  return <div className={`library-hub library-hub-${tab}`}>
    <div className="library-hub-bar">
      <div className="library-hub-tabs" role="tablist" aria-label="Libraries" onKeyDown={onTabKey}>
        {LIBRARY_TABS.map((entry) => {
          const Icon = TAB_ICON[entry.id];
          const selected = entry.id === tab;
          return <button key={entry.id} ref={(node) => { tabRefs.current[entry.id] = node; }} id={`library-tab-${entry.id}`} role="tab" aria-selected={selected} aria-controls="library-hub-panel" tabIndex={selected ? 0 : -1} className={selected ? "active" : ""} title={`${entry.label} (${entry.shortcut})`} onClick={() => onTabChange(entry.id)}>
            <Icon/>{entry.label}
          </button>;
        })}
      </div>
      <div className={`library-hub-storage ${storage.missing ? "warning" : ""}`} title={storage.database || undefined}>
        {storage.missing ? <TriangleAlert/> : <HardDrive/>}
        <span>
          <small>{storage.missing ? `${storage.missing} was not found, so ${tab} are being saved in the default folder:` : storageSentence(tab, storage)}</small>
          {storage.folder && <strong className="library-hub-path"><span>{storage.folder}</span></strong>}
        </span>
        {storage.canReveal && <Button variant="outline" size="sm" onClick={onRevealStorage}><FolderSearch/> Open folder</Button>}
        {storage.canChange && <Button variant="ghost" size="sm" onClick={onChangeStorage}><FolderCog/> Change location…</Button>}
      </div>
    </div>
    <div id="library-hub-panel" className="library-hub-panel" role="tabpanel" aria-labelledby={`library-tab-${tab}`}>
      {tab === "vectors"
        ? <VectorLibrary key="vectors" mode="page" proteins={proteins} onOpenProject={onOpenVectorProject}/>
        : <ProteinLibrary key="proteins"/>}
    </div>
  </div>;
}
