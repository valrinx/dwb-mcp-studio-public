import { access, copyFile, mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run, xml } from './common.mjs';

if (process.platform !== 'darwin') throw new Error('Build this app on macOS.');
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 16))
  throw new Error('Install Node.js 22.16 or newer with npm.');
const root = fileURLToPath(new URL('../../', import.meta.url));
await run('/usr/bin/xcrun', ['--find', 'swiftc']).catch(() => {
  throw new Error(
    'Install Apple Command Line Tools with xcode-select --install, then run this installer again.',
  );
});
const app = resolve(root, 'N3zuui Studio.app');
const stage = resolve(root, `N3zuui Studio-${randomUUID()}.app`);
const contents = resolve(stage, 'Contents');
await mkdir(resolve(contents, 'MacOS'), { recursive: true });
await mkdir(resolve(contents, 'Resources'), { recursive: true });
try {
  const arch = { arm64: 'arm64', x64: 'x86_64' }[process.arch];
  if (!arch) throw new Error('This build supports Apple Silicon and Intel Macs.');
  console.log('Building N3zuui Studio for ' + arch + '…');
  await run(
    '/usr/bin/xcrun',
    [
      'swiftc',
      '-swift-version',
      '5',
      '-target',
      `${arch}-apple-macos13.0`,
      '-O',
      '-framework',
      'AppKit',
      '-framework',
      'WebKit',
      '-framework',
      'Security',
      resolve(root, 'scripts/macos/N3zuuiStudio.swift'),
      '-o',
      resolve(contents, 'MacOS/N3zuuiStudio'),
    ],
    { timeout: 300000 },
  );
  const pkg = JSON.parse(await readFile(resolve(root, 'package.json'), 'utf8'));
  await writeFile(
    resolve(contents, 'Resources/runtime.json'),
    JSON.stringify({ node: process.execPath }),
  );
  await copyFile(
    resolve(root, 'assets/n3zuui-logo.png'),
    resolve(contents, 'Resources/n3zuui-logo.png'),
  );
  await writeFile(
    resolve(contents, 'Info.plist'),
    `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>CFBundleExecutable</key><string>N3zuuiStudio</string><key>CFBundleIdentifier</key><string>com.n3zuui.mcp-studio.mac</string><key>CFBundleName</key><string>N3zuui Studio</string><key>CFBundlePackageType</key><string>APPL</string><key>CFBundleVersion</key><string>1</string><key>CFBundleShortVersionString</key><string>${xml(pkg.version)}</string><key>LSMinimumSystemVersion</key><string>13.0</string><key>NSHighResolutionCapable</key><true/><key>NSAppTransportSecurity</key><dict><key>NSAllowsLocalNetworking</key><true/></dict></dict></plist>`,
  );
  await run('/usr/bin/codesign', ['--force', '--sign', '-', stage]);
  // Never replace a running app. Keep the previous build as a recoverable backup.
  const running = await run('/bin/ps', ['-ax', '-o', 'command=']);
  if (
    running.split('\n').some((line) => line.trim().startsWith(app + '/Contents/MacOS/N3zuuiStudio'))
  )
    throw new Error('Quit N3zuui Studio before rebuilding it.');
  let backup;
  try {
    await access(app);
    backup = app + `.previous-${randomUUID()}`;
    await rename(app, backup);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  try {
    await rename(stage, app);
  } catch (error) {
    if (backup) await rename(backup, app);
    throw error;
  }
  console.log('Built: ' + app);
  if (!process.argv.includes('--no-open')) await run('/usr/bin/open', [app]);
} finally {
  await rm(stage, { recursive: true, force: true });
}
