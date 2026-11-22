const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu } = require('electron');
const path = require('node:path');
const { TimerStore } = require('./store');
const { createAutoSizer } = require('./window-sizing');
const { resolveDataDirectory } = require('./data-directory');
const { saveScreenshot } = require('./screenshot');

let window;
let store;
let heartbeat;
let dataDirectory;
app.setName('Project Timer');

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (window) {
      if (window.isMinimized()) window.restore();
      window.show();
      window.focus();
    }
  });

  app.whenReady().then(() => {
    if (process.platform === 'darwin' && !app.isPackaged) {
      app.dock.setIcon(path.join(app.getAppPath(), 'assets', 'project-timer.png'));
    }
    try {
      dataDirectory = resolveDataDirectory({
        appDirectory: app.getAppPath(), packaged: app.isPackaged,
        override: process.env.PROJECT_TIMER_DATA_DIR
      });
      store = new TimerStore(dataDirectory);
    } catch (error) {
      dialog.showErrorBox('Could not open timer data', `${error.message}\n\nYour existing file has been left in place. Correct it while the app is closed, then reopen.\n\n${dataDirectory ? path.join(dataDirectory, 'projects.json') : 'Check the desktop build configuration.'}`);
      app.quit();
      return;
    }

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Project Timer', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Window',
        submenu: [
          {
            label: 'Save Screenshot…',
            accelerator: 'CmdOrCtrl+Shift+S',
            click: async item => {
              item.enabled = false;
              try {
                await saveScreenshot({ window, dialog, defaultDirectory: app.getPath('desktop') });
              } catch (error) {
                dialog.showErrorBox('Could not save screenshot', error.message);
              } finally {
                item.enabled = true;
              }
            }
          },
          { type: 'separator' },
          { role: 'minimize' },
          { role: 'zoom' },
          { type: 'separator' },
          { role: 'front' }
        ]
      }
    ]));

    window = new BrowserWindow({
      width: 490, height: 310, minWidth: 430, minHeight: 220,
      title: 'Project Timer', backgroundColor: '#202321',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    const autoSize = createAutoSizer(window, screen);
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.loadFile(path.join(__dirname, 'index.html'));

    function saveBeforeClose(event) {
      try { store.stopAll(); }
      catch (error) {
        event.preventDefault();
        dialog.showErrorBox('Could not save timers', `${error.message}\n\nThe app will stay open. Fix the disk or folder permissions and try closing again.`);
      }
    }
    window.on('close', saveBeforeClose);
    app.on('before-quit', saveBeforeClose);
    app.on('window-all-closed', () => app.quit());
    app.on('will-quit', () => clearInterval(heartbeat));

    const handle = (channel, callback) => ipcMain.handle(channel, (event, ...args) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Invalid request source.');
      }
      try { return { ok: true, value: callback(...args) }; }
      catch (error) { return { ok: false, error: error.message }; }
    });

    handle('timer:load', () => ({ ...store.snapshot(), recovered: store.recovered, dataFile: store.file }));
    handle('timer:create', name => store.create(name));
    handle('timer:update', (id, action, value) => {
      if (action === 'delete') throw new Error('Use the confirmed delete action.');
      return store.update(id, action, value);
    });
    ipcMain.handle('timer:delete', async (event, id) => {
      if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame) return { ok: false, error: 'Invalid request source.' };
      try {
        const project = store.snapshot().projects.find(item => item.id === id);
        if (!project) throw new Error('This project no longer exists.');
        const { response } = await dialog.showMessageBox(window, {
          type: 'warning', title: 'Delete project?',
          message: `Delete “${project.name}”?`,
          detail: 'This permanently deletes the project and all of its time blocks.',
          buttons: ['No', 'Yes, delete'], defaultId: 0, cancelId: 0, noLink: true
        });
        return { ok: true, value: response === 1 ? store.update(id, 'delete') : store.snapshot() };
      } catch (error) { return { ok: false, error: error.message }; }
    });
    handle('timer:show-data', () => { shell.showItemInFolder(store.file); });
    handle('timer:resize', autoSize);

    heartbeat = setInterval(() => {
      try {
        store.heartbeat();
        window.webContents.send('timer:save-status', null);
      } catch (error) {
        window.webContents.send('timer:save-status', `Autosave failed: ${error.message}. Your crash-recovery timestamp is not updating.`);
      }
    }, 5000);
  }).catch(error => {
    dialog.showErrorBox('Project Timer could not start', error.message);
    app.quit();
  });
}
