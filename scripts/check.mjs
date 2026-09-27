// Static checks: JS syntax, manifest sanity, locale keys, tool surface in sync,
// every file referenced by manifest/HTML exists, extension ID matches the key.
import { readFileSync, readdirSync, statSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ext = path.join(root, 'extension');
let errors = 0;
const fail = (m) => { errors++; console.error('✗ ' + m); };
const okm = (m) => console.log('✓ ' + m);

const walk = (d) => readdirSync(d).flatMap((f) => { const p = path.join(d, f); if (f === 'node_modules') return []; return statSync(p).isDirectory() ? walk(p) : [p]; });
const js = [...walk(ext), ...walk(path.join(root, 'native-host')), ...walk(path.join(root, 'bridge-relay')), ...walk(path.join(root, 'scripts'))].filter((f) => /\.(m?js)$/.test(f));
for (const f of js) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); } catch (e) { fail(`syntax: ${path.relative(root, f)}\n${e.stderr}`); }
}
okm(`syntax of ${js.length} JS files`);

const manifest = JSON.parse(readFileSync(path.join(ext, 'manifest.json'), 'utf8'));
const expected = ['sidePanel', 'storage', 'scripting', 'debugger', 'tabGroups', 'tabs', 'alarms', 'notifications', 'system.display', 'webNavigation', 'declarativeNetRequestWithHostAccess', 'offscreen', 'nativeMessaging', 'downloads', 'unlimitedStorage'];
if (JSON.stringify([...manifest.permissions].sort()) !== JSON.stringify([...expected].sort())) fail('manifest permissions differ from the 15 documented permissions');
else okm('15 permissions declared');
const der = Buffer.from(manifest.key, 'base64');
const id = [...createHash('sha256').update(der).digest('hex').slice(0, 32)].map((c) => String.fromCharCode(97 + parseInt(c, 16))).join('');
const common = readFileSync(path.join(root, 'native-host', 'lib', 'common.js'), 'utf8');
if (!common.includes(id)) fail(`extension id ${id} (from manifest key) not used as DEFAULT_EXTENSION_ID`); else okm(`extension id ${id}`);

const refs = [manifest.background.service_worker, manifest.side_panel.default_path, manifest.options_ui.page, manifest.storage.managed_schema,
  ...Object.values(manifest.icons), ...Object.values(manifest.action.default_icon), ...manifest.declarative_net_request.rule_resources.map((r) => r.path),
  'offscreen/offscreen.html', 'blocked/blocked.html', 'approval/approval.html', 'content/page-agent.js', 'content/overlay.js', 'content/recorder.js'];
for (const r of refs) if (!existsSync(path.join(ext, r))) fail(`missing file ${r}`);
for (const h of walk(ext).filter((f) => f.endsWith('.html'))) {
  const src = readFileSync(h, 'utf8');
  for (const m of src.matchAll(/(?:src|href)="([^"#:]+)"/g)) if (!existsSync(path.resolve(path.dirname(h), m[1]))) fail(`${path.relative(ext, h)} references missing ${m[1]}`);
}
okm('referenced files exist');

// Relative ES module imports resolve.
for (const f of js.filter((x) => x.startsWith(ext))) {
  for (const m of readFileSync(f, 'utf8').matchAll(/(?:import|from)\s*\(?\s*['"](\.{1,2}\/[^'"]+)['"]/g)) {
    if (!existsSync(path.resolve(path.dirname(f), m[1]))) fail(`${path.relative(root, f)} imports missing ${m[1]}`);
  }
}
okm('module imports resolve');

for (const l of ['en', 'ar']) {
  const msgs = JSON.parse(readFileSync(path.join(ext, '_locales', l, 'messages.json'), 'utf8'));
  for (const k of ['extName', 'extDescription', 'actionTitle', 'cmdOpen', 'cmdStop']) if (!msgs[k]) fail(`_locales/${l} missing ${k}`);
}
okm('locales');

const { MCP_TOOLS, PANEL_TOOLS } = await import(path.join(ext, 'background', 'tools', 'definitions.js'));
const toolsJson = JSON.parse(readFileSync(path.join(root, 'native-host', 'tools.json'), 'utf8'));
if (MCP_TOOLS.length !== 17) fail(`expected 17 MCP tools, found ${MCP_TOOLS.length}`);
if (JSON.stringify(toolsJson.map((t) => t.name)) !== JSON.stringify(MCP_TOOLS.map((t) => t.name))) fail('native-host/tools.json out of date: run npm run gen:tools');
okm(`${MCP_TOOLS.length} MCP tools, ${PANEL_TOOLS.length} side-panel tools`);

console.log(errors ? `\n${errors} problem(s)` : '\nAll static checks passed');
process.exit(errors ? 1 : 0);
