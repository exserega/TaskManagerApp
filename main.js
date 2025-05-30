// main.js
const { app, BrowserWindow, Tray, Menu, desktopCapturer, screen, ipcMain, Notification, shell, dialog, nativeImage } = require('electron');
const { autoUpdater } = require("electron-updater");
const path = require('path');
const fs = require('fs');

app.setName("Менеджер Задач Клиента");

const logFilePath = path.join(app.getPath('userData'), 'main-process.log');

function logToFile(message) {
  const timestamp = new Date().toISOString();
  const logMessage = `${timestamp} - ${message}\n`;
  try {
    fs.appendFileSync(logFilePath, logMessage, 'utf8');
    if (typeof message === 'string') {
        console.log(`(Logged to file) ${message}`);
    } else if (message && typeof message === 'object') {
        console.log(`(Logged to file) ${JSON.stringify(message)}`);
    } else if (message) {
        console.log(`(Logged to file) ${String(message)}`);
    }
  } catch (err) {
    console.error('CRITICAL: Failed to write to log file!', err);
    console.error('Original log message was:', message);
  }
}

autoUpdater.logger = {
  info: (message) => { logToFile(`Updater INFO: ${typeof message === 'object' ? JSON.stringify(message) : message}`); console.info('Updater INFO:', message); },
  warn: (message) => { logToFile(`Updater WARN: ${typeof message === 'object' ? JSON.stringify(message) : message}`); console.warn('Updater WARN:', message); },
  error: (message) => { logToFile(`Updater ERROR: ${typeof message === 'object' ? JSON.stringify(message) : message}`); console.error('Updater ERROR:', message); },
  debug: (message) => { logToFile(`Updater DEBUG: ${typeof message === 'object' ? JSON.stringify(message) : message}`); console.debug('Updater DEBUG:', message); }
};
logToFile('autoUpdater.logger configured.');

let mainWindow = null;
let tray = null;
let appIsQuitting = false;
let selectionWindow = null; // Для окна выделения области

logToFile('Main process script started.');

function createWindow () {
  logToFile('createWindow function called.');
  if (mainWindow && !mainWindow.isDestroyed()) {
    logToFile('Main window already exists, showing and focusing.');
    mainWindow.show();
    mainWindow.focus();
    return mainWindow;
  }

  logToFile('Creating new main window.');
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    icon: path.join(process.resourcesPath, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false
    }
  });

  const mainHtmlPath = path.join(__dirname, 'webapp/index.html');
  logToFile(`Loading main window content from: ${mainHtmlPath}`);
  mainWindow.loadFile(mainHtmlPath);

  // mainWindow.webContents.openDevTools();

  mainWindow.on('close', (event) => {
    logToFile(`Main window 'close' event. appIsQuitting: ${appIsQuitting}`);
    if (!appIsQuitting) {
      event.preventDefault();
      mainWindow.hide();
      logToFile('Main window hidden.');
    }
  });

  mainWindow.on('closed', () => {
    logToFile('Main window "closed" event (window destroyed).');
    mainWindow = null;
  });

  logToFile('Main window created.');
  return mainWindow;
}

function createCreateTaskWindow(screenshotInfo = null) {
  logToFile(`createCreateTaskWindow called. Screenshot info provided: ${!!screenshotInfo}`);
  if (screenshotInfo && screenshotInfo.path) {
    logToFile(`Screenshot path: ${screenshotInfo.path}`);
  }

  let createTaskWin = new BrowserWindow({
    width: 800, height: 750,
    parent: (mainWindow && !mainWindow.isDestroyed()) ? mainWindow : null,
    modal: false,
    icon: path.join(process.resourcesPath, 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload-create-task.js'),
      contextIsolation: true, nodeIntegration: false
    }
  });
  const createTaskHtmlPath = path.join(__dirname, 'webapp/create-task.html');
  logToFile(`Loading create-task window content from: ${createTaskHtmlPath}`);
  createTaskWin.loadFile(createTaskHtmlPath);
  createTaskWin.webContents.on('did-finish-load', () => {
    logToFile('Create-task window "did-finish-load" event.');
    if (screenshotInfo && screenshotInfo.name) {
      logToFile(`Sending screenshot data to create-task window for: ${screenshotInfo.name}`);
      createTaskWin.webContents.send('initial-screenshot-data', screenshotInfo);
    } else if (screenshotInfo) {
      logToFile('Sending screenshot data to create-task window (name missing, sending full object for debug):');
      createTaskWin.webContents.send('initial-screenshot-data', screenshotInfo);
    }
  });
  // createTaskWin.webContents.openDevTools();
  createTaskWin.on('closed', () => { logToFile('Create-task window closed.'); createTaskWin = null; });
  logToFile('Create-task window created.');
}

