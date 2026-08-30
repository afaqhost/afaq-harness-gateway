const $ = (s) => document.querySelector(s);
const token = () => localStorage.getItem('afaq_token');
let language = 'ar';
let currentConversationId = localStorage.getItem('afaq_current_conv') ? parseInt(localStorage.getItem('afaq_current_conv')) : null;
let conversationsCache = [];
let isStreaming = false;

const translations = {
  ar: {
    newChat: 'محادثة جديدة', chat: 'المحادثة', harnesses: 'الهارنسس', apiKeys: 'مفاتيح API', users: 'المستخدمون', docs: 'التوثيق', workspace: 'مساحة العمل', logout: 'تسجيل الخروج', installed: 'مثبّت', notInstalled: 'غير مثبّت', chatSubtitle: 'تحدث مع أي Harness من مكان واحد — محادثات محفوظة مع ذاكرة سياقية', online: 'البوابة متصلة', secureAccess: 'وصول آمن', loginTitle: 'تسجيل الدخول', loginDescription: 'أدخل بيانات حسابك للوصول إلى لوحة Afaq.', email: 'البريد الإلكتروني', password: 'كلمة المرور', login: 'دخول', welcomeTitle: 'مساحة تفكير واحدة،', welcomeTitleAccent: 'كل الهارنسس.', welcomeDescription: 'اختر موديلًا من القائمة وابدأ محادثة جديدة. محادثاتك محفوظة تلقائيًا مع ذاكرة سياقية.', model: 'الموديل', loading: 'جارٍ التحميل...', messagePlaceholder: 'اكتب رسالتك هنا... (المحادثة لها ذاكرة)', enterHint: 'Enter للإرسال · Shift + Enter لسطر جديد — المحادثة تحفظ تلقائيًا', send: 'إرسال', harnessTitle: 'الأدوات المتصلة', refresh: 'تحديث الموديلات', keyTitle: 'مفاتيح الوصول', createKey: 'إنشاء مفتاح', userTitle: 'المستخدمون والصلاحيات', addUser: 'إضافة مستخدم', displayName: 'الاسم', docsTitle: 'ابدأ خلال دقائق', docsIntro: 'استخدم Afaq Gateway كواجهة متوافقة مع OpenAI للوصول إلى أدوات الذكاء الاصطناعي من أي تطبيق.', docsAuthTitle: 'المصادقة', docsAuthText: 'أنشئ API Key وأرسله في ترويسة Bearer مع كل طلب شات.', docsModelsTitle: 'الموديلات', docsModelsText: 'استخدم GET /v1/models لمعرفة الموديلات المتاحة.', docsResponseTitle: 'الاستجابة', docsResponseText: 'النص النهائي موجود في choices[0].message.content.', docsModelsHeading: 'جلب الموديلات', docsModelsBody: 'يعيد هذا المسار الموديلات المكتشفة من الهارنسس المثبتة.', docsChatHeading: 'إرسال رسالة', docsChatBody: 'استبدل API Key والموديل بقيم موجودة في حسابك.', docsStreamHeading: 'البث المباشر', docsStreamText: 'فعّل stream للحصول على أجزاء SSE تدريجيًا، وتنتهي الاستجابة الناجحة بـ data: [DONE].', docsErrorsTitle: 'أخطاء شائعة', docsErrorsText: '401 يعني أن المصادقة فشلت (مفتاح غير صالح أو جلسة منتهية)، و400 يعني أن اسم الهارنس غير معروف، و502 يعني أن أداة CLI فشلت.', keyName: 'اسم المفتاح', create: 'إنشاء', keyWarning: 'احفظ هذا المفتاح الآن، لن يظهر كاملًا مرة أخرى.', copy: 'نسخ', copied: 'تم نسخ المفتاح', active: 'فعال', disabled: 'معطل', enable: 'تفعيل', disable: 'تعطيل', delete: 'حذف', noKeys: 'لا توجد مفاتيح حتى الآن', deleteConfirm: 'هل تريد حذف هذا المفتاح نهائيًا؟', keyError: 'تعذر إنشاء المفتاح', toggleError: 'تعذر تغيير حالة المفتاح', deleteError: 'تعذر حذف المفتاح', refreshError: 'تعذر تحديث الموديلات', sessionExpired: 'انتهت الجلسة، يرجى تسجيل الدخول مرة أخرى', authRequired: 'المصادقة مطلوبة. يرجى تسجيل الدخول مرة أخرى.', chatError: 'تعذر إرسال الرسالة', history: 'السجل', noChats: 'لا توجد محادثات بعد', deleteChatConfirm: 'حذف هذه المحادثة؟', rename: 'إعادة تسمية', renamePrompt: 'عنوان جديد:', typing: 'يكتب...', copyMsg: 'نسخ', copiedMsg: 'تم النسخ', retry: 'إعادة', you: 'أنت', assistant: 'المساعد', newChatTitle: 'محادثة جديدة', messages: 'رسائل', clear: 'مسح'
  },
  en: {
    newChat: 'New chat', chat: 'Chat', harnesses: 'Harnesses', apiKeys: 'API keys', users: 'Users', docs: 'Docs', workspace: 'Workspace', logout: 'Log out', installed: 'Installed', notInstalled: 'Not installed', chatSubtitle: 'Talk to any harness from one place — saved chats with context memory', online: 'Gateway online', secureAccess: 'Secure access', loginTitle: 'Sign in', loginDescription: 'Enter your account details to access Afaq.', email: 'Email address', password: 'Password', login: 'Sign in', welcomeTitle: 'One thinking space,', welcomeTitleAccent: 'All Harnesses.', welcomeDescription: 'Choose a model and start a new conversation. Chats are auto-saved with context memory.', model: 'Model', loading: 'Loading...', messagePlaceholder: 'Write your message... (chat has memory)', enterHint: 'Enter to send · Shift + Enter for new line — chat auto-saves', send: 'Send', harnessTitle: 'Connected tools', refresh: 'Refresh models', keyTitle: 'Access keys', createKey: 'Create key', userTitle: 'Users and permissions', addUser: 'Add user', displayName: 'Name', docsTitle: 'Get started in minutes', docsIntro: 'Use Afaq Gateway as an OpenAI-compatible interface for AI tools from any application.', docsAuthTitle: 'Authentication', docsAuthText: 'Create an API key and send it as a Bearer header with every chat request.', docsModelsTitle: 'Models', docsModelsText: 'Use GET /v1/models to see the available models.', docsResponseTitle: 'Response', docsResponseText: 'The final text is at choices[0].message.content.', docsModelsHeading: 'List models', docsModelsBody: 'This route returns models discovered from installed harnesses.', docsChatHeading: 'Send a message', docsChatBody: 'Replace the API key and model with values from your account.', docsStreamHeading: 'Streaming', docsStreamText: 'Set stream to true for incremental SSE chunks. Successful streams end with data: [DONE].', docsErrorsTitle: 'Common errors', docsErrorsText: '401 means authentication failed (invalid key or expired session), 400 means the harness is unknown, and 502 means the CLI failed.', keyName: 'Key name', create: 'Create', keyWarning: 'Save this key now. It will not be shown in full again.', copy: 'Copy', copied: 'Key copied', active: 'Active', disabled: 'Disabled', enable: 'Enable', disable: 'Disable', delete: 'Delete', noKeys: 'No keys yet', deleteConfirm: 'Delete this key permanently?', keyError: 'Could not create the key', toggleError: 'Could not change key status', deleteError: 'Could not delete the key', refreshError: 'Could not refresh models', sessionExpired: 'Session expired, please sign in again', authRequired: 'Authentication required. Please sign in again.', chatError: 'Could not send message', history: 'History', noChats: 'No chats yet', deleteChatConfirm: 'Delete this conversation?', rename: 'Rename', renamePrompt: 'New title:', typing: 'typing...', copyMsg: 'Copy', copiedMsg: 'Copied', retry: 'Retry', you: 'You', assistant: 'Assistant', newChatTitle: 'New chat', messages: 'messages', clear: 'Clear'
  }
};

