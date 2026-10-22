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
    micDenied: 'Microphone access is needed for narration — allow it on the settings page that just opened, then start recording again.', fromAccount: 'from your account', searchHistory: 'Search conversations…', loadMore: 'Load more', noMatches: 'No conversation matches.', compacted: 'Earlier steps were summarized so the task can keep going; your notebook and goals are kept.', budgetTitle: 'Spending limit reached', budgetContinue: 'Continue', budgetStop: 'Stop here',
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
    micDenied: 'يلزم السماح بالميكروفون للسرد الصوتي — اسمح به من صفحة الإعدادات التي فُتحت، ثم ابدأ التسجيل مرة أخرى.', fromAccount: 'من حسابك', searchHistory: 'ابحث في المحادثات…', loadMore: 'عرض المزيد', noMatches: 'لا توجد محادثة مطابقة.', compacted: 'لُخّصت الخطوات السابقة لتستمر المهمة دون توقف، مع الاحتفاظ بالأهداف ودفتر المهمة.', budgetTitle: 'تم الوصول إلى حد الإنفاق', budgetContinue: 'متابعة', budgetStop: 'توقف هنا',
    noProvider: 'لم تُضِف مؤسستك مزوّد النموذج في إنفرا إيجنت بعد. اطلب من المسؤول إضافته.',
  },
};

