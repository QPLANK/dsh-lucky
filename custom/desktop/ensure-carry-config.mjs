#!/usr/bin/env node
/** 幂等：确保已安装插件的 assets/config.jsonc 里有 animations.carry（回滚 desktop 补丁时会被还原掉）。 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';

const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const file = join(pkg, 'assets', 'config.jsonc');
const s = readFileSync(file, 'utf8');
if (s.includes('"carry"')) {
  console.log('[ensure] animations.carry 已存在，无需修改');
  process.exit(0);
}
const anchor = '  "animations": {\n';
if ((s.split(anchor).length - 1) !== 1) {
  console.error('[ensure] 找不到唯一的 animations 锚点');
  process.exit(2);
}
const block = '    // 抱图标专用动作（dsh-pet-custom）：缺失时回落 moves 池 / 点击回应\n    "carry": { "walk": "抱图标走路" },\n';
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `carry-config-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(file, join(backupDir, 'config.jsonc.orig'));
writeFileSync(file, s.replace(anchor, anchor + block), 'utf8');
console.log('[ensure] 已写入 animations.carry；备份在 ' + backupDir);
