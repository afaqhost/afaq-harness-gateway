const $ = (s) => document.querySelector(s);
const token = () => localStorage.getItem('afaq_token');
let language = localStorage.getItem('afaq_lang') || 'ar';
let currentConversationId = localStorage.getItem('afaq_current_conv') ? parseInt(localStorage.getItem('afaq_current_conv')) : null;
let conversationsCache = [];
let isStreaming = false;

// ---------- Theme: auto (prefers-color-scheme) + manual toggle ----------
let theme = (() => {
  try {
    const saved = localStorage.getItem('afaq_theme');
    if (saved === 'light' || saved === 'dark') return saved;
    return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
  } catch { return 'dark'; }
})();
function applyTheme(t, persist = true) {
  theme = t;
  document.documentElement.setAttribute('data-theme', t);
  document.documentElement.style.colorScheme = t;
  const meta = document.getElementById('theme-color-meta');
  if (meta) meta.content = t === 'light' ? '#f8fafc' : '#0B1020';
  // brand lockup switch
  document.querySelectorAll('.brand-lockup, .login-logo, .setup-logo').forEach(img => {
    if (img.src.includes('lockup-')) {
      img.src = t === 'light' ? '/static/brand/lockup-dark.png' : '/static/brand/lockup-white.png';
    }
  });
  const icon = document.getElementById('theme-icon');
  if (icon) icon.innerHTML = t === 'light'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  // sync wizard toggle icon as well
  const setupIcon = document.querySelector('#setup-theme-toggle svg');
  if (setupIcon) setupIcon.innerHTML = t === 'light'
    ? '<circle cx="12" cy="12" r="5"/><line x1="12" y1="1" x2="12" y2="3"/><line x1="12" y1="21" x2="12" y2="23"/><line x1="4.22" y1="4.22" x2="5.64" y2="5.64"/><line x1="18.36" y1="18.36" x2="19.78" y2="19.78"/><line x1="1" y1="12" x2="3" y2="12"/><line x1="21" y1="12" x2="23" y2="12"/><line x1="4.22" y1="19.78" x2="5.64" y2="18.36"/><line x1="18.36" y1="5.64" x2="19.78" y2="4.22"/>'
    : '<path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"/>';
  const btn = document.getElementById('theme-toggle');
  if (btn) btn.title = t === 'light' ? (language==='ar' ? 'الوضع الفاتح (اضغط للتحويل لداكن)' : 'Light (click for dark)') : (language==='ar' ? 'الوضع الداكن (اضغط للتحويل لفاتح)' : 'Dark (click for light)');
  const setupBtn = document.getElementById('setup-theme-toggle');
  if (setupBtn) setupBtn.title = t === 'light' ? (language==='ar' ? 'الوضع الفاتح' : 'Light') : (language==='ar' ? 'الوضع الداكن' : 'Dark');
  if (persist) try { localStorage.setItem('afaq_theme', t); } catch {}
}
function toggleTheme() {
  applyTheme(theme === 'light' ? 'dark' : 'light');
}
// listen to system changes only when user hasn't set manual preference
try {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener('change', e => {
    if (!localStorage.getItem('afaq_theme')) applyTheme(e.matches ? 'light' : 'dark', false);
  });
} catch {}
// double-click / long-press to reset to auto
function resetThemeToAuto() {
  try { localStorage.removeItem('afaq_theme'); } catch {}
  applyTheme(window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark', false);
}

const translations = {
  ar: {
    newChat: 'محادثة جديدة', chat: 'المحادثة', harnesses: 'الهارنسس', apiKeys: 'مفاتيح API', users: 'المستخدمون', docs: 'التوثيق', usage: 'الاستهلاك', workspace: 'مساحة العمل', logout: 'تسجيل الخروج', installed: 'مثبّت', notInstalled: 'غير مثبّت', chatSubtitle: 'تحدث مع أي Harness من مكان واحد — محادثات محفوظة مع ذاكرة سياقية', online: 'البوابة متصلة', secureAccess: 'وصول آمن', loginTitle: 'تسجيل الدخول', loginDescription: 'أدخل بيانات حسابك للوصول إلى لوحة Afaq.', email: 'البريد الإلكتروني', password: 'كلمة المرور', login: 'دخول', welcomeTitle: 'مساحة تفكير واحدة،', welcomeTitleAccent: 'كل الهارنسس.', welcomeDescription: 'اختر موديلًا من القائمة وابدأ محادثة جديدة. محادثاتك محفوظة تلقائيًا مع ذاكرة سياقية.', model: 'الموديل', loading: 'جارٍ التحميل...', messagePlaceholder: 'اكتب رسالتك هنا... (المحادثة لها ذاكرة)', enterHint: 'Enter للإرسال · Shift + Enter لسطر جديد — المحادثة تحفظ تلقائيًا', send: 'إرسال', harnessTitle: 'الأدوات المتصلة', refresh: 'تحديث الموديلات', keyTitle: 'مفاتيح الوصول', createKey: 'إنشاء مفتاح', userTitle: 'المستخدمون والصلاحيات', addUser: 'إضافة مستخدم', displayName: 'الاسم',
    docsTitle: 'توثيق API', docsIntro: 'AFAQ Gateway واجهة متوافقة مع OpenAI تتيح الوصول إلى نماذج الذكاء الاصطناعي من أي تطبيق. جميع النماذج المثبتة متاحة فورًا.', docsOverviewTitle: 'نظرة عامة', docsOverviewText: 'تدعم البوابة معايير OpenAI كاملة —authentication, list models, chat completions, streaming — مع إضافات خاصة بالبوابة.', docsBaseUrl: 'رابط القاعدة', docsBaseUrlText: 'الرابط الأساسي للبوابة هو عنوان الخادم متبوعًا بـ v1', docsQuickStartTitle: 'البداية السريعة', docsQuickStartText: 'أنشئ مفتاح API من لوحة التحكم، ثم أرسل أول طلب في خطوتين: المصادقة ثم الإرسال.', docsAuthTitle: 'المصادقة', docsAuthText: 'أنشئ مفتاح API من لوحة التحكم وأرسله في ترويسة Authorization مع كل طلب بهذا الشكل: Bearer afaq_YOUR_KEY', docsModelsTitle: 'الموديلات', docsModelsText: 'استخدم GET /v1/models لمعرفة قائمة كاملة بجميع الموديلات المتاحة من جميع الهارنسس المثبتة.', docsResponseTitle: 'الاستجابة', docsResponseText: 'الرد الكامل موجود في choices[0].message.content. تأكد من التحقق من ok === true.', docsModelsHeading: 'جلب الموديلات', docsModelsBody: 'يعيد هذا المسار قائمة بجميع الموديلات المتاحة. كل موديل له معرف فريد بصيغة harness/provider/model — مثل opencode//opencode/big-pickle.', docsChatHeading: 'إرسال رسالة', docsChatBody: 'أرسل طلب POST إلى /v1/chat/completions مع مفتاح API في الترويسة ورسائل المحادثة في الجسم.', docsModelIdTitle: 'صيغة معرف الموديل', docsModelIdText: 'كل معرف موديل يتكون من ثلاثة أجزاء مفصولة بـ //: اسم الهارنسس // المزود // اسم الموديل. مثال: opencode//opencode/big-pickle.', docsContextTitle: 'الذاكرة السياقية', docsContextText: 'البوابة تحفظ سياق المحادثة تلقائيًا لكل محادثة على حدة. أرسل نفس محادثة继续保持 نفس السياق دون إعادة إرسال السجل.', docsSystemPromptTitle: 'التعليمات النظامية', docsSystemPromptText: 'أضف role: system في مصفوفة الرسائل لتعيين سلوك الموديل. سيتم إرسالها مع كل طلب.', docsStreamHeading: 'البث المباشر (Streaming)', docsStreamText: 'فعّل stream: true للحصول على الرد تدريجيًا عبر SSE. كل جزء يحتوي delta.content يتم إلحاقه بالرد. الطلب الناجح ينتهي بـ data: [DONE].', docsStreamExampleHeading: 'مثال على البث', docsStreamExampleText: 'أضف stream: true في جسم الطلب، ثم اقرأ Server-Sent Events من الاستجابة.', docsErrorsTitle: 'أخطاء شائعة', docsErrorsText: '401 = مفتاح غير صالح أو انتهت الجلسة. 400 = اسم هارنس غير معروف. 502 = خطأ في أداة CLI. 504 = انتهت مهلة الاتصال.',
    searchModels: 'ابحث عن موديل... (claude, gpt, gemini)', filterAll: 'الكل', modelFooterHint: '↑↓ للتنقل · Enter للاختيار · Esc للإغلاق', noModelsFound: 'لا توجد نتائج',
    setupEyebrow: 'الإعداد الأولي — 3 خطوات', setupTitle: 'مرحباً بك في AFAQ', setupSubtitle: 'أنشئ حساب المدير ثم اختر الأدوات التي تريد تثبيتها — كل شيء داخل الكونتينر',
    setupStep1: 'حساب المدير', setupStep2: 'الأدوات', setupStep3: 'جاهز',
    terminal: 'الترمنال', terminalTitle: 'ترمنال النظام', terminalSubtitle: 'شل كامل على نفس المستخدم الذي شغّل البوابة — استخدمه للأوامر والصيانة', stop: 'إيقاف',
    setupCreateAdmin: 'إنشاء حساب المدير', setupCreateDesc: 'هذا الحساب سيكون المدير الأول — يمكنك إضافة مستخدمين لاحقاً من لوحة التحكم',
    confirmPassword: 'تأكيد كلمة المرور', setupCreateBtn: 'إنشاء الحساب والدخول', setupHint: 'سيتم تسجيل دخولك تلقائياً بعد الإنشاء',
    setupHarnessTitle: 'الأدوات المتاحة', setupHarnessDesc: 'اختر ما تريد تثبيته الآن — يمكنك تثبيت البقية لاحقاً من صفحة الهارنسس. التثبيت يتم داخل الكونتينر بالأمر الرسمي لكل أداة.',
    installLog: 'سجل التثبيت', close: 'إغلاق', setupSkip: 'تخطي — الذهاب للمحادثة', setupNext: 'متابعة',
    setupDockerNote: 'على الخادم المضيف: يمكنك أيضاً تثبيت الأداة يدوياً بالأمر الموضّح على البطاقة ثم اضغط تحديث',
    setupDoneTitle: 'كل شيء جاهز!', setupDoneDesc: 'تم إنشاء حسابك وتجهيز البوابة. يمكنك الآن بدء المحادثة أو إنشاء مفاتيح API.',
    setupGoChat: 'الذهاب للمحادثة', installing: 'جارٍ التثبيت...', install: 'تثبيت', update: 'تحديث', installed: 'مثبّت', notInstalled: 'غير مثبّت',
    setupPasswordMismatch: 'كلمتا المرور غير متطابقتين', setupPasswordShort: 'كلمة المرور قصيرة — 8 أحرف على الأقل',
    setupEmailInvalid: 'البريد الإلكتروني غير صالح', setupCreating: 'جارٍ الإنشاء...',
    viewLog: 'عرض السجل', cancel: 'إلغاء', confirm: 'تأكيد', prompt: 'إدخال',
    copied: 'تم النسخ', copiedMsg: 'تم النسخ', copyMsg: 'نسخ', retry: 'إعادة', you: 'أنت', assistant: 'المساعد', typing: 'يكتب...', messages: 'رسائل', newChatTitle: 'محادثة جديدة', rename: 'إعادة تسمية', delete: 'حذف', active: 'نشط', disabled: 'معطّل', noKeys: 'لا توجد مفاتيح بعد', noChats: 'لا توجد محادثات بعد',
    refreshError: 'فشل التحديث', keyError: 'خطأ المفتاح', toggleError: 'خطأ التبديل', deleteError: 'خطأ الحذف', deleteConfirm: 'هل أنت متأكد من حذف هذا المفتاح؟', confirmDelete: 'تأكيد الحذف',
    chatError: 'خطأ المحادثة', sessionExpired: 'انتهت الجلسة — يرجى تسجيل الدخول مجدداً',
    usageTotal: 'إجمالي', usage: 'الاستهلاك', usageHarness: 'الهارنس', usageModel: 'الموديل', usageTokens: 'الرموز', usageLatency: 'الزمن', usageDate: 'التاريخ', export: 'تصدير', prev: 'السابق', next: 'التالي', filters: 'الفلاتر', apply: 'تطبيق', clearFilters: 'مسح الفلاتر', usageChartTitle: 'الاستهلاك خلال 7 أيام', usageHistory: 'السجل التفصيلي', models: 'موديلات',
    filterAllHarnesses: 'كل الهارنسس', usageModelPlaceholder: 'فلتر الموديل', dateRange: 'النطاق الزمني', last7Days: 'آخر 7 أيام', last30Days: 'آخر 30 يوم', last90Days: 'آخر 90 يوم', allTime: 'كل الوقت', usageChartEmpty: 'لا توجد بيانات كافية للرسم', usageEmpty: 'لا توجد بيانات بعد', usageStatTotal: 'إجمالي'
  },
  en: {
    newChat: 'New chat', chat: 'Chat', harnesses: 'Harnesses', apiKeys: 'API keys', users: 'Users', docs: 'Docs', usage: 'Usage', workspace: 'Workspace', logout: 'Log out', installed: 'Installed', notInstalled: 'Not installed', chatSubtitle: 'Talk to any harness from one place — saved chats with context memory', online: 'Gateway online', secureAccess: 'Secure access', loginTitle: 'Sign in', loginDescription: 'Enter your account details to access Afaq.', email: 'Email address', password: 'Password', login: 'Sign in', welcomeTitle: 'One thinking space,', welcomeTitleAccent: 'All Harnesses.', welcomeDescription: 'Choose a model and start a new conversation. Chats are auto-saved with context memory.', model: 'Model', loading: 'Loading...', messagePlaceholder: 'Write your message... (chat has memory)', enterHint: 'Enter to send · Shift + Enter for new line — chat auto-saves', send: 'Send', harnessTitle: 'Connected tools', refresh: 'Refresh models', keyTitle: 'Access keys', createKey: 'Create key', userTitle: 'Users and permissions', addUser: 'Add user', displayName: 'Name',
    terminal: 'Terminal', terminalTitle: 'OS Terminal', terminalSubtitle: 'Full shell as the user running the gateway — for commands and maintenance', stop: 'Stop',
    docsTitle: 'API Documentation', docsIntro: 'AFAQ Gateway is an OpenAI-compatible interface for AI models from any application. All installed models are immediately available.', docsOverviewTitle: 'Overview', docsOverviewText: 'The gateway supports the full OpenAI standard — authentication, list models, chat completions, streaming — plus gateway-specific extensions.', docsBaseUrl: 'Base URL', docsBaseUrlText: 'The base URL is your gateway server address followed by /v1', docsQuickStartTitle: 'Quick Start', docsQuickStartText: 'Create an API key from the dashboard, then send your first request in two steps: authenticate, then send.', docsAuthTitle: 'Authentication', docsAuthText: 'Create an API key from the dashboard and include it in the Authorization header with every request: Bearer afaq_YOUR_KEY', docsModelsTitle: 'Models', docsModelsText: 'Use GET /v1/models to get a full list of all available models from all installed harnesses.', docsResponseTitle: 'Response', docsResponseText: 'The full reply is at choices[0].message.content. Always check ok === true in the response.', docsModelsHeading: 'List models', docsModelsBody: 'This route returns all available models. Each model has a unique ID in the format harness/provider/model — e.g. opencode//opencode/big-pickle.', docsChatHeading: 'Send a message', docsChatBody: 'Send a POST request to /v1/chat/completions with your API key in the header and the conversation messages in the body.', docsModelIdTitle: 'Model ID Format', docsModelIdText: 'Every model ID has three parts separated by //: harness name // provider // model name. Example: opencode//opencode/big-pickle.', docsContextTitle: 'Context Memory', docsContextText: 'The gateway automatically maintains conversation context for each chat. Send to the same conversation to keep the context without resending the full history.', docsSystemPromptTitle: 'System Prompt', docsSystemPromptText: 'Add role: system in the messages array to set the model behavior. It will be sent with every request.', docsStreamHeading: 'Streaming', docsStreamText: 'Set stream: true to receive the reply incrementally via SSE. Each chunk contains delta.content that appends to the reply. Successful streams end with data: [DONE].', docsStreamExampleHeading: 'Streaming Example', docsStreamExampleText: 'Add stream: true in the request body, then read Server-Sent Events from the response.', docsErrorsTitle: 'Common errors', docsErrorsText: '401 = invalid or expired key. 400 = unknown harness name. 502 = CLI tool error. 504 = connection timed out.',
    searchModels: 'Search models... (claude, gpt, gemini)', filterAll: 'All', modelFooterHint: '↑↓ Navigate · Enter Select · Esc Close', noModelsFound: 'No results',
    setupEyebrow: 'Initial setup — 3 steps', setupTitle: 'Welcome to AFAQ', setupSubtitle: 'Create the admin account then pick tools to install — everything inside the container',
    setupStep1: 'Admin account', setupStep2: 'Harnesses', setupStep3: 'Ready',
    setupCreateAdmin: 'Create admin account', setupCreateDesc: 'This will be the first admin — you can add users later from the dashboard',
    confirmPassword: 'Confirm password', setupCreateBtn: 'Create & Enter', setupHint: 'You will be logged in automatically',
    setupHarnessTitle: 'Available Harnesses', setupHarnessDesc: 'Pick what to install now — you can install the rest later from the Harnesses page. Each tool installs inside the container via its official command.',
    installLog: 'Install log', close: 'Close', setupSkip: 'Skip — Go to chat', setupNext: 'Continue',
    setupDockerNote: 'On the host: you can also install the tool manually with the command shown on the card, then hit refresh',
    setupDoneTitle: 'All set!', setupDoneDesc: 'Account created and gateway ready. Start chatting or create API keys.',
    setupGoChat: 'Go to chat', installing: 'Installing...', install: 'Install', update: 'Update',
    setupPasswordMismatch: 'Passwords do not match', setupPasswordShort: 'Password too short — 8 chars minimum',
    setupEmailInvalid: 'Invalid email', setupCreating: 'Creating...',
    viewLog: 'View log', cancel: 'Cancel', confirm: 'Confirm', prompt: 'Input',
    copied: 'Copied', copiedMsg: 'Copied', copyMsg: 'Copy', retry: 'Retry', you: 'You', assistant: 'Assistant', typing: 'typing...', messages: 'messages', newChatTitle: 'New chat', rename: 'Rename', delete: 'Delete', active: 'Active', disabled: 'Disabled', noKeys: 'No keys yet', noChats: 'No chats yet',
    refreshError: 'Refresh failed', keyError: 'Key error', toggleError: 'Toggle failed', deleteError: 'Delete failed', deleteConfirm: 'Are you sure you want to delete this key?', confirmDelete: 'Confirm delete',
    chatError: 'Chat error', sessionExpired: 'Session expired — please sign in again',
    usageTotal: 'Total', usage: 'Usage', usageHarness: 'Harness', usageModel: 'Model', usageTokens: 'Tokens', usageLatency: 'Latency', usageDate: 'Date', export: 'Export', prev: 'Prev', next: 'Next', filters: 'Filters', apply: 'Apply', clearFilters: 'Clear filters', usageChartTitle: 'Usage last 7 days', usageHistory: 'History', models: 'models',
    filterAllHarnesses: 'All harnesses', usageModelPlaceholder: 'model filter', dateRange: 'Date range', last7Days: 'Last 7 days', last30Days: 'Last 30 days', last90Days: 'Last 90 days', allTime: 'All time', usageChartEmpty: 'Not enough data', usageEmpty: 'No data yet', usageStatTotal: 'Total'
  }
};

const text = (k) => translations[language][k] || k;

// Global error handler for debugging
window.addEventListener('error', (e) => {
  console.error('Global error:', e.message, e.filename, e.lineno);
  try { showToast('خطأ: ' + e.message); } catch {}
});
window.addEventListener('unhandledrejection', (e) => {
  console.error('Unhandled rejection:', e.reason);
  try { showToast('خطأ: ' + (e.reason?.message || e.reason)); } catch {}
});

function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = language === 'ar' ? 'rtl' : 'ltr';
  document.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = text(el.dataset.i18n); });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((el) => { el.placeholder = text(el.dataset.i18nPlaceholder); });
  if (currentConversationId) {
    const c = conversationsCache.find(x=>x.id===currentConversationId);
    if(c) updateChatHeader(c);
  }
}

