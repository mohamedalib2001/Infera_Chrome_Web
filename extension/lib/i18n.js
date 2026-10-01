// UI strings (Arabic / English). Language: settings.language or browser locale.
const STR = {
  en: {
    appName: 'Infera Agent',
    newChat: 'New chat', history: 'History', shortcuts: 'Shortcuts', scheduled: 'Scheduled tasks', record: 'Record workflow', settings: 'Settings',
    placeholder: 'Ask Infera to do something on this page… (type / for shortcuts)',
    send: 'Send', stop: 'Stop', attach: 'Attach a screenshot of this tab', emptyTitle: 'What should Infera do?',
    emptyHint: 'Infera can read this page, click, type, fill forms, and work across tabs using your signed-in sessions. You can watch every step and stop at any time.',
    ex1: 'Summarize this page', ex2: 'Find the cheapest flight from Cairo to Dubai next Friday', ex3: 'Fill this form with my details', ex4: 'Compare these products in a table',
    thinking: 'Thinking', working: 'Working…', waiting: 'Waiting for your approval', done: 'Done', stopped: 'Stopped', error: 'Error',
    allowOnce: 'Allow this action', allowAlways: 'Always allow on this site', decline: 'Decline',
    wantsTo: 'Infera Agent wants to', planTitle: 'Proposed plan', planSites: 'Sites', approvePlan: 'Approve plan', rejectPlan: 'Make changes',
    modeAsk: 'Manually approve', modeAuto: 'Automatically approve', modePlan: 'Ask before acting', modeSkip: 'Skip all approvals',
    model: 'Model', mode: 'Approvals', noKey: 'Sign in with your INFERA Agent account to start.', openSettings: 'Open settings',
    save: 'Save', cancel: 'Cancel', delete: 'Delete', run: 'Run', edit: 'Edit', schedule: 'Schedule', close: 'Close',
    command: 'Command', description: 'Description', prompt: 'Prompt', startUrl: 'Start URL (optional)',
    newShortcut: 'New shortcut', noShortcuts: 'No shortcuts yet. Save your best prompts and run them with "/".',
    newTask: 'New scheduled task', noTasks: 'No scheduled tasks.', frequency: 'Frequency', time: 'Time', date: 'Date',
    once: 'Once', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly', annually: 'Yearly', dayOfWeek: 'Day of week', dayOfMonth: 'Day of month', month: 'Month',
    lastRun: 'Last run', nextRun: 'Next run', runNow: 'Run now', enabled: 'Enabled', name: 'Name',
    recStart: 'Start recording', recStop: 'Stop & create shortcut', recHint: 'Do the task yourself in this tab. Narrate what you are doing — your voice is transcribed and used as the main signal of intent.',
    recording: 'Recording…', steps: 'steps', mic: 'Narrate with microphone', recDraft: 'Review the generated shortcut',
    noHistory: 'No conversations yet.', tokensSaved: 'tokens saved by compaction', captureRegion: 'Drag to select a region, or use the full screenshot',
    useFull: 'Use full screenshot', useRegion: 'Use selection', you: 'You', tool: 'Tool', result: 'Result', copy: 'Copy',
    injection: 'Content on web pages is treated as untrusted data.', blockedTitle: 'Blocked',
    signInTitle: 'Sign in to INFERA Agent', signInHint: 'Use your INFERA Agent account (inferaagent.com). Usage is paid from your credits; no API key is needed.',
    credits: 'Credits', blockCredits: "You're out of credits. Top up on inferaagent.com to continue.", blockCap: 'Your monthly spending cap on INFERA Agent is reached.', blockConsent: 'Open inferaagent.com and accept the updated terms first.',
    email: 'Email', password: 'Password', server: 'INFERA Agent address (https://inferaagent.com)', signIn: 'Sign in with INFERA Agent', signOut: 'Sign out',
    createAccount: "Don't have an account? Create one on inferaagent.com", signedInAs: 'Signed in as',
    attachFile: 'Attach files from your device (the agent can read them and upload them to sites)', sources: 'Sources:', fileTooBig: 'Attachments are limited to 10 MB in total.',
    costs: 'Costs', balance: 'Balance', today: 'Today', thisMonth: 'This month', thisTask: 'Cost of this conversation so far',
    limits: 'Spending limits', taskLimit: 'Limit per task', taskLimitHint: 'When a task reaches it, the agent asks before spending more. 0 = no limit.',
    dailyLimit: 'Daily limit', dailyLimitHint: 'Saved in your Infera Agent account and applied on every device: tasks stop once today\'s spending reaches it. 0 = no limit.',
    dailyLimitOwnerHint: 'The same limit as "daily browser-agent spend" in the Owner dashboard (in dollars). 0 = no limit.', spentToday: 'Spent today',
    effortLabel: 'Thinking effort', effortHint: 'Medium gives the best value; higher thinks longer and costs more per step.',
    effort_low: 'Low — cheapest', effort_medium: 'Medium — recommended', effort_high: 'High', effort_xhigh: 'Extra high — most expensive',
    webResearchLabel: 'Web research (each search is charged)', byTask: 'By task (last 30 days)', operations: 'Operations log',
    calls: 'calls', searches: 'searches', cacheSaved: 'History served from cache (10× cheaper)', untitled: '(untitled)',
    noCosts: 'No costs yet.', costsLocalOnly: 'Showing this browser only',
    micDenied: 'Microphone access is needed for narration — allow it on the settings page that just opened, then start recording again.', fromAccount: 'from your account', budgetTitle: 'Spending limit reached', budgetContinue: 'Continue', budgetStop: 'Stop here',
    noProvider: 'Your organization has not set up a model provider in Infera Agent yet. Ask an administrator to add it.',
  },
  ar: {
    appName: 'إنفرا إيجنت',
    newChat: 'محادثة جديدة', history: 'السجل', shortcuts: 'الاختصارات', scheduled: 'المهام المجدولة', record: 'تسجيل سير عمل', settings: 'الإعدادات',
    placeholder: 'اطلب من إنفرا تنفيذ مهمة على هذه الصفحة… (اكتب / للاختصارات)',
    send: 'إرسال', stop: 'إيقاف', attach: 'إرفاق لقطة شاشة لهذا التبويب', emptyTitle: 'ماذا تريد أن يفعل إنفرا؟',
    emptyHint: 'يستطيع إنفرا قراءة هذه الصفحة والنقر والكتابة وتعبئة النماذج والعمل عبر التبويبات باستخدام جلسات تسجيل دخولك. تشاهد كل خطوة ويمكنك الإيقاف في أي لحظة.',
    ex1: 'لخّص هذه الصفحة', ex2: 'ابحث عن أرخص رحلة من القاهرة إلى دبي يوم الجمعة القادم', ex3: 'عبّئ هذا النموذج ببياناتي', ex4: 'قارن هذه المنتجات في جدول',
    thinking: 'يفكّر', working: 'يعمل…', waiting: 'بانتظار موافقتك', done: 'اكتمل', stopped: 'أُوقف', error: 'خطأ',
    allowOnce: 'السماح بهذا الإجراء', allowAlways: 'السماح دائمًا على هذا الموقع', decline: 'رفض',
    wantsTo: 'إنفرا إيجنت يريد أن', planTitle: 'الخطة المقترحة', planSites: 'المواقع', approvePlan: 'اعتماد الخطة', rejectPlan: 'تعديل',
    modeAsk: 'موافقة يدوية', modeAuto: 'موافقة تلقائية', modePlan: 'اسأل قبل التنفيذ', modeSkip: 'تخطي كل الموافقات',
    model: 'النموذج', mode: 'الموافقات', noKey: 'سجّل الدخول بحساب إنفرا إيجنت للبدء.', openSettings: 'فتح الإعدادات',
    save: 'حفظ', cancel: 'إلغاء', delete: 'حذف', run: 'تشغيل', edit: 'تعديل', schedule: 'جدولة', close: 'إغلاق',
    command: 'الأمر', description: 'الوصف', prompt: 'البرومت', startUrl: 'رابط البداية (اختياري)',
    newShortcut: 'اختصار جديد', noShortcuts: 'لا توجد اختصارات بعد. احفظ أفضل برومتاتك وشغّلها بكتابة «/».',
    newTask: 'مهمة مجدولة جديدة', noTasks: 'لا توجد مهام مجدولة.', frequency: 'التكرار', time: 'الوقت', date: 'التاريخ',
    once: 'مرة واحدة', daily: 'يومي', weekly: 'أسبوعي', monthly: 'شهري', annually: 'سنوي', dayOfWeek: 'يوم الأسبوع', dayOfMonth: 'يوم الشهر', month: 'الشهر',
    lastRun: 'آخر تشغيل', nextRun: 'التشغيل القادم', runNow: 'تشغيل الآن', enabled: 'مفعّلة', name: 'الاسم',
    recStart: 'بدء التسجيل', recStop: 'إيقاف وإنشاء اختصار', recHint: 'نفّذ المهمة بنفسك في هذا التبويب. اشرح بصوتك ما تفعله — يُفرَّغ صوتك نصيًا ويُستخدم كإشارة أساسية للنية.',
    recording: 'جارٍ التسجيل…', steps: 'خطوات', mic: 'السرد بالميكروفون', recDraft: 'راجع الاختصار الناتج',
    noHistory: 'لا توجد محادثات بعد.', tokensSaved: 'رمز وُفِّرت بالضغط', captureRegion: 'اسحب لتحديد منطقة، أو استخدم اللقطة كاملة',
    useFull: 'استخدام اللقطة كاملة', useRegion: 'استخدام التحديد', you: 'أنت', tool: 'أداة', result: 'النتيجة', copy: 'نسخ',
    injection: 'محتوى صفحات الويب يُعامَل كبيانات غير موثوقة.', blockedTitle: 'محظور',
    signInTitle: 'سجّل الدخول إلى إنفرا إيجنت', signInHint: 'استخدم حسابك على إنفرا إيجنت (inferaagent.com). الاستخدام يُخصم من رصيدك، ولا تحتاج إلى مفتاح API.',
    credits: 'الرصيد', blockCredits: 'رصيدك نفد. اشحن رصيدك على inferaagent.com للمتابعة.', blockCap: 'وصلت إلى حد الإنفاق الشهري في إنفرا إيجنت.', blockConsent: 'افتح inferaagent.com ووافق على الشروط المحدّثة أولًا.',
    email: 'البريد الإلكتروني', password: 'كلمة المرور', server: 'عنوان إنفرا إيجنت (https://inferaagent.com)', signIn: 'تسجيل الدخول بحساب إنفرا إيجنت', signOut: 'تسجيل الخروج',
    createAccount: 'ليس لديك حساب؟ أنشئ حسابًا على inferaagent.com', signedInAs: 'مسجّل الدخول باسم',
    attachFile: 'إرفاق ملفات من جهازك (يقرؤها الوكيل ويرفعها إلى المواقع)', sources: 'المصادر:', fileTooBig: 'الحد الأقصى للمرفقات 10 ميجابايت.',
    costs: 'التكاليف', balance: 'الرصيد', today: 'اليوم', thisMonth: 'هذا الشهر', thisTask: 'تكلفة هذه المحادثة حتى الآن',
    limits: 'حدود الإنفاق', taskLimit: 'الحد لكل مهمة', taskLimitHint: 'عندما تصل المهمة إليه يسألك الوكيل قبل أن يكمل. 0 = بلا حد.',
    dailyLimit: 'الحد اليومي', dailyLimitHint: 'محفوظ في حسابك على إنفرا إيجنت ويُطبَّق على كل أجهزتك: تتوقف المهام عندما يصل إنفاق اليوم إليه. 0 = بلا حد.',
    dailyLimitOwnerHint: 'هو نفس حد «أقصى صرف يومي للوكيل في المتصفح» في مساحة المالك (بالدولار). 0 = بلا حد.', spentToday: 'إنفاق اليوم',
    effortLabel: 'مستوى التفكير', effortHint: 'المتوسط يعطي أفضل قيمة؛ الأعلى يفكر أطول وتكلفته أكبر في كل خطوة.',
    effort_low: 'منخفض — الأرخص', effort_medium: 'متوسط — موصى به', effort_high: 'عالٍ', effort_xhigh: 'عالٍ جدًا — الأغلى',
    webResearchLabel: 'البحث في الإنترنت (كل عملية بحث تُحتسب)', byTask: 'حسب المهمة (آخر 30 يومًا)', operations: 'سجل العمليات',
    calls: 'طلبات', searches: 'عمليات بحث', cacheSaved: 'نسبة السجل المقروء من الذاكرة المؤقتة (أرخص 10 مرات)', untitled: '(بدون عنوان)',
    noCosts: 'لا توجد تكاليف بعد.', costsLocalOnly: 'يُعرض ما في هذا المتصفح فقط',
    micDenied: 'يلزم السماح بالميكروفون للسرد الصوتي — اسمح به من صفحة الإعدادات التي فُتحت، ثم ابدأ التسجيل مرة أخرى.', fromAccount: 'من حسابك', budgetTitle: 'تم الوصول إلى حد الإنفاق', budgetContinue: 'متابعة', budgetStop: 'توقف هنا',
    noProvider: 'لم تُضِف مؤسستك مزوّد النموذج في إنفرا إيجنت بعد. اطلب من المسؤول إضافته.',
  },
};

let lang = (navigator.language || 'en').startsWith('ar') ? 'ar' : 'en';

export function setLanguage(l) {
  if (l === 'ar' || l === 'en') lang = l;
  else lang = (navigator.language || 'en').startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function t(key) {
  return STR[lang][key] ?? STR.en[key] ?? key;
}

export function currentLang() { return lang; }

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

export const MODE_LABEL = { ask: 'modeAsk', auto: 'modeAuto', follow_a_plan: 'modePlan', skip_all_permission_checks: 'modeSkip' };