const text = (k) => translations[language][k] || k;

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
  $('#page-title').textContent = page === 'chat' ? text('chat') : page === 'harnesses' ? text('harnesses') : page === 'keys' ? text('apiKeys') : page === 'users' ? text('users') : text('docs');
  if (page === 'harnesses') loadHarnesses();
  if (page === 'keys') loadKeys();
  if (page === 'users') loadUsers();
  if (page === 'chat') { loadConversations(); }
}

// ---------- Models ----------
async function loadModels() {
  try {
    const res = await api('/v1/models');
    const sel = $('#model-select');
    if (!res.data.length) {
      sel.innerHTML = `<option>${text('loading')}</option>`;
      return;
    }
    const prev = sel.value;
    sel.innerHTML = res.data.map((m) => `<option value="${m.id}">${m.id}</option>`).join('');
    // restore previous or conversation model
    if (currentConversationId) {
      const conv = conversationsCache.find(c=>c.id===currentConversationId);
      if (conv && res.data.some(m=>m.id===conv.model)) sel.value = conv.model;
      else if (prev && res.data.some(m=>m.id===prev)) sel.value = prev;
    } else if (prev && res.data.some(m=>m.id===prev)) sel.value = prev;
    updateComposerModel();
    sel.onchange = () => {
      updateComposerModel();
      // if conversation exists, update its model on change
      if (currentConversationId) {
        const conv = conversationsCache.find(c=>c.id===currentConversationId);
        if (conv && sel.value !== conv.model) {
          api(`/api/chat/conversations/${currentConversationId}`, {method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify({model: sel.value})}).then(()=>{ conv.model = sel.value; renderConversationList(); updateChatHeader(conv); }).catch(()=>{});
        }
      }
    };
  } catch {
    $('#model-select').innerHTML = `<option>${text('loading')}</option>`;
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
    // pick first available model from cache or fallback
    const sel = $('#model-select');
    if(sel && sel.options.length){
      for(const o of sel.options){ if(o.value && o.value.includes('/')){ m=o.value; break; } }
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
    const opts = Array.from($('#model-select').options).map(o=>o.value);
    if (opts.includes(conv.model)) $('#model-select').value = conv.model;
    updateComposerModel();
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
      <button class="suggestion" data-suggest="اشرح لي كيف تعمل البوابة">💡 اشرح لي كيف تعمل البوابة</button>
      <button class="suggestion" data-suggest="اكتب دالة بلغة Python">🐍 اكتب دالة بلغة Python</button>
      <button class="suggestion" data-suggest="ما الفرق بين Harnesses؟">🔀 ما الفرق بين Harnesses؟</button>
      <button class="suggestion" data-suggest="ساعدني في كتابة API">⚡ ساعدني في كتابة API</button>
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
  let html = escapeHtml(text);
  // code blocks ```lang ... ```
  html = html.replace(/```(\w+)?\n?([\s\S]*?)```/g, (m, lang, code) => {
    const l = lang ? `<span style="position:absolute;top:8px;inset-inline-end:10px;font:600 10px var(--font-mono);color:var(--text-faint);text-transform:uppercase">${lang}</span>` : '';
    return `<pre>${l}<code>${code.trim()}</code></pre>`;
  });
  // inline code
  html = html.replace(/`([^`]+)`/g, '<code>$1</code>');
  // bold
  html = html.replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>');
  // italic
  html = html.replace(/(?<!\*)\*([^*]+)\*(?!\*)/g, '<em>$1</em>');
  // links [text](url)
  html = html.replace(/\[([^\]]+)\]\((https?:\/\/[^\)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  // line breaks -> paragraphs
  // split by double newline
  const blocks = html.split(/\n{2,}/).map(b=>{
    if (b.trim().startsWith('<pre')) return b;
    // lists
    if (/^(\s*[-*] )/m.test(b)) {
      const items = b.split('\n').map(l=>l.replace(/^\s*[-*] (.*)/,'<li>$1</li>')).join('');
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
  if (isStreaming) return;
  const promptEl = $('#prompt');
  const content = promptEl.value.trim();
  const model = $('#model-select').value;
  if (!content) return;
  if (!model || !model.includes('/')) {
    showToast(text('chatError') + ': ' + text('loading'));
    return;
  }
  // ChatGPT-like lazy creation: if no conversation, create with first message title (ephemeral -> persist only after send)
  const newChatBtn = $('#new-chat');
  let lazyConv = null;
  if (!currentConversationId) {
    if(newChatBtn) newChatBtn.disabled = true;
    try {
      let m = model;
      if(!m || m===text('loading') || !m.includes('/')){
        const sel=$('#model-select');
        if(sel){ for(const o of sel.options){ if(o.value && o.value.includes('/')){ m=o.value; break; } } }
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
    if(idx>=0 && !conversationsCache[idx].title || conversationsCache[idx].title===text('newChatTitle')){
      // will be updated via loadConversations
    }
  } catch (error) {
    const bubble = assistantNode.querySelector('.bubble');
    if (error.status === 401) {
      bubble.innerHTML = `<p>${text('sessionExpired')}</p>`;
      showToast(text('sessionExpired'));
      setTimeout(()=>{ localStorage.removeItem('afaq_token'); location.href='/login';},1500);
    } else if (error.status === 502) {
      bubble.innerHTML = `<p style="color:var(--status-warning)">⚠️ ${escapeHtml(error.message)}<br><small style="color:var(--text-muted)">Harness failed — check <a href="/harnesses" style="color:var(--brand-primary)">Harnesses</a> installed</small></p>`;
      showToast(error.message);
    } else {
      bubble.innerHTML = `<p style="color:var(--status-error)">${text('chatError')}: ${escapeHtml(error.message)}</p>`;
      showToast(error.message);
    }
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
  const inner = isTyping ? `<div class="typing"><span class="typing-dot"></span><span class="typing-dot"></span><span class="typing-dot"></span><span style="margin-inline-start:6px;font:500 11px var(--font-mono);color:var(--text-faint)">${text('typing')}</span></div>` : (isUser ? `<div class="bubble user"><p>${escapeHtml(content).replace(/\n/g,'<br>')}</p></div>` : `<div class="bubble assistant">${renderMarkdown(content)}</div>`);
  const group = document.createElement('div');
  group.className = 'message-group';
  group.innerHTML = `<div class="message-row ${role}">${avatar}<div class="message-content-wrap"><div class="message-role">${roleLabel} ${modelInfo}</div>${inner}</div></div>`;
  box.appendChild(group);
  box.scrollTop = box.scrollHeight;
  return group;
}

async function sendStream(content, model, assistantNode) {
  const bubble = assistantNode.querySelector('.bubble');
  bubble.innerHTML = '';
  let full = '';
  let hasDelta = false;
  const resp = await fetch(`/api/chat/conversations/${currentConversationId}/messages/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token()}` },
    body: JSON.stringify({ content, model })
  });
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
          // ignore JSON parse errors for keepalive
          if (e.message && e.message.includes('harness_error')) throw e;
          if (e.message && !e.message.toLowerCase().includes('json')) throw e;
        }
      }
    }
  } catch(e){
    if(!hasDelta) throw e;
  }
  bubble.innerHTML = renderMarkdown(full);
  if (!full || !full.trim()) {
    bubble.innerHTML = `<p style="color:var(--text-muted)">${language==='ar' ? '— لا يوجد رد —' : '— no response —'}</p>`;
  }
}

// ---------- Conversation actions ----------
async function deleteConversation(id) {
  if (!confirm(text('deleteChatConfirm'))) return;
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
  const newTitle = prompt(text('renamePrompt'), conv?.title || '');
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
  if (!confirm(text('deleteChatConfirm'))) return;
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
async function deleteKey(id){ if(!confirm(text('deleteConfirm'))) return; try{ await api(`/api/admin/keys/${id}`,{method:'DELETE'}); await loadKeys(); }catch(e){ showToast(`${text('deleteError')}: ${e.message}`);} }
function openUserModal(){ $('#user-form').reset(); $('#user-modal').showModal(); }
async function createUser(e){ e.preventDefault(); const s=e.submitter; s.disabled=true; try{ await api('/api/admin/users',{method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify({email:$('#user-email').value.trim(), password:$('#user-password').value, display_name:$('#user-name').value.trim()})}); $('#user-modal').close(); await loadUsers(); }catch(err){ showToast(err.message);}finally{ s.disabled=false; } }
function showToast(msg){ const t=$('#toast'); t.textContent=msg; t.classList.add('visible'); setTimeout(()=>t.classList.remove('visible'),3500); }
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
$('#sidebar-backdrop')?.addEventListener('click', closeDrawer);
$('#logout').onclick = ()=>{ localStorage.removeItem('afaq_token'); localStorage.removeItem('afaq_current_conv'); location.href='/login'; };
$('#send').onclick = send;
$('#prompt')?.addEventListener('keydown', (e)=>{ if(e.key==='Enter' && !e.shiftKey){ e.preventDefault(); send(); }});
$('#prompt')?.addEventListener('input', autoResize);
$('#login-btn').onclick = login;
$('#new-key').onclick = openKeyModal; $('#key-form').onsubmit = createKey; $('#key-modal-close').onclick = ()=> $('#key-modal').close();
$('#new-user').onclick = openUserModal; $('#user-form').onsubmit = createUser; $('#user-modal-close').onclick = ()=> $('#user-modal').close();
$('#key-copy').onclick = async ()=>{ await navigator.clipboard.writeText($('#key-value').value); $('#key-copy-message').textContent=text('copied'); };
$('#keys-list').onclick = (e)=>{ const b=e.target.closest('[data-action]'); if(!b) return; b.dataset.action==='toggle'?updateKey(b.dataset.keyId):deleteKey(b.dataset.keyId); };
$('#refresh-harnesses').onclick = refreshHarnesses;
$('#clear-chat')?.addEventListener('click', clearCurrentChat);
$('#rename-chat')?.addEventListener('click', ()=>{ if(currentConversationId) renameConversation(currentConversationId); });
$('#lang').onclick = ()=>{ 
  language = language==='ar'?'en':'ar'; 
  applyLanguage(); 
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
document.querySelectorAll('.code-tab').forEach((t)=>{ t.onclick = selectCode; });
document.querySelectorAll('.copy-code').forEach((b)=>{ b.onclick = async ()=>{ await navigator.clipboard.writeText($(`#${b.dataset.copyTarget}`).textContent); b.textContent=text('copied'); setTimeout(()=>{ b.textContent=text('copy');},1400); }; });
window.onpopstate = ()=> show(document.body.dataset.page||'chat', false);

// Init
(async()=>{
  applyLanguage();
  const page=document.body.dataset.page||'chat';
  if(page==='login'){
    document.body.classList.add('login-only');
    document.querySelectorAll('.page').forEach((el)=> el.classList.add('hidden'));
    if(token()) location.href='/chat';
    return;
  }
  if(!token()){ location.href='/login'; return; }
  show(page,false);
  await loadModels();
  await loadConversations();
  bindSuggestions();
  autoResize();
})();
