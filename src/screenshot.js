const fs = require('node:fs/promises');
const path = require('node:path');

async function saveScreenshot({ window, dialog, defaultDirectory, timeoutMs = 8000 }) {
  if (!window || window.isDestroyed()) throw new Error('Open Project Timer before saving a screenshot.');
  let timer;
  let image;
  // Capture the real, visible app contents before opening the native save sheet.
  try {
    image = await Promise.race([
      window.webContents.capturePage(),
      new Promise((_resolve, reject) => {
        timer = setTimeout(() => reject(new Error('The screenshot took too long. Please try again.')), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timer);
  }
  if (image.isEmpty()) throw new Error('The window could not be captured. Please try again.');
  const png = image.toPNG();
  const stamp = new Date().toLocaleString('sv-SE').replaceAll(':', '-');
  const { canceled, filePath } = await dialog.showSaveDialog(window, {
    title: 'Save Screenshot',
    defaultPath: path.join(defaultDirectory, `Project Timer ${stamp}.png`),
    buttonLabel: 'Save Screenshot',
    filters: [{ name: 'PNG image', extensions: ['png'] }],
    properties: ['createDirectory', 'showOverwriteConfirmation']
  });
  if (canceled || !filePath) return null;
  const destination = /\.png$/i.test(filePath) ? filePath : `${filePath}.png`;
  await fs.writeFile(destination, png);
  return destination;
}

module.exports = { saveScreenshot };
