#!/usr/bin/env node
/**
 * 用 dsh-pet 自己的配置解析器校验候选 main-config.jsonc。
 *
 * 为什么要借它自己的解析器：宿主对非法字段是「告警 + 回退默认」，光看文件是对的没用，
 * 必须看 parse 之后的成品里你的值还在不在。这里直接 import 插件源码的 readAllConfig，
 * 并把它发出的告警抓下来（告警里带「非法」= 你的值已被丢弃）。
 *
 * 校验内容：
 *  1. 成品里 whisperPrompt / chatMemoryRounds / physics / workStatusTexts 与候选文件一致（没被回退）
 *  2. pets 的 id / name 全部进了成品
 *  3. 配置引用的每个动画名，在对应素材目录里真的存在（避免右键菜单有名字、点了 404）
 *  4. 可选 --url：把运行中实例的 GET /dsh-pet-7340/config 拉下来，和候选文件对比
 *
 * 用法：
 *   node validate-config.mjs --config out.jsonc [--home ~/.dsh] [--package <dsh-pet 包目录>] [--url http://127.0.0.1:59776/dsh-pet-7340/config]
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { homedir } from 'node:os';
import { parseJsonc } from './build-config.mjs';

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    out[a.slice(2)] = argv[i + 1];
    i += 1;
  }
  return out;
}

function deepEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/** 从 animations 池里抽出所有动画名（含事件档位里的候选数组） */
function collectAnimationNames(animations) {
  const names = new Set();
  if (!animations || typeof animations !== 'object') return names;
  for (const key of ['idle', 'turn', 'drag', 'clicks']) {
    for (const name of animations[key] ?? []) names.add(name);
  }
  for (const action of animations.moves?.actions ?? []) {
    if (action?.name) names.add(action.name);
  }
  for (const category of animations.categories ?? []) {
    for (const name of category?.actions ?? []) names.add(name);
  }
  for (const pool of Object.values(animations.events ?? {})) {
    for (const slot of pool ?? []) {
      if (typeof slot === 'string') names.add(slot);
      else for (const name of slot ?? []) names.add(name);
    }
  }
  return names;
}

async function importReadAllConfig(pkgDir, cacheRoot) {
  const source = join(pkgDir, 'src', 'host', 'config.ts');
  if (!existsSync(source)) throw new Error(`找不到插件源码：${source}`);
  const code = readFileSync(source);
  const hash = createHash('sha1').update(code).digest('hex').slice(0, 12);
  // Node 只在 node_modules 之外做类型剥离，所以把它复制到缓存目录再 import
  const cacheFile = join(cacheRoot, `config-${hash}.mts`);
  if (!existsSync(cacheFile)) writeFileSync(cacheFile, code);
  return import(pathToFileURL(cacheFile).href);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const configPath = resolve(args.config ?? '');
  if (!args.config || !existsSync(configPath)) {
    console.error(`[validate] 配置文件不存在：${configPath}`);
    process.exit(2);
  }
  const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
  const pkgDir = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
  const cacheRoot = join(dirname(fileURLToPath(import.meta.url)), '.cache');
  mkdirSync(cacheRoot, { recursive: true });

  const { readAllConfig } = await importReadAllConfig(pkgDir, cacheRoot);

  const candidate = parseJsonc(readFileSync(configPath, 'utf8'));
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = (...parts) => warnings.push(parts.join(' '));
  let merged;
  try {
    merged = readAllConfig({
      defaultFile: join(pkgDir, 'assets', 'config.jsonc'),
      userFile: configPath,
      petDir: join(home, 'dsh-pet', 'pet'),
    });
  } finally {
    console.warn = originalWarn;
  }

  const errors = [];
  const main = merged.main;
  if (!main) errors.push('解析结果里没有 main 条目（内置默认配置可能损坏）');

  // 1) 人设字段必须原样进成品（没被宿主判非法回退）
  for (const key of ['whisperPrompt', 'chatMemoryRounds', 'physics', 'workStatusTexts', 'proactive']) {
    if (candidate[key] === undefined) continue;
    if (!deepEqual(candidate[key], main?.[key])) {
      errors.push(`字段 ${key} 未生效：宿主判为非法并回退了默认值（看下面的告警）`);
    }
  }

  // 2) 宠物实例
  const candPets = Array.isArray(candidate.pets) ? candidate.pets : [];
  const mergedPets = Array.isArray(main?.pets) ? main.pets : [];
  for (const pet of candPets) {
    const got = mergedPets.find((p) => p.id === pet.id);
    if (!got) {
      errors.push(`宠物实例 ${pet.id} 没进成品（id 可能非法 / 与其它宠物冲突）`);
      continue;
    }
    if (pet.name !== undefined && got.name !== pet.name) {
      errors.push(`宠物 ${pet.id} 的 name 未生效：期望 ${pet.name}，实际 ${got.name}`);
    }
  }

  // 3) 动画素材存在性
  const missing = [];
  for (const [entry, conf] of Object.entries(merged)) {
    const names = collectAnimationNames(conf?.animations);
    const dirs =
      entry === 'main'
        ? [join(home, 'dsh-pet', 'main-animation', 'webm'), join(home, 'dsh-pet', 'main-animation'), join(pkgDir, 'assets', 'webm')]
        : [join(home, 'dsh-pet', 'pet', `${entry}-animation`)];
    for (const name of names) {
      const found = dirs.some((dir) => existsSync(join(dir, `${name}.webm`)) || existsSync(join(dir, `${name}.mov`)));
      if (!found) missing.push(`${entry} → ${name}`);
    }
  }
  if (missing.length) {
    errors.push(`有 ${missing.length} 个动画素材找不到（点了会 404）：\n  - ${missing.join('\n  - ')}`);
  }

  for (const warning of warnings) {
    originalWarn(`[宿主告警] ${warning}`);
    if (warning.includes('非法')) errors.push(`宿主告警：${warning}`);
  }

  // 4) 可选：比对运行中实例
  if (args.url) {
    try {
      const res = await fetch(args.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const live = await res.json();
      if (candidate.whisperPrompt !== undefined && !deepEqual(live?.main?.whisperPrompt, candidate.whisperPrompt)) {
        errors.push('运行中实例的 whisperPrompt 与候选文件不一致（页面还没重载，或写错了 profile/DSH_HOME）');
      }
      const liveNames = (live?.main?.pets ?? []).map((p) => `${p.id}=${p.name}`).join(',');
      const candNames = candPets.map((p) => `${p.id}=${p.name}`).join(',');
      if (liveNames !== candNames) {
        errors.push(`运行中实例的宠物列表不一致：期望 ${candNames}，实际 ${liveNames}`);
      }
    } catch (err) {
      errors.push(`拉取运行中实例配置失败：${err.message}`);
    }
  }

  if (errors.length) {
    originalWarn(`[validate] 失败（${errors.length} 项）：`);
    for (const e of errors) originalWarn(`  ✗ ${e}`);
    process.exit(1);
  }
  if (args.url) console.log(`[validate] 运行中实例一致：${args.url}`);
  const petLine = Object.values(merged)
    .flatMap((conf) => (Array.isArray(conf?.pets) ? conf.pets : []))
    .map((p) => `${p.id}=${p.name}`)
    .join(', ');
  console.log(`[validate] 通过：${configPath}`);
  console.log(`[validate] pets: ${petLine}`);
  console.log(`[validate] whisperPrompt: ${String(main.whisperPrompt).split('\n')[0]}…`);
}

await main();
