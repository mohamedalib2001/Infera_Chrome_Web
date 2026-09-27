# إنفرا إيجنت للمتصفح — Infera Agent for Chrome

<p align="center"><img src="extension/icons/logo.png" width="120" alt="Infera Agent"></p>

**إنفرا إيجنت** وكيل تصفح (Browser Agent) يعمل داخل متصفح Chrome نفسه من لوحة جانبية:
يقرأ الصفحة (نصًا وشجرة وصول ولقطات شاشة)، وينقر ويكتب ويمرّر ويتنقل بين الصفحات
والتبويبات، ويعبّئ النماذج، ويستفيد من جلسات تسجيل الدخول القائمة لديك — وأنت تشاهد كل
خطوة وتستطيع الإيقاف أو الاستيلاء على التحكم في أي لحظة. بُني ليطابق قدرات «Claude in Chrome»
كما وردت في التقرير المرجعي، مع هوية إنفرا.

## القدرات

| المجال | ما يوفّره |
|---|---|
| قراءة الصفحة | شجرة وصول بمعرّفات ثابتة `ref_N`، استخراج النص بأولوية `article/main`، لقطات شاشة كاملة أو مصغّرة، تكبير منطقة |
| التفاعل | نقر يسار/يمين/مزدوج/ثلاثي، تحويم، سحب وإفلات، تمرير، كتابة، مفاتيح واختصارات مع مفاتيح التعديل، تكرار حتى 100 |
| التبويبات | مجموعة تبويبات «Infera» لكل جلسة، إنشاء/إغلاق/تنقل/رجوع/تقدم، تغيير حجم النافذة |
| النماذج | `form_input` لكل الأنواع (select، checkbox، radio، date، range، number، textarea، contenteditable) مع أحداث React |
| أدوات المطوّرين | رسائل console بفلترة regex، طلبات الشبكة مع إخفاء قيم المصادقة، تنفيذ JavaScript (REPL) |
| الملفات والصور | رفع لقطات أو ملفات إلى حقول الإدخال أو بالسحب والإفلات (حتى 10 MB)، تنزيلات بموافقة دائمًا |
| تسجيل GIF | دوائر النقر، مسارات السحب، تسميات الأفعال، شريط تقدم، علامة مائية، جودة 1–30 |
| الأتمتة | اختصارات «/»، مهام مجدولة (مرة/يومي/أسبوعي/شهري/سنوي)، تسجيل سير العمل مع سرد صوتي |
| الوضع السريع | Quick Mode بلغة أوامر مضغوطة (`C RC DC TC H T K S D Z N J W ST NT LT PL`) |
| المعرفة المدمجة | مهارات خاصة بـ Gmail وGoogle Calendar وGoogle Docs وGitHub وSlack وX وLinkedIn |
| التكامل | خادم MCP باسم `infera-in-chrome` عبر Native Messaging (Infera Code/Claude Code/أي عميل MCP)، جسر سحابي للجلسات البعيدة، خوادم MCP بعيدة داخل اللوحة |
| الأمان | أربعة أوضاع موافقة، فاحص أمان مستقل، أذونات لكل موقع **موقّعة بـ HMAC**، حظر فئات المواقع، سياسات المؤسسات |
| الواجهة | عربية وإنجليزية مع RTL، وضع فاتح/داكن، إشعارات وأصوات |

التفاصيل الكاملة وربط كل بند من التقرير بملفه في الكود: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## التثبيت (وضع المطوّر)

1. افتح `chrome://extensions` وفعّل **Developer mode**.
2. اضغط **Load unpacked** واختر مجلد `extension/`.
   معرّف الإضافة ثابت بفضل المفتاح العام في `manifest.json`: `cginklpeajfbmijnfoegocimhaagbbll`.
3. افتح اللوحة الجانبية وسجّل الدخول **بحسابك على إنفرا إيجنت** (البريد وكلمة المرور، وعنوان الخادم إن لم يكن مدمجًا).
   لا تحتاج مفتاح API: طلبات النموذج تمر عبر خادم إنفرا إيجنت بمفتاح مؤسستك. (مفتاح API خاص متاح للمطوّرين من الإعدادات ← متقدم.)
