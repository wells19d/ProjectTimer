const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

// Package the approved PNG into macOS's standard multi-resolution icon format.
// These are size conversions only; the generated artwork and alpha are preserved.
function buildIcon(root) {
  if (process.platform !== 'darwin') throw new Error('Mac icon conversion must run on macOS.');
  const source = path.join(root, 'assets', 'project-timer.png');
  const destination = path.join(root, 'assets', 'project-timer.icns');
  const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'project-timer-icon-'));
  const iconset = path.join(temporary, 'ProjectTimer.iconset');
  fs.mkdirSync(iconset);
  try {
    const chunks = [];
    const types = { 16: ['icp4', 'ic11'], 32: ['icp5', 'ic12'], 128: ['ic07', 'ic13'], 256: ['ic08', 'ic14'], 512: ['ic09', 'ic10'] };
    for (const size of [16, 32, 128, 256, 512]) {
      for (const scale of [1, 2]) {
        const pixels = String(size * scale);
        const filename = `icon_${size}x${size}${scale === 2 ? '@2x' : ''}.png`;
        execFileSync('/usr/bin/sips', ['-z', pixels, pixels, source, '--out', path.join(iconset, filename)], { stdio: 'pipe' });
        const png = fs.readFileSync(path.join(iconset, filename));
        const header = Buffer.alloc(8);
        header.write(types[size][scale - 1], 0, 'ascii');
        header.writeUInt32BE(png.length + 8, 4);
        chunks.push(header, png);
      }
    }
    // ICNS is a length-prefixed container of PNG representations. Write that
    // container directly; iconutil's encoder can reject valid sets in headless
    // environments. No image pixels are changed here.
    const header = Buffer.alloc(8);
    header.write('icns', 0, 'ascii');
    header.writeUInt32BE(8 + chunks.reduce((total, chunk) => total + chunk.length, 0), 4);
    const converted = path.join(temporary, 'project-timer.icns');
    fs.writeFileSync(converted, Buffer.concat([header, ...chunks]));
    fs.copyFileSync(converted, destination);
    return destination;
  } finally {
    fs.rmSync(temporary, { recursive: true, force: true });
  }
}

if (require.main === module) {
  try { console.log(`Created ${buildIcon(path.resolve(__dirname, '..'))}`); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}

module.exports = { buildIcon };
