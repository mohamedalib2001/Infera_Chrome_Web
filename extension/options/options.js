// Infera Agent — settings page.
import { setLanguage, currentLang, MODE_LABEL, t } from '../lib/i18n.js';

const $ = (s) => document.querySelector(s);
const send = (type, extra = {}) => chrome.runtime.sendMessage({ type, ...extra }).then((r) => { if (r?.error) throw new Error(r.error); return r?.data; });
const el = (tag, attrs = {}, ...kids) => {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (v !== undefined && v !== null && v !== false) e.setAttribute(k, v === true ? '' : v);
  }
  for (const k of kids.flat()) if (k != null) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
};

const L = {
  en: {
    subtitle: 'Settings, permissions and connections', account: 'Infera Agent account', accountHint: 'Sign in with your Infera Agent account. Model requests go through your organization\'s Infera Agent server, so no API key is stored in the browser.',
    advanced: 'Advanced (developers)', advancedHint: 'Use your own API key or OAuth server instead of an Infera Agent account.',
    apiKey: 'API key', baseUrl: 'API base URL', oauthAuth: 'OAuth authorize URL', oauthToken: 'OAuth token URL', oauthClient: 'OAuth client ID', oauthRedirect: 'OAuth redirect URI',
    signIn: 'Sign in', signOut: 'Sign out', signedIn: 'Signed in', notSignedIn: 'Not signed in',
    behaviour: 'Agent behaviour', behaviourHint: 'Defaults for new tasks. You can also change the model and approval mode from the side panel.',
    model: 'Default model', effort: 'Effort', mode: 'Approval mode', safety: 'Independent safety checker for each action (Automatically approve mode)', language: 'Interface language',
    notif: 'Desktop notification when a background task finishes', sound: 'Play a sound when a task finishes',
    sites: 'Your approved sites', sitesHint: 'Sites where you chose "Always allow". Entries are integrity-protected; tampered entries are ignored.',
    site: 'Site', since: 'Approved', status: 'Status', revoke: 'Revoke', revokeAll: 'Revoke all', none: 'No approved sites yet.', valid: 'valid', tampered: 'tampered (ignored)',
    blocklist: 'Personal blocklist', blocklistHint: 'One domain per line. Infera will never open or act on these sites (subdomains included). Banking, trading, crypto, adult and piracy sites are blocked by default.',
    connections: 'Connections', native: 'Infera Code / Desktop (native messaging)', reconnect: 'Reconnect', relay: 'Cloud bridge relay (for cloud-hosted sessions)', relayUrl: 'Relay URL (wss://…)', relayOn: 'Enable cloud bridge',
    classifier: 'Remote domain classifier URL (optional, use {domain})', nativeHelp: 'Install the native host so Infera Code or any MCP client can drive this browser:',
    policy: 'Organization policy', policyHint: 'Managed by your administrator (read-only).', noPolicy: 'No organization policy is applied.',
    mic: 'Microphone access for workflow narration', micBtn: 'Allow microphone', micOk: 'Microphone allowed. You can close this tab.',
    save: 'Save', saved: 'Saved ✓',
    remote: 'Remote MCP servers', remoteHint: 'Tools from these MCP servers (Streamable HTTP) are offered to the agent. Every call asks for the REMOTE_MCP permission unless you allow the server.',
    srvName: 'Name', srvUrl: 'URL (https://…/mcp)', srvAuth: 'Authorization header (optional)', add: 'Add server', remove: 'Remove', noServers: 'No remote MCP servers.',
  },
  ar: {
    subtitle: 'الإعدادات والأذونات والاتصالات', account: 'حساب إنفرا إيجنت', accountHint: 'سجّل الدخول بحسابك على إنفرا إيجنت. تمرّ طلبات النموذج عبر خادم إنفرا إيجنت الخاص بمؤسستك، فلا يُخزَّن أي مفتاح API في المتصفح.',
    advanced: 'متقدم (للمطوّرين)', advancedHint: 'استخدم مفتاح API خاصًا بك أو خادم OAuth بدلًا من حساب إنفرا إيجنت.',
    apiKey: 'مفتاح API', baseUrl: 'عنوان واجهة API', oauthAuth: 'رابط التفويض (OAuth)', oauthToken: 'رابط الرمز (OAuth)', oauthClient: 'معرّف العميل (OAuth)', oauthRedirect: 'رابط إعادة التوجيه (OAuth)',
    signIn: 'تسجيل الدخول', signOut: 'تسجيل الخروج', signedIn: 'تم تسجيل الدخول', notSignedIn: 'لم يتم تسجيل الدخول',
    behaviour: 'سلوك الوكيل', behaviourHint: 'الإعدادات الافتراضية للمهام الجديدة، ويمكن تغيير النموذج ووضع الموافقة من اللوحة الجانبية أيضًا.',
    model: 'النموذج الافتراضي', effort: 'مستوى الجهد', mode: 'وضع الموافقة', safety: 'فاحص أمان مستقل لكل إجراء (في وضع الموافقة التلقائية)', language: 'لغة الواجهة',
    notif: 'إشعار سطح المكتب عند انتهاء مهمة في الخلفية', sound: 'تشغيل صوت عند انتهاء المهمة',
    sites: 'المواقع التي وافقت عليها', sitesHint: 'المواقع التي اخترت فيها «السماح دائمًا». الإدخالات محمية بتوقيع سلامة، وأي إدخال معدَّل يُتجاهل.',
    site: 'الموقع', since: 'تاريخ الموافقة', status: 'الحالة', revoke: 'إلغاء', revokeAll: 'إلغاء الكل', none: 'لا توجد مواقع موافق عليها بعد.', valid: 'سليم', tampered: 'معدَّل (متجاهَل)',
    blocklist: 'قائمة الحظر الشخصية', blocklistHint: 'نطاق في كل سطر. لن يفتح إنفرا هذه المواقع أو يعمل عليها (بما فيها النطاقات الفرعية). مواقع البنوك والتداول والعملات المشفرة والمحتوى الإباحي والمقرصن محظورة افتراضيًا.',
    connections: 'الاتصالات', native: 'إنفرا كود / سطح المكتب (Native Messaging)', reconnect: 'إعادة الاتصال', relay: 'جسر سحابي (للجلسات المستضافة في السحابة)', relayUrl: 'رابط الجسر (wss://…)', relayOn: 'تفعيل الجسر السحابي',
    classifier: 'رابط مصنّف النطاقات البعيد (اختياري، استخدم {domain})', nativeHelp: 'ثبّت المضيف الأصلي ليتمكن إنفرا كود أو أي عميل MCP من التحكم في هذا المتصفح:',
    policy: 'سياسة المؤسسة', policyHint: 'يديرها المسؤول (للقراءة فقط).', noPolicy: 'لا توجد سياسة مؤسسية مطبّقة.',
    mic: 'الوصول إلى الميكروفون لسرد سير العمل', micBtn: 'السماح بالميكروفون', micOk: 'تم السماح بالميكروفون. يمكنك إغلاق هذا التبويب.',
    save: 'حفظ', saved: 'تم الحفظ ✓',
    remote: 'خوادم MCP البعيدة', remoteHint: 'تُعرض أدوات هذه الخوادم (Streamable HTTP) على الوكيل، وكل استدعاء يطلب إذن REMOTE_MCP ما لم تسمح للخادم دائمًا.',
    srvName: 'الاسم', srvUrl: 'الرابط (https://…/mcp)', srvAuth: 'ترويسة Authorization (اختياري)', add: 'إضافة خادم', remove: 'حذف', noServers: 'لا توجد خوادم MCP بعيدة.',
  },
};
const tr = (k) => (L[currentLang()] || L.en)[k] ?? L.en[k] ?? k;

