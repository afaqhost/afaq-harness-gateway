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
      this.terminalId = null;
      this.ws = null;
      this.xterm = null;
      this.fitAddon = null;
      this.fallbackPre = null;
      this.fallbackInput = null;
      this.closeListeners = [];
      this.connected = false;
      this.starting = null;
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

      if (this.stopButton) {
        this.stopButton.disabled = false;
        this.stopButton.onclick = () => this.stop();
      }

      if (window.Terminal) {
        this._startXterm(info);
      } else {
        this._startFallback();
      }

      this.setStatus(`${language === 'ar' ? 'متصل' : 'connected'} · pid ${info.pid} · ${info.shell}`, 'ok');
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

      term.onData((data) => {
        if (this.ws && this.ws.readyState === 1) this.ws.send(data);
      });
      term.onResize(({ cols, rows }) => {
        if (this.ws && this.ws.readyState === 1) {
          this.ws.send(JSON.stringify({ type: 'resize', cols, rows }));
        }
      });

      const ws = new WebSocket(PROTOCOL + '//' + window.location.host + '/api/admin/terminal/' + this.terminalId + '/ws', []);
      ws.onopen = () => {
        this.connected = true;
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

    _startFallback() {
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

      const ws = new WebSocket(PROTOCOL + '//' + window.location.host + '/api/admin/terminal/' + this.terminalId + '/ws', []);
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
      ws.onerror = () => { this.setStatus('connection failed', 'error'); };
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
    if (!mount) return;
    pageInstance = new OsTerminal({ mount, statusEl: status, stopButton: stopBtn });
    pageInstance.onClose(() => { pageInstance = null; });
    try { await pageInstance.start(); } catch (err) {
      if (window.showToast) showToast(err.message || String(err));
    }
    if (stopBtn) stopBtn.onclick = () => { if (pageInstance) pageInstance.stop(); };
  };

  // Lazy init when the page becomes visible (called from show() in app.js).
})();

