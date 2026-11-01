"use client";

import { useId, useState, type ReactNode } from "react";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { activeTabId, tabKeyTarget } from "@/lib/job-tabs";

/**
 * The two-level layout for long job pages: a summary strip that always says
 * what is chosen and what is wrong, then the details split into tabs. The
 * Compile page's summary bar is the model.
 */

export type JobSummaryItem = {
  label: string;
  value: ReactNode;
  detail?: ReactNode;
  /** A verdict shown as a chip beside the value: colour, icon and word. */
  status?: { tone: StatusTone; label: string };
};

export function JobSummary({ label, items, actions, note }: { label: string; items: JobSummaryItem[]; actions?: ReactNode; note?: ReactNode }) {
  return <section className="job-summary" aria-label={label}>
    <dl>{items.map((item) => <div key={item.label}>
      <dt>{item.label}</dt>
      <dd><span className="job-summary-value">{item.value}{item.status && <StatusChip tone={item.status.tone} label={item.status.label}/>}</span>{item.detail && <small>{item.detail}</small>}</dd>
    </div>)}</dl>
    {(actions || note) && <div className="job-summary-actions">{note && <div className="job-summary-note" role="status">{note}</div>}{actions}</div>}
  </section>;
}

export type JobTab = {
  id: string;
  label: string;
  /** One short line under the label: a count or the current choice. */
  hint?: string;
  content: ReactNode;
};

/**
 * Tabs for a job page. Every panel stays mounted and inactive ones are only
 * hidden, so drafts, searches and reports built inside a panel survive a tab
 * switch and the page can still read them (Affinity capture saves the
 * construct designer's report from whichever tab is open).
 */
export function JobTabs({ label, tabs, active, onActiveChange, compact = false }: { label: string; tabs: JobTab[]; active?: string; onActiveChange?: (id: string) => void; compact?: boolean }) {
  const ids = tabs.map((tab) => tab.id);
  const [own, setOwn] = useState(ids[0] ?? "");
  const current = activeTabId(ids, active ?? own);
  const base = useId();
  const tabId = (id: string) => `${base}-tab-${id}`;
  const panelId = (id: string) => `${base}-panel-${id}`;
  function show(id: string) {
    setOwn(id);
    onActiveChange?.(id);
  }
  return <div className={`job-tabs${compact ? " compact" : ""}`}>
    <div className="job-tabs-list" role="tablist" aria-label={label}>
      {tabs.map((tab, index) => <button
        key={tab.id}
        type="button"
        role="tab"
        id={tabId(tab.id)}
        aria-selected={tab.id === current}
        aria-controls={panelId(tab.id)}
        tabIndex={tab.id === current ? 0 : -1}
        onClick={() => show(tab.id)}
        onKeyDown={(event) => {
          const target = tabKeyTarget(event.key, index, tabs.length);
          if (target === null) return;
          event.preventDefault();
          show(tabs[target].id);
          document.getElementById(tabId(tabs[target].id))?.focus();
        }}
      ><strong>{tab.label}</strong>{tab.hint && <small>{tab.hint}</small>}</button>)}
    </div>
    {tabs.map((tab) => <div key={tab.id} className="job-tab-panel" role="tabpanel" id={panelId(tab.id)} aria-labelledby={tabId(tab.id)} hidden={tab.id !== current}>{tab.content}</div>)}
  </div>;
}