async function api(url, options = {}) {
  options.headers = { ...(options.headers || {}), ...(token() ? { Authorization: `Bearer ${token()}` } : {}) };
  const resp = await fetch(url, options);
  if (!resp.ok) {
    const body = await resp.json().catch(() => ({}));
    const err = new Error(body.detail || body.error?.message || resp.statusText);
    err.status = resp.status;
    err.detail = body.detail || body.error?.message;
    if (resp.status === 401 && !url.includes('/api/auth/login')) {
      if (token() && document.body.dataset.page !== 'login') {
        const needsRedirect = !url.includes('/v1/chat/completions') && !url.includes('/api/chat');
        if (needsRedirect) {
          localStorage.removeItem('afaq_token');
          setTimeout(() => location.href = '/login', 800);
        }
      }
    }
    throw err;
  }
  if (resp.status === 204) return null;
  const ct = resp.headers.get('content-type') || '';
  if (ct.includes('text/event-stream')) return resp;
  return resp.json();
}

function show(page, updateUrl = true) {
  document.querySelectorAll('.page').forEach((el) => el.classList.add('hidden'));
  const target = $(`#${page === 'documentation' ? 'docs' : page}`);
  if (!target) return;
  target.classList.remove('hidden');
  document.querySelectorAll('.nav-link').forEach((el) => el.classList.toggle('active', el.dataset.page === page));
  if (updateUrl && page !== 'login') history.pushState({ page }, '', `/${page}`);
  $('#page-title').textContent = page === 'chat' ? text('chat') : page === 'harnesses' ? text('harnesses') : page === 'keys' ? text('apiKeys') : page === 'usage' ? text('usage') : page === 'users' ? text('users') : page === 'terminal' ? text('terminal') : text('docs');
  if (page === 'harnesses') loadHarnesses();
  if (page === 'keys') loadKeys();
  if (page === 'users') loadUsers();
  if (page === 'usage') loadUsage();
  if (page === 'chat') { loadConversations(); }
  if (page === 'terminal' && window.initTerminalPage) window.initTerminalPage();
}

// ---------- Models ----------
let allModelsCache = [];
let modelFilter = 'all';
let modelSearchQuery = '';
let focusedModelIndex = -1;

async function loadModels() {
  try {
    const res = await api('/v1/models');
    allModelsCache = res.data || [];
    const sel = $('#model-select');
    if (!res.data.length) {
      sel.innerHTML = `<option>${text('loading')}</option>`;
      updateModelTrigger();
      return;
    }
    const prev = sel.value;
    // keep hidden select for compatibility
    sel.innerHTML = res.data.map((m) => `<option value="${m.id}">${m.id}</option>`).join('');
    // Prefer known working model as default if nothing selected
    const preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"];
    let defaultModel = null;
    for (const pref of preferred) {
      if (res.data.some(m=>m.id===pref)) { defaultModel = pref; break; }
    }
    if (!defaultModel) {
      // fallback to first non-codex model
      const nonCodex = res.data.find(m=> !m.id.startsWith('codex//'));
      defaultModel = nonCodex ? nonCodex.id : res.data[0].id;
    }
    if (currentConversationId) {
      const conv = conversationsCache.find(c=>c.id===currentConversationId);
      if (conv && conv.model) {
        const exists = res.data.some(m=>m.id===conv.model);
        if (!exists) {
          const opt = document.createElement('option');
          opt.value = conv.model;
opt.textContent = `${conv.model} (غير متوفر)`;
          sel.prepend(opt);
        }
        sel.value = conv.model;
        if (!exists) {
          setTimeout(()=> showToast(language==='ar' ? `الموديل '${conv.model}' غير متوفر — اختر موديلاً من القائمة` : `Model '${conv.model}' unavailable — pick one`), 600);
        }
      } else if (prev && res.data.some(m=>m.id===prev)) {
        sel.value = prev;
      }
    } else if (prev && res.data.some(m=>m.id===prev)) {
      sel.value = prev;
    }
    // Ensure default is preferred for new chats if still empty or broken codex
    if (!currentConversationId && (!sel.value || sel.value === text('loading') || sel.value.startsWith('codex//'))) {
      if (defaultModel) sel.value = defaultModel;
    }
    updateComposerModel();
    updateModelTrigger();
    renderModelList();
    // bind hidden select change (for programmatic use)
    sel.onchange = () => {
      updateComposerModel();
      updateModelTrigger();
      if (currentConversationId) {
        const conv = conversationsCache.find(c=>c.id===currentConversationId);
        if (conv && sel.value !== conv.model) {
          api(`/api/chat/conversations/${currentConversationId}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({model: sel.value})}).then(()=>{ conv.model = sel.value; renderConversationList(); updateChatHeader(conv); renderModelList(); }).catch(()=>{});
        }
      }
    };
  } catch {
    $('#model-select').innerHTML = `<option>${text('loading')}</option>`;
    updateModelTrigger();
  }
}

function getFilteredModels() {
  let list = allModelsCache;
  const q = (modelSearchQuery || '').trim().toLowerCase();
  if (modelFilter !== 'all') {
    if (modelFilter === 'claude') {
      list = list.filter(m => m.id.toLowerCase().includes('claude'));
    } else {
      list = list.filter(m => m.owned_by === modelFilter || m.id.toLowerCase().startsWith(modelFilter + '/') || m.id.toLowerCase().startsWith(modelFilter + '//'));
    }
  }
  if (q) {
    const terms = q.split(/\s+/);
    list = list.filter(m => {
      const hay = (m.id + ' ' + (m.owned_by||'')).toLowerCase();
      return terms.every(t => hay.includes(t));
    });
  }
  return list;
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const terms = query.trim().split(/\s+/).filter(Boolean);
  let out = escapeHtml(text);
  for (const t of terms) {
    const re = new RegExp('(' + t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + ')', 'ig');
    out = out.replace(re, '<mark>$1</mark>');
  }
  return out;
}

function updateModelTrigger() {
  const sel = $('#model-select');
  const txt = $('#model-trigger-text');
  const cnt = $('#model-trigger-count');
  if (!sel || !txt) return;
  const val = sel.value;
  if (!val || val === text('loading')) {
    txt.textContent = text('loading');
    if (cnt) cnt.textContent = allModelsCache.length ? allModelsCache.length + ' ' + text('models') : '';
    return;
  }
  txt.textContent = val;
  txt.title = val;
  if (cnt) cnt.textContent = allModelsCache.length ? allModelsCache.length : '';
}

function renderModelList() {
  const listEl = $('#model-list');
  const countEl = $('#model-count');
  if (!listEl) return;
  const filtered = getFilteredModels();
  const query = modelSearchQuery;
  if (countEl) countEl.textContent = filtered.length + ' / ' + allModelsCache.length + ' ' + text('models');
  if (!filtered.length) {
    listEl.innerHTML = `<div class="model-empty"><strong>${text('noModelsFound')}</strong><br><small style="color:var(--text-faint)">جرب كلمة أخرى مثل gpt, claude, gemini</small></div>`;
    focusedModelIndex = -1;
    return;
  }
  // Group by owned_by
  const groups = {};
  for (const m of filtered.slice(0, 200)) {
    const g = m.owned_by || 'other';
    if (!groups[g]) groups[g] = [];
    groups[g].push(m);
  }
  let html = '';
  let idx = 0;
  const selVal = $('#model-select')?.value;
  for (const [group, models] of Object.entries(groups)) {
    html += `<div class="model-group-label">${escapeHtml(group)} · ${models.length}</div>`;
    for (const m of models) {
      const isActive = m.id === selVal;
      const isFocused = idx === focusedModelIndex;
      const provider = m.id.split('//').pop().split('/')[0] || '';
      const short = m.id.split('/').pop();
      html += `<div class="model-option ${isActive?'active':''} ${isFocused?'focused':''}" data-model-id="${escapeHtml(m.id)}" data-index="${idx}" role="option" aria-selected="${isActive}" tabindex="-1">
        <div class="model-option-main">
          <div class="model-option-id">${highlightMatch(m.id, query)}</div>
          <div class="model-option-sub">${escapeHtml(m.owned_by)}${provider && provider!==m.owned_by ? ' · ' + escapeHtml(provider) : ''}</div>
        </div>
        <span class="model-option-badge">${escapeHtml(short.slice(0,18))}</span>
        <span class="model-option-check">${isActive?'✓':''}</span>
      </div>`;
      idx++;
    }
  }
  if (filtered.length > 200) {
    html += `<div class="model-empty"><small>... و ${filtered.length - 200} موديل آخر — استخدم البحث للتصفية</small></div>`;
  }
  listEl.innerHTML = html;
  // bind clicks
  listEl.querySelectorAll('.model-option').forEach(el => {
    el.onclick = () => selectModel(el.dataset.modelId);
  });
  // ensure focused visible
  const focused = listEl.querySelector('.model-option.focused');
  if (focused) focused.scrollIntoView({block:'nearest'});
}

function ensureModelDropdownPlacement() {
  const dd = document.getElementById('model-dropdown');
  const b = document.getElementById('model-dropdown-backdrop');
  const wrap = document.getElementById('model-search-wrap');
  if (!dd) return;
  const isMobile = window.innerWidth <= 860;
  if (isMobile) {
    if (dd.parentElement !== document.body) document.body.appendChild(dd);
    if (b && b.parentElement !== document.body) document.body.appendChild(b);
  } else if (wrap) {
    if (dd.parentElement !== wrap) wrap.appendChild(dd);
    if (b && b.parentElement !== wrap) wrap.appendChild(b);
  }
}

function openModelDropdown() {
  const dd = $('#model-dropdown');
  const trig = $('#model-trigger');
  const b = $('#model-dropdown-backdrop');
  if (!dd || !trig) return;
  ensureModelDropdownPlacement();
  dd.classList.remove('hidden');
  if (b) b.hidden = false;
  trig.setAttribute('aria-expanded', 'true');
  document.body.classList.add('model-sheet-open');
  const inp = $('#model-search-input');
  if (inp && window.innerWidth > 860) {
    inp.focus();
    inp.select();
  }
  focusedModelIndex = -1;
  renderModelList();
}

function closeModelDropdown() {
  const dd = $('#model-dropdown');
  const trig = $('#model-trigger');
  const b = $('#model-dropdown-backdrop');
  if (!dd) return;
  dd.classList.add('hidden');
  if (b) b.hidden = true;
  if (trig) trig.setAttribute('aria-expanded','false');
  document.body.classList.remove('model-sheet-open');
  focusedModelIndex = -1;
  dd.style.bottom = '';
  dd.style.maxHeight = '';
}

function selectModel(id) {
  const sel = $('#model-select');
  if (!sel) return;
  sel.value = id;
  sel.dispatchEvent(new Event('change', {bubbles:true}));
  updateModelTrigger();
  renderModelList();
  closeModelDropdown();
  // PATCH conversation if needed (already handled in sel.onchange, but ensure)
  if (currentConversationId) {
    const conv = conversationsCache.find(c=>c.id===currentConversationId);
    if (conv && id !== conv.model) {
      api(`/api/chat/conversations/${currentConversationId}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({model: id})}).then(()=>{ conv.model = id; renderConversationList(); updateChatHeader(conv); }).catch(()=>{});
    }
  }
}

function updateComposerModel() {
  const m = $('#model-select')?.value;
  if (m && $('#composer-model')) $('#composer-model').textContent = m;
  if (m && $('#chat-model-name')) $('#chat-model-name').textContent = m;
  if (m && $('#chat-model-badge')) $('#chat-model-badge').textContent = m.split('/').pop();
}

// ---------- Conversations (ChatGPT-like) ----------
async function loadConversations() {
  try {
    const convs = await api('/api/chat/conversations');
    conversationsCache = convs;
    renderConversationList();
    if (!convs.length) {
      currentConversationId = null;
      localStorage.removeItem('afaq_current_conv');
      showWelcome();
      return;
    }
    if (currentConversationId) {
      const exists = convs.find(c=>c.id===currentConversationId);
      if (!exists) {
        currentConversationId = null;
        localStorage.removeItem('afaq_current_conv');
        showWelcome();
        return;
      }
      await selectConversation(currentConversationId, false);
    } else {
      // ephemeral new chat - keep welcome, don't auto-select first (ChatGPT-like)
      showWelcome();
      return;
    }
  } catch (e) {
    console.error('loadConversations', e);
    // if 401, api already redirects
    if(e.status!==401) renderConversationList();
  }
}

function renderConversationList() {
  const list = $('#conversation-list');
  const countEl = $('#conv-count');
  if (countEl) countEl.textContent = conversationsCache.length ? `${conversationsCache.length}` : '';
  if (!conversationsCache.length) {
    list.innerHTML = `<div class="conv-empty muted">${text('noChats')}</div>`;
    return;
  }
  list.innerHTML = conversationsCache.map((c) => {
    const active = c.id === currentConversationId ? 'active' : '';
    const date = new Date(c.updated_at).toLocaleDateString(language==='ar'?'ar-EG':'en-US', {month:'short', day:'numeric'});
    return `<div class="conv-item ${active}" data-conv-id="${c.id}" onclick="selectConversation(${c.id})">
      <div class="conv-item-title" title="${escapeHtml(c.title)}">${escapeHtml(c.title || text('newChatTitle'))}</div>
      <div class="conv-item-preview">${escapeHtml(c.last_message || '')}</div>
      <div class="conv-item-meta"><span>${c.message_count||0} ${text('messages')}</span><span>·</span><span>${date}</span>${c.model?`<span class="conv-item-model">${escapeHtml(c.model.split('/').pop())}</span>`:''}</div>
      <div class="conv-item-actions">
        <button class="conv-action" title="${text('rename')}" onclick="event.stopPropagation(); renameConversation(${c.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg></button>
        <button class="conv-action danger" title="${text('delete')}" onclick="event.stopPropagation(); deleteConversation(${c.id})"><svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"/></svg></button>
      </div>
    </div>`;
  }).join('');
}

async function createConversation(model) {
  let m = model || $('#model-select')?.value || null;
  if(!m || m===text('loading') || !m.includes('/')){
    // Prefer known working model
    const preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"];
    for (const pref of preferred) {
      if (allModelsCache.some(x=>x.id===pref)) { m = pref; break; }
    }
    if (!m || !m.includes('/')) {
      const sel = $('#model-select');
      if(sel && sel.options.length){
        // skip broken codex
        for(const o of sel.options){ if(o.value && o.value.includes('/') && !o.value.startsWith('codex//')){ m=o.value; break; } }
        if (!m || !m.includes('/')) {
          for(const o of sel.options){ if(o.value && o.value.includes('/')){ m=o.value; break; } }
        }
      }
    }
    if(!m || !m.includes('/')) m = null;
  }
  const btn = $('#new-chat');
  if(btn) btn.disabled = true;
  try{
    const conv = await api('/api/chat/conversations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: m, title: text('newChatTitle') })
    });
    conversationsCache.unshift(conv);
    currentConversationId = conv.id;
    localStorage.setItem('afaq_current_conv', conv.id);
    renderConversationList();
    await selectConversation(conv.id, false);
    return conv;
  } finally {
    if(btn) btn.disabled = false;
  }
}