// Функция для запуска процесса выделения области и последующего захвата
function startAreaSelectionAndCapture() {
    logToFile('startAreaSelectionAndCapture called.');
    const primaryDisplay = screen.getPrimaryDisplay();
    const { x, y, width, height } = primaryDisplay.bounds;

    if (selectionWindow && !selectionWindow.isDestroyed()) {
        logToFile('Selection window already exists, focusing.');
        selectionWindow.focus();
        return;
    }

    logToFile(`Creating selection window for display at X:${x}, Y:${y}, W:${width}, H:${height}`);
    selectionWindow = new BrowserWindow({
        x: x,
        y: y,
        width: width,
        height: height,
        frame: false,
        transparent: true,
        alwaysOnTop: true,
        skipTaskbar: true,
        enableLargerThanScreen: true, // Полезно для мультимониторных систем в будущем
        webPreferences: {
            preload: path.join(__dirname, 'preload-selection.js'),
            contextIsolation: true,
            nodeIntegration: false
        }
    });

    selectionWindow.loadFile(path.join(__dirname, 'selection.html'));
    // selectionWindow.webContents.openDevTools(); // Для отладки окна выделения

    selectionWindow.on('closed', () => {
        logToFile('Selection window was closed.');
        selectionWindow = null;
    });
}


