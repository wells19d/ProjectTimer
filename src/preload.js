const { contextBridge, ipcRenderer } = require('electron');

async function invoke(channel, ...args) {
  const result = await ipcRenderer.invoke(channel, ...args);
  if (!result.ok) throw new Error(result.error);
  return result.value;
}

contextBridge.exposeInMainWorld('timer', {
  load: () => invoke('timer:load'),
  create: name => invoke('timer:create', name),
  update: (id, action, value) => invoke('timer:update', id, action, value),
  delete: id => invoke('timer:delete', id),
  editSession: (id, index, changes) => invoke('timer:edit-session', id, index, changes),
  addSession: (id, times) => invoke('timer:add-session', id, times),
  deleteSession: (id, index) => invoke('timer:delete-session', id, index),
  showData: () => invoke('timer:show-data'),
  resize: height => invoke('timer:resize', height),
  onSaveStatus: callback => ipcRenderer.on('timer:save-status', (_event, message) => callback(message))
});
