#!/usr/bin/env node
/** 让图标跟手：grab 请求带上宠物中心坐标（幂等，只改 sprite.js 的一行）。 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';

const home = resolve(process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const file = join(pkg, 'runtime', 'electron-helper', 'sprite.js');
const s = readFileSync(file, 'utf8');
const oldLine = '          body: JSON.stringify({ id: p.id, duration: dur / 1000 }),';
const newLine =
  '          body: JSON.stringify({ id: p.id, duration: dur / 1000, x: Math.round(this.currentCenterX() + VIEW.x), y: Math.round(this.currentCenterY() + VIEW.y) }),';
if (s.includes(newLine)) {
  console.log('[patch] 已经带坐标了，无需修改');
  process.exit(0);
}
if (!s.includes(oldLine)) {
  console.error('[patch] 找不到 grab 请求体，停止');
  process.exit(2);
}
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const dir = join(home, 'dsh-pet', 'backups', `carry-smooth-${stamp}`);
mkdirSync(dir, { recursive: true });
copyFileSync(file, join(dir, 'sprite.js.orig'));
writeFileSync(file, s.replace(oldLine, newLine), 'utf8');
const check = spawnSync(process.execPath, ['--check', file], { encoding: 'utf8' });
if (check.status !== 0) {
  copyFileSync(join(dir, 'sprite.js.orig'), file);
  console.error('[patch] 语法检查失败，已回滚：\n' + check.stderr);
  process.exit(1);
}
console.log('[patch] 已写入：grab 携带宠物坐标；备份 ' + dir);
