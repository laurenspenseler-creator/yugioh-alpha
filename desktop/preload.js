'use strict'
// The "Mit Handy verbinden" window may only ask the main process for the
// sharing state, switch it, and copy a text; it has no other access.
const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('phone', {
  get: () => ipcRenderer.invoke('phone:get'),
  set: enabled => ipcRenderer.invoke('phone:set', enabled === true),
  copy: text => ipcRenderer.invoke('phone:copy', String(text)),
})
