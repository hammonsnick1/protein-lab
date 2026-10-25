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

export function useProteinLabsWebMcp(actions: { openProject: (id: string) => void; openJob: (id: string) => void; openNotebook: () => void; openLibrary: (tab: "vectors" | "proteins") => void }) {
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
    register({
      name: "open_vector_and_protein_library",
      title: "Open vector and protein library",
      description: "Open the vector and protein library on its Vectors or Proteins tab, where saved vectors and purified proteins are browsed and searched.",
      inputSchema: { type: "object", properties: { tab: { type: "string", enum: ["vectors", "proteins"] } }, additionalProperties: false },
      annotations: { readOnlyHint: true, untrustedContentHint: false },
      execute(input) { const tab = input.tab ?? "vectors"; if (tab !== "vectors" && tab !== "proteins") throw new Error("Unknown library tab"); actions.openLibrary(tab); return { tab, view: "library" }; },
    });
    return () => lifecycle.abort();
  }, [actions]);
}
