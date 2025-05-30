// preload.js (для mainWindow)
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronApp', {
  sendNotificationRequest: (data) => { // data может быть объектом { title, body } или просто сигналом
    ipcRenderer.send('request-show-notification', data);
  }
});

console.log('Preload script for mainWindow loaded and "electronApp" API exposed.');