ipcMain.on('area-selected', async (event, bounds) => {
    logToFile(`IPC "area-selected" received with original (logical) bounds: ${JSON.stringify(bounds)}`);
    if (selectionWindow && !selectionWindow.isDestroyed()) {
        selectionWindow.close();
        selectionWindow = null;
    }

    if (!bounds || typeof bounds.x !== 'number' || typeof bounds.y !== 'number' || typeof bounds.width !== 'number' || typeof bounds.height !== 'number' || bounds.width <= 0 || bounds.height <= 0) {
        logToFile(`Invalid logical bounds received for area selection: ${JSON.stringify(bounds)}. Aborting screenshot.`);
        return;
    }

    try {
        const primaryDisplay = screen.getPrimaryDisplay();
        const scaleFactor = primaryDisplay.scaleFactor;
        logToFile(`Primary display: ID=${primaryDisplay.id}, Logical Size=${primaryDisplay.size.width}x${primaryDisplay.size.height}, ScaleFactor=${scaleFactor}, Bounds=${JSON.stringify(primaryDisplay.bounds)}`);

        // Рассчитываем физические размеры экрана для запроса thumbnail
        const physicalWidth = Math.floor(primaryDisplay.size.width * scaleFactor);
        const physicalHeight = Math.floor(primaryDisplay.size.height * scaleFactor);

        logToFile(`Requesting desktopCapturer source with thumbnailSize: ${physicalWidth}x${physicalHeight}`);
        const sources = await desktopCapturer.getSources({
            types: ['screen'],
            thumbnailSize: {
                width: physicalWidth,
                height: physicalHeight
            }
            // fetchWindowIcons: false // Можно добавить, если не нужны иконки окон (может немного ускорить)
        });

        if (!sources || sources.length === 0) {
            logToFile('Error: Screen sources not found for area capture!'); return;
        }

        // Попытка найти источник для основного дисплея
        let targetSource = sources.find(source => source.display_id === primaryDisplay.id.toString());
        if (!targetSource && sources.length > 0) {
            // Если display_id не совпал (иногда бывает строкой, иногда числом, или отличается формат)
            // Попробуем найти по имени "Screen 1" или взять первый источник
            logToFile(`Primary display source not found by display_id ("${primaryDisplay.id.toString()}"). Available IDs: ${sources.map(s => s.display_id).join(', ')}. Falling back to other heuristics.`);
            targetSource = sources.find(s => s.name === "Screen 1" || s.name === primaryDisplay.name) || sources[0];
        }
        
        if (!targetSource) {
             logToFile('Error: No target source could be determined after heuristics.'); return;
        }
        if (!targetSource.thumbnail) {
            logToFile(`Error: Could not get thumbnail for the target screen source "${targetSource.name}". Thumbnail object is missing.`); return;
        }

        const fullImage = targetSource.thumbnail; // nativeImage
        const imageSize = fullImage.getSize();
        logToFile(`Target source "${targetSource.name}" thumbnail (fullImage) actual physical size: ${imageSize.width}x${imageSize.height}`);

        if (imageSize.width === 0 || imageSize.height === 0) {
            logToFile('Error: Captured fullImage has zero dimensions. Aborting capture process.');
            return;
        }
        
        // Масштабируем логические координаты выделения (из selection.html) в физические пиксели для обрезки
        const cropBounds = {
            x: Math.floor(bounds.x * scaleFactor),
            y: Math.floor(bounds.y * scaleFactor),
            width: Math.floor(bounds.width * scaleFactor),
            height: Math.floor(bounds.height * scaleFactor)
        };
        logToFile(`Calculated physical cropBounds for cropping: ${JSON.stringify(cropBounds)} (Original logical bounds from selection window: ${JSON.stringify(bounds)})`);

        // Валидация и корректировка физических координат обрезки, чтобы они не выходили за пределы fullImage
        if (cropBounds.x < 0) cropBounds.x = 0;
        if (cropBounds.y < 0) cropBounds.y = 0;
        
        // Проверка, не начинается ли обрезка за пределами изображения
        if (cropBounds.x >= imageSize.width) {
            logToFile(`Error: cropBounds.x (${cropBounds.x}) is at or beyond image width (${imageSize.width}). Aborting crop.`); return;
        }
        if (cropBounds.y >= imageSize.height) {
            logToFile(`Error: cropBounds.y (${cropBounds.y}) is at or beyond image height (${imageSize.height}). Aborting crop.`); return;
        }

        // Корректируем ширину и высоту, если они выходят за пределы изображения
        if (cropBounds.x + cropBounds.width > imageSize.width) {
            cropBounds.width = imageSize.width - cropBounds.x;
            logToFile(`Adjusted crop width to ${cropBounds.width} because it exceeded image width (max physical image width ${imageSize.width})`);
        }
        if (cropBounds.y + cropBounds.height > imageSize.height) {
            cropBounds.height = imageSize.height - cropBounds.y;
            logToFile(`Adjusted crop height to ${cropBounds.height} because it exceeded image height (max physical image height ${imageSize.height})`);
        }

        // Финальная проверка на валидность размеров обрезки
        if (cropBounds.width <= 0 || cropBounds.height <= 0) {
            logToFile(`Error: Calculated crop dimensions are invalid (<=0) after adjustment. Physical W=${cropBounds.width}, H=${cropBounds.height}. Aborting crop.`);
            return;
        }
        
        logToFile(`Attempting to crop image of physical size ${imageSize.width}x${imageSize.height} with final physical bounds: ${JSON.stringify(cropBounds)}`);
        const croppedImage = fullImage.crop(cropBounds);
        const croppedSize = croppedImage.getSize();
        logToFile(`Cropped image to physical W=${croppedSize.width}, H=${croppedSize.height}`);

        if (croppedSize.width === 0 || croppedSize.height === 0) {
            logToFile('Error: Cropped image resulted in zero dimensions. Aborting.');
            return;
        }

        const pngBuffer = croppedImage.toPNG();
        logToFile(`Area screenshot PNG buffer size: ${pngBuffer.length}`);

        const tempDir = app.getPath('temp');
        if (!fs.existsSync(tempDir)) { fs.mkdirSync(tempDir, { recursive: true }); }
        const tempFileName = `screenshot-area-${Date.now()}.png`;
        const tempPath = path.join(tempDir, tempFileName);

        fs.writeFileSync(tempPath, pngBuffer);
        logToFile(`Area screenshot saved to temporary file: ${tempPath}`);

        const screenshotInfo = {
            name: tempFileName, type: 'image/png', path: tempPath,
            dataUrl: `data:image/png;base64,${pngBuffer.toString('base64')}`
        };
        createCreateTaskWindow(screenshotInfo);

    } catch (error) {
        logToFile(`EXCEPTION in area-selected IPC handler: ${error.toString()} | Stack: ${error.stack}`);
        console.error('Exception during processing selected area screenshot:', error);
    }
});

