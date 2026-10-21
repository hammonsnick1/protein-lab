// The only desktop capabilities the sandboxed page can reach. Each call is a
// fixed request to the main process; the page never gets Node or file access.
const { contextBridge, ipcRenderer } = require("electron");

contextBridge.exposeInMainWorld("proteinLabDesktop", {
  getProjectDirectory: () => ipcRenderer.invoke("project-directory:get"),
  chooseProjectDirectory: () => ipcRenderer.invoke("project-directory:choose"),
  openProjectDirectory: () => ipcRenderer.invoke("project-directory:open"),
});