async function selectConversation(id, pushState=true) {
  closeDrawer();
  if (document.body.dataset.page !== 'chat') {
    show('chat', pushState);
  }
  currentConversationId = id;
  localStorage.setItem('afaq_current_conv', id);
  renderConversationList();
  document.querySelectorAll('.conv-item').forEach(el=>el.classList.toggle('active', parseInt(el.dataset.convId)==id));
  const conv = conversationsCache.find(c=>c.id===id);
  if (conv) updateChatHeader(conv);
  try {
    const detail = await api(`/api/chat/conversations/${id}`);
    const idx = conversationsCache.findIndex(c=>c.id===id);
    if(idx>=0) conversationsCache[idx] = { ...conversationsCache[idx], title: detail.title, model: detail.model, updated_at: detail.updated_at, message_count: detail.message_count, last_message: detail.messages?.length ? detail.messages[detail.messages.length-1].content.slice(0,80) : null };
    renderConversationList();
    renderMessages(detail.messages, detail);
    if(detail.messages?.length) { setTimeout(()=>{ const b=$('#messages'); if(b) b.scrollTop=b.scrollHeight; },50); }
  } catch (e) {
    if(e.status===404){
      // stale id, remove from cache
      conversationsCache = conversationsCache.filter(c=>c.id!==id);
      localStorage.removeItem('afaq_current_conv');
      currentConversationId = conversationsCache[0]?.id || null;
      if(currentConversationId) localStorage.setItem('afaq_current_conv', currentConversationId);
      renderConversationList();
      if(currentConversationId) await selectConversation(currentConversationId);
      else showWelcome();
      showToast(e.message);
    } else {
      showToast(e.message);
      showWelcome();
    }
  }
}

function updateChatHeader(conv) {
  if ($('#chat-title')) $('#chat-title').textContent = conv.title || text('newChatTitle');
  if ($('#chat-model-badge')) $('#chat-model-badge').textContent = conv.model ? conv.model.split('/').pop() : '';
  if ($('#chat-message-count')) $('#chat-message-count').textContent = conv.message_count ? `${conv.message_count} ${text('messages')}` : '';
  if ($('#chat-model-name')) $('#chat-model-name').textContent = conv.model || '';
  // sync model select to conversation model
  if (conv.model && $('#model-select')) {
    const sel = $('#model-select');
    const opts = Array.from(sel.options).map(o=>o.value);
    if (!opts.includes(conv.model)) {
      const opt = document.createElement('option');
      opt.value = conv.model;
      opt.textContent = `${conv.model} (غير متوفر)`;
      opt.style.color = '#e11d48';
      sel.prepend(opt);
      // also add to cache if not present
      if (!allModelsCache.some(m=>m.id===conv.model)) {
        allModelsCache.unshift({id: conv.model, owned_by: conv.model.split('/')[0]});
      }
    }
    sel.value = conv.model;
    updateComposerModel();
    updateModelTrigger();
    renderModelList();
  }
}

function showWelcome() {
  const box = $('#messages');
  box.innerHTML = `<div class="welcome" id="welcome">
    <div class="welcome-index">01 / CHAT</div>
    <h2><span>${text('welcomeTitle')}</span><br><em>${text('welcomeTitleAccent')}</em></h2>
    <p>${text('welcomeDescription')}</p>
    <div class="welcome-actions"><div class="welcome-hint"><span class="welcome-kbd">Enter</span> ${text('enterHint')}</div></div>
    <div class="welcome-suggestions">
      <button class="suggestion" data-suggest="اشرح لي كيف تعمل البوابة"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 1 7 7c0 2.38-1.19 4.47-3 5.74V17a1 1 0 0 1-1 1H9a1 1 0 0 1-1-1v-2.26C6.19 13.47 5 11.38 5 9a7 7 0 0 1 7-7z"/></svg> اشرح لي كيف تعمل البوابة</button>
      <button class="suggestion" data-suggest="اكتب دالة بلغة Python"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2H8a4 4 0 0 0-4 4v4a4 4 0 0 0 4 4h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1H7a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h8z"/><path d="M17 6v4a4 4 0 0 0 4 4h1a1 1 0 0 1 1 1v1a1 1 0 0 1-1 1h-1a4 4 0 0 1-4-4V6"/></svg> اكتب دالة بلغة Python</button>
      <button class="suggestion" data-suggest="ما الفرق بين Harnesses؟"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16 3h5v5"/><path d="M8 3H3v5"/><path d="M12 22v-8.3a4 4 0 0 0-1.172-2.872L3 3"/><path d="m15 9 6-6"/></svg> ما الفرق بين Harnesses؟</button>
      <button class="suggestion" data-suggest="ساعدني في كتابة API"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> ساعدني في كتابة API</button>
    </div>
  </div>`;
  bindSuggestions();
  updateChatHeader({title: text('newChatTitle'), model: $('#model-select')?.value || '', message_count:0});
}

function bindSuggestions() {
  document.querySelectorAll('.suggestion').forEach(b=>{
    b.onclick = () => {
      const ta = $('#prompt');
      ta.value = b.dataset.suggest;
      ta.focus();
      autoResize();
      // optional: auto-send on suggestion click after small delay? keep manual for now
    };
  });
}

function escapeHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

