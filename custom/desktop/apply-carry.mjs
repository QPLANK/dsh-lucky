#!/usr/bin/env node
/**
 * 桌面端「抱着图标一步一步搬过去」补丁（只改 runtime/electron-helper 的 sprite.js / events.js）。
 *
 * 流程（由宿主 /desktop/carry 下发的 anim 叶子触发）：
 *   1. 宠物走到图标旁（窗口跟随，走路动画循环）
 *   2. 播「抱起」动作 0.4s
 *   3. POST /desktop/carry/grab 让宿主开始沿直线分步移动图标（Finder set position），
 *      同时宠物用同一时长沿同一条直线走到目标 —— 图标始终在宠物脚下，看起来就是她抱着走
 *   4. 播「放下」动作
 *
 * 用法：
 *   node desktop/apply-carry.mjs --check
 *   node desktop/apply-carry.mjs
 *   node desktop/revert-carry.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:carry';
const METHODS = readFileSync(join(HERE, 'sprite-carry-methods.js'), 'utf8').trimEnd();

const EVENTS_PATCH = `  if (hit.name.indexOf("@carry:") === 0) {
    let payload = null;
    try {
      payload = JSON.parse(hit.name.slice(7));
    } catch (e) {
      console.warn('[dsh-pet] carry 指令解析失败：' + (e && e.message ? e.message : String(e)));
    }
    if (payload) {
      for (const s of sprites) {
        if (s.pet.id === petId) void s.startCarry(payload);
      }
    }
    return;
  }
`;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--check') out.check = true;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--package=')) out.package = a.slice(10);
    else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return out;
}

function count(haystack, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return n;
    n += 1;
    i = at + needle.length;
  }
}

const args = parseArgs(process.argv.slice(2));
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const helper = join(pkg, 'runtime', 'electron-helper');
const spriteFile = join(helper, 'sprite.js');
const eventsFile = join(helper, 'events.js');

if (!existsSync(spriteFile)) {
  console.error(`找不到 ${spriteFile}`);
  process.exit(2);
}

const sprite = readFileSync(spriteFile, 'utf8');
const events = readFileSync(eventsFile, 'utf8');
const patched = sprite.includes(MARKER) && events.includes(MARKER);

if (args.check) {
  console.log(`[check] sprite.js: ${sprite.includes(MARKER) ? '已打' : '未打'}`);
  console.log(`[check] events.js: ${events.includes(MARKER) ? '已打' : '未打'}`);
  process.exit(patched ? 0 : 1);
}

if (patched) {
  console.error('[apply] 已经打过补丁了（找到标记）；要重打先跑 revert-carry.mjs');
  process.exit(2);
}

const A_CTOR = '    this.pendingMove = null;\n    this.customPos = null;';
const A_METHODS = '\n  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----';
const A_ANIM = 'function applyAnimLeaf(petId, leaf) {\n  const hit = S.readAnim(leaf);\n  if (!hit) return;\n';

for (const [name, text, anchor] of [
  ['sprite.ctor', sprite, A_CTOR],
  ['sprite.methods', sprite, A_METHODS],
  ['events.anim', events, A_ANIM],
]) {
  const hits = count(text, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

let nextSprite = sprite.replace(A_CTOR, `${A_CTOR}\n    // ${MARKER} —— 抱图标状态\n    this.carrying = false;\n    this.carryToken = 0;\n    this.carryRef = null;`);
nextSprite = nextSprite.replace(A_METHODS, `\n${METHODS}\n${A_METHODS}`);
nextSprite = `/* ${MARKER} */\n` + nextSprite;

let nextEvents = events.replace(A_ANIM, `${A_ANIM}  // ${MARKER} —— 抱图标指令：@carry:{...}\n${EVENTS_PATCH}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `carry-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(spriteFile, join(backupDir, 'sprite.js.orig'));
copyFileSync(eventsFile, join(backupDir, 'events.js.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, spriteFile, eventsFile, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  writeFileSync(spriteFile, nextSprite, 'utf8');
  writeFileSync(eventsFile, nextEvents, 'utf8');
  for (const file of [spriteFile, eventsFile]) {
    const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
    if (check.status !== 0) throw new Error(`node --check 失败：${file}\n${check.stderr || check.stdout}`);
  }
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  copyFileSync(join(backupDir, 'sprite.js.orig'), spriteFile);
  copyFileSync(join(backupDir, 'events.js.orig'), eventsFile);
  console.error('[apply] 已回滚');
  process.exit(1);
}

console.log(`
[apply] 完成。重启 DSH 桌面应用后，桌面形态的小肥鱼会「走过去 → 抱起 → 一步步搬」。
  /desk now   立刻试一次（会走一段路）
  /desk off   关掉
  回滚：node desktop/revert-carry.mjs
`);
