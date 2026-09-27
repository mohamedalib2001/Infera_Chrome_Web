import { t, setLanguage } from '../lib/i18n.js';

const id = new URLSearchParams(location.search).get('id');
const $ = (s) => document.getElementById(s);

async function main() {
  const s = await chrome.runtime.sendMessage({ type: 'get_settings' });
  setLanguage(s?.data?.language);
  const res = await chrome.runtime.sendMessage({ type: 'APPROVAL_GET', id });
  const r = res?.data;
  if (!r) { window.close(); return; }
  $('title').textContent = r.isPlan ? t('planTitle') : `${t('wantsTo')}…`;
  $('site').textContent = r.netloc || r.url || '';
  $('desc').textContent = r.description || '';
  if (r.reason) { $('reason').hidden = false; $('reason').textContent = r.reason; }
  if (r.client) $('client').textContent = `MCP client: ${r.client}`;
  $('once').textContent = r.isPlan ? t('approvePlan') : t('allowOnce');
  $('always').textContent = t('allowAlways');
  $('always').hidden = !r.allowAlways;
  $('deny').textContent = t('decline');
  const answer = (a) => chrome.runtime.sendMessage({ type: 'APPROVAL_ANSWER', id, answer: a });
  $('once').onclick = () => answer('once');
  $('always').onclick = () => answer('always');
  $('deny').onclick = () => answer('deny');
  $('once').focus();
}
main();