function renderMarkdown(text) {
  if (!text) return '';
  // Try marked library first (loaded via /static/marked.min.js)
  const mk = (typeof window !== 'undefined' && window.marked) || (typeof marked !== 'undefined' ? marked : null);
  if (mk) {
    try {
      if (!window._markedConfigured) {
        mk.setOptions({
          gfm: true,
          breaks: true,
          pedantic: false,
          smartLists: true,
          smartypants: false,
          headerIds: false,
          mangle: false
        });
        // No custom renderer needed for v15 - use default and post-process
        // We will add code language labels and table wrappers via string replacement after parsing
        window._markedConfigured = true;
      }
      // Use marked to parse
      let html = mk.parse(text);
      // Basic sanitization: remove script tags
      html = html.replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, '');
      // Post-process: wrap tables for scrolling
      html = html.replace(/<table>/g, '<div class="table-wrap"><table>').replace(/<\/table>/g, '</table></div>');
      // Post-process: add copy button to code blocks
      html = html.replace(/<pre><code class="language-(\w+)">/g, '<pre><span class="code-lang">$1</span><button class="code-copy" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText).then(()=>{const t=this.textContent;this.textContent=\'✓\';setTimeout(()=>this.textContent=\'نسخ\',1200)})">نسخ</button><code class="language-$1">');
      html = html.replace(/<pre><code>/g, '<pre><button class="code-copy" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText).then(()=>{const t=this.textContent;this.textContent=\'✓\';setTimeout(()=>this.textContent=\'نسخ\',1200)})">نسخ</button><code>');
      return html;
    } catch (e) {
      console.warn('marked parse failed, fallback', e);
    }
  }
  // Fallback: simple parser (previous logic) with improved headings/tables
  let html = escapeHtml(text);
  // code blocks ```lang ... ```
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (m, lang, code) => {
    const l = lang ? `<span class="code-lang">${escapeHtml(lang)}</span>` : '';
    const btn = `<button class="code-copy" onclick="navigator.clipboard.writeText(this.nextElementSibling.innerText).then(()=>{const t=this.textContent;this.textContent='✓';setTimeout(()=>this.textContent='نسخ',1200)})">نسخ</button>`;
    return `<pre>${l}${btn}<code>${code.trim()}</code></pre>`;
  });
  // headings # ## ###
  html = html.replace(/^######\s+(.*)$/gm, '<h6>$1</h6>');
  html = html.replace(/^#####\s+(.*)$/gm, '<h5>$1</h5>');
  html = html.replace(/^####\s+(.*)$/gm, '<h4>$1</h4>');
  html = html.replace(/^###\s+(.*)$/gm, '<h3>$1</h3>');
  html = html.replace(/^##\s+(.*)$/gm, '<h2>$1</h2>');
  html = html.replace(/^#\s+(.*)$/gm, '<h1>$1</h1>');
  // blockquotes
  html = html.replace(/^>\s+(.*)$/gm, '<blockquote>$1</blockquote>');
  // horizontal rule
  html = html.replace(/^---+$|^\*\*\*+$|^___+$/gm, '<hr>');
  // images ![alt](url)
  html = html.replace(/!\[([^\]]*)\]\((https?:\/\/[^\s\)]+)\)/g, '<img src="$2" alt="$1" loading="lazy">');
  // tables | a | b |
  // Simple table detection: lines with | and header separator
  html = html.replace(/(\|.*\|\n\|[-| :]+\|\n(\|.*\|\n?)+)/g, (m) => {
    const lines = m.trim().split('\n');
    if (lines.length < 2) return m;
    const header = lines[0].split('|').filter(c=>c.trim()).map(c=>`<th>${c.trim()}</th>`).join('');
    const rows = lines.slice(2).map(line => {
      const cells = line.split('|').filter(c=>c.trim()).map(c=>`<td>${c.trim()}</td>`).join('');
      return `<tr>${cells}</tr>`;
    }).join('');
    return `<div class="table-wrap"><table><thead><tr>${header}</tr></thead><tbody>${rows}</tbody></table></div>`;
  });
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // strikethrough
  html = html.replace(/~~([^~]+)~~/g, '<del>$1</del>');
  // italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // split by double newline into blocks
  const blocks = html.split(/\n{2,}/).map(b=>{
    const t = b.trim();
    if (!t) return '';
    if (t.startsWith('<pre') || t.startsWith('<h') || t.startsWith('<blockquote') || t.startsWith('<hr') || t.startsWith('<div class="table-wrap"') || t.startsWith('<table')) return b;
    if (/^(\s*[-*] )/m.test(b)) {
      const items = b.split('\n').map(l=>{
        const m = l.match(/^\s*[-*]\s+(?:\[([ x])\]\s+)?(.*)/);
        if (m) {
          const checked = m[1];
          const content = m[2];
          if (checked !== undefined) {
            const isChecked = checked.toLowerCase() === 'x';
            return `<li class="task-list-item"><input type="checkbox" ${isChecked?'checked':''} disabled> ${content}</li>`;
          }
          return `<li>${content}</li>`;
        }
        return l;
      }).join('');
      // check if task list
      if (b.includes('task-list-item')) return `<ul class="task-list">${items}</ul>`;
      return `<ul>${items}</ul>`;
    }
    if (/^\s*\d+\.\s/m.test(b)) {
      const items = b.split('\n').map(l=>l.replace(/^\s*\d+\.\s(.*)/,'<li>$1</li>')).join('');
      return `<ol>${items}</ol>`;
    }
    return `<p>${b.replace(/\n/g,'<br>')}</p>`;
  }).join('');
  return blocks;
}

function renderMessages(messages, conv) {
  const box = $('#messages');
  if (!messages || !messages.length) {
    // keep welcome but also show header
    showWelcome();
    if (conv) updateChatHeader(conv);
    return;
  }
  box.innerHTML = '';
  messages.forEach(m => {
    const isUser = m.role === 'user';
    const avatar = isUser
      ? `<div class="message-avatar user">${text('you').charAt(0).toUpperCase()}</div>`
      : `<div class="message-avatar assistant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2a7 7 0 0 0-7 7c0 3.5 2.5 6 7 10 4.5-4 7-6.5 7-10a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.2"/></svg></div>`;
    const roleLabel = isUser ? text('you') : text('assistant');
    const modelInfo = !isUser && conv?.model ? `<span class="mono">${escapeHtml(conv.model.split('/').pop())}</span>` : '';
    const contentHtml = isUser ? `<div class="bubble user"><p>${escapeHtml(m.content).replace(/\n/g,'<br>')}</p></div>` : `<div class="bubble assistant">${renderMarkdown(m.content)}</div>`;
    const actions = !isUser ? `<div class="message-actions"><button class="msg-action" onclick="copyMessage(this)"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg>${text('copyMsg')}</button><button class="msg-action" onclick="retryMessage(${m.id})"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="23 4 23 10 17 10"/><path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/></svg>${text('retry')}</button></div>` : '';
    const row = document.createElement('div');
    row.className = 'message-group';
    row.innerHTML = `<div class="message-row ${m.role}">
      ${avatar}
      <div class="message-content-wrap">
        <div class="message-role">${roleLabel} ${modelInfo}</div>
        ${contentHtml}
        ${actions}
      </div>
    </div>`;
    box.appendChild(row);
  });
  box.scrollTop = box.scrollHeight;
  bindCopyButtons();
}

function bindCopyButtons() {
  // already via onclick
}
function copyMessage(btn) {
  const bubble = btn.closest('.message-row').querySelector('.bubble');
  const text = bubble.innerText;
  navigator.clipboard.writeText(text).then(()=> {
    const orig = btn.innerHTML;
    btn.textContent = text('copiedMsg');
    setTimeout(()=> btn.innerHTML = orig, 1200);
  });
}
async function retryMessage(id) {
  // find message content and resend? For now just toast
  showToast('Retry coming soon');
}

function autoResize() {
  const ta = $('#prompt');
  if(!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 160) + 'px';
}

// ---------- Send ----------
async function send() {
  console.log('send() called', {isStreaming, content: document.getElementById('prompt')?.value?.slice(0,20), model: document.getElementById('model-select')?.value, currentConv: currentConversationId});
  if (isStreaming) {
    console.warn('send blocked: already streaming');
    showToast(language==='ar' ? 'انتظر انتهاء الرد الحالي' : 'Wait for current response');
    return;
  }
  const promptEl = $('#prompt');
  if (!promptEl) { console.error('prompt element not found'); showToast('خطأ: حقل الرسالة غير موجود'); return; }
  const content = promptEl.value.trim();
  let model = $('#model-select')?.value || '';
  console.log('send model before fallback', JSON.stringify(model), 'allModels', allModelsCache.length);
  if (!content) {
    console.warn('send: empty content');
    return;
  }
  if (!model || !model.includes('/') || model === text('loading')) {
    console.warn('send: invalid model', model, 'trying fallback');
    // Try conversation model first
    const conv = currentConversationId ? conversationsCache.find(c=>c.id===currentConversationId) : null;
    if (conv && conv.model && conv.model.includes('/')) {
      model = conv.model;
      console.log('fallback to conv.model', model);
    } else if (allModelsCache.length) {
      // Prefer big-pickle
      const pref = allModelsCache.find(m=>m.id==='opencode//opencode/big-pickle') || allModelsCache.find(m=>!m.id.startsWith('codex//')) || allModelsCache[0];
      model = pref.id;
      console.log('fallback to', model);
      const sel = $('#model-select');
      if (sel) { sel.value = model; updateModelTrigger(); }
    } else {
      showToast(text('chatError') + ': ' + text('loading') + ' — حاول تحديث الصفحة');
      console.error('send: no model available, allModelsCache empty');
      return;
    }
  }
  // Final validation: if still codex, switch
  if (model.startsWith('codex//')) {
    console.warn('send: codex model detected, switching to big-pickle');
    const pref = allModelsCache.find(m=>m.id==='opencode//opencode/big-pickle');
    if (pref) {
      model = pref.id;
      const sel = $('#model-select');
      if (sel) { sel.value = model; updateModelTrigger(); }
      showToast(language==='ar' ? 'موديل codex غير متاح، تم التبديل إلى big-pickle' : 'codex unavailable, switched to big-pickle');
    }
  }
  // ChatGPT-like lazy creation: if no conversation, create with first message title (ephemeral -> persist only after send)
  const newChatBtn = $('#new-chat');
  let lazyConv = null;
  if (!currentConversationId) {
    if(newChatBtn) newChatBtn.disabled = true;
    try {
      let m = model;
      if(!m || m===text('loading') || !m.includes('/') || m.startsWith('codex//')){
        const preferred = ["opencode//opencode/big-pickle", "opencode//opencode/claude-sonnet-4", "commandcode//deepseek/deepseek-v4-flash"];
        for (const pref of preferred) {
          if (allModelsCache.some(x=>x.id===pref)) { m = pref; break; }
        }
        if (!m || !m.includes('/') || m.startsWith('codex//')) {
          const sel=$('#model-select');
          if(sel){
            for(const o of sel.options){ if(o.value && o.value.includes('/') && !o.value.startsWith('codex//')){ m=o.value; break; } }
            if (!m || !m.includes('/')) {
              for(const o of sel.options){ if(o.value && o.value.includes('/')){ m=o.value; break; } }
            }
          }
        }
      }
      const conv = await api('/api/chat/conversations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: m, title: content.slice(0,50) })
      });
      lazyConv = conv;
      currentConversationId = conv.id;
      localStorage.setItem('afaq_current_conv', conv.id);
      updateChatHeader(conv);
    } catch(e){ showToast(e.message); if(newChatBtn) newChatBtn.disabled=false; return; }
    finally { if(newChatBtn) newChatBtn.disabled=false; }
  }
  promptEl.value = '';
  autoResize();
  promptEl.focus();
  const convMeta = lazyConv || conversationsCache.find(c=>c.id===currentConversationId);
  addOptimisticMessage('user', content, convMeta);
  const assistantNode = addOptimisticMessage('assistant', '', convMeta, true);
  const sendBtn = $('#send');
  sendBtn.disabled = true;
  sendBtn.classList.add('sending');
  isStreaming = true;
  const start = Date.now();
  try {
    await sendStream(content, model, assistantNode);
    // update cache title if first message
    const idx = conversationsCache.findIndex(c=>c.id===currentConversationId);
    if(idx>=0 && (!conversationsCache[idx].title || conversationsCache[idx].title===text('newChatTitle'))){
      // will be updated via loadConversations
    }
  } catch (error) {
    const bubble = assistantNode.querySelector('.bubble') || assistantNode.querySelector('.typing')?.parentElement || assistantNode.querySelector('.message-content-wrap');
    const safeBubble = bubble || assistantNode;
    if (error.status === 401) {
      safeBubble.innerHTML = `<p>${text('sessionExpired')}</p>`;
      showToast(text('sessionExpired'));
      setTimeout(()=>{ localStorage.removeItem('afaq_token'); location.href='/login';},1500);
    } else if (error.status === 502 || error.status === 504 || error.status === 400) {
      const isTimeout = error.status === 504 || /timed out|timeout/i.test(error.message);
      const detail = isTimeout ? (language==='ar' ? 'انتهت مهلة الرد — جرب موديل آخر مثل opencode/big-pickle' : 'Response timed out — try another model') : '';
      safeBubble.innerHTML = `<p style="color:var(--status-warning)"><svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="vertical-align:middle;margin-inline-end:4px"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>${escapeHtml(error.message)}${detail ? `<br><small style="color:var(--text-muted)">${detail}</small>`:''}<br><small style="color:var(--text-muted)">Harness failed — check <a href="/harnesses" style="color:var(--brand-primary)">Harnesses</a> installed</small></p>`;
      showToast(error.message);
    } else {
      safeBubble.innerHTML = `<p style="color:var(--status-error)">${text('chatError')}: ${escapeHtml(error.message)}</p>`;
      showToast(error.message);
    }
    console.error('send error', error);
  } finally {
    isStreaming = false;
    sendBtn.disabled = false;
    sendBtn.classList.remove('sending');
    // lightweight list refresh without re-selecting (avoids message flicker/disappear)
    setTimeout(async ()=>{
      try{
        const convs = await api('/api/chat/conversations');
        conversationsCache = convs;
        renderConversationList();
        const cur = conversationsCache.find(c=>c.id===currentConversationId);
        if(cur) updateChatHeader(cur);
      }catch{}
    }, 600);
    const box = $('#messages');
    if(box) box.scrollTop = box.scrollHeight;
  }
}

function addOptimisticMessage(role, content, conv, isTyping=false) {
  const box = $('#messages');
  if (box.querySelector('.welcome')) box.innerHTML = '';
  const isUser = role==='user';
  const avatar = isUser ? `<div class="message-avatar user">${text('you').charAt(0).toUpperCase()}</div>` : `<div class="message-avatar assistant"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><path d="M12 2a7 7 0 0 0-7 7c0 3.5 2.5 6 7 10 4.5-4 7-6.5 7-10a7 7 0 0 0-7-7z"/><circle cx="12" cy="9" r="2.2"/></svg></div>`;
  const roleLabel = isUser ? text('you') : text('assistant');
  const modelInfo = !isUser && conv?.model ? `<span class="mono">${escapeHtml(conv.model.split('/').pop())}</span>` : '';
  const inner = isTyping ? `<div class="bubble assistant"><div class="typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span><span style="margin-inline-start:6px;font:500 11px var(--font-mono);color:var(--text-faint)">${text('typing')}</span></div></div>` : (isUser ? `<div class="bubble user"><p>${escapeHtml(content).replace(/\n/g,'<br>')}</p></div>` : `<div class="bubble assistant">${renderMarkdown(content)}</div>`);
  const group = document.createElement('div');
  group.className = 'message-group';
  group.innerHTML = `<div class="message-row ${role}">${avatar}<div class="message-content-wrap"><div class="message-role">${roleLabel} ${modelInfo}</div>${inner}</div></div>`;
  box.appendChild(group);
  box.scrollTop = box.scrollHeight;
  return group;
}

async function sendStream(content, model, assistantNode) {
  console.log('sendStream start', {content: content.slice(0,30), model});
  let bubble = assistantNode.querySelector('.bubble');
  if (!bubble) {
    // fallback for typing placeholder
    bubble = document.createElement('div');
    bubble.className = 'bubble assistant';
    const wrap = assistantNode.querySelector('.message-content-wrap');
    if (wrap) {
      const typing = wrap.querySelector('.typing');
      if (typing) typing.replaceWith(bubble);
      else wrap.appendChild(bubble);
    } else {
      assistantNode.appendChild(bubble);
    }
  }
  bubble.innerHTML = '';
  let full = '';
  let hasDelta = false;
  const controller = new AbortController();
  const timeoutMs = 95000;
  const timeoutId = setTimeout(()=> controller.abort(), timeoutMs);
  let resp;
  try {
    resp = await fetch(`/api/chat/conversations/${currentConversationId}/messages/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
      body: JSON.stringify({ content, model }),
      signal: controller.signal,
    });
  } catch (e) {
    clearTimeout(timeoutId);
    if (e.name === 'AbortError') {
      const err = new Error(language==='ar' ? 'انتهت مهلة الاتصال (95s) — جرب موديل آخر' : 'Request timed out (95s) — try another model');
      err.status = 504;
      throw err;
    }
    throw e;
  }
  clearTimeout(timeoutId);
  if (!resp.ok) {
    const body = await resp.json().catch(()=>({}));
    const err = new Error(body.detail || body.error?.message || resp.statusText);
    err.status = resp.status;
    throw err;
  }
  const reader = resp.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        if (!line.startsWith('data: ')) continue;
        const data = line.slice(6).trim();
        if (!data) continue;
        if (data === '[DONE]') { buffer=''; break; }
        try {
          const json = JSON.parse(data);
          if (json.error) throw new Error(json.error.message);
          const delta = json.choices?.[0]?.delta?.content;
          if (delta) {
            hasDelta = true;
            full += delta;
            bubble.innerHTML = renderMarkdown(full) + '<span class="stream-cursor"></span>';
            const box=$('#messages'); if(box) box.scrollTop=box.scrollHeight;
          }
        } catch (e) {
          if (e.message && e.message.includes('harness_error')) throw e;
          if (e.message && !e.message.toLowerCase().includes('json')) throw e;
        }
      }
    }
  } catch(e){
    if (e.name === 'AbortError') {
      const err = new Error(language==='ar' ? 'انتهت مهلة القراءة — جرب موديل آخر' : 'Read timed out — try another model');
      err.status = 504;
      throw err;
    }
    if(!hasDelta) throw e;
  }
  bubble.innerHTML = renderMarkdown(full);
  if (!full || !full.trim()) {
    if (!hasDelta) {
      const err = new Error(language==='ar' ? 'لا يوجد رد من الموديل — تأكد أن الموديل متاح وجرب opencode/big-pickle' : 'No response from model — try opencode/big-pickle');
      err.status = 502;
      throw err;
    }
    bubble.innerHTML = `<p style="color:var(--text-muted)">${language==='ar' ? '— لا يوجد رد —' : '— no response —'}</p>`;
  }
}

// ---------- Conversation actions ----------
async function deleteConversation(id) {
  const ok = await showConfirmBox({ title: text('confirmDelete') || text('delete'), message: text('deleteChatConfirm'), confirmText: text('delete'), cancelText: text('cancel') });
  if (!ok) return;
  try {
    await api(`/api/chat/conversations/${id}`, { method: 'DELETE' });
    conversationsCache = conversationsCache.filter(c=>c.id!==id);
    if (currentConversationId===id) {
      currentConversationId = conversationsCache[0]?.id || null;
      if (currentConversationId) localStorage.setItem('afaq_current_conv', currentConversationId);
      else localStorage.removeItem('afaq_current_conv');
    }
    renderConversationList();
    if (currentConversationId) await selectConversation(currentConversationId);
    else showWelcome();
  } catch(e){ showToast(e.message); }
}
async function renameConversation(id) {
  const conv = conversationsCache.find(c=>c.id===id);
  const newTitle = await showPromptBox({ title: text('rename') || 'Rename', message: text('renamePrompt'), defaultValue: conv?.title || '', placeholder: conv?.title || '' });
  if (!newTitle || !newTitle.trim()) return;
  try {
    const updated = await api(`/api/chat/conversations/${id}`, {
      method: 'PATCH',
      headers: { 'Content-Type':'application/json' },
      body: JSON.stringify({ title: newTitle.trim() })
    });
    const idx = conversationsCache.findIndex(c=>c.id===id);
    if(idx>=0) conversationsCache[idx] = updated;
    renderConversationList();
    if (currentConversationId===id) updateChatHeader(updated);
  } catch(e){ showToast(e.message); }
}
async function clearCurrentChat() {
  if (!currentConversationId) return;
  const ok = await showConfirmBox({ title: text('confirmDelete') || text('delete'), message: text('deleteChatConfirm'), confirmText: text('delete'), cancelText: text('cancel') });
  if (!ok) return;
  try {
    // delete all messages by deleting conversation and creating new one with same model
    const old = conversationsCache.find(c=>c.id===currentConversationId);
    await api(`/api/chat/conversations/${currentConversationId}`, { method:'DELETE' });
    conversationsCache = conversationsCache.filter(c=>c.id!==currentConversationId);
    const conv = await createConversation(old?.model);
    showToast('Cleared');
  } catch(e){ showToast(e.message); }
}

// expose globally for inline onclick
window.selectConversation = selectConversation;
window.deleteConversation = deleteConversation;
window.renameConversation = renameConversation;
window.copyMessage = copyMessage;
window.retryMessage = retryMessage;

// ---------- Harnesses / Keys / Users ----------
async function loadHarnesses() {
  try {
    const hs = await api('/api/admin/harnesses');
    $('#harness-grid').innerHTML = hs.map((h)=> `<div class="card"><div><h3>${escapeHtml(h.display_name)}</h3><p>${escapeHtml(h.provider||'Built-in provider')}</p><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${h.models.slice(0,6).map(m=>`<span style="font:500 11px var(--font-mono);background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18);color:var(--brand-primary);padding:3px 7px;border-radius:999px">${escapeHtml(m.id.split('/').pop())}</span>`).join('')}${h.models.length>6?`<span style="font:500 11px var(--font-mono);color:var(--text-faint)">+${h.models.length-6}</span>`:''}</div></div><small>${h.models.length} ${language==='ar'?'موديل':'models'}</small><span class="badge ${h.installed?'ok':''}">${h.installed?text('installed'):text('notInstalled')}</span></div>`).join('');
  } catch(e){ $('#harness-grid').innerHTML = `<p class="error-message">${escapeHtml(e.message)}</p>`; }
}
async function refreshHarnesses(){
  const b=$('#refresh-harnesses'); if(b) b.disabled=true;
  try{ await api('/api/admin/harnesses/refresh',{method:'POST'}); await loadHarnesses(); await loadModels(); }catch(e){ showToast(`${text('refreshError')}: ${e.message}`);}finally{ if(b) b.disabled=false; }
}
async function loadKeys(){
  try{
    const keys = await api('/api/admin/keys');
    $('#keys-list').innerHTML = keys.length ? keys.map((k)=> `<div class="row"><span>${escapeHtml(k.name)}<br><small class="muted">${escapeHtml(k.prefix)}••••</small></span><span class="key-actions"><span class="badge ${k.is_active?'ok':''}">${k.is_active?text('active'):text('disabled')}</span><button class="key-action" data-action="toggle" data-key-id="${k.id}">${k.is_active?text('disable'):text('enable')}</button><button class="key-action danger" data-action="delete" data-key-id="${k.id}">${text('delete')}</button></span></div>`).join('') : `<p class="muted">${text('noKeys')}</p>`;
  }catch(e){ $('#keys-list').innerHTML = `<p class="error-message">${escapeHtml(e.message)}</p>`; }
}
async function loadUsers(){
  try{ const users=await api('/api/admin/users'); $('#users-list').innerHTML = users.map((u)=> `<div class="row"><span>${escapeHtml(u.display_name||u.email)}<br><small class="muted">${escapeHtml(u.email)}</small></span><span class="badge">${escapeHtml(u.role)}</span></div>`).join(''); }catch(e){ $('#users-list').innerHTML=`<p class="error-message">${escapeHtml(e.message)}</p>`; }
}
function openKeyModal(){ $('#key-form').reset(); $('#key-create-fields').classList.remove('hidden'); $('#key-result').classList.add('hidden'); $('#key-modal-title').textContent=text('createKey'); $('#key-modal').showModal(); }
async function createKey(e){ e.preventDefault(); const b=$('#key-create-submit'); b.disabled=true; try{ const k=await api('/api/admin/keys',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({name:$('#key-name').value.trim()})}); $('#key-value').value=k.key; $('#key-create-fields').classList.add('hidden'); $('#key-result').classList.remove('hidden'); await loadKeys(); }catch(err){ showToast(`${text('keyError')}: ${err.message}`);}finally{ b.disabled=false; } }
async function updateKey(id){ try{ await api(`/api/admin/keys/${id}`,{method:'PATCH'}); await loadKeys(); }catch(e){ showToast(`${text('toggleError')}: ${e.message}`);} }
async function deleteKey(id){
  const ok = await showConfirmBox({ title: text('confirmDelete') || 'تأكيد', message: text('deleteConfirm'), confirmText: text('delete'), cancelText: text('cancel') });
  if(!ok) return;
  try{ await api(`/api/admin/keys/${id}`,{method:'DELETE'}); await loadKeys(); }catch(e){ showToast(`${text('deleteError')}: ${e.message}`);}
}
function openUserModal(){ $('#user-form').reset(); $('#user-modal').showModal(); }
async function createUser(e){ e.preventDefault(); const s=e.submitter; s.disabled=true; try{ await api('/api/admin/users',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:$('#user-email').value.trim(), password:$('#user-password').value, display_name:$('#user-name').value.trim()})}); $('#user-modal').close(); await loadUsers(); }catch(err){ showToast(err.message);}finally{ s.disabled=false; } }
function showToast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('visible'); setTimeout(()=>t.classList.remove('visible'),3500); }

// ---------- UI Box (replaces alert/confirm/prompt) ----------
function showConfirmBox({ title, message, confirmText, cancelText, eyebrow }={}){
  return new Promise((resolve)=>{
    const dlg = document.getElementById('confirm-modal');
    if(!dlg || typeof dlg.showModal !== 'function'){
      // fallback to non-blocking toast + resolve false to avoid native confirm
      showToast(message || title || 'Confirm?');
      resolve(false);
      return;
    }
    document.getElementById('confirm-title').textContent = title || text('confirm') || 'Confirm';
    document.getElementById('confirm-message').textContent = message || '';
    if(eyebrow) document.getElementById('confirm-eyebrow').textContent = eyebrow;
    const ok = document.getElementById('confirm-ok');
    const cancel = document.getElementById('confirm-cancel');
    if(confirmText) ok.textContent = confirmText;
    if(cancelText) cancel.textContent = cancelText;
    const close = (val)=>{ try{ dlg.close(); }catch{} ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); dlg.removeEventListener('close', onClose); resolve(val); };
    const onOk = ()=> close(true);
    const onCancel = ()=> close(false);
    const onClose = ()=> close(false);
    ok.addEventListener('click', onOk, {once:true});
    cancel.addEventListener('click', onCancel, {once:true});
    dlg.addEventListener('close', onClose, {once:true});
    dlg.showModal();
  });
}
function showPromptBox({ title, message, defaultValue, placeholder, confirmText, cancelText }={}){
  return new Promise((resolve)=>{
    const dlg = document.getElementById('prompt-modal');
    if(!dlg || typeof dlg.showModal !== 'function'){
      showToast(message || title || 'Input required');
      resolve(null);
      return;
    }
    document.getElementById('prompt-title').textContent = title || text('prompt') || 'Input';
    document.getElementById('prompt-message').textContent = message || '';
    const input = document.getElementById('prompt-input');
    input.value = defaultValue || '';
    if(placeholder) input.placeholder = placeholder;
    const ok = document.getElementById('prompt-ok');
    const cancel = document.getElementById('prompt-cancel');
    if(confirmText) ok.textContent = confirmText;
    if(cancelText) cancel.textContent = cancelText;
    const close = (val)=>{ try{ dlg.close(); }catch{} ok.removeEventListener('click', onOk); cancel.removeEventListener('click', onCancel); dlg.removeEventListener('close', onClose); const form=document.getElementById('prompt-form'); form.removeEventListener('submit', onSubmit); resolve(val); };
    const onOk = (e)=>{ if(e) e.preventDefault(); const v = input.value; if(!v || !v.trim()){ input.focus(); return; } close(v.trim()); };
    const onCancel = ()=> close(null);
    const onClose = ()=> close(null);
    const onSubmit = (e)=>{ e.preventDefault(); onOk(e); };
    const form = document.getElementById('prompt-form');
    form.addEventListener('submit', onSubmit, {once:true});
    ok.addEventListener('click', onOk, {once:true});
    cancel.addEventListener('click', onCancel, {once:true});
    dlg.addEventListener('close', onClose, {once:true});
    dlg.showModal();
    setTimeout(()=> input.focus(), 50);
  });
}

// ---------- Usage — Pro Max ----------
let usageOffset = 0;
const usageLimit = 20;
let usageCache = { items: [], total: 0 };
function formatNumber(n){ return new Intl.NumberFormat(language==='ar'?'ar-EG':'en-US').format(n); }
function formatTokens(n){
  if(n>=1000000) return (n/1000000).toFixed(1)+'M';
  if(n>=1000) return (n/1000).toFixed(1)+'k';
  return String(n);
}
function renderUsageStats(items, total){
  const totalEl = document.getElementById('usage-stat-total');
  const tokensEl = document.getElementById('usage-stat-tokens');
  const latencyEl = document.getElementById('usage-stat-latency');
  const costEl = document.getElementById('usage-stat-cost');
  const totalSub = document.getElementById('usage-stat-total-sub');
  const tokensSub = document.getElementById('usage-stat-tokens-sub');
  const latencySub = document.getElementById('usage-stat-latency-sub');
  const costSub = document.getElementById('usage-stat-cost-sub');
  if(!totalEl) return;
  const totalReq = total;
  const totalTokens = items.reduce((a,c)=> a + (c.total_tokens||0), 0);
  const avgLatency = items.length ? Math.round(items.reduce((a,c)=> a + (c.latency_ms||0),0)/items.length) : 0;
  const totalCost = items.reduce((a,c)=> a + (c.cost||0), 0);
  // animate numbers
  totalEl.textContent = formatNumber(totalReq);
  if(totalSub) totalSub.textContent = items.length ? `${formatNumber(items.length)} ${text('usage')} ${language==='ar'?'في الصفحة':'on page'}` : `—`;
  tokensEl.textContent = formatTokens(totalTokens);
  if(tokensSub) {
    const avg = items.length ? Math.round(totalTokens/items.length) : 0;
    tokensSub.textContent = items.length ? `${formatTokens(avg)} avg · ${items.length} reqs` : '—';
  }
  latencyEl.textContent = avgLatency ? `${avgLatency} ms` : '—';
  if(latencySub) latencySub.textContent = items.length ? `${language==='ar'?'متوسط':'avg'} · ${Math.min(...items.map(i=>i.latency_ms||0))||0}—${Math.max(...items.map(i=>i.latency_ms||0))||0} ms` : '—';
  costEl.textContent = totalCost ? `$${totalCost.toFixed(2)}` : '$0.00';
  if(costSub) costSub.textContent = items.length ? `${(totalCost/items.length).toFixed(3)} avg` : '—';

  // sparks
  ['total','tokens','latency','cost'].forEach((k, idx)=>{
    const el = document.getElementById(`usage-spark-${k}`);
    if(!el) return;
    const vals = items.slice(-8).map((_,i)=> 20 + Math.sin((i+idx)*1.3)*18 + Math.random()*10 );
    if(!vals.length) vals.push(20,35,22,40,28);
    const max = Math.max(...vals, 40);
    el.innerHTML = vals.map(v=> `<i style="height:${Math.round((v/max)*100)}%"></i>`).join('');
  });
}
function renderUsageChart(items){
  const chart = document.getElementById('usage-chart');
  if(!chart) return;
  if(!items.length){
    chart.innerHTML = `<div class="usage-chart-empty">${text('usageChartEmpty') || 'لا توجد بيانات كافية للرسم'}</div>`;
    return;
  }
  // group by day (last 7)
  const days = {};
  const now = new Date();
  for(let i=6;i>=0;i--){
    const d = new Date(now); d.setDate(d.getDate()-i);
    const key = d.toISOString().slice(0,10);
    days[key] = { tokens:0, reqs:0, label: d.toLocaleDateString(language==='ar'?'ar-EG':'en-US', {month:'short', day:'numeric'}) };
  }
  items.forEach(it=>{
    const key = (it.created_at||'').slice(0,10);
    if(days[key]){
      days[key].tokens += it.total_tokens||0;
      days[key].reqs += 1;
    }
  });
  const entries = Object.values(days);
  const maxTokens = Math.max(...entries.map(e=>e.tokens), 1);
  const maxReqs = Math.max(...entries.map(e=>e.reqs), 1);
  chart.innerHTML = `
    <div class="usage-bars">
      ${entries.map(e=> `
        <div class="usage-bar-group">
          <div style="flex:1; display:flex; gap:3px; align-items:end; width:100%; height:100%">
            <div class="usage-bar" style="height:${Math.round((e.tokens/maxTokens)*100)}%; flex:1" title="${e.tokens} tokens"></div>
            <div class="usage-bar alt" style="height:${Math.round((e.reqs/maxReqs)*100)}%; flex:1; opacity:.7" title="${e.reqs} reqs"></div>
          </div>
          <span class="usage-bar-label">${e.label}</span>
        </div>
      `).join('')}
    </div>
    <div class="usage-chart-meta">
      <span>${language==='ar'?'الرموز':'Tokens'} · ${formatTokens(entries.reduce((a,c)=>a+c.tokens,0))}</span>
      <span>${language==='ar'?'الطلبات':'Requests'} · ${entries.reduce((a,c)=>a+c.reqs,0)}</span>
    </div>
  `;
}
async function loadUsage(){
  const listEl = document.getElementById('usage-list');
  const infoEl = document.getElementById('usage-page-info');
  if(!listEl) return;
  const harness = document.getElementById('usage-harness')?.value || '';
  const model = document.getElementById('usage-model')?.value?.trim() || '';
  const range = document.getElementById('usage-range')?.value || 'all';
  const params = new URLSearchParams({ limit: usageLimit, offset: usageOffset });
  if(harness) params.set('harness', harness);
  if(model) params.set('model', model);
  if(range !== 'all'){
    const days = parseInt(range, 10);
    const from = new Date(); from.setDate(from.getDate()-days);
    params.set('from', from.toISOString());
  }
  // loading skeletons
  listEl.innerHTML = `<div class="usage-loading"><div class="usage-skeleton"></div><div class="usage-skeleton"></div><div class="usage-skeleton"></div></div>`;
  if(infoEl) infoEl.textContent = text('loading');
  try{
    const data = await api(`/api/chat/usage?${params}`);
    const items = data.items || [];
    const total = data.total || 0;
    usageCache = { items, total };
    // stats & chart
    renderUsageStats(items, total);
    renderUsageChart(items);
    if(infoEl) infoEl.textContent = `${formatNumber(total)} ${text('usageTotal')} · ${Math.floor(usageOffset/usageLimit)+1} / ${Math.max(1, Math.ceil(total/usageLimit))}`;
    if(!items.length){
      listEl.innerHTML = `<div class="usage-empty"><div style="width:48px;height:48px;border-radius:50%;background:rgba(59,130,246,0.1);border:1px solid rgba(59,130,246,0.18);display:grid;place-items:center;margin:0 auto 12px"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="var(--brand-primary)" stroke-width="1.7"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg></div><h4>${text('usageEmpty')}</h4><p class="muted" style="font-size:13px; max-width:420px; margin:6px auto 0">${language==='ar'?'ابدأ محادثة لرؤية الاستهلاك هنا':'Start a chat to see usage here'}</p><button class="outline-button" style="margin-top:14px" onclick="location.href='/chat'">${text('newChat')}</button></div>`;
    } else {
      // Pro Max table
      listEl.innerHTML = `
        <div style="overflow-x:auto">
        <table class="usage-table">
          <thead><tr><th>${text('usageHarness')}</th><th>${text('usageModel')}</th><th>${text('usageTokens')}</th><th>${text('usageLatency')}</th><th>${text('usageDate')}</th><th style="width:36px"></th></tr></thead>
          <tbody>
            ${items.map(i=> `
              <tr>
                <td><span class="usage-badge ${escapeHtml(i.harness)}">${escapeHtml(i.harness)}</span></td>
                <td><span class="mono" title="${escapeHtml(i.model)}" style="max-width:220px; display:inline-block; overflow:hidden; text-overflow:ellipsis; white-space:nowrap">${escapeHtml(i.model)}</span></td>
                <td><strong>${formatNumber(i.total_tokens||0)}</strong> <small class="muted">(${formatNumber(i.prompt_tokens||0)}→${formatNumber(i.completion_tokens||0)})</small></td>
                <td>${i.latency_ms ? `<span style="color:${i.latency_ms>2000?'var(--status-warning)':'var(--text-secondary)'}">${i.latency_ms} ms</span>` : '<span class="muted">—</span>'}</td>
                <td><span class="muted" style="font:500 12px var(--font-mono)">${new Date(i.created_at).toLocaleString(language==='ar'?'ar-EG':'en-US', {month:'short', day:'numeric', hour:'2-digit', minute:'2-digit'})}</span></td>
                <td><button class="icon-btn" title="Copy" onclick="navigator.clipboard.writeText('${escapeHtml(i.model)}'); showToast('${text('copied')}')"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v3"/></svg></button></td>
              </tr>
            `).join('')}
          </tbody>
        </table>
        </div>
      `;
    }
    const prev = document.getElementById('usage-prev'), next = document.getElementById('usage-next'), dots = document.getElementById('usage-dots');
    if(prev) prev.disabled = usageOffset===0;
    if(next) next.disabled = usageOffset + usageLimit >= total;
    if(dots){
      const pages = Math.max(1, Math.ceil(total/usageLimit));
      const cur = Math.floor(usageOffset/usageLimit);
      dots.innerHTML = Array.from({length: Math.min(5, pages)}, (_,i)=>{
        let idx;
        if(pages<=5) idx=i;
        else if(cur<2) idx=i;
        else if(cur>pages-3) idx=pages-5+i;
        else idx=cur-2+i;
        return `<i class="${idx===cur?'active':''}"></i>`;
      }).join('');
    }
  }catch(e){
    listEl.innerHTML = `<div class="usage-empty"><h4 style="color:var(--status-error)">${escapeHtml(e.message)}</h4><p class="muted">${language==='ar'?'حاول تحديث الصفحة':'Try refreshing'}</p><button class="outline-button" onclick="loadUsage()" style="margin-top:12px">${text('refresh')}</button></div>`;
    if(infoEl) infoEl.textContent = '';
  }
}
async function exportUsage(){
  try{
    const harness = document.getElementById('usage-harness')?.value || '';
    const model = document.getElementById('usage-model')?.value?.trim() || '';
    const params = new URLSearchParams({ limit: 1000, offset: 0 });
    if(harness) params.set('harness', harness);
    if(model) params.set('model', model);
    const data = await api(`/api/chat/usage?${params}`);
    const rows = [['date','harness','model','prompt_tokens','completion_tokens','total_tokens','latency_ms']];
    (data.items||[]).forEach(i=> rows.push([i.created_at, i.harness, i.model, i.prompt_tokens, i.completion_tokens, i.total_tokens, i.latency_ms]));
    const csv = rows.map(r=> r.map(v=> `"${String(v||'').replace(/"/g,'""')}"`).join(',')).join('\n');
    const blob = new Blob([csv], {type:'text/csv'});
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `usage-${new Date().toISOString().slice(0,10)}.csv`; a.click();
    showToast(text('export') + ' ✓');
  }catch(e){ showToast(e.message); }
}
function selectCode(e){ const b=e.currentTarget; document.querySelectorAll('.code-tab').forEach(t=>t.classList.remove('active')); document.querySelectorAll('.code-sample').forEach(s=>s.classList.remove('active')); b.classList.add('active'); $(`#${b.dataset.code}`).classList.add('active'); $('#active-language').textContent=b.textContent; $('.code-panel .copy-code').dataset.copyTarget=b.dataset.code; }
function addBubble(role, content){ /* kept for compatibility, now uses addOptimisticMessage */}
async function login(){
  const emailEl = $('#email');
  const passEl = $('#password');
  const msgEl = $('#login-message');
  const btn = $('#login-btn');
  const email = emailEl.value.trim();
  const password = passEl.value;
  if(!email || !password){ msgEl.textContent = language==='ar' ? 'يرجى إدخال البريد وكلمة المرور' : 'Please enter email and password'; return; }
  if(btn) btn.disabled = true;
  msgEl.textContent = '';
  try{
    const r=await fetch('/api/auth/login',{method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body:new URLSearchParams({username: email, password})});
    if(!r.ok){
      const body = await r.json().catch(()=>({}));
      const detail = body.detail || (r.status===401 ? (language==='ar' ? 'البريد أو كلمة المرور غير صحيحة' : 'Incorrect email or password') : r.statusText);
      throw new Error(detail);
    }
    const data = await r.json();
    localStorage.setItem('afaq_token', data.access_token);
    if(data.user) localStorage.setItem('afaq_user', JSON.stringify(data.user));
    location.href='/chat';
  }catch(e){
    msgEl.textContent=e.message;
    if(btn) btn.disabled=false;
  }
}

function setDrawer(open){
  const s=$('#sidebar'), b=$('#sidebar-backdrop'), t=$('#menu-toggle');
  if(!s||!t) return;
  s.classList.toggle('open', open); t.setAttribute('aria-expanded', String(open)); if(b) b.hidden=!open;
  document.body.classList.toggle('drawer-open', open);
}
function closeDrawer(){ setDrawer(false); }

document.querySelectorAll('.nav-link').forEach((a)=>{ a.onclick=(e)=>{ e.preventDefault(); show(a.dataset.page); closeDrawer(); }; });
// ChatGPT-like: new chat is ephemeral until first message - do NOT create DB row yet
$('#new-chat').onclick = async () => {
  currentConversationId = null;
  localStorage.removeItem('afaq_current_conv');
  renderConversationList();
  showWelcome();
  updateChatHeader({title: text('newChatTitle'), model: $('#model-select')?.value || '', message_count:0});
  closeDrawer();
  const ta=$('#prompt'); if(ta){ ta.value=''; ta.focus(); autoResize(); }
  // clear composer model highlight
  const box=$('#messages'); if(box) box.scrollTop=0;
};
$('#menu-toggle')?.addEventListener('click', ()=> setDrawer(!$('#sidebar').classList.contains('open')));
$('#sidebar-close')?.addEventListener('click', closeDrawer);
$('#sidebar-backdrop')?.addEventListener('click', closeDrawer);
document.addEventListener('keydown', (e)=>{ if(e.key==='Escape' && $('#sidebar')?.classList.contains('open')) closeDrawer(); });
$('#logout').onclick = ()=>{ localStorage.removeItem('afaq_token'); localStorage.removeItem('afaq_current_conv'); location.href='/login'; };
$('#send').onclick = send;
$('#prompt')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
$('#prompt')?.addEventListener('input', autoResize);
$('#login-btn').onclick = login;
$('#new-key').onclick = openKeyModal; $('#key-form').onsubmit = createKey; $('#key-modal-close').onclick = ()=> $('#key-modal').close();
$('#new-user').onclick = openUserModal; $('#user-form').onsubmit = createUser; $('#user-modal-close').onclick = ()=> $('#user-modal').close();
$('#confirm-modal-close')?.addEventListener('click', ()=> $('#confirm-modal').close());
$('#prompt-modal-close')?.addEventListener('click', ()=> $('#prompt-modal').close());
// allow backdrop click to close dialogs (native <dialog> does not close on backdrop, so add listener)
document.querySelectorAll('dialog').forEach(dlg=>{
  dlg.addEventListener('click', (e)=>{
    const rect = dlg.getBoundingClientRect();
    if(e.clientX < rect.left || e.clientX > rect.right || e.clientY < rect.top || e.clientY > rect.bottom){
      dlg.close();
    }
  });
});
$('#key-copy').onclick = async ()=>{ await navigator.clipboard.writeText($('#key-value').value); $('#key-copy-message').textContent=text('copied'); };
$('#keys-list').onclick = (e)=>{ const b=e.target.closest('[data-action]'); if(!b) return; b.dataset.action==='toggle'?updateKey(b.dataset.keyId):deleteKey(b.dataset.keyId); };
$('#refresh-harnesses').onclick = refreshHarnesses;
$('#clear-chat')?.addEventListener('click', clearCurrentChat);
$('#rename-chat')?.addEventListener('click', ()=>{ if(currentConversationId) renameConversation(currentConversationId); });
$('#lang').onclick = ()=>{ 
  language = language==='ar'?'en':'ar'; 
  try { localStorage.setItem('afaq_lang', language); } catch {}
  applyLanguage(); 
  // also refresh theme button title which depends on language
  applyTheme(theme, false);
  const active = document.querySelector('.nav-link.active')?.dataset.page || 'chat';
  show(active,false); 
  renderConversationList(); 
  if(currentConversationId){
    const detail = conversationsCache.find(c=>c.id===currentConversationId);
    // re-render current messages with new language labels
    const box = $('#messages');
    if(box && !box.querySelector('.welcome')){
      // trigger re-fetch to update labels? simple re-render via select
      selectConversation(currentConversationId, false);
    }
  }
};
$('#theme-toggle')?.addEventListener('click', toggleTheme);
$('#theme-toggle')?.addEventListener('dblclick', (e)=>{ e.preventDefault(); resetThemeToAuto(); });
$('#theme-toggle')?.addEventListener('contextmenu', (e)=>{ e.preventDefault(); resetThemeToAuto(); showToast(language==='ar' ? 'تمت إعادة الوضع إلى تلقائي حسب الجهاز' : 'Reset to auto (system)'); });
document.querySelectorAll('.code-tab').forEach((t)=>{ t.onclick = selectCode; });
document.querySelectorAll('.copy-code').forEach((b)=>{ b.onclick = async ()=>{ await navigator.clipboard.writeText($(`#${b.dataset.copyTarget}`).textContent); b.textContent=text('copied'); setTimeout(()=>{ b.textContent=text('copy');},1400); }; });
window.onpopstate = ()=> show(document.body.dataset.page||'chat', false);

// ---------- Model Search bindings ----------
(function initModelSearch(){
  const trigger = document.getElementById('model-trigger');
  const dropdown = document.getElementById('model-dropdown');
  const input = document.getElementById('model-search-input');
  const clearBtn = document.getElementById('model-search-clear');
  const pills = document.getElementById('model-filter-pills');
  if (!trigger || !dropdown) return;

  trigger.addEventListener('click', (e)=>{
    e.stopPropagation();
    const isOpen = !dropdown.classList.contains('hidden');
    if (isOpen) closeModelDropdown(); else openModelDropdown();
  });

  // Search input
  if (input) {
    input.addEventListener('input', ()=>{
      modelSearchQuery = input.value;
      if (clearBtn) clearBtn.classList.toggle('hidden', !modelSearchQuery);
      focusedModelIndex = -1;
      renderModelList();
    });
    input.addEventListener('keydown', (e)=>{
      const filtered = getFilteredModels().slice(0,200);
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        focusedModelIndex = Math.min(focusedModelIndex + 1, filtered.length - 1);
        renderModelList();
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        focusedModelIndex = Math.max(focusedModelIndex - 1, 0);
        renderModelList();
      } else if (e.key === 'Enter') {
        e.preventDefault();
        if (focusedModelIndex >= 0 && filtered[focusedModelIndex]) {
          selectModel(filtered[focusedModelIndex].id);
        } else if (filtered.length === 1) {
          selectModel(filtered[0].id);
        }
      } else if (e.key === 'Escape') {
        closeModelDropdown();
        trigger.focus();
      }
    });
  }
  if (clearBtn) {
    clearBtn.addEventListener('click', ()=>{
      modelSearchQuery = '';
      if (input) { input.value = ''; input.focus(); }
      clearBtn.classList.add('hidden');
      focusedModelIndex = -1;
      renderModelList();
    });
  }
  if (pills) {
    pills.addEventListener('click', (e)=>{
      const btn = e.target.closest('.pill');
      if (!btn) return;
      pills.querySelectorAll('.pill').forEach(p=>p.classList.remove('active'));
      btn.classList.add('active');
      modelFilter = btn.dataset.filter || 'all';
      focusedModelIndex = -1;
      renderModelList();
      if (input) input.focus();
    });
  }
  // Close on mobile close button or backdrop click
  document.getElementById('model-dropdown-close')?.addEventListener('click', closeModelDropdown);
  document.getElementById('model-dropdown-backdrop')?.addEventListener('click', closeModelDropdown);

  // Close on outside click
  document.addEventListener('click', (e)=>{
    if (!dropdown.classList.contains('hidden') && !dropdown.contains(e.target) && !trigger.contains(e.target)) {
      closeModelDropdown();
    }
  });
  // Close on Esc globally
  document.addEventListener('keydown', (e)=>{
    if (e.key === 'Escape' && !dropdown.classList.contains('hidden')) {
      closeModelDropdown();
    }
  });

  // Reparent for mobile viewport isolation
  ensureModelDropdownPlacement();
  window.addEventListener('resize', ensureModelDropdownPlacement);

  // Keyboard avoidance on mobile using visualViewport
  if (window.visualViewport) {
    const handleViewport = () => {
      if (dropdown.classList.contains('hidden') || window.innerWidth > 860) return;
      const keyboardHeight = Math.max(0, window.innerHeight - window.visualViewport.height);
      if (keyboardHeight > 80) {
        dropdown.style.bottom = `${keyboardHeight}px`;
        dropdown.style.maxHeight = `${window.visualViewport.height - 12}px`;
      } else {
        dropdown.style.bottom = '';
        dropdown.style.maxHeight = '';
      }
    };
    window.visualViewport.addEventListener('resize', handleViewport);
    window.visualViewport.addEventListener('scroll', handleViewport);
  }

  // Touch drag down to dismiss bottom sheet on mobile
  const handle = dropdown.querySelector('.model-dropdown-sheet-handle');
  const mobileHeader = dropdown.querySelector('.model-dropdown-mobile-header');
  let startY = 0;
  let currentY = 0;
  let isDragging = false;

  const onTouchStart = (e) => {
    if (window.innerWidth > 860) return;
    startY = e.touches[0].clientY;
    currentY = startY;
    isDragging = true;
    dropdown.style.transition = 'none';
  };
  const onTouchMove = (e) => {
    if (!isDragging) return;
    currentY = e.touches[0].clientY;
    const deltaY = currentY - startY;
    if (deltaY > 0) {
      dropdown.style.transform = `translateY(${deltaY}px)`;
    }
  };
  const onTouchEnd = () => {
    if (!isDragging) return;
    isDragging = false;
    const deltaY = currentY - startY;
    dropdown.style.transition = 'transform 200ms cubic-bezier(0.16, 1, 0.3, 1)';
    if (deltaY > 70) {
      dropdown.style.transform = 'translateY(100%)';
      setTimeout(() => {
        closeModelDropdown();
        dropdown.style.transform = '';
        dropdown.style.transition = '';
      }, 200);
    } else {
      dropdown.style.transform = 'translateY(0)';
      setTimeout(() => {
        dropdown.style.transform = '';
        dropdown.style.transition = '';
      }, 200);
    }
  };
  [handle, mobileHeader].forEach(el => {
    if (el) {
      el.addEventListener('touchstart', onTouchStart, { passive: true });
      el.addEventListener('touchmove', onTouchMove, { passive: true });
      el.addEventListener('touchend', onTouchEnd, { passive: true });
    }
  });
})();

