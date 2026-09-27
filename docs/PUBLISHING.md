# نشر إنفرا إيجنت لكل المستخدمين — Publishing Infera Agent

الهدف: أن يثبّت أي مستخدم الإضافة على أي جهاز من متجر Chrome، ثم يسجّل الدخول بحسابه
على إنفرا إيجنت، دون مفتاح API ودون أي إعداد.

## كيف يعمل الربط بحساب إنفرا إيجنت

```
الإضافة (متصفح المستخدم)                      خادم إنفرا إيجنت                 مزوّد النموذج
─────────────────────────                      ─────────────────                 ─────────────
1. POST /v1/sessions {email, password}   ──►   التحقق من الحساب (Argon2id)
                                          ◄──  token مرتبط بالمؤسسة
2. GET  /v1/browser-agent/me             ──►   الحساب، المؤسسة، هل المزوّد مضبوط
3. POST /v1/browser-agent/v1/messages    ──►   فلترة الطلب + مفتاح المؤسسة     ──►  Messages API
   (Authorization: Bearer <token>)        ◄──  بث الاستجابة كما هي            ◄──
```

* مفتاح النموذج محفوظ في Secrets Core على خادم إنفرا إيجنت لكل مؤسسة، ولا يصل إلى المتصفح أبدًا.
* كل استدعاء يُسجَّل في سجل التدقيق `agent.browser.model_call` دون محتوى الرسائل.
* تسجيل الخروج يلغي الجلسة على الخادم (`DELETE /v1/sessions/current`).
* الكود: `packages/agent/browser-agent.ts` و`packages/api/routes.ts` في مستودع Infera_Agent.

## 1) تجهيز خادم إنفرا إيجنت

1. انشر نسخة Infera_Agent التي تحتوي بوابة المتصفح (الفرع `claude/pensive-dijkstra-r61pm0`، commit `554775a`).
2. أضف مفتاح مزوّد النموذج لكل مؤسسة من الواجهة أو عبر `POST /v1/secrets`:
   `class: PLATFORM_PROVIDER_SECRET`، `name: ANTHROPIC_API_KEY`.
3. تأكد أن الخادم متاح عبر HTTPS (ملف `deploy/Caddyfile` يمرّر البث فورًا بعد هذا التعديل).
4. إن ضبطت `allowedOrigins` في الخادم، أضف `chrome-extension://<معرّف الإضافة>`.

## 2) بناء حزمة المتجر

```bash
node scripts/build-store.mjs --api-url https://<عنوان خادم إنفرا إيجنت> --version 1.0.0
# الناتج: dist/infera-agent-1.0.0.zip
```

السكربت يثبّت عنوان الخادم داخل الإضافة (`config.js`)، ويحذف مفتاح التطوير `key` من
`manifest.json` لأن المتجر يعطي معرّفًا خاصًا به.

## 3) الرفع على Chrome Web Store

1. أنشئ حساب مطوّر على https://chrome.google.com/webstore/devconsole (رسوم لمرة واحدة 5 دولارات).
2. **New item** ← ارفع `dist/infera-agent-<version>.zip`.
3. **Store listing**: الاسم «إنفرا إيجنت – Infera Agent»، الوصف (من `_locales/*/messages.json`
   وملف README)، الأيقونة `extension/icons/icon128.png`، ولقطات شاشة 1280×800 للوحة الجانبية.
4. **Privacy practices**:
   * Single purpose: «وكيل تصفح يقرأ الصفحة وينفّذ الأفعال التي يطلبها المستخدم باللغة الطبيعية».
   * برّر كل صلاحية (الجدول أدناه).
   * البيانات: محتوى المواقع، نشاط المستخدم، سجل التصفح (عناوين التبويبات المفتوحة)، معلومات
     التعريف الشخصية (البريد عند تسجيل الدخول)، المصادقة. لا بيع للبيانات ولا استخدام إعلاني.
   * رابط سياسة الخصوصية: انشر `docs/PRIVACY.md` على موقعك وضع الرابط.
5. **Distribution**: Public (للجميع)، أو Unlisted (لمن معه الرابط)، أو Private (لنطاق Google Workspace).
6. أرسل للمراجعة. إضافات صلاحية `debugger` و`<all_urls>` تأخذ مراجعة أطول عادة؛ التبرير الواضح يسرّعها.

| الصلاحية | التبرير المقترح للمتجر |
|---|---|
| `sidePanel` | عرض واجهة الوكيل في لوحة جانبية أثناء التصفح |
| `storage`, `unlimitedStorage` | حفظ الإعدادات والمواقع الموافق عليها والاختصارات والمحادثات محليًا |
| `scripting` | قراءة نص الصفحة وبنيتها وتعبئة النماذج بطلب المستخدم |
| `debugger` | تنفيذ النقر والكتابة والتقاط الشاشة التي يطلبها المستخدم |
| `tabs`, `tabGroups` | فتح التبويبات وإغلاقها وتنظيم تبويبات الوكيل في مجموعة منفصلة |
| `alarms` | تشغيل المهام المجدولة التي ينشئها المستخدم |
| `notifications` | إشعار المستخدم بانتهاء مهمة أو حاجتها لموافقة |
| `system.display` | معرفة أبعاد الشاشة لضبط اللقطات وتغيير حجم النافذة |
| `webNavigation` | حظر المواقع عالية الخطورة ورصد الانتقال بين النطاقات |
| `declarativeNetRequestWithHostAccess` | تعريف طلبات الإضافة لخادم إنفرا إيجنت |
| `offscreen` | تشغيل صوت الإشعار وإنشاء ملفات GIF |
| `nativeMessaging` | الربط الاختياري مع Infera Code على جهاز المستخدم |
| `downloads` | حفظ تسجيلات GIF واللقطات، والتنزيلات بعد موافقة المستخدم |
| `<all_urls>` | الوكيل يعمل على أي موقع يطلبه المستخدم |

## 4) بعد النشر

* معرّف المتجر يختلف عن معرّف التطوير. لربط Infera Code:
  `node native-host/install.js --extension-id <معرّف المتجر>,cginklpeajfbmijnfoegocimhaagbbll`
* التحديثات: ارفع ZIP بإصدار أعلى (`--version 1.0.1`)، وChrome يحدّث عند المستخدمين تلقائيًا.

## 5) للمؤسسات: تثبيت إجباري وإعداد مسبق

عبر Google Admin أو سياسات Chrome:

```json
{
  "ExtensionInstallForcelist": ["<معرّف المتجر>;https://clients2.google.com/service/update2/crx"],
  "3rdparty": { "extensions": { "<معرّف المتجر>": {
    "inferaUrl": "https://agent.company.com",
    "blocklist": ["bank.example"],
    "defaultPermissionMode": "ask",
    "disableSkipAllApprovals": true
  } } }
}
```

المفاتيح المتاحة موصوفة في `extension/managed_schema.json`.