// Обработчик отмены выделения
ipcMain.on('cancel-selection', () => {
    logToFile('IPC "cancel-selection" received.');
    if (selectionWindow && !selectionWindow.isDestroyed()) {
        selectionWindow.close();
        selectionWindow = null;
    }
});


ipcMain.on('delete-temp-file', (event, filePath) => {
  logToFile(`IPC "delete-temp-file" received for path: ${filePath}`);
  if (filePath && typeof filePath === 'string') {
    fs.unlink(filePath, (err) => {
      if (err) {
        logToFile(`ERROR deleting temporary file '${filePath}': ${err.toString()}`);
        console.error(`Error deleting temporary file '${filePath}':`, err);
      } else {
        logToFile(`Temporary file '${filePath}' successfully deleted.`);
      }
    });
  } else {
    logToFile(`IPC "delete-temp-file": Received invalid path: ${filePath}`);
    console.warn('Received invalid path for file deletion:', filePath);
  }
});

ipcMain.on('request-show-notification', (event, data) => {
  logToFile(`IPC "request-show-notification" received with data: ${JSON.stringify(data)}`);
  if (mainWindow && (!mainWindow.isVisible() || !mainWindow.isFocused())) {
    if (Notification.isSupported()) {
      logToFile('Notification is supported, creating notification.');
      const notification = new Notification({
        title: data.title || 'Менеджер Задач Клиента',
        body: data.body || 'Есть новые события.',
        icon: path.join(process.resourcesPath, 'icon.png')
      });
      notification.on('click', () => {
        logToFile('Notification clicked.');
        if (mainWindow) {
          if (!mainWindow.isVisible()) { mainWindow.show(); }
          mainWindow.focus();
        }
      });
      notification.on('close', () => { logToFile('Notification closed.'); });
      notification.on('failed', (err) => { logToFile(`Notification failed to display: ${err ? err.toString() : 'Unknown error'}`); });
      notification.show();
      logToFile('Notification.show() called.');
    } else {
      logToFile('Notifications are not supported on this system.');
    }
  } else {
    logToFile(`Notification not shown. mainWindow exists: ${!!mainWindow}, visible: ${mainWindow ? mainWindow.isVisible() : 'N/A'}, focused: ${mainWindow ? mainWindow.isFocused() : 'N/A'}`);
  }
});

