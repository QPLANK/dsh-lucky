#!/usr/bin/env node
/**
 * 把「主动搭话」「抱个图标」加进右键菜单的「动作」分类顶部，点一下直接触发。
 *
 * 只改 runtime/electron-helper/sprite.js：
 *   - 菜单树：在 S.buildMenuTree 的「动作」子级最前面插入两个叶子（无 children = 可点项）
 *   - 动作分发：onMenuAction 里 POST /proactive 或 /desktop/nudge（手动语义，忽略开关与免打扰）
 *
 * 用法：
 *   node desktop/apply-menu-actions.mjs --check
 *   node desktop/apply-menu-actions.mjs
 *   node desktop/revert-menu-actions.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:menu-actions';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--check') out.check = true;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--package=')) out.package = a.slice(10);
  }
  return out;
}
function count(s, n) {
  let c = 0;
  let i = 0;
  for (;;) {
    const at = s.indexOf(n, i);
    if (at === -1) return c;
    c += 1;
    i = at + n.length;
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
  console.log(`[check] 动作菜单项: ${patched ? '已打' : '未打'}`);
  process.exit(patched ? 0 : 1);
}
if (patched) {
  console.error('[apply] 已经打过补丁了；要重打先跑 revert-menu-actions.mjs');
  process.exit(2);
}

const A_TREE = '    const tree = tools.concat(S.buildMenuTree(this.animations));';
const A_DISPATCH = "    if (leaf.action === 'reload') {";

for (const [name, anchor] of [['tree', A_TREE], ['dispatch', A_DISPATCH]]) {
  const hits = count(source, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

const TREE_PATCH = `    // ${MARKER} —— 「动作」分类顶部放两个手动触发项（无 children = 叶子，可直接点）
    const actionTree = S.buildMenuTree(this.animations);
    if (actionTree.length && Array.isArray(actionTree[0].children)) {
      actionTree[0].children.unshift(
        { label: '主动搭话', action: 'proactive' },
        { label: '抱个图标', action: 'carry' },
      );
    }
    const tree = tools.concat(actionTree);`;

const DISPATCH_PATCH = `    // ${MARKER} —— 手动触发：主动搭话 / 抱个图标（忽略开关与免打扰）
    if (leaf.action === 'proactive') {
      fetch(BASE + '/proactive', { method: 'POST' })
        .then((r) => {
          if (!r.ok) console.warn('[dsh-pet] 主动搭话失败 HTTP ' + r.status);
        })
        .catch((e) => console.warn('[dsh-pet] 主动搭话失败：' + (e && e.message ? e.message : String(e))));
      return;
    }
    if (leaf.action === 'carry') {
      fetch(BASE + '/desktop/nudge', { method: 'POST' })
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => {
          if (d && d.ok === false) console.warn('[dsh-pet] 抱图标失败：' + (d.reason || '') + (d.message ? ' ' + d.message : ''));
        })
        .catch((e) => console.warn('[dsh-pet] 抱图标失败：' + (e && e.message ? e.message : String(e))));
      return;
    }
`;

let next = source.replace(A_TREE, TREE_PATCH);
next = next.replace(A_DISPATCH, `${DISPATCH_PATCH}${A_DISPATCH}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `menu-actions-${stamp}`);
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
[apply] 完成。右键「重载配置」（或重启应用）后：右键小肥鱼 → 动作 → 主动搭话 / 抱个图标。
  回滚：node desktop/revert-menu-actions.mjs
`);
