#!/usr/bin/env node
/**
 * 回滚设置页开关补丁：从最近一次（或指定）备份还原 lib/client.js。
 *
 * 用法：
 *   node settings-ui/revert-settings-ui.mjs --list
 *   node settings-ui/revert-settings-ui.mjs
 *   node settings-ui/revert-settings-ui.mjs --backup=/path/to/settings-ui-2026...
 */
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--list') out.list = true;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--package=')) out.package = a.slice(10);
    else if (a.startsWith('--backup=')) out.backup = a.slice(9);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const root = join(home, 'dsh-pet', 'backups');
const list = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('settings-ui-')).sort().reverse() : [];

if (args.list) {
  for (const n of list) console.log(n);
  process.exit(0);
}
const dir = args.backup ? resolve(args.backup) : list[0] ? join(root, list[0]) : '';
if (!dir || !existsSync(join(dir, 'client.js.orig'))) {
  console.error('[revert] 找不到设置页补丁备份');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? meta.pkg);
const clientFile = join(pkg, 'lib', 'client.js');
copyFileSync(join(dir, 'client.js.orig'), clientFile);
const check = spawnSync(process.execPath, ['--check', clientFile], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error(`[revert] 语法检查失败：\n${check.stderr}`);
  process.exit(1);
}
console.log(`[revert] 已还原 ${clientFile}；刷新页面生效`);
