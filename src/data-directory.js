const fs = require('node:fs');
const path = require('node:path');

function resolveDataDirectory({ appDirectory, packaged, override }) {
  if (override) return path.resolve(override);
  const configFile = path.join(appDirectory, 'desktop-config.json');
  // A manually packaged Electron executable can still report isPackaged=false.
  // Our build configuration is the authoritative marker for a desktop build.
  if (!packaged && !fs.existsSync(configFile)) return path.join(appDirectory, 'data');
  // The personal desktop build points to the same external JSON folder as the
  // development app. Never write inside the signed application bundle.
  const config = JSON.parse(fs.readFileSync(configFile, 'utf8'));
  if (typeof config.dataDirectory !== 'string' || !path.isAbsolute(config.dataDirectory)) {
    throw new Error('The desktop build needs an absolute dataDirectory in desktop-config.json. Rebuild with yarn build:mac.');
  }
  return config.dataDirectory;
}

module.exports = { resolveDataDirectory };