// ---------- Usage ----------
(function initUsage(){
  const harnessSel = document.getElementById('usage-harness');
  const modelInput = document.getElementById('usage-model');
  const rangeSel = document.getElementById('usage-range');
  const refreshBtn = document.getElementById('usage-refresh');
  const applyBtn = document.getElementById('usage-apply');
  const clearBtn = document.getElementById('usage-clear');
  const exportBtn = document.getElementById('usage-export');
  const prevBtn = document.getElementById('usage-prev');
  const nextBtn = document.getElementById('usage-next');
  if(harnessSel) harnessSel.addEventListener('change', ()=>{ usageOffset=0; loadUsage(); });
  if(rangeSel) rangeSel.addEventListener('change', ()=>{ usageOffset=0; loadUsage(); });
  if(modelInput){
    let t;
    modelInput.addEventListener('input', ()=>{
      clearTimeout(t);
      t=setTimeout(()=>{ usageOffset=0; loadUsage(); }, 400);
    });
  }
  if(applyBtn) applyBtn.addEventListener('click', ()=>{ usageOffset=0; loadUsage(); });
  if(clearBtn) clearBtn.addEventListener('click', ()=>{
    if(harnessSel) harnessSel.value='';
    if(modelInput) modelInput.value='';
    if(rangeSel) rangeSel.value='all';
    usageOffset=0; loadUsage();
  });
  if(refreshBtn) refreshBtn.addEventListener('click', ()=>{ usageOffset=0; loadUsage(); });
  if(exportBtn) exportBtn.addEventListener('click', exportUsage);
  if(prevBtn) prevBtn.addEventListener('click', ()=>{ if(usageOffset>=usageLimit){ usageOffset-=usageLimit; loadUsage(); }});
  if(nextBtn) nextBtn.addEventListener('click', ()=>{ usageOffset+=usageLimit; loadUsage(); });
})();

