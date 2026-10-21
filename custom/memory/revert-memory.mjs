#!/usr/bin/env node
/** 回滚长期画像补丁（还原 lib/index.js 与 assets/config.jsonc；profile.json 保留）。
 *  用法：node memory/revert-memory.mjs [--list] [--backup=...] */
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
const list = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('memory-') && !n.startsWith('memory-ui-')).sort().reverse() : [];
if (args.list) { for (const n of list) console.log(n); process.exit(0); }
const dir = args.backup ? resolve(args.backup) : list[0] ? join(root, list[0]) : '';
if (!dir || !existsSync(join(dir, 'index.js.orig'))) { console.error('[revert] 找不到 memory 补丁备份'); process.exit(2); }
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? meta.pkg);
const indexFile = join(pkg, 'lib', 'index.js');
const configFile = join(pkg, 'assets', 'config.jsonc');
copyFileSync(join(dir, 'index.js.orig'), indexFile);
copyFileSync(join(dir, 'config.jsonc.orig'), configFile);
const check = spawnSync(process.execPath, ['--check', indexFile], { encoding: 'utf8' });
if (check.status !== 0) { console.error(`[revert] 语法检查失败：\n${check.stderr}`); process.exit(1); }
console.log('[revert] 已还原 index.js / config.jsonc；profile.json 与 memory.json 保留');
