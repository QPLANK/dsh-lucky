  // ---- 宠物设置框（dsh-pet-custom:pet-settings）：右键「设置…」→ 开关 + 可收起的参数 ----
  ensurePetSettingsCss() {
    if (document.querySelector('style[data-dsh-pet-settings]')) return;
    const tag = document.createElement('style');
    tag.dataset.dshPetSettings = '1';
    tag.textContent =
      '.dsh-pet-settings{position:fixed;z-index:2147483002;width:266px;padding:11px 13px;' +
      'background:rgba(255,255,255,.98);border:1px solid rgba(0,0,0,.12);border-radius:10px;' +
      'box-shadow:0 10px 32px rgba(0,0,0,.22);color:#2b2b2b;font-size:13px;line-height:1.5;' +
      'font-family:"ShangshouSoftCandy","Yuanti SC","YouYuan","PingFang SC","Microsoft YaHei",sans-serif;' +
      'user-select:none}' +
      '.dsh-pet-settings *{box-sizing:border-box}' +
      '.dsh-pet-settings .t{font-size:14px;font-weight:600;margin:0 0 4px}' +
      '.dsh-pet-settings .sec{border-top:1px solid rgba(0,0,0,.07);padding:7px 0 2px}' +
      '.dsh-pet-settings .sec:first-of-type{border-top:none}' +
      '.dsh-pet-settings .hd{display:flex;align-items:center;justify-content:space-between;gap:8px}' +
      '.dsh-pet-settings .sw{display:flex;align-items:center;gap:7px;cursor:pointer}' +
      '.dsh-pet-settings .exp{border:none;background:transparent;color:#2b63ff;font:inherit;font-size:12px;' +
      'padding:2px 0;cursor:pointer;white-space:nowrap}' +
      '.dsh-pet-settings .exp:hover{text-decoration:underline}' +
      '.dsh-pet-settings .exp:disabled{opacity:.45;cursor:default;text-decoration:none}' +
      '.dsh-pet-settings .r{display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0}' +
      '.dsh-pet-settings .r span{white-space:nowrap}' +
      '.dsh-pet-settings input[type=number]{width:62px;padding:3px 6px;border:1px solid rgba(0,0,0,.18);' +
      'border-radius:6px;font:inherit;text-align:right;background:#fff;color:inherit;outline:none}' +
      '.dsh-pet-settings input[type=number]:focus{border-color:#2b63ff}' +
      '.dsh-pet-settings input[type=checkbox]{width:15px;height:15px;accent-color:#2b63ff}' +
      '.dsh-pet-settings .hint{margin:2px 0 0;font-size:11px;color:rgba(43,43,43,.55)}' +
      '.dsh-pet-settings .st{min-height:16px;margin-top:4px;font-size:12px;color:#d94f3d;white-space:pre-wrap}' +
      '.dsh-pet-settings .a{display:flex;justify-content:flex-end;gap:8px;margin-top:8px}' +
      '.dsh-pet-settings .a button{padding:4px 12px;border-radius:7px;border:1px solid rgba(0,0,0,.15);' +
      'background:#fff;font:inherit;cursor:pointer;color:inherit}' +
      '.dsh-pet-settings .a button.ok{border-color:#2b63ff;background:#2b63ff;color:#fff}' +
      '.dsh-pet-settings input:disabled,button:disabled{opacity:.55;cursor:default}';
    document.head.appendChild(tag);
  }

  openPetSettings() {
    if (this.settingsEl) {
      this.closePetSettings();
      return;
    }
    this.ensurePetSettingsCss();
    const wrap = document.createElement('div');
    wrap.className = 'dsh-pet-settings';
    wrap.innerHTML =
      '<p class="t">小肥鱼的设置</p>' +
      '<div class="sec">' +
      '<div class="hd"><label class="sw"><input type="checkbox" data-k="enabled" disabled><span>主动搭话</span></label>' +
      '<button type="button" class="exp" data-k="exp-p" disabled>参数 ▾</button></div>' +
      '<div data-k="body-p" hidden>' +
      '<label class="r"><span>最短间隔（分钟）</span><input type="number" min="5" max="1440" step="1" data-k="min" disabled></label>' +
      '<label class="r"><span>最长间隔（分钟）</span><input type="number" min="5" max="1440" step="1" data-k="max" disabled></label>' +
      '<label class="r"><span>免打扰开始（点）</span><input type="number" min="0" max="24" step="1" data-k="q0" disabled></label>' +
      '<label class="r"><span>免打扰结束（点）</span><input type="number" min="0" max="24" step="1" data-k="q1" disabled></label>' +
      '</div></div>' +
      '<div class="sec">' +
      '<div class="hd"><label class="sw"><input type="checkbox" data-k="desk" disabled><span>抱桌面图标</span></label>' +
      '<button type="button" class="exp" data-k="exp-d" disabled>参数 ▾</button></div>' +
      '<div data-k="body-d" hidden>' +
      '<label class="r"><span>最短间隔（分钟）</span><input type="number" min="5" max="1440" step="1" data-k="dmin" disabled></label>' +
      '<label class="r"><span>最长间隔（分钟）</span><input type="number" min="5" max="1440" step="1" data-k="dmax" disabled></label>' +
      '<label class="r"><span>免打扰开始（点）</span><input type="number" min="0" max="24" step="1" data-k="dq0" disabled></label>' +
      '<label class="r"><span>免打扰结束（点）</span><input type="number" min="0" max="24" step="1" data-k="dq1" disabled></label>' +
      '<p class="hint">只改图标位置，不删/不改名/不动文件；需要 Finder 权限</p>' +
      '</div></div>' +
      '<div class="st" data-k="status"></div>' +
      '<div class="a"><button type="button" data-k="cancel">取消</button><button type="button" class="ok" data-k="save" disabled>保存</button></div>';
    document.body.appendChild(wrap);
    this.settingsEl = wrap;
    this.settingsOpen = true;
    this.setInteractive(true);
    this.syncInputBusy();

    const q = (k) => wrap.querySelector('[data-k="' + k + '"]');
    const status = q('status');
    const setStatus = (msg) => {
      status.textContent = msg || '';
    };
    const fields = ['enabled', 'min', 'max', 'q0', 'q1', 'desk', 'dmin', 'dmax', 'dq0', 'dq1'];
    const controls = fields.map(q).concat([q('exp-p'), q('exp-d'), q('save')]);
    const setDisabled = (v) => {
      for (const el of controls) el.disabled = v;
    };

    // 展开/收起参数：点「参数 ▾」就地展开；展开后重新夹取位置，避免底部超出窗口
    const place = () => {
      const hit = this.hit.getBoundingClientRect();
      const clamp = this.visibleClampRect();
      const w = wrap.offsetWidth;
      const h = wrap.offsetHeight;
      let x = hit.right + 8;
      let y = hit.top;
      if (clamp) {
        if (x + w > clamp.x + clamp.w - 4) x = hit.left - w - 8;
        x = Math.min(Math.max(clamp.x + 4, x), clamp.x + clamp.w - w - 4);
        y = Math.min(Math.max(clamp.y + 4, y), clamp.y + clamp.h - h - 4);
      }
      wrap.style.left = Math.round(x) + 'px';
      wrap.style.top = Math.round(y) + 'px';
    };
    const bindExpand = (btn, body) => {
      btn.addEventListener('click', () => {
        const open = body.hasAttribute('hidden');
        if (open) body.removeAttribute('hidden');
        else body.setAttribute('hidden', '');
        btn.textContent = open ? '参数 ▴' : '参数 ▾';
        place();
      });
    };
    bindExpand(q('exp-p'), q('body-p'));
    bindExpand(q('exp-d'), q('body-d'));

    Promise.all([
      fetch(BASE + '/proactive/settings').then((r) => (r.ok ? r.json() : null)).catch(() => null),
      fetch(BASE + '/desktop/state?light=1').then((r) => (r.ok ? r.json() : null)).catch(() => null),
    ]).then(([p, d]) => {
      if (p) {
        q('enabled').checked = p.enabled === true;
        q('min').value = p.minMinutes;
        q('max').value = p.maxMinutes;
        q('q0').value = Array.isArray(p.quietHours) ? p.quietHours[0] : 0;
        q('q1').value = Array.isArray(p.quietHours) ? p.quietHours[1] : 8;
      } else {
        setStatus('读不到主动搭话设置（宿主补丁没生效？）');
      }
      if (d) {
        q('desk').checked = d.enabled === true;
        q('dmin').value = d.minMinutes;
        q('dmax').value = d.maxMinutes;
        q('dq0').value = Array.isArray(d.quietHours) ? d.quietHours[0] : 0;
        q('dq1').value = Array.isArray(d.quietHours) ? d.quietHours[1] : 8;
      }
      setDisabled(false);
    });

    const readPair = (a, b) => [Number(q(a).value), Number(q(b).value)];
    const validPair = (min, max) => [min, max].every((n) => Number.isFinite(n) && n >= 5 && n <= 1440) && min <= max;
    const validQuiet = (a, b) => [a, b].every((n) => Number.isFinite(n) && n >= 0 && n <= 24);

    const save = async () => {
      const [min, max] = readPair('min', 'max');
      const [q0, q1] = readPair('q0', 'q1');
      const [dmin, dmax] = readPair('dmin', 'dmax');
      const [dq0, dq1] = readPair('dq0', 'dq1');
      if (!validPair(min, max)) {
        setStatus('主动搭话：间隔要 5–1440 分钟，且最短 ≤ 最长');
        return;
      }
      if (!validQuiet(q0, q1)) {
        setStatus('主动搭话：免打扰小时要 0–24');
        return;
      }
      if (!validPair(dmin, dmax)) {
        setStatus('抱图标：间隔要 5–1440 分钟，且最短 ≤ 最长');
        return;
      }
      if (!validQuiet(dq0, dq1)) {
        setStatus('抱图标：免打扰小时要 0–24');
        return;
      }
      setDisabled(true);
      setStatus('');
      try {
        const enabled = q('enabled').checked;
        const desk = q('desk').checked;
        const [resProactive, resDesk] = await Promise.all([
          fetch(BASE + '/proactive/settings', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled, minMinutes: min, maxMinutes: max, quietHours: [q0, q1] }),
          }),
          fetch(BASE + '/desktop/toggle', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ enabled: desk, minMinutes: dmin, maxMinutes: dmax, quietHours: [dq0, dq1] }),
          }),
        ]);
        if (!resProactive.ok) throw new Error('主动搭话 HTTP ' + resProactive.status);
        if (!resDesk.ok) throw new Error('抱图标 HTTP ' + resDesk.status);
        this.closePetSettings();
        this.showWhisper(
          '哼，' + (enabled ? '本鱼会自己找你' : '本鱼不主动说话了') + '，' + (desk ? '桌面上的东西也帮你看着' : '也不碰你桌面了') + '。'
        );
      } catch (e) {
        setStatus('保存失败：' + (e && e.message ? e.message : String(e)));
        setDisabled(false);
      }
    };

    q('cancel').addEventListener('click', () => this.closePetSettings());
    q('save').addEventListener('click', () => void save());
    wrap.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') this.closePetSettings();
    });

    place();
    this.syncInputRegions();
    q('cancel').focus();
  }

  closePetSettings() {
    if (this.settingsEl) {
      this.settingsEl.remove();
      this.settingsEl = null;
    }
    this.settingsOpen = false;
    this.syncInputBusy();
    this.syncInputRegions();
    if (!this.inputBusy()) this.setInteractive(false);
  }
