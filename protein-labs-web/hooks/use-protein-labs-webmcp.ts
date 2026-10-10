"use client";

import { useEffect } from "react";

type Tool = {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations: { readOnlyHint: boolean; untrustedContentHint: boolean };
  execute: (input: Record<string, unknown>) => unknown;
};

declare global {
  interface Document {
    modelContext?: { registerTool: (tool: Tool, options?: { signal?: AbortSignal }) => void | Promise<void> };
  }
}

export function useProteinLabsWebMcp(actions: { openProject: (id: string) => void; openJob: (id: string) => void; openNotebook: () => void }) {
  useEffect(() => {
    const context = document.modelContext;
    if (!context?.registerTool) return;
    const lifecycle = new AbortController();
    const register = (tool: Tool) => void Promise.resolve(context.registerTool(tool, { signal: lifecycle.signal })).catch(() => undefined);
    register({
      name: "open_protein_project",
      title: "Open protein project",
      description: "Open a Protein Lab project and show its purification workflow tree.",
      inputSchema: { type: "object", properties: { projectId: { type: "string", enum: ["hbb", "vegf"] } }, required: ["projectId"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) { const id = String(input.projectId ?? ""); if (!['hbb','vegf'].includes(id)) throw new Error("Unknown project"); actions.openProject(id); return { projectId: id, view: "workflow" }; },
    });
    register({
      name: "open_protein_job",
      title: "Open protein job",
      description: "Open one scientific job in the current project workspace.",
      inputSchema: { type: "object", properties: { jobId: { type: "string", enum: ["sequence","properties","research","structure","readiness","expression","purification","chromatogram","gel"] } }, required: ["jobId"], additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) { const id = String(input.jobId ?? ""); const allowed = ["sequence","properties","research","structure","readiness","expression","purification","chromatogram","gel"]; if (!allowed.includes(id)) throw new Error("Unknown protein job"); actions.openJob(id); return { jobId: id, view: "job" }; },
    });
    register({
      name: "open_project_notebook",
      title: "Open project notebook",
      description: "Open the editable scientific report for the current protein project.",
      inputSchema: { type: "object", properties: {}, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute() { actions.openNotebook(); return { view: "notebook" }; },
    });
    return () => lifecycle.abort();
  }, [actions]);
}