// ---------- Harnesses with Install ----------
const HARNESS_META = {
  opencode: { desc: { ar: 'محرك نماذج خفيف — big-pickle, claude-sonnet', en: 'Lightweight engine — big-pickle, claude-sonnet' } },
  codex: { desc: { ar: 'واجهة OpenAI Codex', en: 'OpenAI Codex CLI' } },
  claude: { desc: { ar: 'أداة Claude الرسمية', en: 'Official Claude Code CLI' } },
  commandcode: { desc: { ar: 'Command Code — دعم DeepSeek', en: 'Command Code — DeepSeek support' } },
  agy: { desc: { ar: 'Google Antigravity — ثنائي رسمي (سكربت التثبيت)', en: 'Google Antigravity — official standalone binary' } },
};

let setupInstalling = null;

async function checkSetupStatus() {
  try {
    const r = await fetch('/api/auth/setup-status');
    if (!r.ok) return { needs_setup: false, has_users: true };
    return await r.json();
  } catch { return { needs_setup: false, has_users: true }; }
}

function showSetupPanel(n) {
  document.querySelectorAll('.setup-panel').forEach(p => p.classList.remove('active'));
  const target = document.getElementById(`setup-panel-${n}`);
  if (target) target.classList.add('active');
  document.querySelectorAll('.stepper-step').forEach(s => {
    const step = parseInt(s.dataset.step);
    s.classList.toggle('active', step === n);
    s.classList.toggle('done', step < n);
  });
  document.querySelectorAll('.stepper-line').forEach((line, idx) => {
    line.classList.toggle('filled', idx < n - 1);
  });
  const stepper = document.getElementById('setup-stepper');
  if (stepper) stepper.setAttribute('aria-valuenow', n);
  // update brand logo theme
  const img = document.querySelector('.setup-logo');
  if (img) img.src = theme === 'light' ? '/static/brand/lockup-dark.png' : '/static/brand/lockup-white.png';
}