app.whenReady().then(() => {
  logToFile(`App is ready. User data path: ${app.getPath('userData')}`);
  createWindow();

  const menuTemplate = [
    ...(process.platform === 'darwin' ? [{
      label: app.name,
      submenu: [
        { role: 'about', label: `О программе ${app.name}` }, { type: 'separator' },
        { role: 'services', label: 'Службы' }, { type: 'separator' },
        { role: 'hide', label: `Скрыть ${app.name}` }, { role: 'hideOthers', label: 'Скрыть остальные' },
        { role: 'unhide', label: 'Показать все' }, { type: 'separator' },
        { role: 'quit', label: `Выйти из ${app.name}` }
      ]
    }] : []),
    {
      label: 'Файл',
      submenu: [
        { label: 'Создать новую задачу', accelerator: 'CmdOrCtrl+N', click: () => { createCreateTaskWindow(); } },
        { type: 'separator' },
        process.platform === 'darwin' ? { role: 'close', label: 'Закрыть окно' } :
                                         { label: 'Выход', accelerator: 'CmdOrCtrl+Q', click: () => { appIsQuitting = true; app.quit(); }}
      ]
    },
    {
      label: 'Правка',
      submenu: [
        { role: 'undo', label: 'Отменить' }, { role: 'redo', label: 'Повторить' }, { type: 'separator' },
        { role: 'cut', label: 'Вырезать' }, { role: 'copy', label: 'Копировать' }, { role: 'paste', label: 'Вставить' },
        ...(process.platform === 'darwin' ? [
          { role: 'pasteAndMatchStyle', label: 'Вставить и согласовать стиль' },
          { role: 'delete', label: 'Удалить' }, { role: 'selectAll', label: 'Выделить все' }
        ] : [
          { role: 'delete', label: 'Удалить' }, { type: 'separator' }, { role: 'selectAll', label: 'Выделить все' }
        ])
      ]
    },
    {
      label: 'Вид',
      submenu: [
        { role: 'reload', label: 'Перезагрузить' }, { role: 'forceReload', label: 'Принудительно перезагрузить' }, { type: 'separator' },
        { role: 'resetZoom', label: 'Сбросить масштаб' }, { role: 'zoomIn', label: 'Увеличить' }, { role: 'zoomOut', label: 'Уменьшить' },
        { type: 'separator' }, { role: 'togglefullscreen', label: 'Полноэкранный режим' }
      ]
    },
    {
      label: 'Окно',
      submenu: [
        { role: 'minimize', label: 'Свернуть' }, { role: 'zoom', label: 'Масштабировать' },
        ...(process.platform === 'darwin' ? [
          { type: 'separator' }, { role: 'front', label: 'Переместить на передний план' }
        ] : [
          { role: 'close', label: 'Закрыть окно' }
        ])
      ]
    },
    {
      label: 'Помощь',
      submenu: [
        {
          label: 'О программе',
          click: () => {
            const currentWindow = BrowserWindow.getFocusedWindow() || mainWindow;
            if (currentWindow && !currentWindow.isDestroyed()) {
                dialog.showMessageBox(currentWindow, {
                    type: 'info', title: `О программе ${app.name}`, message: `${app.name}`,
                    detail: `Версия: ${app.getVersion()}\n\nЭто приложение для управления задачами клиентов и сотрудников.`
                });
            } else {
                dialog.showMessageBox(null, {
                    type: 'info', title: `О программе ${app.name}`, message: `${app.name}`,
                    detail: `Версия: ${app.getVersion()}\n\nЭто приложение для управления задачами клиентов и сотрудников.`
                });
            }
          }
        }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(menuTemplate);
  Menu.setApplicationMenu(menu);
  logToFile('Application menu created and set.');

  logToFile('Attempting to create tray icon...');
  const iconPathTray = path.join(process.resourcesPath, 'icon.png');
  logToFile(`Calculated icon path for tray: ${iconPathTray}`);
  logToFile(`Checking if icon file exists at path (using fs.existsSync for tray): ${fs.existsSync(iconPathTray)}`);
  let trayIconObject = null;
  try {
    logToFile(`Attempting to create nativeImage from path for tray: ${iconPathTray}`);
    const image = nativeImage.createFromPath(iconPathTray);
    if (image.isEmpty()) {
      logToFile(`ERROR: nativeImage.createFromPath for tray ('${iconPathTray}') returned an empty image.`);
    } else {
      logToFile(`SUCCESS: nativeImage.createFromPath for tray ('${iconPathTray}') created a non-empty image.`);
      trayIconObject = image;
    }
  } catch (e) {
      logToFile(`ERROR during nativeImage.createFromPath for tray: ${e.toString()}`);
  }

  if (trayIconObject && !trayIconObject.isEmpty()) {
    try {
      tray = new Tray(trayIconObject);
      logToFile('Tray object created successfully using NativeImage.');
      const contextMenu = Menu.buildFromTemplate([
        { label: 'Открыть приложение', click: () => { logToFile('Tray Menu: Open App clicked.'); if (mainWindow && mainWindow.isDestroyed()) {createWindow()} else if(mainWindow) {mainWindow.show(); mainWindow.focus();} else {createWindow(); } } },
        { label: 'Создать новую задачу', click: () => { logToFile('Tray Menu: Create New Task clicked.'); createCreateTaskWindow(); } },
        { label: 'Создать задачу (скриншот)', click: () => { logToFile('Tray Menu: Create Task with Screenshot clicked.'); startAreaSelectionAndCapture(); }}, // <--- ИЗМЕНЕНО ЗДЕСЬ
        { type: 'separator' },
        { label: 'Выход', click: () => { logToFile('Tray Menu: Exit clicked.'); appIsQuitting = true; app.quit(); } }
      ]);
      tray.setToolTip('Менеджер Задач Клиента');
      tray.setContextMenu(contextMenu);
      tray.on('click', () => {
        logToFile('Tray icon direct click.');
        if (mainWindow && !mainWindow.isDestroyed()) {
            if (mainWindow.isVisible() && !mainWindow.isMinimized()) {
               logToFile('Main window visible and not minimized, focusing.');
               mainWindow.focus();
            } else {
              logToFile('Main window hidden or minimized, showing and focusing.');
              mainWindow.show();
              mainWindow.focus();
            }
        } else {
            logToFile('Main window does not exist or destroyed, creating new.');
            createWindow();
        }
      });
      logToFile('Tray setup complete.');
    } catch (error) {
        logToFile(`ERROR creating Tray object from NativeImage: ${error.toString()} | Stack: ${error.stack}`);
        console.error("Error creating Tray object from NativeImage:", error);
    }
  } else {
      logToFile('Failed to create a valid NativeImage for tray. Tray icon not shown.');
  }

  logToFile('Initializing auto-updater system.');

  autoUpdater.checkForUpdatesAndNotify()
    .then(updateCheckResult => {
      if (updateCheckResult && updateCheckResult.updateInfo) {
        logToFile(`Initial update check result: version ${updateCheckResult.updateInfo.version} available.`);
      } else {
        logToFile('Initial update check: No update available or no result from checkForUpdatesAndNotify.');
      }
    })
    .catch(err => {
      logToFile(`Error in initial checkForUpdatesAndNotify: ${err == null ? "null" : (err.stack || err).toString()}`);
    });

  setInterval(() => {
    logToFile('Inside setInterval (hourly): Triggering autoUpdater.checkForUpdates().'); // Добавил hourly для ясности в логах
    autoUpdater.checkForUpdates(); 
  }, 60 * 60 * 1000);

  autoUpdater.on('checking-for-update', () => { logToFile('Updater Event: checking-for-update'); });
  autoUpdater.on('update-available', (info) => { logToFile('Updater Event: update-available. Info: ' + JSON.stringify(info)); });
  autoUpdater.on('update-not-available', (info) => { logToFile('Updater Event: update-not-available. Info: ' + JSON.stringify(info)); });
  autoUpdater.on('error', (err) => { logToFile('Updater Event: error. Error: ' + (err == null ? "null" : (err.stack || err).toString())); });
  autoUpdater.on('download-progress', (progressObj) => {
    let log_message = `Updater Event: download-progress. Speed: ${progressObj.bytesPerSecond} B/s. Downloaded ${progressObj.percent}% (${progressObj.transferred}/${progressObj.total})`;
    logToFile(log_message);
    if (mainWindow && !mainWindow.isDestroyed() && mainWindow.webContents) {
      mainWindow.webContents.send('download-progress', { percent: Math.round(progressObj.percent) });
    }
  });
  autoUpdater.on('update-downloaded', (info) => {
    logToFile('Updater Event: update-downloaded. Info: ' + JSON.stringify(info));
    const currentWin = BrowserWindow.getFocusedWindow() || mainWindow;
    if (currentWin && !currentWin.isDestroyed()){
        dialog.showMessageBox(currentWin, {
            type: 'info',
            buttons: ['Перезапустить сейчас', 'Позже'],
            title: 'Доступно обновление',
            message: `Новая версия ${info.version} загружена.`,
            detail: 'Перезапустите приложение, чтобы применить изменения.'
        }).then((returnValue) => {
            if (returnValue.response === 0) {
                logToFile('User chose to restart and install update.');
                appIsQuitting = true;
                autoUpdater.quitAndInstall();
            } else {
                logToFile('User chose to install update later.');
            }
        }).catch(err => {
            logToFile(`Error showing update downloaded dialog: ${err.toString()}`);
        });
    } else {
        logToFile('No suitable window to show update downloaded dialog.');
    }
  });

  app.on('activate', function () {
    logToFile('App "activate" event triggered.');
    if (BrowserWindow.getAllWindows().length === 0 || (mainWindow && mainWindow.isDestroyed())) {
        createWindow();
    } else if (mainWindow) {
        mainWindow.show();
        mainWindow.focus();
    }
  });
});

app.on('window-all-closed', function () {
  logToFile(`Event: window-all-closed. AppIsQuitting: ${appIsQuitting}`);
  if (process.platform !== 'darwin' && appIsQuitting) {
    app.quit();
  } else if (process.platform !== 'darwin' && !appIsQuitting) {
    logToFile("All windows potentially hidden/closed (not macOS), app remains in tray if tray exists.");
  }
});

app.on('before-quit', () => {
  logToFile('Event: before-quit. Setting appIsQuitting to true.');
  appIsQuitting = true;
});