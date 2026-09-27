# نشر إنفرا إيجنت لكل المستخدمين — Publishing Infera Agent

الهدف: أن يثبّت أي مستخدم الإضافة على أي جهاز من متجر Chrome، ثم يسجّل الدخول بحسابه
على إنفرا إيجنت، دون مفتاح API ودون أي إعداد.

## كيف يعمل الربط بحساب إنفرا إيجنت (inferaagent.com)

```
الإضافة (متصفح المستخدم)                     inferaagent.com                      مزوّد النموذج
─────────────────────────                     ───────────────                      ─────────────
1. /.well-known/oauth-authorization-server ►  بيانات OAuth
2. POST /oauth/register (مرة واحدة)       ►  client_id للإضافة
3. نافذة /oauth/authorize                 ►  المستخدم يسجّل الدخول (كلمة مرور/Google/SSO) ويوافق
4. POST /oauth/token (PKCE)               ►  access_token + refresh_token
5. GET  /api/browser-agent/me             ►  الحساب، الرصيد، هل الوكيل متاح
6. POST /api/browser-agent/v1/messages    ►  فحص الرصيد + فلترة + مفتاح المنصة      ►  Messages API
                                          ◄  بث الاستجابة كما هي، ثم خصم التوكنز من الرصيد
```

* مفتاح النموذج على خادم المنصة فقط؛ لا يصل إلى المتصفح.
* الاستهلاك يُخصم من رصيد المستخدم (عملية `browser_agent` في دفتر الحسابات)، وعند نفاد الرصيد يرد
  الخادم بـ 402 وتظهر للمستخدم رسالة «اشحن رصيدك».
* التوكن يتجدد تلقائيًا (refresh token)، ويمكن للمستخدم إلغاء «INFERA Agent for Chrome» من
  الإعدادات ← Connect في inferaagent.com.
* الكود: `apps/server/src/browserAgent.ts` في مستودع Infera_Agent، الفرع
  `claude/pensive-dijkstra-r61pm0-chrome-gateway` (مبني على `claude/owner-real-services`).

## 1) تفعيل البوابة على inferaagent.com

1. راجع الفرع `claude/pensive-dijkstra-r61pm0-chrome-gateway` في مستودع Infera_Agent.
2. ادمجه في `claude/owner-real-services`. **الدمج ينشر على الإنتاج تلقائيًا** (`.github/workflows/deploy.yml`).
3. تحقّق بعد النشر: `curl -i https://inferaagent.com/api/browser-agent/me` يجب أن يرد `401` بصيغة JSON.

## 2) بناء حزمة المتجر

```bash
node scripts/build-store.mjs --api-url https://inferaagent.com --version 1.0.0
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
| `identity` | تسجيل الدخول بحساب إنفرا إيجنت (OAuth) في نافذة آمنة |
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
    "inferaUrl": "https://inferaagent.com",
    "blocklist": ["bank.example"],
    "defaultPermissionMode": "ask",
    "disableSkipAllApprovals": true
  } } }
}
```

المفاتيح المتاحة موصوفة في `extension/managed_schema.json`.
