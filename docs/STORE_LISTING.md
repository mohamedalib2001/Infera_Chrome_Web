# Chrome Web Store listing — copy/paste texts

Item ID: `nablmcconmoblabfpbcfaplmbijmgdjc`

## Store listing

**Category:** Productivity → Workflow & Planning · **Language:** English (add Arabic as a second language)

### Description (English)

INFERA Agent is a browsing agent that works inside your own Chrome. Tell it what you need in plain language and it reads the page, clicks, types, scrolls, fills forms and works across tabs — using the sites you are already signed in to. You watch every step in the side panel and can stop or take over at any moment.

What you can do
• Summarize articles and long pages, compare products in a table, extract data
• Fill in forms, search sites, and complete multi-step tasks across tabs
• Save your best prompts as “/” shortcuts and schedule recurring tasks
• Record a workflow once (with voice narration) and replay it as a shortcut
• Export a GIF of what the agent did

Your INFERA Agent account
Sign in with your inferaagent.com account (password, Google or SSO). No API keys: usage is paid from your INFERA Agent credits, and the model key never reaches your browser.

Safety first
• You choose how it works: approve every action, approve a plan, or let an independent safety checker review each action
• Banking, trading, crypto and other high-risk sites are blocked by default
• Purchases, payments, account creation, card numbers and IDs are never handled by the agent
• Downloads and sign-in approvals always ask you first
• Page content is treated as untrusted data, and hidden text is removed to resist prompt-injection

Works in Arabic and English, with light and dark themes.

### الوصف (العربية)

إنفرا إيجنت وكيل تصفح يعمل داخل متصفح Chrome الخاص بك. اطلب ما تريد باللغة الطبيعية، فيقرأ الصفحة وينقر ويكتب ويمرّر ويعبّئ النماذج ويعمل عبر التبويبات — مستخدمًا المواقع التي سجّلت الدخول إليها. تشاهد كل خطوة في اللوحة الجانبية، ويمكنك الإيقاف أو استعادة التحكم في أي لحظة.

ماذا يمكنك أن تفعل
• تلخيص المقالات والصفحات الطويلة، ومقارنة المنتجات في جدول، واستخراج البيانات
• تعبئة النماذج، والبحث في المواقع، وإنجاز مهام متعددة الخطوات عبر التبويبات
• حفظ أفضل أوامرك كاختصارات «/» وجدولة المهام المتكررة
• تسجيل سير عمل مرة واحدة (مع السرد الصوتي) وإعادة تشغيله كاختصار
• تصدير صورة GIF لما قام به الوكيل

حسابك على إنفرا إيجنت
سجّل الدخول بحسابك على inferaagent.com (كلمة مرور أو Google أو SSO). لا مفاتيح API: الاستهلاك يُخصم من رصيدك في إنفرا إيجنت، ومفتاح النموذج لا يصل إلى متصفحك أبدًا.

الأمان أولًا
• أنت تختار طريقة العمل: موافقة على كل إجراء، أو على خطة، أو فاحص أمان مستقل يراجع كل إجراء
• مواقع البنوك والتداول والعملات المشفرة وغيرها من المواقع عالية الخطورة محظورة افتراضيًا
• الوكيل لا يجري مشتريات أو مدفوعات ولا ينشئ حسابات ولا يتعامل مع أرقام البطاقات أو الهويات
• التنزيلات وموافقات تسجيل الدخول تطلب إذنك دائمًا
• محتوى الصفحات يُعامَل كبيانات غير موثوقة، والنصوص المخفية تُحذف لمقاومة حقن التعليمات

يعمل بالعربية والإنجليزية، مع الوضع الفاتح والداكن.

### Graphic assets
- Store icon: `extension/icons/icon128.png`
- Screenshots (1280×800): `screenshot-1.png`, `screenshot-2.png`, `screenshot-3.png`
- Small promo tile (440×280): `promo-small-440x280.png`

## Privacy tab

**Single purpose:** A browsing agent that reads the current web page and performs the actions the user asks for in natural language (reading, clicking, typing, filling forms, navigating), signed in with the user's INFERA Agent account.

**Permission justifications**

| Permission | Justification |
|---|---|
| sidePanel | Shows the agent's chat and approvals in Chrome's side panel while the user browses. |
| storage | Saves settings, approved sites, shortcuts, schedules and conversation history locally. |
| unlimitedStorage | Keeps screenshots of recorded workflows and conversation history without hitting the default quota. |
| scripting | Reads the page's text and structure and fills form fields when the user asks. |
| debugger | Performs the clicks, typing and screenshots the user asks for (trusted input via the DevTools protocol), only on tabs in the agent's tab group. |
| tabs | Opens, closes, switches and navigates the tabs the agent works in. |
| tabGroups | Keeps the tabs the agent controls in a separate, clearly labelled group. |
| alarms | Runs the scheduled tasks the user creates. |
| notifications | Tells the user when a background task finishes or needs approval. |
| system.display | Reads the display size to scale screenshots and keep resized windows on screen. |
| webNavigation | Blocks high-risk sites and detects when a page moves to another domain during a task. |
| declarativeNetRequestWithHostAccess | Adds a client-identification header to requests sent to INFERA Agent's own servers. |
| offscreen | Plays the completion sound and encodes GIF recordings. |
| identity | Opens the secure INFERA Agent sign-in window (OAuth). |
| nativeMessaging | Optional connection to INFERA Agent's desktop/coding tools on the user's computer. |
| downloads | Saves GIF recordings and screenshots; downloads from sites always require the user's approval. |
| Host permission (all URLs) | The agent works on whichever website the user asks it to operate. |

**Remote code:** No, I am not using remote code. (All scripts are packaged in the extension.)

**Data usage — collected:** Personally identifiable information (name, email of the INFERA Agent account), Authentication information (sign-in token), Personal communications (the user's prompts), Location — no, Web history (URLs/titles of tabs in the agent's group), User activity (actions performed by the agent), Website content (page text and screenshots needed for the task).

Certify all three: not sold to third parties; not used for unrelated purposes; not used for creditworthiness or lending.

**Privacy policy URL:** https://github.com/mohamedalib2001/Infera_Chrome_Web/blob/claude/pensive-dijkstra-r61pm0/docs/PRIVACY.md

## Distribution
Free · Public · All regions.

## Test instructions (for the reviewer)
1. Install the extension and click its toolbar icon to open the side panel.
2. Click "Sign in with INFERA Agent" and sign in with the test account below, then click Allow.
3. Open any website (e.g. https://en.wikipedia.org/wiki/Chrome) and type "Summarize this page".

Test account: `<email>` / `<password>` (an INFERA Agent account with credits).
