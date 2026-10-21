#!/usr/bin/env node
/** 离线验收 desktop/snippet.js（用的就是即将插入 lib/index.js 的那段源码）。 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';

const HERE = dirname(fileURLToPath(import.meta.url));
const snippet = readFileSync(join(HERE, 'snippet.js'), 'utf8');
const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else { fails.push(name); console.log(`  ✗ ${name} ${extra}`); }
};

const userRoot = mkdtempSync(join(tmpdir(), 'dsh-pet-desk-'));
const says = [];
const anims = [];
const state = {
  writePet: (id, leaf, data) => (leaf === 'say' ? says : anims).push({ id, data }),
};
const config = { main: { desktopInteraction: { enabled: false, minMinutes: 30, maxMinutes: 60, quietHours: [1, 7] } } };
const api = new Function(
  'join', 'readFileSync', 'writeFileSync', 'spawn', 'console', 'userRoot',
  'readAllConfig', 'configPaths', 'findPetInstance', 'state',
  `${snippet}\nreturn { deskSettings, deskInQuiet, deskPickTarget, deskListIcons, deskStatus, deskInteract, deskWriteState, deskLastMoved };`,
)(
  join, readFileSync, writeFileSync, spawn, { warn: () => {}, log: console.log },
  userRoot,
  () => config,
  {},
  () => ({ entry: 'main', conf: { animations: { clicks: ['点击回应-开心跃动'], idle: ['待机呼吸休闲'], categories: [{ actions: ['悠闲哼歌'] }] } } }),
  state,
);

console.log('[1] 开关与兜底');
{
  let s = api.deskSettings(config);
  check('配置 enabled=false 时默认关闭', s.enabled === false);
  check('间隔读配置 30–60', s.minMinutes === 30 && s.maxMinutes === 60);
  check('免打扰读配置 1–7', s.quietHours[0] === 1 && s.quietHours[1] === 7);
  api.deskWriteState({ enabled: true });
  s = api.deskSettings(config);
  check('开关文件优先于配置', s.enabled === true);
  api.deskWriteState({ enabled: false });
  check('再关回去', api.deskSettings(config).enabled === false);
}

console.log('[2] 免打扰');
{
  check('跨天 23–9 内 2 点安静', api.deskInQuiet([23, 9], 2) === true);
  check('跨天 23–9 内 12 点不安静', api.deskInQuiet([23, 9], 12) === false);
  check('起止相同 = 关闭', api.deskInQuiet([4, 4], 4) === false);
}

console.log('[3] 选位避让');
{
  const icons = [{ name: 'a', x: 100, y: 100 }, { name: 'b', x: 500, y: 300 }];
  let ok = true;
  for (let i = 0; i < 40; i += 1) {
    const p = api.deskPickTarget(icons, { left: 0, top: 0, right: 1440, bottom: 900 }, { name: 'a' });
    if (!p) { ok = false; break; }
    const clash = icons.some((ic) => ic.name !== 'a' && Math.abs(ic.x - p.x) < 110 && Math.abs(ic.y - p.y) < 95);
    if (clash || p.x < 40 || p.x > 1280 || p.y < 70 || p.y > 720) { ok = false; break; }
  }
  check('40 次采样都落在安全区且不压图标', ok);
}

console.log('[4] Finder 调用（本机若未授权，应返回结构化错误而不是抛异常）');
{
  const r = await api.deskListIcons();
  console.log('    →', JSON.stringify(r).slice(0, 160));
  check('返回对象带 ok 字段', typeof r.ok === 'boolean');
  if (!r.ok) check('未授权时 reason 可识别', ['no-automation', 'osascript-error', 'timeout'].includes(r.reason), r.reason);
  const st = await api.deskStatus(config);
  check('体检文案包含开关/权限', typeof st.enabled === 'boolean' && typeof st.detail === 'string');
}

console.log('[5] 未开启时不动作');
{
  const before = says.length;
  const r = await api.deskInteract('main', false);
  check('返回 disabled', r.ok === false && r.reason === 'disabled', JSON.stringify(r));
  check('没有气泡副作用', says.length === before);
}

rmSync(userRoot, { recursive: true, force: true });
if (fails.length) { console.error(`\n[test] 失败 ${fails.length} 项`); process.exit(1); }
console.log('\n[test] desktop snippet 通过');
