#!/usr/bin/env node
/** 回滚右键「设置…」面板补丁：从最近一次（或指定）备份还原 sprite.js。
 *  用法：node desktop/revert-pet-settings.mjs [--list] [--backup=...] */
import { copyFileSync, existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const args = {};
for (const a of process.argv.slice(2)) {
  if (a === '--list') args.list = true;
  else if (a.startsWith('--home=')) args.home = a.slice(7);
  else if (a.startsWith('--package=')) args.package = a.slice(10);
  else if (a.startsWith('--backup=')) args.backup = a.slice(9);
}
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const root = join(home, 'dsh-pet', 'backups');
const list = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('pet-settings-')).sort().reverse() : [];
if (args.list) {
  for (const n of list) console.log(n);
  process.exit(0);
}
const dir = args.backup ? resolve(args.backup) : list[0] ? join(root, list[0]) : '';
if (!dir || !existsSync(join(dir, 'sprite.js.orig'))) {
  console.error('[revert] 找不到设置面板补丁备份');
  process.exit(2);
}
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? meta.pkg);
const file = join(pkg, 'runtime', 'electron-helper', 'sprite.js');
copyFileSync(join(dir, 'sprite.js.orig'), file);
const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error(`[revert] 语法检查失败：\n${check.stderr}`);
  process.exit(1);
}
console.log(`[revert] 已还原 ${file}；重启 DSH 桌面应用生效`);
