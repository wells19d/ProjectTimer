const { app, BrowserWindow, ipcMain, dialog, shell, screen, Menu } = require('electron');
const path = require('node:path');
const { TimerStore } = require('./store');
const { createHeartbeat, createCloseGuard } = require('./save-lifecycle');
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

    app.setAboutPanelOptions({
      applicationName: 'Project Timer', applicationVersion: app.getVersion(),
      credits: 'Stores project data locally and works offline.'
    });

    Menu.setApplicationMenu(Menu.buildFromTemplate([
      { label: 'Project Timer', submenu: [{ role: 'about' }, { type: 'separator' }, { role: 'quit' }] },
      { role: 'editMenu' },
      { role: 'viewMenu' },
      {
        label: 'Support',
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
          {
            label: 'Report a Problem…',
            click: async () => {
              try {
                await shell.openExternal('https://github.com/wells19d/ProjectTimer/issues');
              } catch (error) {
                dialog.showErrorBox('Could not open GitHub', error.message);
              }
            }
          }
        ]
      },
      {
        role: 'windowMenu',
        submenu: [
          {
            label: 'Always on Top',
            type: 'checkbox',
            checked: false,
            click: item => {
              if (window && !window.isDestroyed()) window.setAlwaysOnTop(item.checked);
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

    const initialHeight = 388;
    window = new BrowserWindow({
      width: 540, height: initialHeight, minWidth: 430, minHeight: 220,
      title: 'Project Timer', backgroundColor: '#202321',
      webPreferences: {
        preload: path.join(__dirname, 'preload.js'),
        contextIsolation: true, nodeIntegration: false, sandbox: true
      }
    });
    const autoSize = createAutoSizer(window, screen, { minimumHeight: initialHeight });
    window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.loadFile(path.join(__dirname, 'index.html'));

    heartbeat = createHeartbeat({
      store,
      report: message => {
        if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('timer:save-status', message);
      }
    });
    const closeGuard = createCloseGuard({
      save: () => store.stopAll(),
      pause: () => heartbeat.pause(),
      resume: () => heartbeat.resume(),
      finish: () => app.quit(),
      reportError: error => dialog.showErrorBox('Could not save timers', `${error.message}\n\nThe app will stay open. Fix the disk or folder permissions and try closing again.`)
    });
    window.on('close', closeGuard.handle);
    app.on('before-quit', closeGuard.handle);
    app.on('window-all-closed', () => app.quit());
    app.on('will-quit', () => heartbeat.dispose());

    const trusted = event => event.sender === window.webContents && event.senderFrame === window.webContents.mainFrame;
    const handle = (channel, callback) => ipcMain.handle(channel, async (event, ...args) => {
      if (!trusted(event)) {
        throw new Error('Invalid request source.');
      }
      try {
        if (closeGuard.isClosing()) throw new Error('The app is closing. Please wait for the final save.');
        const value = await callback(...args);
        heartbeat.sync();
        return { ok: true, value };
      }
      catch (error) { return { ok: false, error: error.message }; }
    });

    handle('timer:load', async () => {
      await store.flush();
      return { ...store.snapshot(), recovered: store.recovered, dataFile: store.file };
    });
    handle('timer:create', name => store.create(name));
    handle('timer:update', (id, action, value) => {
      if (action === 'delete') throw new Error('Use the confirmed delete action.');
      return store.update(id, action, value);
    });
    handle('timer:edit-session', (id, index, changes) => store.editSession(id, index, changes));
    handle('timer:add-session', (id, times) => store.addSession(id, times));
    handle('timer:delete-session', (id, index) => store.deleteSession(id, index));
    handle('timer:delete', id => store.update(id, 'delete'));
    handle('timer:show-data', () => { shell.showItemInFolder(store.file); });
    handle('timer:resize', autoSize);

    heartbeat.sync();
  }).catch(error => {
    dialog.showErrorBox('Project Timer could not start', error.message);
    app.quit();
  });
}
