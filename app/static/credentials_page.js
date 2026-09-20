// Credentials page wiring: left = live OS terminal, right = paste-key panel.

(function () {
  let terminalInstance = null;

  async function fetchHarnesses() {
    const r = await fetch('/api/admin/harnesses', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('afaq_token') || '') } });
    if (!r.ok) throw new Error('harnesses list failed: ' + r.status);
    return r.json();
  }

  async function fetchCredentials() {
    const r = await fetch('/api/admin/credentials', { headers: { Authorization: 'Bearer ' + (localStorage.getItem('afaq_token') || '') } });
    if (!r.ok) throw new Error('credentials list failed: ' + r.status);
    return r.json();
  }

  function fillHarnessSelect(select, harnesses) {
    select.innerHTML = harnesses.map((h) => `<option value="${escapeHtml(h.name)}">${escapeHtml(h.display_name || h.name)}</option>`).join('');
  }

  function escapeHtml(s) {
    return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  function renderCredentialsList(container, profiles) {
    if (!profiles.length) {
      container.innerHTML = `<div class="muted" style="padding:18px">${language === 'ar' ? 'لا توجد بيانات دخول محفوظة' : 'No saved credentials'}</div>`;
      return;
    }
    container.innerHTML = profiles.map((p) => `
      <div class="cred-row" data-cred-id="${p.id}">
        <div class="cred-row-main">
          <strong>${escapeHtml(p.harness)}</strong>
          <span class="cred-profile">${escapeHtml(p.profile_name)}</span>
          <span class="badge ${p.status === 'authenticated' ? 'ok' : ''}">${escapeHtml(p.status || 'unknown')}</span>
        </div>
        <div class="cred-row-actions">
          <button class="outline-button small" data-cred-action="check" data-cred-id="${p.id}">${language === 'ar' ? 'اختبار' : 'Test'}</button>
          <button class="outline-button small danger" data-cred-action="delete" data-cred-id="${p.id}">${language === 'ar' ? 'حذف' : 'Delete'}</button>
        </div>
      </div>
    `).join('');
    container.querySelectorAll('[data-cred-action]').forEach((b) => {
      b.onclick = async () => {
        const id = b.dataset.credId;
        const action = b.dataset.credAction;
        b.disabled = true;
        try {
          if (action === 'check') {
            const r = await fetch('/api/admin/credentials/' + id + '/check', { method: 'POST', headers: { Authorization: 'Bearer ' + (localStorage.getItem('afaq_token') || '') } });
            if (!r.ok) throw new Error(await r.text());
            showToast(language === 'ar' ? 'تم الاختبار' : 'Checked');
          } else if (action === 'delete') {
            const ok = await showConfirmBox({
              title: language === 'ar' ? 'حذف بيانات الدخول' : 'Delete credential?',
              message: language === 'ar' ? 'لن يمكن التراجع — احفظ المفتاح في مكان آخر أولاً' : 'This cannot be undone — save the token elsewhere first.',
              confirmText: language === 'ar' ? 'حذف' : 'Delete',
              cancelText: language === 'ar' ? 'إلغاء' : 'Cancel',
            });
            if (!ok) return;
            const r = await fetch('/api/admin/credentials/' + id, { method: 'DELETE', headers: { Authorization: 'Bearer ' + (localStorage.getItem('afaq_token') || '') } });
            if (!r.ok) throw new Error(await r.text());
          }
          await refreshCredentialsList();
        } catch (err) {
          showToast(err.message || String(err));
        } finally {
          b.disabled = false;
        }
      };
    });
  }

  async function refreshCredentialsList() {
    try {
      const profiles = await fetchCredentials();
      renderCredentialsList(document.getElementById('credentials-list'), profiles);
    } catch (err) {
      const el = document.getElementById('credentials-list');
      if (el) el.innerHTML = `<div class="error-message">${escapeHtml(err.message)}</div>`;
    }
  }

  async function startTerminal() {
    if (terminalInstance) return terminalInstance;
    const mount = document.getElementById('credentials-terminal-mount');
    const status = document.getElementById('credentials-terminal-status');
    const stopBtn = document.getElementById('credentials-terminal-stop');
    if (!mount) return null;
    const banner = [
      '',
      '\x1b[36m╭──────────────────────────────────────────────╮\x1b[0m',
      '\x1b[36m│\x1b[0m  CLI auth helper                                \x1b[36m│\x1b[0m',
      '\x1b[36m│\x1b[0m  Run the harness\'s own auth flow, then        \x1b[36m│\x1b[0m',
      '\x1b[36m│\x1b[0m  paste the resulting token in the panel →     \x1b[36m│\x1b[0m',
      '\x1b[36m╰──────────────────────────────────────────────╯\x1b[0m',
      '',
    ].join('\r\n');
    terminalInstance = new window.OsTerminal({ mount, statusEl: status, stopButton: stopBtn, banner });
    terminalInstance.onClose(() => { terminalInstance = null; });
    try {
      await terminalInstance.start();
    } catch (err) {
      showToast(err.message || String(err));
    }
    return terminalInstance;
  }

  async function initCredentialsPage() {
    const select = document.getElementById('cred-harness');
    const list = document.getElementById('credentials-list');
    const msg = document.getElementById('cred-message');
    const saveBtn = document.getElementById('cred-save');
    if (!select || !saveBtn) return;

    try {
      const harnesses = await fetchHarnesses();
      fillHarnessSelect(select, harnesses);
    } catch (err) {
      msg.textContent = err.message;
    }
    await refreshCredentialsList();

    saveBtn.onclick = async () => {
      msg.textContent = '';
      const harness = select.value;
      const profile_name = (document.getElementById('cred-profile-name').value || 'default').trim();
      const auth_type = document.getElementById('cred-auth-type').value;
      const token = document.getElementById('cred-token').value.trim();
      if (!harness) { msg.textContent = language === 'ar' ? 'اختر أداة' : 'Pick a harness'; return; }
      if (auth_type === 'token' && !token) { msg.textContent = language === 'ar' ? 'التوكن مطلوب' : 'Token required'; return; }
      saveBtn.disabled = true;
      try {
        const r = await fetch('/api/admin/harnesses/' + harness + '/credentials', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (localStorage.getItem('afaq_token') || '') },
          body: JSON.stringify({ profile_name, auth_type, token: token || null }),
        });
        if (!r.ok) {
          const t = await r.text();
          throw new Error(t);
        }
        document.getElementById('cred-token').value = '';
        msg.textContent = language === 'ar' ? '✓ تم الحفظ' : '✓ Saved';
        await refreshCredentialsList();
      } catch (err) {
        msg.textContent = err.message || String(err);
      } finally {
        saveBtn.disabled = false;
      }
    };

    // start the terminal only when the page becomes visible (lazy)
    const observer = new MutationObserver(() => {
      const page = document.getElementById('credentials');
      if (page && !page.classList.contains('hidden')) {
        observer.disconnect();
        startTerminal();
      }
    });
    observer.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

    const stopBtn = document.getElementById('credentials-terminal-stop');
    if (stopBtn) stopBtn.onclick = () => { if (terminalInstance) terminalInstance.stop(); };
  }

  // Standalone /terminal page wiring
  let pageTerminal = null;
  async function initTerminalPage() {
    const mount = document.getElementById('terminal-page-mount');
    const status = document.getElementById('terminal-page-status');
    const stopBtn = document.getElementById('terminal-page-stop');
    if (!mount) return;
    pageTerminal = new window.OsTerminal({ mount, statusEl: status, stopButton: stopBtn });
    try { await pageTerminal.start(); } catch (err) { showToast(err.message || String(err)); }
    if (stopBtn) stopBtn.onclick = () => { if (pageTerminal) pageTerminal.stop(); };
  }

  // Lazy init when the page becomes visible
  const pageObserver = new MutationObserver(() => {
    if (document.getElementById('terminal') && !document.getElementById('terminal').classList.contains('hidden')) {
      if (!pageTerminal) {
        pageObserver.disconnect();
        initTerminalPage();
      }
    }
    if (document.getElementById('credentials') && !document.getElementById('credentials').classList.contains('hidden')) {
      initCredentialsPage();  // idempotent (select check)
    }
  });
  pageObserver.observe(document.body, { subtree: true, attributes: true, attributeFilter: ['class'] });

  // Expose for app.js if it wants to call directly
  window.initCredentialsPage = initCredentialsPage;
  window.initTerminalPage = initTerminalPage;
})();