4. اضغط أيقونة إنفرا في شريط الأدوات (أو `Ctrl+E` / `⌘E`) لفتح اللوحة الجانبية. `Ctrl+Shift+E` يوقف المهمة الجارية.

## النشر لكل المستخدمين (أي جهاز)

```bash
node scripts/build-store.mjs --api-url https://<خادم إنفرا إيجنت>   # ينتج dist/infera-agent-<version>.zip
```

ارفع الملف على Chrome Web Store، فيثبّت أي مستخدم الإضافة من المتجر ويسجّل الدخول بحسابه على
إنفرا إيجنت مباشرة. الخطوات الكاملة (تجهيز الخادم، المتجر، سياسة الخصوصية، التثبيت الإجباري
للمؤسسات): [`docs/PUBLISHING.md`](docs/PUBLISHING.md) · [`docs/PRIVACY.md`](docs/PRIVACY.md).

## ربط Infera Code أو أي عميل MCP

```bash
cd native-host
node install.js                 # يسجّل com.infera.agent_code_browser_extension لكل متصفحات Chromium المثبتة
# أعد تشغيل المتصفح، ثم من إعدادات الإضافة: Connections → Reconnect
claude mcp add infera-in-chrome -- node "$(pwd)/infera-mcp-server.js"
```

* `--desktop` يسجّل اسم مضيف تطبيق سطح المكتب `com.infera.agent_browser_extension`.
* `--browsers chrome,edge,brave` لتحديد المتصفحات، و`--uninstall` للإزالة.
* القناة المحلية: `/tmp/infera-mcp-browser-bridge-$USER/<pid>.sock` (أو أنبوب مسمّى على Windows).
* أدوات إضافية في خادم MCP: `list_connected_browsers` و`switch_browser`.

## الجسر السحابي (للجلسات المستضافة في السحابة)

```bash
cd bridge-relay && npm install
RELAY_AGENT_TOKEN=<secret> PORT=8787 node server.js     # ضعه خلف TLS (wss://) في الإنتاج
```

في إعدادات الإضافة: فعّل **Cloud bridge** واكتب `wss://<host>/ws`. في الجلسة البعيدة:
`node infera-mcp-server.js --relay wss://<host>/agent --token <secret>`؛ عند `switch_browser`
يظهر للمستخدم إشعار اقتران برمز يجب قبوله.

## سياسات المؤسسات

عبر Chrome Enterprise (التخزين المُدار، `extension/managed_schema.json`):
`enabled`، `forceLoginOrgUUID`، `allowlist`، `blocklist`، `defaultPermissionMode`،
`disableSkipAllApprovals`، `apiBaseUrl`، `relayUrl`.

## الاختبارات

```bash
npm test          # فحوص ثابتة + اختبار جسر Native Messaging/MCP + اختبار الجسر السحابي
npm i && npm run test:e2e   # يحمّل الإضافة في Chromium: كل الأدوات + حلقة الوكيل مقابل API وهمي
```

## هيكل المستودع

```
extension/            الإضافة (Manifest V3)
  background/         الخدمة الخلفية: الوكيل، الأدوات، CDP، الأذونات، الجسور
  content/            سكربتات تُحقن عند الطلب: page-agent، overlay، recorder
  sidepanel/          واجهة المحادثة
  options/ approval/ blocked/ offscreen/   صفحات مساعدة
native-host/          مضيف Native Messaging + خادم MCP "infera-in-chrome" + المثبّت
bridge-relay/         خادم الجسر السحابي المرجعي
scripts/              فحوص واختبارات e2e
docs/ARCHITECTURE.md  ربط التقرير بالتنفيذ
```

---

## English summary

Infera Agent is a Manifest V3 browser agent: a side-panel assistant that reads pages
(accessibility tree with stable `ref_N` ids, text, screenshots), acts through the Chrome DevTools
Protocol (trusted clicks, typing, keys, scrolling, drag), manages its own tab group, fills forms,
reads console/network logs, uploads files, records GIFs, runs saved `/` shortcuts and scheduled
tasks, records workflows with voice narration, and exposes the whole tool surface as the
`infera-in-chrome` MCP server over native messaging (and a cloud relay). Safety: four approval
modes, an independent per-action safety checker, HMAC-signed site permissions, category blocking,
always-confirm and hard-blocked actions, and enterprise policies. See
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
