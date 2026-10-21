#!/usr/bin/env node
/**
 * 在右键「设置…」面板里加「长期记忆」区：摘要 + 事实/回忆列表、逐条删除、一键清空。
 * 只改 runtime/electron-helper/sprite.js。
 *
 * 用法：node desktop/apply-memory-ui.mjs [--check]
 * 回滚：node desktop/revert-memory-ui.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = {};
for (const a of process.argv.slice(2)) {
  if (a === '--check') args.check = true;
  else if (a.startsWith('--home=')) args.home = a.slice(7);
  else if (a.startsWith('--package=')) args.package = a.slice(10);
}
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const file = join(pkg, 'runtime', 'electron-helper', 'sprite.js');
const MARKER = 'dsh-pet-custom:memory-ui';
const s = readFileSync(file, 'utf8');
if (args.check) {
  console.log(`[check] 设置面板长期记忆区: ${s.includes(MARKER) ? '已加' : '未加'}`);
  process.exit(s.includes(MARKER) ? 0 : 1);
}
if (s.includes(MARKER)) {
  console.error('[apply] 已经加过了；要重来先跑 revert-memory-ui.mjs');
  process.exit(2);
}

const A_CSS = "      '.dsh-pet-settings input:disabled,button:disabled{opacity:.55;cursor:default}';";
const A_HTML = "      '<p class=\"hint\">只改图标位置，不删/不改名/不动文件；需要 Finder 权限</p>' +\n      '</div></div>' +\n      '<div class=\"st\" data-k=\"status\"></div>' +";
const A_JS = "    bindExpand(q('exp-d'), q('body-d'));";
for (const [name, anchor] of [['css', A_CSS], ['html', A_HTML], ['js', A_JS]]) {
  if ((s.split(anchor).length - 1) !== 1) {
    console.error(`[apply] 锚点 ${name} 不唯一，停止`);
    process.exit(2);
  }
}

const CSS = `      '.dsh-pet-settings input:disabled,button:disabled{opacity:.55;cursor:default}' +
      '.dsh-pet-settings .mem{max-height:220px;overflow:auto;white-space:pre-wrap;font-size:12px;line-height:1.5;' +
      'background:rgba(0,0,0,.03);border-radius:6px;padding:6px 8px;color:rgba(43,43,43,.85)}' +
      '.dsh-pet-settings .mem:empty{display:none}' +
      '.dsh-pet-settings .memsum{margin-bottom:4px}' +
      '.dsh-pet-settings .memhd{margin:6px 0 2px;font-size:11px;color:rgba(43,43,43,.5)}' +
      '.dsh-pet-settings .memrow{display:flex;align-items:flex-start;justify-content:space-between;gap:6px;padding:2px 0}' +
      '.dsh-pet-settings .memrow span{flex:1;overflow-wrap:anywhere}' +
      '.dsh-pet-settings .memrow button{border:none;background:transparent;color:rgba(217,79,61,.9);font-size:14px;' +
      'line-height:1;padding:0 2px;cursor:pointer}';`;

const HTML = `      '<p class="hint">只改图标位置，不删/不改名/不动文件；需要 Finder 权限</p>' +
      '</div></div>' +
      '<div class="sec"><div class="hd"><span>长期记忆</span>' +
      '<button type="button" class="exp" data-k="exp-m">查看 ▾</button></div>' +
      '<div data-k="body-m" hidden>' +
      '<div class="mem" data-k="mem-text">加载中…</div>' +
      '<div class="hint" data-k="mem-count"></div>' +
      '<div class="a"><button type="button" data-k="mem-clear">清空记忆</button></div>' +
      '</div></div>' +
      '<div class="st" data-k="status"></div>' +`;

const JS = `    bindExpand(q('exp-d'), q('body-d'));
    // ${MARKER} —— 长期记忆：摘要 + 事实/回忆列表（逐条删除）
    bindExpand(q('exp-m'), q('body-m'));
    const memText = q('mem-text');
    const renderMemory = (p) => {
      if (!p) {
        memText.textContent = '读不到记忆（宿主补丁没生效？）';
        return;
      }
      memText.innerHTML = '';
      const sum = document.createElement('div');
      sum.className = 'memsum';
      sum.textContent = p.summary ? p.summary : '还没有形成摘要，多聊几句就会慢慢记住。';
      memText.appendChild(sum);
      const facts = Array.isArray(p.facts) ? p.facts : [];
      const eps = Array.isArray(p.episodes) ? p.episodes : [];
      const addHead = (text) => {
        const h = document.createElement('div');
        h.className = 'memhd';
        h.textContent = text;
        memText.appendChild(h);
      };
      const addRow = (kind, id, label) => {
        const row = document.createElement('div');
        row.className = 'memrow';
        const span = document.createElement('span');
        span.textContent = label;
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = '×';
        btn.title = '删除这条';
        btn.dataset.kind = kind;
        btn.dataset.id = id;
        row.appendChild(span);
        row.appendChild(btn);
        memText.appendChild(row);
      };
      if (facts.length) {
        addHead('事实');
        for (const f of facts) addRow('fact', f.id, f.text);
      }
      if (eps.length) {
        addHead('回忆');
        for (const e of eps) addRow('episode', e.id, e.date + '：' + e.summary);
      }
      q('mem-count').textContent = '共 ' + facts.length + ' 条事实 · ' + (p.episodeCount || 0) + ' 段回忆';
    };
    const loadMemory = () => {
      fetch(BASE + '/profile')
        .then((r) => (r.ok ? r.json() : null))
        .then(renderMemory)
        .catch(() => {
          memText.textContent = '读不到记忆';
        });
    };
    memText.addEventListener('click', async (e) => {
      const btn = e.target && e.target.closest ? e.target.closest('button[data-id]') : null;
      if (!btn) return;
      const body = btn.dataset.kind === 'episode' ? { forgetEpisode: btn.dataset.id } : { forget: btn.dataset.id };
      try {
        const res = await fetch(BASE + '/profile', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        loadMemory();
      } catch (err) {
        q('mem-count').textContent = '删除失败：' + (err && err.message ? err.message : String(err));
      }
    });
    q('exp-m').addEventListener('click', loadMemory);
    q('mem-clear').addEventListener('click', async () => {
      if (typeof confirm === 'function' && !confirm('确定清空小肥鱼对你的长期记忆？')) return;
      try {
        const res = await fetch(BASE + '/profile', { method: 'DELETE' });
        if (!res.ok) throw new Error('HTTP ' + res.status);
        loadMemory();
      } catch (e) {
        q('mem-count').textContent = '清空失败：' + (e && e.message ? e.message : String(e));
      }
    });`;

let next = s.replace(A_CSS, CSS).replace(A_HTML, HTML).replace(A_JS, JS);
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(home, 'dsh-pet', 'backups', `memory-ui-${stamp}`);
mkdirSync(dir, { recursive: true });
copyFileSync(file, join(dir, 'sprite.js.orig'));
writeFileSync(join(dir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, file, marker: MARKER }, null, 2));
try {
  writeFileSync(file, next, 'utf8');
  const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(check.stderr || check.stdout);
  console.log('[apply] 设置面板已加「长期记忆」区；右键「重载配置」生效');
} catch (e) {
  copyFileSync(join(dir, 'sprite.js.orig'), file);
  console.error('[apply] 失败已回滚：' + (e && e.message ? e.message : String(e)));
  process.exit(1);
}
