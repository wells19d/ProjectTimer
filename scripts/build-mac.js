const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const { installMacApp } = require('./install-mac');
const { buildIcon } = require('./build-icon');

// Personal, offline macOS packaging using the runtime already installed by Yarn.
// Electron's manual packaging format: Contents/Resources/app/package.json.
function build() {
  if (process.platform !== 'darwin') throw new Error('Run this build on your Mac.');
  const root = path.resolve(__dirname, '..');
  const manifest = require(path.join(root, 'package.json'));
  const runtime = path.dirname(require.resolve('electron/package.json'));
  const template = path.join(runtime, 'dist', 'Electron.app');
  if (!fs.existsSync(template)) throw new Error('Electron is not installed. Run yarn install first.');
  const output = path.join(root, 'dist');
  fs.mkdirSync(output, { recursive: true });
  const staging = fs.mkdtempSync(path.join(output, '.build-'));
  const bundle = path.join(staging, 'Project Timer.app');
  const destination = path.join(output, 'Project Timer.app');
  const plistTool = '/usr/libexec/PlistBuddy';
  const plist = (file, command) => execFileSync(plistTool, ['-c', command, file], { encoding: 'utf8' }).trim();

  try {
    console.log('Preparing the Project Timer icon…');
    const icon = buildIcon(root);
    console.log('Copying the installed Electron runtime…');
    execFileSync('/usr/bin/ditto', [template, bundle]);
    const contents = path.join(bundle, 'Contents');
    const resources = path.join(contents, 'Resources');
    const appDirectory = path.join(resources, 'app');
    fs.mkdirSync(appDirectory);
    fs.cpSync(path.join(root, 'src'), path.join(appDirectory, 'src'), { recursive: true });
    fs.mkdirSync(path.join(appDirectory, 'assets'));
    fs.copyFileSync(path.join(root, 'assets', 'project-timer.png'), path.join(appDirectory, 'assets', 'project-timer.png'));
    fs.copyFileSync(icon, path.join(resources, 'project-timer.icns'));
    fs.writeFileSync(path.join(appDirectory, 'package.json'), JSON.stringify({
      name: manifest.name, productName: manifest.productName, version: manifest.version,
      description: manifest.description, main: manifest.main
    }, null, 2) + '\n');
    const dataDirectory = path.resolve(process.env.PROJECT_TIMER_DATA_DIR || path.join(root, 'data'));
    fs.writeFileSync(path.join(appDirectory, 'desktop-config.json'), JSON.stringify({ dataDirectory }, null, 2) + '\n');
    fs.rmSync(path.join(resources, 'default_app.asar'), { force: true });
    for (const license of ['LICENSE', 'LICENSES.chromium.html']) {
      fs.copyFileSync(path.join(runtime, 'dist', license), path.join(resources, license));
    }

    const info = path.join(contents, 'Info.plist');
    plist(info, 'Set :CFBundleDisplayName Project Timer');
    plist(info, 'Set :CFBundleName Project Timer');
    fs.renameSync(path.join(contents, 'MacOS', 'Electron'), path.join(contents, 'MacOS', 'Project Timer'));
    plist(info, 'Set :CFBundleExecutable Project Timer');
    plist(info, 'Set :CFBundleIconFile project-timer.icns');
    plist(info, 'Set :CFBundleIdentifier local.projecttimer.desktop');
    plist(info, `Set :CFBundleShortVersionString ${manifest.version}`);
    plist(info, `Set :CFBundleVersion ${manifest.version}`);
    plist(info, 'Set :LSApplicationCategoryType public.app-category.productivity');
    plist(info, 'Delete :ElectronAsarIntegrity');
    const frameworks = path.join(contents, 'Frameworks');
    for (const helper of fs.readdirSync(frameworks).filter(name => name.endsWith('.app'))) {
      const helperInfo = path.join(frameworks, helper, 'Contents', 'Info.plist');
      const identifier = plist(helperInfo, 'Print :CFBundleIdentifier');
      plist(helperInfo, `Set :CFBundleIdentifier ${identifier.replace('com.github.Electron', 'local.projecttimer.desktop')}`);
      const name = plist(helperInfo, 'Print :CFBundleName');
      plist(helperInfo, `Set :CFBundleName ${name.replace('Electron', 'Project Timer')}`);
    }

    console.log('Signing the local app…');
    execFileSync('/usr/bin/xattr', ['-cr', bundle]);
    execFileSync('/usr/bin/codesign', ['--force', '--deep', '--sign', '-', bundle], { stdio: 'pipe' });
    execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', bundle], { stdio: 'pipe' });

    // Replace only this generated artifact after the staged build is complete.
    // No source, node_modules, or user time data is copied or removed here.
    fs.rmSync(destination, { recursive: true, force: true });
    fs.renameSync(bundle, destination);
    console.log(`\nBuilt: ${destination}\nData stays in: ${dataDirectory}`);
    if (process.argv.includes('--package-only')) {
      console.log('Installation skipped (--package-only).');
    } else {
      console.log('Installing in Applications…');
      try {
        const installed = installMacApp(destination);
        console.log(`Ready: ${installed}\nOpen Project Timer from Applications or Spotlight. You can also add it to the Dock.`);
      } catch (error) {
        throw new Error(`The app was built successfully, but installation failed: ${error.message}\nYour built app is still available at ${destination}. If Applications is not writable, move it there in Finder.`);
      }
    }
  } finally {
    fs.rmSync(staging, { recursive: true, force: true });
  }
}

try { build(); }
catch (error) {
  console.error(`Build failed: ${error.message}`);
  process.exitCode = 1;
}
