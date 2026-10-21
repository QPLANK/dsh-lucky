#!/usr/bin/env node
/**
 * 新建一只「文件宠物」（pet pack）：独立动画池 + 独立素材目录，和主宠物完全隔离。
 *
 * 默认把包内 97 段动画复制过来当占位素材——先让新种类能跑起来，再逐段替换成你自己的画。
 * 想省 52MB 磁盘用 --link（软链到包内素材，macOS/Linux 可用，Windows 用复制）。
 *
 * 用法：
 *   node pet-pack/new-species.mjs <prefix> "<显示名>" [--link] [--persona persona.json] [--size 420]
 *   node pet-pack/new-species.mjs salt "海盐" --persona ./persona.json
 *
 * 产出：
 *   $DSH_HOME/dsh-pet/pet/<prefix>-config.json
 *   $DSH_HOME/dsh-pet/pet/<prefix>-animation/*.webm
 */
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { parseJsonc, buildPrompt, buildOverlay } from '../build-config.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const KIT = dirname(HERE);

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (argv[i].startsWith('--')) {
      const key = argv[i].slice(2);
      const val = argv[i + 1];
      if (val === undefined || val.startsWith('--')) flags[key] = true;
      else {
        flags[key] = val;
        i += 1;
      }
    } else positional.push(argv[i]);
  }
  return { positional, flags };
}

const { positional, flags } = parseArgs(process.argv.slice(2));
const prefix = positional[0];
const displayName = positional[1];
if (!prefix || !displayName) {
  console.error('用法: node pet-pack/new-species.mjs <prefix> "<显示名>" [--link] [--persona persona.json] [--size 420]');
  process.exit(2);
}
if (!/^[A-Za-z0-9_-]{1,32}$/.test(prefix)) {
  console.error('prefix 只能用字母 / 数字 / _ / -（它同时是素材目录名与路由片段）');
  process.exit(2);
}

const home = resolve(flags.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(flags.package ?? process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const petDir = join(home, 'dsh-pet', 'pet');
const animDir = join(petDir, `${prefix}-animation`);
const cfgPath = join(petDir, `${prefix}-config.json`);

if (!existsSync(pkg)) {
  console.error(`找不到 dsh-pet 包：${pkg}`);
  process.exit(2);
}
if (existsSync(cfgPath) || existsSync(animDir)) {
  console.error(`已存在同名种类：${prefix}（${cfgPath}）`);
  process.exit(2);
}

// 实例 id 不能和现存的撞（主宠物 id 在 main-config.jsonc，其它种类在各 -config.json）
const taken = new Set();
const mainCfg = join(home, 'dsh-pet', 'main-config.jsonc');
if (existsSync(mainCfg)) {
  const main = parseJsonc(readFileSync(mainCfg, 'utf8'));
  for (const p of main.pets ?? []) taken.add(p.id);
}
if (existsSync(petDir)) {
  for (const file of readdirSync(petDir)) {
    if (!file.endsWith('-config.json')) continue;
    try {
      const conf = parseJsonc(readFileSync(join(petDir, file), 'utf8'));
      for (const p of conf.pets ?? []) taken.add(p.id);
    } catch {
      /* 坏文件留给插件自己报错 */
    }
  }
}
const petId = `${prefix}1`;
if (taken.has(petId)) {
  console.error(`实例 id ${petId} 已被占用（换一个 prefix）`);
  process.exit(2);
}

// 1) 素材目录
mkdirSync(petDir, { recursive: true });
if (flags.link) {
  symlinkSync(join(pkg, 'assets', 'webm'), animDir, 'dir');
  console.log(`[new] 软链素材：${animDir} → ${join(pkg, 'assets', 'webm')}`);
} else {
  cpSync(join(pkg, 'assets', 'webm'), animDir, { recursive: true });
  console.log(`[new] 复制素材：${animDir}（${readdirSync(animDir).length} 个文件）`);
}

// 2) 配置：动画池整段复用默认（名字与复制过来的文件名一一对应），人设按 persona 生成
const base = parseJsonc(readFileSync(join(pkg, 'assets', 'config.jsonc'), 'utf8'));
const personaPath = flags.persona
  ? resolve(flags.persona)
  : [join(KIT, 'persona.json'), join(KIT, 'persona.example.json')].find((file) => existsSync(file));
const persona = personaPath
  ? parseJsonc(readFileSync(personaPath, 'utf8'))
  : { name: displayName, identity: '一只住在用户桌面上的 Q 版小宠物' };

const config = {
  pets: [
    {
      id: petId,
      name: displayName,
      size: Number(flags.size ?? 420),
      balanceEnabled: true,
      whisperEnabled: true,
      workStatusEnabled: true,
      fixedEnabled: false,
      display: 'both',
      position: { corner: 'bottom-right', marginX: 24, marginY: 80 },
    },
  ],
  animations: base.animations,
  animationWeights: base.animationWeights,
};
const overlay = buildOverlay({ ...persona, targetId: petId, name: displayName }, { pets: config.pets });
config.whisperPrompt = overlay.whisperPrompt;
if (overlay.workStatusTexts) config.workStatusTexts = overlay.workStatusTexts;
if (overlay.chatMemoryRounds !== undefined) config.chatMemoryRounds = overlay.chatMemoryRounds;
writeFileSync(
  cfgPath,
  [
    `// 文件宠物：${displayName}（种类前缀 ${prefix}）`,
    '// animations / animationWeights 是本种类自己的，绝不回落到主宠物；素材只查同级 ' + `${prefix}-animation/`,
    '// 换成自己的画：把 webm 按同名丢进 animation 目录即可；新增动作记得同时写进下面的池子。',
    '',
    JSON.stringify(config, null, 2),
    '',
  ].join('\n'),
  'utf8',
);
console.log(`[new] 写入配置：${cfgPath}`);

// 3) 用插件自己的解析器验收
const result = spawnSync(
  process.execPath,
  [join(KIT, 'validate-config.mjs'), '--config', join(home, 'dsh-pet', 'main-config.jsonc'), '--home', home, '--package', pkg],
  { stdio: 'inherit' },
);
if (result.status !== 0) {
  console.warn('[new] 主配置校验没过（可能你还没跑 apply.sh），单独验收新种类：');
  console.warn(`      node validate-config.mjs --config ${cfgPath} --home ${home} --package ${pkg}`);
}

console.log(`
[next]
  1. 刷新页面（桌面形态：右键宠物 →「重载配置」）——新种类应出现在右下角
  2. 换自己的画：${animDir}/ 里同名替换 .webm（VP9-Alpha，透明，脚底线对齐）
  3. 增删动作：改 ${cfgPath} 的 animations 池；名字 = 文件名去掉 .webm
  4. 删掉这只：rm -rf ${animDir} ${cfgPath}
`);
