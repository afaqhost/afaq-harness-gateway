// OsTerminal — vanilla-JS WebSocket terminal client (CasaOS-style).
//
// One instance per mount point. Public API:
//   const t = new OsTerminal({mount, statusEl, stopButton});
//   await t.start();    // opens WS + xterm
//   t.stop();           // kill PTY + close WS
//   t.onClose(cb);      // notified when shell exits
//
// Falls back to a <pre> + <input> line buffer if xterm.js isn't loaded.

(function () {
  const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';

  function authHeaders() {
    const tok = localStorage.getItem('afaq_token');
    return tok ? { Authorization: 'Bearer ' + tok } : {};
  }

  function getWsUrl(terminalId) {
    const tok = localStorage.getItem('afaq_token');
    const qs = tok ? '?token=' + encodeURIComponent(tok) : '';
    return PROTOCOL + '//' + window.location.host + '/api/admin/terminal/' + terminalId + '/ws' + qs;
  }

  async function startSession() {
    const r = await fetch('/api/admin/terminal/start', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ cols: 100, rows: 30 }),
    });
    if (!r.ok) {
      const t = await r.text();
      throw new Error('start failed: ' + r.status + ' ' + t);
    }
    return r.json();  // {terminal_id, pid, shell, cwd, cols, rows}
  }

  async function stopSession(terminalId) {
    try {
      await fetch('/api/admin/terminal/' + terminalId + '/stop', {
        method: 'POST',
        headers: authHeaders(),
      });
    } catch {}
  }

  class OsTerminal {
    constructor(opts) {
      this.mount = opts.mount;
      this.statusEl = opts.statusEl || null;
      this.stopButton = opts.stopButton || null;
      this.keypadContainer = opts.keypadContainer || null;
      this.terminalId = null;
      this.ws = null;
      this.xterm = null;
      this.fitAddon = null;
      this.fallbackPre = null;
      this.fallbackInput = null;
      this.closeListeners = [];
      this.connected = false;
      this.starting = null;
      this.ctrlActive = false;
      this.altActive = false;
      this.shiftActive = false;
    }

    sendKey(data) {
      if (this.ws && this.ws.readyState === 1) {
        this.ws.send(data);
      } else if (this.fallbackInput) {
        this.fallbackInput.value += data;
      }
      if (this.xterm) {
        try { this.xterm.focus(); } catch {}
      }
    }

    _applyCtrl(data) {
      if (!data) return data;
      const c = data.charCodeAt(0);
      if (c >= 65 && c <= 90) return String.fromCharCode(c - 64) + data.slice(1);
      if (c >= 97 && c <= 122) return String.fromCharCode(c - 96) + data.slice(1);
      if (data[0] === '[') return '\x1b' + data.slice(1);
      if (data[0] === ']') return '\x1d' + data.slice(1);
      if (data[0] === '\\') return '\x1c' + data.slice(1);
      if (data[0] === ' ') return '\x00' + data.slice(1);
      return data;
    }

    setCtrlActive(active) {
      this.ctrlActive = !!active;
      const el = this.keypadContainer ? this.keypadContainer.querySelector('#term-key-ctrl') : document.getElementById('term-key-ctrl');
      if (el) el.classList.toggle('active', this.ctrlActive);
    }

    setAltActive(active) {
      this.altActive = !!active;
      const el = this.keypadContainer ? this.keypadContainer.querySelector('#term-key-alt') : document.getElementById('term-key-alt');
      if (el) el.classList.toggle('active', this.altActive);
    }

    setShiftActive(active) {
      this.shiftActive = !!active;
      const el = this.keypadContainer ? this.keypadContainer.querySelector('#term-key-shift') : document.getElementById('term-key-shift');
      if (el) el.classList.toggle('active', this.shiftActive);
    }

    resetModifiers() {
      this.setCtrlActive(false);
      this.setAltActive(false);
      this.setShiftActive(false);
    }

    async pasteFromClipboard() {
      try {
        if (navigator.clipboard && navigator.clipboard.readText) {
          const text = await navigator.clipboard.readText();
          if (text) {
            this.sendKey(text);
            return;
          }
        }
      } catch {}
      const text = prompt(language === 'ar' ? 'الصق النص المراد إرساله:' : 'Paste text to send:');
      if (text) this.sendKey(text);
    }

    bindKeypad(container) {
      const el = container || this.keypadContainer;
      if (!el) return;
      this.keypadContainer = el;

      // Prevent button touch from stealing focus from xterm input
      el.addEventListener('pointerdown', (e) => {
        const btn = e.target.closest('.term-key-btn');
        if (btn) e.preventDefault();
      });

      el.addEventListener('click', async (e) => {
        const btn = e.target.closest('.term-key-btn');
        if (!btn) return;
        e.preventDefault();
        e.stopPropagation();

        const key = btn.dataset.key;
        const char = btn.dataset.char;
        const action = btn.dataset.action;

        if (key === 'ctrl') {
          this.setCtrlActive(!this.ctrlActive);
          return;
        }
        if (key === 'alt') {
          this.setAltActive(!this.altActive);
          return;
        }
        if (key === 'shift') {
          this.setShiftActive(!this.shiftActive);
          return;
        }

        let payload = '';
        if (key === 'esc') payload = '\x1b';
        else if (key === 'tab') payload = '\t';
        else if (key === 'ctrl-c') payload = '\x03';
        else if (key === 'ctrl-l') payload = '\x0c';
        else if (key === 'ctrl-d') payload = '\x04';
        else if (key === 'ctrl-z') payload = '\x1a';
        else if (key === 'up') payload = '\x1b[A';
        else if (key === 'down') payload = '\x1b[B';
        else if (key === 'left') payload = '\x1b[D';
        else if (key === 'right') payload = '\x1b[C';
        else if (char) payload = char;
        else if (action === 'paste') {
          await this.pasteFromClipboard();
          return;
        }

        if (payload) {
          if (this.ctrlActive && (!key || !key.startsWith('ctrl-'))) {
            payload = this._applyCtrl(payload);
            this.setCtrlActive(false);
          } else if (this.altActive) {
            payload = '\x1b' + payload;
            this.setAltActive(false);
          }
          this.sendKey(payload);
        }
      });
    }

    onClose(cb) { this.closeListeners.push(cb); }

    setStatus(text, kind) {
      if (!this.statusEl) return;
      this.statusEl.textContent = text || '';
      this.statusEl.dataset.kind = kind || '';
    }

    async start() {
      if (this.starting) return this.starting;
      this.starting = this._start();
      return this.starting;
    }

    async _start() {
      this.setStatus(language === 'ar' ? 'جارٍ البدء…' : 'Starting…');
      let info;
      try {
        info = await startSession();
      } catch (err) {
        this.setStatus(String(err.message || err), 'error');
        throw err;
      }
      this.terminalId = info.terminal_id;
      this.info = info;

      if (this.stopButton) {
        this.stopButton.disabled = false;
        this.stopButton.onclick = () => this.stop();
      }

      this.setStatus(language === 'ar' ? 'جارٍ الاتصال…' : 'Connecting…');

      if (window.Terminal) {
        this._startXterm(info);
      } else {
        this._startFallback(info);
      }
    }

    _startXterm(info) {
      const term = new window.Terminal({
        fontFamily: 'ui-monospace, SFMono-Regular, Menlo, Consolas, monospace',
        fontSize: 13,
        cursorBlink: true,
        convertEol: true,
        theme: { background: '#0B1020', foreground: '#E2E8F0', cursor: '#3B82F6' },
        cols: info.cols,
        rows: info.rows,
      });
      this.xterm = term;
      this.fitAddon = new window.FitAddon.FitAddon();
      term.loadAddon(this.fitAddon);
      term.open(this.mount);
      try { this.fitAddon.fit(); } catch {}
      this.bindKeypad();

      term.onData((data) => {
        let toSend = data;
        if (this.ctrlActive) {
          toSend = this._applyCtrl(data);
          this.setCtrlActive(false);
        } else if (this.altActive) {
          toSend = '\x1b' + data;
          this.setAltActive(false);
        } else if (this.shiftActive) {
          toSend = data.toUpperCase();
          this.setShiftActive(false);
        }
        if (this.ws && this.ws.readyState === 1) this.ws.send(toSend);
      });
      term.onResize(({ cols, rows }) => {
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      const ws = new WebSocket(getWsUrl(this.terminalId));
      ws.onopen = () => {
        this.connected = true;
        this.setStatus(`${language === 'ar' ? 'متصل' : 'connected'} · pid ${info.pid} · ${info.shell}`, 'ok');
        try { this.fitAddon.fit(); } catch {}
        ws.send(JSON.stringify({ type: 'resize', cols: term.cols, rows: term.rows }));
      };
      ws.onmessage = (e) => {
        let data = e.data;
        if (typeof data !== 'string') return;
        if (data[0] === '{') {
          try {
            const obj = JSON.parse(data);
            if (obj.type === 'exit') {
              this._handleClose(obj.code || 0);
              return;
            }
          } catch {}
        }
        term.write(data);
      };
      ws.onerror = (ev) => {
        this.setStatus(language === 'ar' ? 'فشل الاتصال' : 'connection failed', 'error');
        // Don't kill the terminal yet — onclose will fire too and surface
        // the actual server-side reason. This avoids racing the close handler.
      };
      ws.onclose = (ev) => {
        // 1000=normal, 1001=going away, 1008=policy violation, 1011=server error,
        // 1012=service restart, 4000-4999=app-defined
        const code = ev && typeof ev.code === 'number' ? ev.code : 0;
        const reason = ev && ev.reason ? ` (${ev.reason})` : '';
        if (code !== 1000 && code !== 1001 && this.xterm) {
          try { this.xterm.write(`\r\n\x1b[1;31m[connection closed code=${code}${reason}]\x1b[0m\r\n`); } catch {}
        }
        this._handleClose(code);
      };
      this.ws = ws;

      const onResize = () => { try { this.fitAddon.fit(); } catch {} };
      window.addEventListener('resize', onResize);
      this._cleanupResize = () => window.removeEventListener('resize', onResize);
    }

    _startFallback(info) {
      info = info || this.info || {};
      this.mount.innerHTML = '';
      const pre = document.createElement('pre');
      pre.className = 'terminal-fallback';
      pre.style.cssText = 'background:#0B1020;color:#E2E8F0;padding:12px;min-height:280px;max-height:60vh;overflow:auto;font:13px ui-monospace,monospace;border-radius:8px;margin:0;white-space:pre-wrap';
      const input = document.createElement('input');
      input.type = 'text';
      input.placeholder = language === 'ar' ? 'اكتب أمراً ثم Enter (xterm غير محمّل)' : 'Type a command and press Enter (xterm not loaded)';
      input.style.cssText = 'width:100%;padding:8px;margin-top:8px;background:#0B1020;color:#E2E8F0;border:1px solid #253149;border-radius:8px;font:13px ui-monospace,monospace';
      this.mount.appendChild(pre);
      this.mount.appendChild(input);
      this.fallbackPre = pre;
      this.fallbackInput = input;
      this.bindKeypad();

      const ws = new WebSocket(getWsUrl(this.terminalId));
      ws.onopen = () => {
        this.connected = true;
        this.setStatus(`${language === 'ar' ? 'متصل' : 'connected'}${info.pid ? ` · pid ${info.pid} · ${info.shell}` : ''}`, 'ok');
      };
      ws.onmessage = (e) => {
        let data = e.data;
        if (typeof data !== 'string') return;
        if (data[0] === '{') {
          try {
            const obj = JSON.parse(data);
            if (obj.type === 'exit') { this._handleClose(obj.code || 0); return; }
          } catch {}
        }
        pre.textContent += data;
        pre.scrollTop = pre.scrollHeight;
      };
      ws.onerror = () => { this.setStatus(language === 'ar' ? 'فشل الاتصال' : 'connection failed', 'error'); };
      ws.onclose = (ev) => {
        const code = ev && typeof ev.code === 'number' ? ev.code : 0;
        const reason = ev && ev.reason ? ` (${ev.reason})` : '';
        if (code !== 1000 && code !== 1001) {
          pre.textContent += `\n[connection closed code=${code}${reason}]\n`;
        }
        this._handleClose(code);
      };
      this.ws = ws;

      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        e.preventDefault();
        const v = input.value + '\n';
        input.value = '';
        pre.textContent += v;
        if (ws.readyState === 1) ws.send(v);
      });
    }

    _handleClose(code) {
      this.resetModifiers();
      if (!this.connected && code === 0) return;
      this.connected = false;
      const isError = code !== null && code !== undefined && code !== 0;
      const statusText = isError
        ? `${language === 'ar' ? 'فشل البدء' : 'failed to start'} · code ${code}`
        : `${language === 'ar' ? 'منتهٍ' : 'closed'}`;
      this.setStatus(statusText, isError ? 'error' : 'muted');
      if (this.ws) try { this.ws.close(); } catch {}
      if (this.xterm) {
        try {
          if (isError) {
            this.xterm.write(`\r\n\x1b[1;31m[session failed to start, exit code ${code}]\x1b[0m\r\n`);
          } else {
            this.xterm.write('\r\n\x1b[2m[session closed]\x1b[0m\r\n');
          }
        } catch {}
      }
      if (this.fallbackPre) {
        this.fallbackPre.textContent += isError
          ? `\n[session failed to start, exit code ${code}]\n`
          : '\n[session closed]\n';
      }
      this.closeListeners.forEach((cb) => { try { cb(code); } catch {} });
      if (this.stopButton) this.stopButton.disabled = true;
    }

    async stop() {
      this.setStatus(language === 'ar' ? 'جارٍ الإيقاف…' : 'Stopping…');
      if (this.ws) try { this.ws.close(); } catch {}
      if (this.terminalId) await stopSession(this.terminalId);
      this._handleClose(0);
    }
  }

  window.OsTerminal = OsTerminal;

  // ---------- /terminal page wiring ----------

  let pageInstance = null;
  window.initTerminalPage = async function initTerminalPage() {
    if (pageInstance) return;
    const mount = document.getElementById('terminal-page-mount');
    const status = document.getElementById('terminal-page-status');
    const stopBtn = document.getElementById('terminal-page-stop');
    const keypad = document.getElementById('terminal-keypad-bar');
    if (!mount) return;
    pageInstance = new OsTerminal({ mount, statusEl: status, stopButton: stopBtn, keypadContainer: keypad });
    pageInstance.onClose(() => { pageInstance = null; });
    try { await pageInstance.start(); } catch (err) {
      if (window.showToast) showToast(err.message || String(err));
    }
    if (stopBtn) stopBtn.onclick = () => { if (pageInstance) pageInstance.stop(); };
  };

  // Lazy init when the page becomes visible (called from show() in app.js).
})();

