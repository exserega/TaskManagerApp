// preload-create-task.js
const { contextBridge, ipcRenderer } = require('electron');

// fs и path больше не нужны здесь

contextBridge.exposeInMainWorld('electronAPI', {
    getInitialScreenshotData: () => {
        return new Promise((resolve) => {
            ipcRenderer.once('initial-screenshot-data', (event, screenshotInfo) => {
                // screenshotInfo теперь это объект { name, type, path, dataUrl }
                console.log('Preload (create-task): Received IPC "initial-screenshot-data" with info:', screenshotInfo);
                if (screenshotInfo && screenshotInfo.dataUrl && screenshotInfo.name && screenshotInfo.type && screenshotInfo.path) {
                    resolve(screenshotInfo);
                } else {
                    console.warn('Preload (create-task): Received incomplete or no screenshotInfo via IPC.');
                    resolve(null); 
                }
            });
        });
    },
    deleteFile: (filePath) => {
        if (filePath && typeof filePath === 'string') {
            ipcRenderer.send('delete-temp-file', filePath); 
        } else {
            console.warn('Preload (deleteFile): Invalid filePath provided:', filePath);
        }
    }
});

console.log('Preload script (preload-create-task.js) loaded and API exposed. Ready to receive screenshot data.');