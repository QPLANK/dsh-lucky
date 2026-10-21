#!/usr/bin/env node
/** 回滚设置面板「长期记忆」区（还原 sprite.js）。 */
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
const list = existsSync(root) ? readdirSync(root).filter((n) => n.startsWith('memory-ui-')).sort().reverse() : [];
if (args.list) { for (const n of list) console.log(n); process.exit(0); }
const dir = args.backup ? resolve(args.backup) : list[0] ? join(root, list[0]) : '';
if (!dir || !existsSync(join(dir, 'sprite.js.orig'))) { console.error('[revert] 找不到 memory-ui 备份'); process.exit(2); }
const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? meta.pkg);
const file = join(pkg, 'runtime', 'electron-helper', 'sprite.js');
copyFileSync(join(dir, 'sprite.js.orig'), file);
const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (check.status !== 0) { console.error(check.stderr); process.exit(1); }
console.log('[revert] 已还原 sprite.js；右键「重载配置」生效');