const MODELS = [
  ['claude-opus-5', 'Claude Opus 5'], ['claude-opus-5[fast]', 'Claude Opus 5 [fast] — Quick Mode'], ['claude-sonnet-5', 'Claude Sonnet 5'],
  ['claude-haiku-4-5', 'Claude Haiku 4.5'], ['claude-fable-5-1', 'Claude Fable 5.1'],
];

function field(label, input) { return el('label', { class: 'field' }, el('span', {}, label), input); }
function check(label, input) { return el('label', { class: 'check' }, input, el('span', {}, label)); }
function select(opts, value) { const s = el('select', {}, ...opts.map(([v, l]) => el('option', { value: v }, l))); s.value = value; return s; }

async function render() {
  const s = await send('get_settings');
  setLanguage(s.language);
  document.title = `${t('appName')} — ${t('settings')}`;
  $('#title').textContent = t('appName');
  $('#subtitle').textContent = tr('subtitle');
  const policy = await send('get_policy');
  const app = $('#app');
  app.replaceChildren();

  if (location.hash === '#mic') {
    const note = el('p', { class: 'muted' });
    app.append(el('section', { class: 'card' }, el('h2', {}, tr('mic')),
      el('button', { class: 'btn primary', onclick: async () => {
        try { const st = await navigator.mediaDevices.getUserMedia({ audio: true }); st.getTracks().forEach((x) => x.stop()); note.textContent = tr('micOk'); } catch (e) { note.textContent = e.message; }
      } }, tr('micBtn')), note));
  }

  // Account: Infera Agent sign-in first; personal key / OAuth are developer options.
  const auth = await send('auth_status');
  const email = el('input', { type: 'email', autocomplete: 'username', placeholder: 'name@company.com' });
  const password = el('input', { type: 'password', autocomplete: 'current-password' });
  const server = el('input', { type: 'url', value: auth.server || '', placeholder: 'https://agent.example.com', disabled: policy.inferaUrl ? true : undefined });
  const errA = el('span', { class: 'saved', style: 'color:var(--danger)' });
  const acc = auth.account || {};
  const inferaBlock = auth.infera
    ? el('div', {},
      el('div', { class: 'pill ok' }, `${tr('signedIn')}: ${acc.displayName || acc.email || ''}${acc.organizationName ? ` · ${acc.organizationName}` : ''}`),
      el('div', { class: 'muted', style: 'font-size:12.5px;margin-top:4px;direction:ltr;text-align:start' }, auth.server),
      auth.providerConfigured === false ? el('p', { class: 'badge warn', style: 'margin-top:8px' }, t('noProvider')) : null,
      el('div', { class: 'actions' }, el('button', { class: 'btn', onclick: async () => { await send('sign_out'); render(); } }, tr('signOut'))))
    : el('div', {},
      el('div', { class: 'fields' }, field(t('email'), email), field(t('password'), password), field(t('server'), server)),
      el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: async () => {
        errA.textContent = '';
        try { await send('infera_sign_in', { email: email.value, password: password.value, server: policy.inferaUrl ? undefined : server.value }); render(); }
        catch (e) { errA.textContent = e.message; }
      } }, tr('signIn')), errA));

  const apiKey = el('input', { type: 'password', value: s.apiKey, autocomplete: 'off', placeholder: 'sk-…' });
  const baseUrl = el('input', { value: s.apiBaseUrl, disabled: policy.apiBaseUrl ? true : undefined });
  const oa = el('input', { value: s.oauth.authorizeUrl });
  const ot = el('input', { value: s.oauth.tokenUrl });
  const oc = el('input', { value: s.oauth.clientId });
  const orr = el('input', { value: s.oauth.redirectUri || 'https://infera.ai/oauth/callback' });
  const savedA = el('span', { class: 'saved' });
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('account')), el('p', { class: 'muted' }, tr('accountHint')),
    inferaBlock,
    el('details', { style: 'margin-top:16px' }, el('summary', { class: 'muted' }, tr('advanced')),
      el('p', { class: 'muted', style: 'font-size:12.5px' }, tr('advancedHint')),
      el('div', { class: 'fields' }, field(tr('apiKey'), apiKey), field(tr('baseUrl'), baseUrl)),
      el('div', { class: 'fields', style: 'margin-top:10px' }, field(tr('oauthAuth'), oa), field(tr('oauthToken'), ot), field(tr('oauthClient'), oc), field(tr('oauthRedirect'), orr)),
      el('div', { class: 'actions' },
        el('button', { class: 'btn', onclick: async () => {
          await send('update_settings', { patch: { apiKey: apiKey.value.trim(), ...(policy.apiBaseUrl ? {} : { apiBaseUrl: baseUrl.value.trim() || 'https://api.anthropic.com' }), oauth: { ...s.oauth, authorizeUrl: oa.value.trim(), tokenUrl: ot.value.trim(), clientId: oc.value.trim(), redirectUri: orr.value.trim() } } });
          savedA.textContent = tr('saved');
        } }, tr('save')),
        el('button', { class: 'btn', onclick: async () => { try { await send('sign_in'); render(); } catch (e) { alert(e.message); } } }, 'OAuth ' + tr('signIn')),
        savedA))));

  // Behaviour
  const model = select(MODELS, s.model);
  const effort = select([['low', 'low'], ['medium', 'medium'], ['high', 'high'], ['xhigh', 'xhigh'], ['max', 'max']], s.effort);
  const modes = ['ask', 'auto', 'follow_a_plan', 'skip_all_permission_checks'].filter((m) => !(policy.disableSkipAllApprovals && m === 'skip_all_permission_checks'));
  const mode = select(modes.map((m) => [m, t(MODE_LABEL[m])]), s.permissionMode);
  const lang = select([['auto', 'Auto / تلقائي'], ['ar', 'العربية'], ['en', 'English']], s.language);
  const safety = el('input', { type: 'checkbox', checked: s.safetyChecker ? true : undefined });
  const notif = el('input', { type: 'checkbox', checked: s.notifications ? true : undefined });
  const sound = el('input', { type: 'checkbox', checked: s.sound ? true : undefined });
  const savedB = el('span', { class: 'saved' });
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('behaviour')), el('p', { class: 'muted' }, tr('behaviourHint')),
    el('div', { class: 'fields' }, field(tr('model'), model), field(tr('effort'), effort), field(tr('mode'), mode), field(tr('language'), lang)),
    el('div', { style: 'display:grid;gap:8px;margin-top:12px' }, check(tr('safety'), safety), check(tr('notif'), notif), check(tr('sound'), sound)),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: async () => {
      await send('update_settings', { patch: { model: model.value, effort: effort.value, permissionMode: mode.value, language: lang.value, safetyChecker: safety.checked, notifications: notif.checked, sound: sound.checked } });
      savedB.textContent = tr('saved');
      if (lang.value !== s.language) render();
    } }, tr('save')), savedB)));

  // Approved sites
  const perms = await send('list_permissions');
  const tbody = el('tbody', {}, ...perms.map((p) => el('tr', {},
    el('td', {}, p.scope?.netloc || '?'),
    el('td', {}, new Date(p.createdAt).toLocaleString(currentLang())),
    el('td', {}, el('span', { class: `pill ${p.valid ? 'ok' : 'bad'}` }, p.valid ? tr('valid') : tr('tampered'))),
    el('td', {}, el('button', { class: 'btn small danger', onclick: async () => { await send('revoke_permission', { id: p.id }); render(); } }, tr('revoke'))))));
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('sites')), el('p', { class: 'muted' }, tr('sitesHint')),
    perms.length ? el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, tr('site')), el('th', {}, tr('since')), el('th', {}, tr('status')), el('th', {}))), tbody) : el('p', { class: 'muted' }, tr('none')),
    perms.length ? el('div', { class: 'actions' }, el('button', { class: 'btn danger', onclick: async () => { await send('revoke_all_permissions'); render(); } }, tr('revokeAll'))) : null));

  // Blocklist
  const bl = el('textarea', { rows: 4, placeholder: 'example.com' }, (s.userBlocklist || []).join('\n'));
  const savedC = el('span', { class: 'saved' });
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('blocklist')), el('p', { class: 'muted' }, tr('blocklistHint')), bl,
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: async () => {
      await send('update_settings', { patch: { userBlocklist: bl.value.split(/\s+/).map((x) => x.trim().toLowerCase()).filter(Boolean) } });
      savedC.textContent = tr('saved');
    } }, tr('save')), savedC)));

  // Connections
  const ns = await send('native_status');
  const rs = await send('relay_status');
  const relayUrl = el('input', { value: s.relayUrl, placeholder: 'wss://bridge.infera.ai/ws', disabled: policy.relayUrl ? true : undefined });
  const relayOn = el('input', { type: 'checkbox', checked: s.relayEnabled ? true : undefined });
  const classifier = el('input', { value: s.remoteDomainClassifier, placeholder: 'https://api.infera.ai/domain_info?domain={domain}' });
  const savedD = el('span', { class: 'saved' });
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('connections')),
    el('div', { class: 'row', style: 'justify-content:space-between;flex-wrap:wrap' },
      el('div', {}, el('div', {}, tr('native')), el('span', { class: `pill ${ns.state === 'connected' ? 'ok' : 'bad'}` }, `${ns.state}${ns.host ? ' — ' + ns.host : ''}`),
        ns.lastError && ns.state !== 'connected' ? el('div', { class: 'muted', style: 'font-size:12px' }, ns.lastError) : null,
        ns.clients?.length ? el('div', { class: 'muted', style: 'font-size:12px' }, `MCP clients: ${ns.clients.map((c) => c.id).join(', ')}`) : null),
      el('button', { class: 'btn', onclick: async () => { await send('native_reconnect'); render(); } }, tr('reconnect'))),
    el('p', { class: 'muted', style: 'margin:12px 0 0' }, tr('nativeHelp')),
    el('pre', { class: 'cmd' }, `cd native-host && npm install\nnode install.js --extension-id ${chrome.runtime.id}\n# then in your MCP client (e.g. Claude Code / Infera Code):\n#   claude mcp add infera-in-chrome -- node <path>/native-host/infera-mcp-server.js`),
    el('div', { class: 'fields', style: 'margin-top:14px' }, field(tr('relayUrl'), relayUrl), field(tr('classifier'), classifier)),
    el('div', { style: 'margin-top:8px' }, check(tr('relayOn'), relayOn), el('span', { class: `pill ${rs.state === 'connected' ? 'ok' : ''}` }, `${tr('relay')}: ${rs.state}`)),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: async () => {
      await send('update_settings', { patch: { relayUrl: relayUrl.value.trim(), relayEnabled: relayOn.checked, remoteDomainClassifier: classifier.value.trim() } });
      savedD.textContent = tr('saved');
    } }, tr('save')), savedD)));

  // Remote MCP servers
  const servers = await send('list_mcp_servers');
  const sName = el('input', { placeholder: 'crm' });
  const sUrl = el('input', { placeholder: 'https://mcp.example.com/mcp' });
  const sAuth = el('input', { type: 'password', placeholder: 'Bearer …', autocomplete: 'off' });
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('remote')), el('p', { class: 'muted' }, tr('remoteHint')),
    servers.length ? el('table', {}, el('tbody', {}, ...servers.map((sv) => el('tr', {},
      el('td', {}, sv.name), el('td', { style: 'direction:ltr' }, sv.url),
      el('td', {}, el('button', { class: 'btn small danger', onclick: async () => { await send('delete_mcp_server', { id: sv.id }); render(); } }, tr('remove'))))))) : el('p', { class: 'muted' }, tr('noServers')),
    el('div', { class: 'fields', style: 'margin-top:12px' }, field(tr('srvName'), sName), field(tr('srvUrl'), sUrl), field(tr('srvAuth'), sAuth)),
    el('div', { class: 'actions' }, el('button', { class: 'btn primary', onclick: async () => {
      try { await send('save_mcp_server', { server: { name: sName.value, url: sUrl.value, headers: sAuth.value.trim() ? { authorization: sAuth.value.trim() } : {} } }); render(); } catch (e) { alert(e.message); }
    } }, tr('add')))));

  // Policy
  const keys = Object.keys(policy || {});
  app.append(el('section', { class: 'card' },
    el('h2', {}, tr('policy')), el('p', { class: 'muted' }, keys.length ? tr('policyHint') : tr('noPolicy')),
    keys.length ? el('pre', { class: 'cmd' }, JSON.stringify(policy, null, 2)) : null,
    el('p', { class: 'muted', style: 'font-size:12px;margin:10px 0 0' }, `Extension ID: ${chrome.runtime.id} · v${chrome.runtime.getManifest().version}`)));
}

render();
