// Data format versions are independent of the app's package.json version.
const CURRENT_DATA_VERSION = 1;

// Add an explicit N -> N+1 conversion here when the format changes, then raise
// CURRENT_DATA_VERSION. App version 1.0.1 does not change the data format.
const MIGRATIONS = Object.freeze({});

function migrateData(input, { targetVersion = CURRENT_DATA_VERSION, migrations = MIGRATIONS } = {}) {
  if (!input || !Number.isSafeInteger(input.version) || input.version < 1) {
    throw new Error('The project data needs a valid format version.');
  }
  if (!Number.isSafeInteger(targetVersion) || targetVersion < 1) throw new Error('Invalid target data version.');
  if (input.version > targetVersion) {
    throw new Error(`Data version ${input.version} is newer than this app supports (${targetVersion}). The data has not been replaced.`);
  }
  let data = structuredClone(input);
  while (data.version < targetVersion) {
    const version = data.version;
    const migrate = migrations[version];
    if (typeof migrate !== 'function') {
      throw new Error(`No data migration from version ${version} to ${version + 1} is available. The data has not been replaced.`);
    }
    const converted = migrate(data);
    if (!converted || typeof converted !== 'object' || Array.isArray(converted)) throw new Error(`Data migration from version ${version} failed.`);
    data = { ...converted, version: version + 1 };
  }
  return data;
}

module.exports = { CURRENT_DATA_VERSION, migrateData };
