#!/usr/bin/env node
/**
 * 给桌面宠物加「设置…」菜单项与设置框（只改 runtime/electron-helper/sprite.js）。
 *
 * 右键小肥鱼 → 设置… → 弹出小面板：主动搭话开关 / 最短·最长间隔 / 免打扰时段。
 * 保存走 POST /proactive/settings（用户覆盖文件 proactive-settings.json），立即生效。
 *
 * 用法：
 *   node desktop/apply-pet-settings.mjs --check
 *   node desktop/apply-pet-settings.mjs
 *   node desktop/revert-pet-settings.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:pet-settings';
const METHODS = readFileSync(join(HERE, 'sprite-settings-methods.js'), 'utf8').trimEnd();

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--check') out.check = true;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--package=')) out.package = a.slice(10);
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
const spriteFile = join(pkg, 'runtime', 'electron-helper', 'sprite.js');
if (!existsSync(spriteFile)) {
  console.error(`找不到 ${spriteFile}`);
  process.exit(2);
}

const source = readFileSync(spriteFile, 'utf8');
const patched = source.includes(MARKER);

if (args.check) {
  console.log(`[check] sprite.js 设置框: ${patched ? '已打' : '未打'}`);
  process.exit(patched ? 0 : 1);
}
if (patched) {
  console.error('[apply] 已经打过补丁了；要重打先跑 revert-pet-settings.mjs');
  process.exit(2);
}

const A_CTOR = '    this.chatClose = null;\n    this.chatOpen = false;';
const A_METHODS = '\n  // ---- 拖拽抛掷物理（弹簧跟手 + 甩抛 + 重力反弹；与浏览器 pet.ts 同构）----';
const A_BUSY = '    return this.dragState.active || this.menuOpen || this.chatOpen;';
const A_REGIONS = "    const controls = [...document.querySelectorAll('.dsh-pet-menu-column, .dsh-pet-chat')];";
const A_TOOLS = "      { label: '对话', action: 'chat' },";
const A_DISPATCH = "    if (leaf.action === 'reload') {";

for (const [name, anchor] of [['ctor', A_CTOR], ['methods', A_METHODS], ['busy', A_BUSY], ['regions', A_REGIONS], ['tools', A_TOOLS], ['dispatch', A_DISPATCH]]) {
  const hits = count(source, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

let next = source;
next = next.replace(A_CTOR, `${A_CTOR}\n    // ${MARKER} —— 设置框状态\n    this.settingsEl = null;\n    this.settingsOpen = false;`);
next = next.replace(A_METHODS, `\n${METHODS}\n${A_METHODS}`);
next = next.replace(A_BUSY, '    return this.dragState.active || this.menuOpen || this.chatOpen || this.settingsOpen;');
next = next.replace(A_REGIONS, "    const controls = [...document.querySelectorAll('.dsh-pet-menu-column, .dsh-pet-chat, .dsh-pet-settings')];");
next = next.replace(A_TOOLS, `${A_TOOLS}\n      { label: '设置…', action: 'settings' },`);
next = next.replace(
  A_DISPATCH,
  `    // ${MARKER} —— 右键「设置…」：打开主动搭话设置框\n    if (leaf.action === 'settings') {\n      this.openPetSettings();\n      return;\n    }\n${A_DISPATCH}`,
);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `pet-settings-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(spriteFile, join(backupDir, 'sprite.js.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, spriteFile, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  writeFileSync(spriteFile, next, 'utf8');
  const check = spawnSync(process.execPath, ['--check', spriteFile], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check 失败：\n${check.stderr || check.stdout}`);
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  copyFileSync(join(backupDir, 'sprite.js.orig'), spriteFile);
  console.error('[apply] 已回滚');
  process.exit(1);
}

console.log(`
[apply] 完成。重启 DSH 桌面应用后：右键小肥鱼 →「设置…」→ 调主动搭话开关 / 间隔 / 免打扰 / 抱桌面图标。
  回滚：node desktop/revert-pet-settings.mjs
`);