async function loadSetupHarnesses() {
  const grid = document.getElementById('setup-harness-grid');
  if (!grid) return;
  grid.innerHTML = `<div class="muted" style="grid-column:1/-1; text-align:center; padding:18px">${text('loading')}</div>`;
  try {
    const hs = await api('/api/admin/harnesses');
    if (!hs.length) {
      grid.innerHTML = `<div class="muted" style="grid-column:1/-1; text-align:center">${text('noModelsFound')}</div>`;
      return;
    }
    grid.innerHTML = hs.map(h => {
      const meta = HARNESS_META[h.name] || { desc: { ar: '', en: '' } };
      const desc = meta.desc[language] || meta.desc.en || '';
      const isInstalled = !!h.installed;
      const badge = isInstalled ? `<span class="badge ok">${text('installed')}</span>` : `<span class="badge">${text('notInstalled')}</span>`;
      const countLine = h.models.length ? `<small>${h.models.length} ${text('models')} · ${h.models.slice(0,2).map(m=>escapeHtml(m.id.split('/').pop())).join(', ')}${h.models.length>2?'…':''}</small>` : `<small class="muted">${text('noModelsFound')}</small>`;
      const actionBtn = isInstalled
        ? `<button class="harness-btn success" disabled>✓ ${text('installed')}</button><button class="harness-btn" data-setup-action="update" data-harness="${escapeHtml(h.name)}">${text('update')}</button>`
        : `<button class="harness-btn primary" data-setup-action="install" data-harness="${escapeHtml(h.name)}">${text('install')}</button>`;
      return `<div class="setup-harness-card ${isInstalled?'installed':''}" data-harness-card="${escapeHtml(h.name)}" data-install-recipe="${escapeHtml(h.install_recipe||'')}" data-update-recipe="${escapeHtml(h.update_recipe||'')}">
        <div class="harness-head"><h3>${escapeHtml(h.display_name)}</h3>${badge}</div>
        <p>${escapeHtml(desc)}</p>
        <small class="mono" style="color:var(--text-faint)">${escapeHtml(h.install_recipe||'')}</small>
        ${countLine}
        <div class="setup-harness-actions">${actionBtn} <button class="harness-btn" data-setup-action="log" data-harness="${escapeHtml(h.name)}" style="display:none">${text('viewLog')}</button></div>
      </div>`;
    }).join('');
    // update done stats
    const stats = document.getElementById('setup-done-stats');
    if (stats) {
      const installed = hs.filter(h=>h.installed).length;
      stats.innerHTML = `
        <div class="setup-done-stat"><strong>${installed} / ${hs.length}</strong><span>${text('installed')}</span></div>
        <div class="setup-done-stat"><strong>${hs.reduce((a,c)=>a+c.models.length,0)}</strong><span>${text('models')}</span></div>`;
    }
  } catch (e) {
    grid.innerHTML = `<div class="muted" style="grid-column:1/-1; text-align:center; color:var(--status-error)">${escapeHtml(e.message)}</div>`;
  }
}

async function installHarness(name, btn, action='install') {
  if (setupInstalling) { showToast(language==='ar' ? 'انتظر انتهاء التثبيت الحالي' : 'Wait for current install'); return; }
  setupInstalling = name;
  const act = action === 'update' ? 'update' : 'install';
  const card = document.querySelector(`[data-harness-card="${name}"]`);
  const logCard = document.getElementById('setup-log-card');
  const logEl = document.getElementById('setup-log');
  const statusEl = document.getElementById('setup-log-status');
  const btnOrig = btn ? btn.textContent : '';
  if (btn) { btn.disabled = true; btn.textContent = text('installing'); }
  if (logCard) logCard.classList.remove('hidden');
  if (logEl) {
    const recipe = act === 'update' ? card?.dataset.updateRecipe : card?.dataset.installRecipe;
    const cmd = recipe || `${act === 'update' ? 'update' : 'install'} ${name}`;
    logEl.textContent = `→ ${cmd}\n— ${new Date().toLocaleTimeString()} —\n`;
    logEl.scrollTop = logEl.scrollHeight;
  }
  if (statusEl) { statusEl.textContent = text('installing'); statusEl.className = 'badge'; }
  try {
    const res = await api(`/api/admin/harnesses/${name}/${act}`, { method: 'POST' });
    const jobId = res.job_id;
    if (statusEl) statusEl.textContent = `job ${jobId.slice(0,8)}…`;
    // stream logs via SSE (token via query because EventSource can't send headers)
    const _tok = token();
    const esUrl = _tok ? `/api/admin/harnesses/${name}/jobs/${jobId}/stream?token=${encodeURIComponent(_tok)}` : `/api/admin/harnesses/${name}/jobs/${jobId}/stream`;
    const es = new EventSource(esUrl);
    // Fallback to polling if SSE fails due to auth (we try fetch streaming polyfill)
    // Try to use fetch with EventSource-like polling as fallback
    let gotEvent = false;
    es.onmessage = (e) => {
      gotEvent = true;
      try {
        const data = JSON.parse(e.data);
        if (logEl) { logEl.textContent += (data.message || JSON.stringify(data)) + '\n'; logEl.scrollTop = logEl.scrollHeight; }
      } catch { if (logEl) logEl.textContent += e.data + '\n'; }
    };
    // custom event handling via addEventListener for 'log' and 'done'
    const appendLog = (msg) => { if (logEl) { logEl.textContent += msg + '\n'; logEl.scrollTop = logEl.scrollHeight; } };
    es.addEventListener('log', (e) => {
      gotEvent = true;
      try { const d = JSON.parse(e.data); appendLog(d.message || e.data); } catch { appendLog(e.data); }
    });
    es.addEventListener('done', (e) => {
      gotEvent = true;
      try {
        const d = JSON.parse(e.data);
        const ok = d.stage === 'completed' && (d.exit_code === 0 || d.exit_code == null);
        if (statusEl) { statusEl.textContent = ok ? `✓ ${text('installed')}` : `✗ ${text('notInstalled')}`; statusEl.className = ok ? 'badge ok' : 'badge'; }
        if (logEl) logEl.textContent += `\n— ${ok ? '✓ completed' : '✗ failed (code ' + (d.exit_code||1) + ')'} —\n`;
      } catch { if (statusEl) statusEl.textContent = 'done'; }
      es.close();
      setupInstalling = null;
      if (btn) { btn.disabled = false; btn.textContent = btnOrig || (act==='update' ? text('update') : text('install')); }
      loadSetupHarnesses(); // refresh grid
      if (document.getElementById('harness-grid')) loadHarnesses();
    });
    es.addEventListener('error', () => {
      // fallback polling after 1.5s if no events
      setTimeout(async () => {
        if (gotEvent) return;
        es.close();
        // poll via fetch
        for (let i=0;i<60;i++) {
          try {
            const j = await api(`/api/admin/harnesses/${name}/jobs/${jobId}`);
            if (logEl) { logEl.textContent = (j.logs||[]).join('\n') + '\n'; logEl.scrollTop = logEl.scrollHeight; }
            if (j.stage === 'completed' || j.stage === 'failed') {
              const ok = j.stage === 'completed';
              if (statusEl) { statusEl.textContent = ok ? `✓ ${text('installed')}` : `✗ failed`; statusEl.className = ok ? 'badge ok' : 'badge'; }
              setupInstalling = null;
              if (btn) { btn.disabled = false; btn.textContent = btnOrig || (act==='update' ? text('update') : text('install')); }
              loadSetupHarnesses();
              if (document.getElementById('harness-grid')) loadHarnesses();
              break;
            }
          } catch {}
          await new Promise(r=>setTimeout(r,1500));
        }
      }, 1500);
    });
    // also start polling as backup regardless (covers auth issue with EventSource)
    setTimeout(async () => {
      if (gotEvent) return;
      // if SSE never fired, fallback polling already started via error handler; duplicate safe
    }, 1200);
  } catch (e) {
    if (logEl) logEl.textContent += `\n✗ ${escapeHtml(e.message)}\n`;
    if (statusEl) { statusEl.textContent = '✗ failed'; statusEl.className = 'badge'; }
    showToast(e.message);
    setupInstalling = null;
    if (btn) { btn.disabled = false; btn.textContent = btnOrig || (act==='update' ? text('update') : text('install')); }
  }
}

