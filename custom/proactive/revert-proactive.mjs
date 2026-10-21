#!/usr/bin/env node
/**
 * 回滚「主动搭话」补丁：从最近一次（或指定一次）备份还原 lib/index.js 与 assets/config.jsonc。
 *
 * 用法：
 *   node proactive/revert-proactive.mjs --list
 *   node proactive/revert-proactive.mjs
 *   node proactive/revert-proactive.mjs --backup=/path/to/proactive-2026...
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
    else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const backupsRoot = join(home, 'dsh-pet', 'backups');

const list = existsSync(backupsRoot)
  ? readdirSync(backupsRoot)
      .filter((n) => n.startsWith('proactive-'))
      .sort()
      .reverse()
  : [];

if (args.list) {
  if (!list.length) console.log('[revert] 没有补丁备份');
  for (const n of list) console.log(n);
  process.exit(0);
}

const dir = args.backup ? resolve(args.backup) : list[0] ? join(backupsRoot, list[0]) : '';
if (!dir || !existsSync(join(dir, 'index.js.orig'))) {
  console.error('[revert] 找不到补丁备份（--list 查看）');
  process.exit(2);
}

const meta = JSON.parse(readFileSync(join(dir, 'meta.json'), 'utf8'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? meta.pkg);
const indexFile = join(pkg, 'lib', 'index.js');
const configFile = join(pkg, 'assets', 'config.jsonc');

copyFileSync(join(dir, 'index.js.orig'), indexFile);
copyFileSync(join(dir, 'config.jsonc.orig'), configFile);

const check = spawnSync(process.execPath, ['--check', indexFile], { encoding: 'utf8' });
if (check.status !== 0) {
  console.error(`[revert] 还原后的 index.js 语法检查失败：\n${check.stderr}`);
  process.exit(1);
}
console.log(`[revert] 已从 ${dir} 还原 ${pkg}`);
console.log('[revert] 重启 DSH 桌面应用后生效');
