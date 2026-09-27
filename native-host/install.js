#!/usr/bin/env node
'use strict';
// Registers the Infera Agent native messaging host for Chromium browsers.
//   node install.js [--extension-id <id>] [--desktop] [--uninstall] [--browsers chrome,edge,brave,...]
// Writes <host>.json manifests into each browser's NativeMessagingHosts folder
// (macOS/Linux) or registry key HKCU\Software\<Vendor>\<Browser>\NativeMessagingHosts (Windows).
const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');
const { HOST_CODE, HOST_DESKTOP, DEFAULT_EXTENSION_ID } = require('./lib/common');

const args = process.argv.slice(2);
const val = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : undefined; };
const extId = val('--extension-id') || DEFAULT_EXTENSION_ID;
const hostName = args.includes('--desktop') ? HOST_DESKTOP : HOST_CODE;
const uninstall = args.includes('--uninstall');
const only = val('--browsers')?.split(',').map((s) => s.trim().toLowerCase());
const home = os.homedir();

const DIRS = {
  darwin: {
    chrome: 'Library/Application Support/Google/Chrome',
    'chrome-beta': 'Library/Application Support/Google/Chrome Beta',
    'chrome-canary': 'Library/Application Support/Google/Chrome Canary',
    chromium: 'Library/Application Support/Chromium',
    edge: 'Library/Application Support/Microsoft Edge',
    brave: 'Library/Application Support/BraveSoftware/Brave-Browser',
    vivaldi: 'Library/Application Support/Vivaldi',
    opera: 'Library/Application Support/com.operasoftware.Opera',
    arc: 'Library/Application Support/Arc/User Data',
  },
  linux: {
    chrome: '.config/google-chrome',
    'chrome-beta': '.config/google-chrome-beta',
    chromium: '.config/chromium',
    edge: '.config/microsoft-edge',
    brave: '.config/BraveSoftware/Brave-Browser',
    vivaldi: '.config/vivaldi',
    opera: '.config/opera',
  },
};
const REG = {
  chrome: 'HKCU\\Software\\Google\\Chrome\\NativeMessagingHosts',
  chromium: 'HKCU\\Software\\Chromium\\NativeMessagingHosts',
  edge: 'HKCU\\Software\\Microsoft\\Edge\\NativeMessagingHosts',
  brave: 'HKCU\\Software\\BraveSoftware\\Brave-Browser\\NativeMessagingHosts',
  vivaldi: 'HKCU\\Software\\Vivaldi\\NativeMessagingHosts',
  opera: 'HKCU\\Software\\Opera Software\\NativeMessagingHosts',
};

function wrapperPath() {
  const dir = path.join(home, '.infera', 'chrome');
  fs.mkdirSync(dir, { recursive: true });
  const script = path.join(__dirname, 'infera-native-host.js');
  if (process.platform === 'win32') {
    const p = path.join(dir, 'infera-native-host.bat');
    fs.writeFileSync(p, `@echo off\r\n"${process.execPath}" "${script}" %*\r\n`);
    return p;
  }
  const p = path.join(dir, 'infera-native-host');
  fs.writeFileSync(p, `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`, { mode: 0o755 });
  fs.chmodSync(p, 0o755);
  return p;
}

function manifest(binPath) {
  return {
    name: hostName,
    description: 'Infera Agent browser bridge (MCP server: infera-in-chrome)',
    path: binPath,
    type: 'stdio',
    allowed_origins: [`chrome-extension://${extId}/`],
  };
}

function main() {
  if (!/^[a-p]{32}$/.test(extId)) throw new Error(`Invalid extension id: ${extId}`);
  const done = [];
  if (process.platform === 'win32') {
    const dir = path.join(home, '.infera', 'chrome');
    const jsonPath = path.join(dir, `${hostName}.json`);
    if (!uninstall) {
      const bin = wrapperPath();
      fs.writeFileSync(jsonPath, JSON.stringify(manifest(bin), null, 2));
    }
    for (const [name, key] of Object.entries(REG)) {
      if (only && !only.includes(name)) continue;
      try {
        if (uninstall) execFileSync('reg', ['delete', `${key}\\${hostName}`, '/f'], { stdio: 'ignore' });
        else execFileSync('reg', ['add', `${key}\\${hostName}`, '/ve', '/t', 'REG_SZ', '/d', jsonPath, '/f'], { stdio: 'ignore' });
        done.push(name);
      } catch { /* browser not installed / key missing */ }
    }
    if (uninstall) { try { fs.unlinkSync(jsonPath); } catch { /* ignore */ } }
  } else {
    const table = DIRS[process.platform];
    if (!table) throw new Error(`Unsupported platform ${process.platform} (WSL is not supported)`);
    const bin = uninstall ? null : wrapperPath();
    for (const [name, rel] of Object.entries(table)) {
      if (only && !only.includes(name)) continue;
      const base = path.join(home, rel);
      if (!fs.existsSync(base) && !(only && only.includes(name))) continue;
      const dir = path.join(base, 'NativeMessagingHosts');
      const file = path.join(dir, `${hostName}.json`);
      if (uninstall) { try { fs.unlinkSync(file); done.push(name); } catch { /* ignore */ } continue; }
      fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(file, JSON.stringify(manifest(bin), null, 2), { mode: 0o644 });
      done.push(`${name}: ${file}`);
    }
  }
  console.log(`${uninstall ? 'Removed' : 'Registered'} ${hostName} for extension ${extId}:`);
  for (const d of done) console.log('  - ' + d);
  if (!done.length) console.log('  (no supported browser profile found — pass --browsers chrome to force)');
  if (!uninstall) {
    console.log('\nRestart the browser (it reads native host manifests at startup), then open Infera Agent settings → Connections → Reconnect.');
    console.log(`\nAdd the MCP server to your client, e.g.:\n  claude mcp add infera-in-chrome -- node "${path.join(__dirname, 'infera-mcp-server.js')}"`);
  }
}

main();
