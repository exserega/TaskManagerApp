
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronSelectionAPI', {
  sendSelection: (bounds) => ipcRenderer.send('area-selected', bounds),
  cancelSelection: () => ipcRenderer.send('cancel-selection')
});
console.log('Preload script for selectionWindow loaded and "electronSelectionAPI" exposed.');