// Infera Agent Web: the execution center, history, studio and usage screens.
Object.assign(STR.en, {
  appName: 'Infera Agent', home: 'Home', connected: 'Connected', liveTitle: 'Task execution', studio: 'Workflow studio',
  emptyTitle: 'Tell it what to do. Watch it get done.',
  emptyHint: 'Write what you want — the agent opens the sites, signs in with your sessions, fills the forms and checks the result, step by step in front of you.',
  placeholder: 'Write what you want done… (type / for workflows)',
  qa_open: 'Open a site', qa_login: 'Sign in', qa_form: 'Fill a form', qa_upload: 'Upload files', qa_extract: 'Extract a table', qa_track: 'Track a request',
  qa_compare: 'Compare prices', qa_report: 'Create a report', qa_more: 'More',
  qa_open_p: 'Open ', qa_login_p: 'Sign in to ', qa_form_p: 'Fill in the form on this page with: ', qa_upload_p: 'Upload the attached files to ', qa_extract_p: 'Extract the table on this page into an Excel file',
  qa_track_p: 'Check the status of my request number … on ', qa_compare_p: 'Compare the price of … on ', qa_report_p: 'Create a report (PDF) about ',
  quickTasks: 'Quick tasks',
  qt_submit: 'Submit a request on a portal', qt_submit_p: 'Open [site], sign in, start a new [request type] request, fill it in with the details below, upload the documents I attached, and stop before the final submit so I can review.\n\nDetails: ',
  qt_status: 'Track a request\'s status', qt_status_p: 'Open [site], find my request number [number] and tell me its current status and any action needed.',
  qt_collect: 'Collect data from a site', qt_collect_p: 'Go to [site], collect [what] from every page of the results, and give me the list as an Excel file.',
  qt_table: 'Build a table from a page', qt_table_p: 'Turn the information on this page into a clean table with the columns: ',
  qt_prices: 'Compare prices', qt_prices_p: 'Compare the price of [product] on [site 1], [site 2] and [site 3], including delivery, and show the cheapest in a table.',
  qt_saved: 'Run a saved workflow', qt_saved_s: 'Your recorded and saved workflows',
  st_running: 'Running now…', st_paused: 'Paused', st_waiting: 'Waiting for you', st_done: 'Completed', st_error: 'Failed', st_stopped: 'Stopped', st_idle: 'Ready',
  pause: 'Pause', resume: 'Resume', takeOver: 'Take over', giveBack: 'Give control back', retry: 'Retry', continueTask: 'Continue', details: 'View details', exportResults: 'Export results',
  elapsed: 'Elapsed', stepOf: 'Step {n} of {m}', stepsDone: '{n} of {m} steps', noSteps: 'The agent shows its steps here as it works.', nowDoing: 'Now', activity: 'Recent actions',
  takenOverNote: 'You have control of the browser. Work in the page, then give control back — the agent will look at the page again and continue.',
  pausedNote: 'Paused after the current step. Resume when you are ready; you can also send new instructions.',
  liveIdle: 'No task is running. Start one from Home.', cost: 'Cost', site: 'Site', modelUsed: 'Model',
  allStatuses: 'All statuses', allSites: 'All sites', taskHistory: 'Task history', view: 'View',
  wfSaved: 'My workflows', wfTemplates: 'Templates', wfSchedules: 'Schedules', wfRecord: 'Record', wfNew: 'New workflow', wfImport: 'Import', wfExport: 'Export',
  wfEditor: 'Edit workflow', wfName: 'Workflow name', wfSteps: 'Steps', wfAddStep: 'Add step', wfTest: 'Test run', wfSave: 'Save workflow', wfVars: 'Variables',
  wfKind_do: 'Do', wfKind_if: 'If', wfKind_each: 'For each', wfKind_wait: 'Wait until', wfKind_check: 'Verify',
  wfImported: 'Imported {n} workflow(s).', wfBadFile: 'This file is not an Infera workflow export.', useTemplate: 'Use', recSettings: 'Recording settings',
  recVoice: 'Voice narration', recShots: 'Capture screenshots of steps', recFields: 'Detect form fields automatically', recNow: 'Start recording now', recSub: 'Record your steps in the browser and they become a reusable smart workflow.',
  usageTitle: 'Usage & costs', period_today: 'Today', period_week: 'This week', period_month: 'This month', totalCost: 'Total cost', byModel: 'By model', perDay: 'Per day', vsPrev: 'vs previous period',
  opModes: 'Operating modes', op_auto: 'Auto', op_fast: 'Fast', op_balanced: 'Balanced', op_power: 'Power', op_manual: 'Choose a model',
  op_auto_d: 'Picks the right power for each task', op_fast_d: 'Simple, quick tasks', op_balanced_d: 'Best value for most work', op_power_d: 'Complex, multi-step work',
  routedTo: 'Auto chose', because: 'for', theme: 'Theme', theme_dark: 'Dark', theme_light: 'Light', theme_auto: 'System',
});
Object.assign(STR.ar, {
  appName: 'Infera Agent', home: 'الرئيسية', connected: 'متصل', liveTitle: 'تنفيذ المهمة', studio: 'استوديو سير العمل',
  emptyTitle: 'اكتب ما تريد… وسيتم التنفيذ داخل المتصفح',
  emptyHint: 'وكيل ذكي ينفّذ مهامك في المواقع الإلكترونية بسرعة ودقة وأمان: يفتح المواقع، ويستخدم جلساتك، ويملأ النماذج، ويتحقق من النتيجة خطوة بخطوة أمامك.',
  placeholder: 'اكتب ما تريد تنفيذه… (اكتب / لسير العمل المحفوظ)',
  qa_open: 'فتح موقع', qa_login: 'تسجيل دخول', qa_form: 'تعبئة نموذج', qa_upload: 'رفع ملفات', qa_extract: 'استخراج جدول', qa_track: 'متابعة طلب',
  qa_compare: 'مقارنة أسعار', qa_report: 'إنشاء تقرير', qa_more: 'المزيد',
  qa_open_p: 'افتح ', qa_login_p: 'سجّل الدخول إلى ', qa_form_p: 'املأ النموذج في هذه الصفحة بالبيانات التالية: ', qa_upload_p: 'ارفع الملفات المرفقة إلى ', qa_extract_p: 'استخرج الجدول الموجود في هذه الصفحة إلى ملف Excel',
  qa_track_p: 'تابع حالة طلبي رقم … على ', qa_compare_p: 'قارن سعر … في ', qa_report_p: 'أنشئ تقريرًا (PDF) عن ',
  quickTasks: 'مهام سريعة',
  qt_submit: 'تقديم طلب على بوابة', qt_submit_p: 'افتح [الموقع]، وسجّل الدخول، وابدأ طلب [نوع الطلب] جديدًا، واملأه بالبيانات التالية، وارفع المستندات المرفقة، وتوقف قبل الإرسال النهائي لأراجعه.\n\nالبيانات: ',
  qt_status: 'متابعة حالة طلب', qt_status_p: 'افتح [الموقع]، وابحث عن طلبي رقم [الرقم]، وأخبرني بحالته الحالية وأي إجراء مطلوب.',
  qt_collect: 'جمع بيانات من موقع', qt_collect_p: 'ادخل إلى [الموقع]، واجمع [ما المطلوب] من كل صفحات النتائج، وسلّمني القائمة في ملف Excel.',
  qt_table: 'إنشاء جدول من صفحة', qt_table_p: 'حوّل المعلومات في هذه الصفحة إلى جدول منظّم بالأعمدة: ',
  qt_prices: 'مقارنة أسعار', qt_prices_p: 'قارن سعر [المنتج] في [موقع 1] و[موقع 2] و[موقع 3] شاملًا التوصيل، واعرض الأرخص في جدول.',
  qt_saved: 'تنفيذ سير عمل محفوظ', qt_saved_s: 'سير العمل الذي سجّلته وحفظته',
  st_running: 'جارٍ التنفيذ الآن…', st_paused: 'متوقف مؤقتًا', st_waiting: 'بانتظارك', st_done: 'مكتمل', st_error: 'فشل', st_stopped: 'أُوقف', st_idle: 'جاهز',
  pause: 'إيقاف مؤقت', resume: 'استئناف', takeOver: 'تولَّ التحكم', giveBack: 'أعد التحكم للوكيل', retry: 'إعادة المحاولة', continueTask: 'متابعة', details: 'عرض التفاصيل', exportResults: 'تصدير النتائج',
  elapsed: 'الوقت المنقضي', stepOf: 'الخطوة {n} من {m}', stepsDone: '{n} من {m} خطوات', noSteps: 'يعرض الوكيل خطواته هنا أثناء العمل.', nowDoing: 'الآن', activity: 'آخر الإجراءات',
  takenOverNote: 'التحكم في المتصفح لك الآن. اعمل في الصفحة ثم أعد التحكم للوكيل — سيعيد النظر في الصفحة ويكمل.',
  pausedNote: 'توقف الوكيل بعد الخطوة الحالية. استأنف متى شئت، ويمكنك أيضًا إرسال تعليمات جديدة.',
  liveIdle: 'لا توجد مهمة قيد التنفيذ. ابدأ واحدة من الرئيسية.', cost: 'التكلفة', site: 'الموقع', modelUsed: 'النموذج',
  allStatuses: 'جميع الحالات', allSites: 'كل المواقع', taskHistory: 'سجل المهام', view: 'عرض',
  wfSaved: 'مهامي المحفوظة', wfTemplates: 'قوالب جاهزة', wfSchedules: 'الجدولة', wfRecord: 'تسجيل جديد', wfNew: 'سير عمل جديد', wfImport: 'استيراد', wfExport: 'تصدير',
  wfEditor: 'تعديل سير العمل', wfName: 'اسم سير العمل', wfSteps: 'الخطوات', wfAddStep: 'إضافة خطوة', wfTest: 'تجربة التنفيذ', wfSave: 'حفظ سير العمل', wfVars: 'المتغيرات',
  wfKind_do: 'نفّذ', wfKind_if: 'إذا', wfKind_each: 'لكل', wfKind_wait: 'انتظر حتى', wfKind_check: 'تحقّق',
  wfImported: 'تم استيراد {n} من سير العمل.', wfBadFile: 'هذا الملف ليس تصديرًا لسير عمل إنفرا.', useTemplate: 'استخدم', recSettings: 'إعدادات التسجيل',
  recVoice: 'التسجيل الصوتي', recShots: 'التقاط لقطات الشاشة', recFields: 'اكتشاف الحقول تلقائيًا', recNow: 'ابدأ التسجيل الآن', recSub: 'سجّل خطواتك في المتصفح وستتحول إلى سير عمل ذكي قابل لإعادة الاستخدام.',
  usageTitle: 'الاستخدام والتكاليف', period_today: 'اليوم', period_week: 'هذا الأسبوع', period_month: 'هذا الشهر', totalCost: 'إجمالي التكلفة', byModel: 'تفاصيل الاستخدام حسب النموذج', perDay: 'يوميًا', vsPrev: 'مقارنة بالفترة السابقة',
  opModes: 'أوضاع التشغيل', op_auto: 'تلقائي', op_fast: 'سريع', op_balanced: 'متوازن', op_power: 'قوي', op_manual: 'اختيار نموذج',
  op_auto_d: 'يختار القوة المناسبة لكل مهمة', op_fast_d: 'لمهام بسيطة وسريعة', op_balanced_d: 'أفضل توازن لمعظم المهام', op_power_d: 'للمهام المعقدة متعددة الخطوات',
  routedTo: 'اختار الوضع التلقائي', because: 'لأنها', theme: 'المظهر', theme_dark: 'داكن', theme_light: 'فاتح', theme_auto: 'حسب النظام',
});

let lang = (navigator.language || 'en').startsWith('ar') ? 'ar' : 'en';

export function setLanguage(l) {
  if (l === 'ar' || l === 'en') lang = l;
  else lang = (navigator.language || 'en').startsWith('ar') ? 'ar' : 'en';
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'ar' ? 'rtl' : 'ltr';
}

export function t(key, vars) {
  let s = STR[lang][key] ?? STR.en[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.split(`{${k}}`).join(String(v));
  return s;
}

export function currentLang() { return lang; }

export function applyI18n(root = document) {
  root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
  root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); el.setAttribute('aria-label', t(el.dataset.i18nTitle)); });
  root.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
}

export const MODE_LABEL = { ask: 'modeAsk', auto: 'modeAuto', follow_a_plan: 'modePlan', skip_all_permission_checks: 'modeSkip' };
