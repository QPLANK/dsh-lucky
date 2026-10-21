#!/usr/bin/env node
/**
 * 安装「抱图标走路」专用素材并接到搬运流程：
 *   1. 把 assets/抱图标走路.webm 复制到 $DSH_HOME/dsh-pet/main-animation/webm/
 *   2. sprite.js：startCarry 优先用 animations.carry.walk / lift / put（缺失回落旧行为）
 *   3. assets/config.jsonc：animations 里加 carry 默认（walk=抱图标走路）
 *
 * 用法：
 *   node desktop/apply-carry-anim.mjs --check
 *   node desktop/apply-carry-anim.mjs
 *   node desktop/revert-carry-anim.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:carry-anim';

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
const configFile = join(pkg, 'assets', 'config.jsonc');
const assetDir = join(home, 'dsh-pet', 'main-animation', 'webm');
const assetDst = join(assetDir, '抱图标走路.webm');
const assetSrc = join(HERE, 'assets', '抱图标走路.webm');

if (!existsSync(spriteFile)) {
  console.error(`找不到 ${spriteFile}`);
  process.exit(2);
}

const sprite = readFileSync(spriteFile, 'utf8');
const config = readFileSync(configFile, 'utf8');
const patched = sprite.includes(MARKER);

if (args.check) {
  console.log(`[check] sprite.js carry 专用动作: ${patched ? '已接' : '未接'}`);
  console.log(`[check] 素材: ${existsSync(assetDst) ? '已安装' : '缺失'} → ${assetDst}`);
  process.exit(patched && existsSync(assetDst) ? 0 : 1);
}
if (patched) {
  console.error('[apply] 已经接过了；要重来先跑 revert-carry-anim.mjs');
  process.exit(2);
}
if (!existsSync(assetSrc)) {
  console.error(`[apply] 缺少素材源码 ${assetSrc}`);
  process.exit(2);
}

const A_WALK = "      const walk = (acts[0] && acts[0].name) || this.animations.idle[0] || this.anim;";
const A_LIFT = "      const lift = (this.animations.clicks && this.animations.clicks[0]) || this.animations.idle[0] || this.anim;";
const A_PUT = "      this.switchTo(lift, true); // 放下";
for (const [name, anchor] of [['walk', A_WALK], ['lift', A_LIFT], ['put', A_PUT]]) {
  const hits = count(sprite, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

let nextSprite = sprite.replace(
  A_WALK,
  `      // ${MARKER} —— 专用搬运动作（缺失时回落到移动池第一个 / 点击回应）\n      const carryCfg = this.animations.carry || {};\n      const walk = carryCfg.walk || (acts[0] && acts[0].name) || this.animations.idle[0] || this.anim;`,
);
nextSprite = nextSprite.replace(
  A_LIFT,
  `      const lift = carryCfg.lift || (this.animations.clicks && this.animations.clicks[0]) || this.animations.idle[0] || this.anim;\n      const put = carryCfg.put || lift;`,
);
nextSprite = nextSprite.replace(A_PUT, '      this.switchTo(put, true); // 放下');

let nextConfig = config;
if (!config.includes('"carry"')) {
  const anchor = '  "animations": {\n';
  if (count(config, anchor) !== 1) {
    console.error('[apply] config.jsonc 的 animations 锚点不唯一，停止');
    process.exit(2);
  }
  nextConfig = config.replace(
    anchor,
    anchor +
      '    // 抱图标专用动作（dsh-pet-custom）：walk 缺失时回落到 moves 池第一个，lift/put 缺失回落到点击回应\n' +
      '    "carry": { "walk": "抱图标走路" },\n',
  );
}

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `carry-anim-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(spriteFile, join(backupDir, 'sprite.js.orig'));
copyFileSync(configFile, join(backupDir, 'config.jsonc.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, spriteFile, configFile, assetDst, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  mkdirSync(assetDir, { recursive: true });
  copyFileSync(assetSrc, assetDst);
  writeFileSync(spriteFile, nextSprite, 'utf8');
  writeFileSync(configFile, nextConfig, 'utf8');
  const check = spawnSync(process.execPath, ['--check', spriteFile], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check 失败：\n${check.stderr || check.stdout}`);
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  copyFileSync(join(backupDir, 'sprite.js.orig'), spriteFile);
  copyFileSync(join(backupDir, 'config.jsonc.orig'), configFile);
  console.error('[apply] 已回滚');
  process.exit(1);
}

console.log(`
[apply] 完成。
  素材：${assetDst}
  重载：右键小肥鱼 →「重载配置」（Helper 会重新拉配置与 sprite）
  回滚：node desktop/revert-carry-anim.mjs
`);
