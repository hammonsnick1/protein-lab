/**
 * The desktop capabilities the web UI can use when it is running inside the
 * Electron shell. Everything here degrades: in a browser the bridge is absent
 * and the caller falls back to a download.
 */

export type PdfExportRequest = {
  html: string;
  filename: string;
  header: string;
  footer: string;
};

export type PdfExportResult =
  | { ok: true; path: string; bytes: number }
  | { ok: false; cancelled?: boolean; reason?: string };

export type DesktopBridge = {
  version: number;
  exportReportPdf: (request: PdfExportRequest) => Promise<PdfExportResult>;
};

export function desktopBridge(): DesktopBridge | null {
  if (typeof window === "undefined") return null;
  const bridge = (window as unknown as { proteinLabsDesktop?: DesktopBridge }).proteinLabsDesktop;
  return bridge && typeof bridge.exportReportPdf === "function" ? bridge : null;
}
