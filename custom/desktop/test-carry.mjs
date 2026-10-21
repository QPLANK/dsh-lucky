#!/usr/bin/env node
/** 离线验收「抱图标」链路：deskInteract 产生 @carry 指令 → grab 端点按会话启动图标分步移动。 */
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';

const HERE = dirname(fileURLToPath(import.meta.url));
const snippet = readFileSync(join(HERE, 'snippet.js'), 'utf8');
const fails = [];
const check = (n, c, x = '') => { if (c) console.log(`  ✓ ${n}`); else { fails.push(n); console.log(`  ✗ ${n} ${x}`); } };

const calls = [];
function fakeSpawn(cmd, args) {
  const script = args[1] || '';
  calls.push({ cmd, script });
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.kill = () => {};
  setTimeout(() => {
    if (script.includes('ASCII character 31')) {
      child.stdout.emit('data', Buffer.from('COUNT\x1f2\nA.png\x1f100,200\x1f0\nB.png\x1f400,300\x1f0\n'));
      child.emit('close', 0);
    } else if (script.includes('bounds of window of desktop')) {
      child.stdout.emit('data', Buffer.from('0, 0, 1440, 900'));
      child.emit('close', 0);
    } else if (script.includes('delay stepDelay')) {
      child.stdout.emit('data', Buffer.from('ok'));
      child.emit('close', 0);
    } else {
      child.stdout.emit('data', Buffer.from('150,250'));
      child.emit('close', 0);
    }
  }, 0);
  return child;
}

const wrote = [];
const pet = { id: 'main', display: 'desktop', animations: { clicks: ['click'], idle: ['idle'], categories: [{ actions: ['act'] }] } };
const cfg = { main: { desktopInteraction: { enabled: true, quietHours: [0, 0] }, animations: { clicks: ['click'], idle: ['idle'], categories: [{ actions: ['act'] }] } } };
const api = new Function(
  'join', 'readFileSync', 'writeFileSync', 'spawn', 'console', 'userRoot', 'readAllConfig', 'configPaths', 'findPetInstance', 'state',
  `${snippet}\nreturn { deskInteract, deskCarryGrab };`,
)(
  join, readFileSync, () => {}, fakeSpawn, { warn: () => {} }, '/tmp/dsh-pet-carry-test',
  () => cfg, {},
  () => ({ entry: 'main', conf: pet.animations, pet }),
  { writePet: (id, leaf, data) => wrote.push({ id, leaf, data }) },
);

console.log('[1] carry 指令');
{
  const r = await api.deskInteract('main', true);
  check('返回 mode=carry', r.ok === true && r.mode === 'carry', JSON.stringify(r));
  const anim = wrote.find((w) => w.leaf === 'anim');
  check('写了 anim 叶子', !!anim && anim.data && anim.data.name.startsWith('@carry:'));
  const payload = JSON.parse(anim.data.name.slice(7));
  check('payload 带 id/name/from/to', !!(payload.id && payload.name && payload.from && payload.to));
  check('from 是图标坐标', payload.from.x === 100 || payload.from.x === 400);
  console.log('[2] grab');
  const g = await api.deskCarryGrab(payload.id, 2);
  check('grab ok', g.ok === true, JSON.stringify(g));
  check('调用了分步脚本', calls.some((c) => c.script.includes('delay stepDelay')));
  const again = await api.deskCarryGrab(payload.id, 2);
  check('会话用后即失效', again.ok === false && again.reason === 'no-session');
  const bad = await api.deskCarryGrab('nope', 2);
  check('未知 id 拒绝', bad.ok === false && bad.reason === 'no-session');
}

if (fails.length) { console.error(`失败 ${fails.length}`); process.exit(1); }
console.log('\n[test] carry 链路通过');
