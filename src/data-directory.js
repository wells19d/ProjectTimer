const path = require('node:path');

// The project and the installed app each own their data folder. No development
// path is embedded in the installed runtime.
function resolveDataDirectory({ appDirectory, override }) {
  return override ? path.resolve(override) : path.join(appDirectory, 'data');
}

module.exports = { resolveDataDirectory };
