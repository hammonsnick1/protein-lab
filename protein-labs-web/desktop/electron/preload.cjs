const { contextBridge, ipcRenderer } = require("electron");

/**
 * The only bridge the renderer gets.
 *
 * The report needs a real PDF writer and a save dialog, both of which live in
 * the main process. Nothing else is exposed: the renderer still talks to the
 * local engine over HTTP, and there is no file-system or shell surface here.
 */
contextBridge.exposeInMainWorld("proteinLabsDesktop", {
  version: 1,
  exportReportPdf: (request) => ipcRenderer.invoke("report:export-pdf", request),
});