// Enhanced harnesses page with install buttons
const _originalLoadHarnesses = loadHarnesses;
async function loadHarnessesEnhanced() {
  try {
    const hs = await api('/api/admin/harnesses');
    const grid = document.getElementById('harness-grid');
    if (!grid) return;
    if (!hs.length) { grid.innerHTML = `<div class="muted">${text('noModelsFound')}</div>`; return; }
    grid.innerHTML = hs.map(h => {
      const meta = HARNESS_META[h.name] || { desc: { ar:'', en:'' } };
      const isInstalled = !!h.installed;
      const badge = isInstalled ? `<span class="badge ok">${text('installed')}</span>` : `<span class="badge">${text('notInstalled')}</span>`;
      const models = h.models.slice(0,6).map(m=>`<span style="font:500 11px var(--font-mono);background:rgba(59,130,246,0.08);border:1px solid rgba(59,130,246,0.18);color:var(--brand-primary);padding:3px 7px;border-radius:999px">${escapeHtml(m.id.split('/').pop())}</span>`).join('');
      const more = h.models.length>6?`<span style="font:500 11px var(--font-mono);color:var(--text-faint)">+${h.models.length-6}</span>`:'';
      const btn = isInstalled
        ? `<button class="harness-btn success" disabled>✓ ${text('installed')}</button> <button class="harness-btn" data-harness-action="update" data-harness="${escapeHtml(h.name)}">${text('update')}</button> <button class="harness-btn danger" data-harness-action="uninstall" data-harness="${escapeHtml(h.name)}" title="${language==='ar'?'بعد حذف الـ CLI خارجياً، اضغط هنا لتحديث حالة البوابة':'After deleting the CLI externally, click to sync gateway state'}">${language==='ar'?'إزالة من البوابة':'Sync uninstall'}</button>`
        : `<button class="harness-btn primary" data-harness-action="install" data-harness="${escapeHtml(h.name)}">${text('install')}</button>`;
      return `<div class="card ${isInstalled?'installed':''}" data-harness-card="${escapeHtml(h.name)}" data-install-recipe="${escapeHtml(h.install_recipe||'')}" data-update-recipe="${escapeHtml(h.update_recipe||'')}"><div><h3>${escapeHtml(h.display_name)}</h3><p>${escapeHtml(meta.desc[language]||meta.desc.en||h.provider||'')}</p><small class="mono" style="color:var(--text-faint)">${escapeHtml(h.install_recipe||'')}</small><div style="margin-top:8px;display:flex;gap:6px;flex-wrap:wrap">${models}${more}</div></div><small>${h.models.length} ${language==='ar'?'موديل':'models'} · <span class="mono">${escapeHtml(h.name)}</span></small><div style="display:flex; align-items:center; gap:8px; flex-wrap:wrap">${badge} ${btn}</div></div>`;
    }).join('');
  } catch(e){ const g=document.getElementById('harness-grid'); if(g) g.innerHTML = `<p class="error-message">${escapeHtml(e.message)}</p>`; }
}
// Override
loadHarnesses = loadHarnessesEnhanced;

// Init
(async()=>{
  applyLanguage();
  applyTheme(theme, false);
  const page=document.body.dataset.page||'chat';
  const needsSetup = await checkSetupStatus();

  // If setup needed, force setup page regardless of requested page
  if (needsSetup.needs_setup) {
    document.body.classList.add('setup-mode');
    document.body.dataset.page = 'setup';
    document.querySelectorAll('.page').forEach(el=> el.classList.add('hidden'));
    const setupSec = document.getElementById('setup');
    if (setupSec) setupSec.classList.remove('hidden');
    // hide login too
    const loginSec = document.getElementById('login');
    if (loginSec) loginSec.classList.add('hidden');
    showSetupPanel(1);
    bindSetupEvents();
    // if already have token (edge), clear it
    if (token()) { localStorage.removeItem('afaq_token'); }
    return;
  }

  // If user hits /setup but already setup, redirect
  if (page==='setup') {
    if (!needsSetup.needs_setup) {
      if (token()) location.href='/chat';
      else location.href='/login';
      return;
    }
  }

  if(page==='login'){
    document.body.classList.add('login-only');
    document.querySelectorAll('.page').forEach((el)=> el.classList.add('hidden'));
    const loginSec = document.getElementById('login');
    if (loginSec) loginSec.classList.remove('hidden');
    if(token()) location.href='/chat';
    return;
  }
  if(page==='setup'){
    document.body.classList.add('setup-mode');
    showSetupPanel(1);
    bindSetupEvents();
    return;
  }
  if(!token()){ location.href='/login'; return; }
  show(page,false);
  bindMainHarnessGrid();
  bindSetupEvents();
  await loadModels();
  await loadConversations();
  bindSuggestions();
  autoResize();
  // if initial page is harnesses, ensure grid bound after render
  if (page==='harnesses') setTimeout(bindMainHarnessGrid, 300);
})();

function bindSetupEvents() {
  const form = document.getElementById('setup-form');
  if (form && !form.dataset.bound) {
    form.dataset.bound = '1';
    form.addEventListener('submit', async (e)=>{
      e.preventDefault();
      const email = document.getElementById('setup-email').value.trim();
      const name = document.getElementById('setup-name').value.trim();
      const p1 = document.getElementById('setup-password').value;
      const p2 = document.getElementById('setup-password2').value;
      const msg = document.getElementById('setup-message');
      const btn = document.getElementById('setup-submit');
      msg.textContent = ''; msg.className='setup-message';
      if (!email || !email.includes('@')) { msg.textContent = text('setupEmailInvalid'); return; }
      if (p1.length < 8) { msg.textContent = text('setupPasswordShort'); return; }
      if (p1 !== p2) { msg.textContent = text('setupPasswordMismatch'); return; }
      btn.disabled = true; const orig = btn.innerHTML; btn.innerHTML = text('setupCreating');
      try {
        const r = await fetch('/api/auth/bootstrap', { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ email, password: p1, display_name: name || email.split('@')[0] }) });
        const data = await r.json().catch(()=>({}));
        if (!r.ok) throw new Error(data.detail || data.error?.message || r.statusText);
        // auto-login: save token
        const tokenVal = data.access_token || data.token || (data.user && data.user.access_token);
        const toStore = tokenVal || data.access_token;
        if (toStore) {
          localStorage.setItem('afaq_token', toStore);
          if (data.user) localStorage.setItem('afaq_user', JSON.stringify(data.user));
          else if (data.email) localStorage.setItem('afaq_user', JSON.stringify(data));
        } else {
          // fallback: login via credentials
          const lr = await fetch('/api/auth/login', { method:'POST', headers:{'Content-Type':'application/x-www-form-urlencoded'}, body: new URLSearchParams({username: email, password: p1}) });
          const lj = await lr.json();
          if (lr.ok && lj.access_token) localStorage.setItem('afaq_token', lj.access_token);
        }
        msg.textContent = language==='ar' ? '✓ تم إنشاء الحساب — جارٍ تحميل الأدوات...' : '✓ Account created — loading harnesses...';
        msg.className='setup-message success';
        showSetupPanel(2);
        await loadSetupHarnesses();
      } catch (err) {
        msg.textContent = err.message;
        msg.className='setup-message';
      } finally { btn.disabled=false; btn.innerHTML = orig; }
    });
  }
  const refreshBtn = document.getElementById('setup-refresh-harnesses');
  if (refreshBtn && !refreshBtn.dataset.bound) {
    refreshBtn.dataset.bound='1';
    refreshBtn.addEventListener('click', async ()=>{
      refreshBtn.disabled=true;
      try { await api('/api/admin/harnesses/refresh', {method:'POST'}); await loadSetupHarnesses(); } catch(e){ showToast(e.message);} finally{ refreshBtn.disabled=false;}
    });
  }
  const skipBtn = document.getElementById('setup-skip');
  if (skipBtn && !skipBtn.dataset.bound) {
    skipBtn.dataset.bound='1';
    skipBtn.addEventListener('click', ()=> { location.href='/chat'; });
  }
  const nextBtn = document.getElementById('setup-next');
  if (nextBtn && !nextBtn.dataset.bound) {
    nextBtn.dataset.bound='1';
    nextBtn.addEventListener('click', ()=> { showSetupPanel(3); });
  }
  const doneBtn = document.getElementById('setup-done');
  if (doneBtn && !doneBtn.dataset.bound) {
    doneBtn.dataset.bound='1';
    doneBtn.addEventListener('click', ()=> { location.href='/chat'; });
  }
  const logClose = document.getElementById('setup-log-close');
  if (logClose && !logClose.dataset.bound) {
    logClose.dataset.bound='1';
    logClose.addEventListener('click', ()=> { document.getElementById('setup-log-card')?.classList.add('hidden'); });
  }
  const grid = document.getElementById('setup-harness-grid');
  if (grid && !grid.dataset.bound) {
    grid.dataset.bound='1';
    grid.addEventListener('click', (e)=>{
      const btn = e.target.closest('[data-setup-action]');
      if (!btn) return;
      const action = btn.dataset.setupAction;
      const harness = btn.dataset.harness;
      if (action === 'install' || action === 'update') installHarness(harness, btn, action);
      else if (action === 'log') document.getElementById('setup-log-card')?.classList.remove('hidden');
    });
  }
  // setup log actions
  const logCopy = document.getElementById('setup-log-copy');
  if (logCopy && !logCopy.dataset.bound) {
    logCopy.dataset.bound='1';
    logCopy.addEventListener('click', async ()=>{
      const logEl = document.getElementById('setup-log');
      if (!logEl) return;
      try { await navigator.clipboard.writeText(logEl.textContent); showToast(text('copied')); } catch { showToast(logEl.textContent.slice(0,120)); }
    });
  }
  const logClear = document.getElementById('setup-log-clear');
  if (logClear && !logClear.dataset.bound) {
    logClear.dataset.bound='1';
    logClear.addEventListener('click', ()=>{
      const logEl = document.getElementById('setup-log');
      if (logEl) logEl.textContent = '';
      const statusEl = document.getElementById('setup-log-status');
      if (statusEl) { statusEl.textContent=''; statusEl.className='badge'; }
    });
  }
  // wizard theme / language toggles
  const setupTheme = document.getElementById('setup-theme-toggle');
  if (setupTheme && !setupTheme.dataset.bound) {
    setupTheme.dataset.bound='1';
    setupTheme.addEventListener('click', ()=>{
      const cur = document.documentElement.getAttribute('data-theme');
      applyTheme(cur === 'light' ? 'dark' : 'light');
      // update wizard logo
      const logo = document.querySelector('.setup-logo');
      if (logo) logo.src = theme === 'light' ? '/static/brand/lockup-dark.png' : '/static/brand/lockup-white.png';
    });
  }
  const setupLang = document.getElementById('setup-lang');
  if (setupLang && !setupLang.dataset.bound) {
    setupLang.dataset.bound='1';
    setupLang.addEventListener('click', ()=>{
      language = language==='ar'?'en':'ar';
      try { localStorage.setItem('afaq_lang', language); } catch {}
      applyLanguage();
      applyTheme(theme, false);
      // refresh wizard UI texts that are not data-i18n
      loadSetupHarnesses();
    });
  }
}

function bindMainHarnessGrid(){
  const mainGrid = document.getElementById('harness-grid');
  if (!mainGrid || mainGrid.dataset.bound) return;
  mainGrid.dataset.bound='1';
  mainGrid.addEventListener('click', async (e)=>{
    const btn = e.target.closest('[data-harness-action]');
    if (!btn) return;
    const harness = btn.dataset.harness;
    const action = btn.dataset.harnessAction;
    if (action === 'uninstall') {
      // Tell the gateway to forget this harness's state after the user has
      // removed the CLI externally. We do NOT delete the binary here.
      const ok = await showConfirmBox({
        title: language==='ar' ? `إزالة ${harness}` : `Forget ${harness}?`,
        message: language==='ar' ? 'إزالة من حالة البوابة — لن يحذف البرنامج المثبت على النظام' : 'Forget this harness from gateway state — will not delete the installed program on disk',
        confirmText: text('confirm'),
        cancelText: text('cancel'),
      });
      if (!ok) return;
      const orig = btn.textContent;
      btn.disabled = true;
      try {
        await api(`/api/admin/harnesses/${harness}/uninstall`, { method: 'POST' });
        showToast(language==='ar' ? `تم: ${harness} غير مثبت الآن` : `Synced: ${harness} now uninstalled`);
        await loadHarnesses();
      } catch (err) {
        showToast(err.message);
      } finally {
        btn.disabled = false;
        btn.textContent = orig;
      }
      return;
    }
    if (action === 'install' || action === 'update') {
      const orig = btn.textContent;
      btn.disabled=true; btn.textContent=text('installing');
      // ensure harnesses page has a log area? reuse setup log or show toast
      try {
        const res = await api(`/api/admin/harnesses/${harness}/${action}`, {method:'POST'});
        showToast(`${harness}: ${res.status||'started'} (${res.job_id.slice(0,8)})`);
        // show a temporary inline log under grid
        let logBox = document.getElementById('harness-install-log');
        if (!logBox) {
          logBox = document.createElement('div');
          logBox.id = 'harness-install-log';
          logBox.className = 'setup-log-card';
          logBox.style.marginTop='14px';
          logBox.innerHTML = `<div class="setup-log-header"><span class="terminal-dots"><i></i><i></i><i></i></span><span>${text('installLog')}</span><span class="badge" id="harness-log-status"></span><div class="setup-log-actions"><button class="outline-button small" onclick="this.closest('.setup-log-card').remove()">${text('close')}</button></div></div><pre class="setup-log" id="harness-log" style="max-height:240px"></pre>`;
          mainGrid.after(logBox);
        }
        const logEl = document.getElementById('harness-log');
        const statusEl = document.getElementById('harness-log-status');
        const recipe = action === 'update' ? btn.closest('[data-harness-card]')?.dataset.updateRecipe : btn.closest('[data-harness-card]')?.dataset.installRecipe;
        if (logEl) logEl.textContent = `→ ${recipe || `${action} ${harness}`} — ${new Date().toLocaleTimeString()}\n`;
        // poll with live update
        let lastLen = 0;
        for(let i=0;i<80;i++){
          await new Promise(r=>setTimeout(r,1300));
          try{
            const j = await api(`/api/admin/harnesses/${harness}/jobs/${res.job_id}`);
            if (logEl && j.logs) {
              const newLogs = j.logs.slice(lastLen).join('\n');
              if (newLogs) { logEl.textContent += (logEl.textContent.endsWith('\n')?'':'\n') + newLogs + '\n'; logEl.scrollTop = logEl.scrollHeight; lastLen = j.logs.length; }
            }
            if (statusEl) statusEl.textContent = j.stage;
            if(j.stage==='completed' || j.stage==='failed'){
              const ok = j.stage==='completed' && (j.exit_code===0 || j.exit_code==null);
              if (statusEl) { statusEl.textContent = ok ? `✓ ${text('installed')}` : `✗ failed`; statusEl.className = ok ? 'badge ok' : 'badge'; }
              showToast(ok ? `✓ ${harness} ${text('installed')}` : `✗ ${harness} failed`);
              loadHarnesses();
              break;
            }
          }catch(e){ if (logEl) logEl.textContent += `\n${e.message}\n`; }
        }
      } catch(err){ showToast(err.message);} finally{ btn.disabled=false; btn.textContent=orig; }
    }
  });
}

