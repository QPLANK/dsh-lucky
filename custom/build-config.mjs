#!/usr/bin/env node
/**
 * 把 persona.json 编译成 dsh-pet 的用户层配置 main-config.jsonc。
 *
 * 设计要点：
 *  - 只写「人设」相关字段（whisperPrompt / workStatusTexts / chatMemoryRounds / physics / pets[].name），
 *    其余顶层字段（memes、notificationsEnabled、animations、eventsRefreshSec…）从现有配置原样透传，
 *    所以再跑一次不会把你手改的东西吃掉。
 *  - 输出仍是 JSONC（纯 JSON 也是合法 JSONC），开头带一段说明注释，方便继续手改。
 *
 * 用法：
 *   node build-config.mjs --persona persona.json [--existing ~/.dsh/dsh-pet/main-config.jsonc] --out /tmp/main-config.jsonc
 */
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** 去除 JSONC 注释（正确处理字符串里的 // 和 /*，以及转义） */
export function stripJsonc(src) {
  let out = '';
  let i = 0;
  let inString = false;
  while (i < src.length) {
    const ch = src[i];
    const next = src[i + 1];
    if (inString) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 2;
        continue;
      }
      if (ch === '"') inString = false;
      i += 1;
      continue;
    }
    if (ch === '"') {
      inString = true;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === '/' && next === '/') {
      while (i < src.length && src[i] !== '\n') i += 1;
      continue;
    }
    if (ch === '/' && next === '*') {
      i += 2;
      while (i < src.length && !(src[i] === '*' && src[i + 1] === '/')) i += 1;
      i += 2;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

export function parseJsonc(text) {
  return JSON.parse(stripJsonc(text));
}

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 1) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const val = argv[i + 1];
    if (val === undefined || val.startsWith('--')) throw new Error(`参数 ${a} 缺少值`);
    out[key] = val;
    i += 1;
  }
  return out;
}

const PHYSICS_PRESETS = {
  // 默认手感：会掉、会弹、落地有摩擦
  normal: {
    gravity: 1400,
    restitution: 0.78,
    groundFriction: 2.5,
    ceilingBounce: true,
    throwPower: 1.0,
    petCollision: false,
  },
  // 无重力漂浮：甩出去匀速直线飞，撞墙反弹、永不落地（想让它「飘着」就用这个）
  float: {
    gravity: 0,
    restitution: 0.92,
    groundFriction: 0,
    ceilingBounce: true,
    throwPower: 1.15,
    petCollision: false,
  },
  // 冰面：有重力但不摩擦，落地后一直滑
  ice: {
    gravity: 1400,
    restitution: 0.9,
    groundFriction: 0,
    ceilingBounce: true,
    throwPower: 1.25,
    petCollision: false,
  },
};

function asStringArray(value, field) {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((x) => typeof x !== 'string' || !x.trim())) {
    throw new Error(`persona.${field} 必须是非空字符串数组`);
  }
  return value.map((x) => x.trim());
}

/** 生成人设提示词（whisperPrompt）——碎碎念与对话共用 */
export function buildPrompt(persona) {
  const name = String(persona.name ?? '').trim();
  if (!name) throw new Error('persona.name 必须填写（宠物显示名，也是人设里的自称来源）');
  const traits = asStringArray(persona.traits, 'traits');
  const catchphrases = asStringArray(persona.catchphrases, 'catchphrases');
  const topics = asStringArray(persona.selfTalkTopics, 'selfTalkTopics');
  const taboos = asStringArray(persona.taboos, 'taboos');

  const lines = [];
  const identity = String(persona.identity ?? '一只住在用户桌面上的 Q 版小宠物').trim();
  lines.push(`你是${name}，${identity}。`);
  if (traits.length) lines.push(`性格：${traits.join('、')}。`);
  if (persona.speech) lines.push(`说话方式：${String(persona.speech).trim()}。`);
  const selfName = String(persona.selfName ?? '').trim();
  const callUser = String(persona.callUser ?? '').trim();
  if (selfName || callUser) {
    const bits = [];
    if (selfName) bits.push(`自称「${selfName}」`);
    if (callUser) bits.push(`称呼对方「${callUser}」`);
    lines.push(`${bits.join('，')}。`);
  }
  if (catchphrases.length) {
    lines.push(`偶尔会蹦出这些口头禅（自然带出，别每句都用）：${catchphrases.join(' / ')}`);
  }
  if (topics.length) lines.push(`碎碎念时从这些话题里挑一个：${topics.join('、')}。`);
  if (persona.chatStyle) lines.push(`对话时，${String(persona.chatStyle).trim()}。`);
  if (taboos.length) lines.push(`禁忌：${taboos.join('；')}。`);
  if (persona.promptExtra) lines.push(String(persona.promptExtra).trim());
  lines.push('碎碎念只说一句（20 字以内）；对话别长篇大论。不要解释你自己，不要提你是 AI。');
  return lines.join('\n');
}

export function buildOverlay(persona, existing = {}) {
  const prompt = buildPrompt(persona);
  const overlay = {};

  // 1) 人设
  overlay.whisperPrompt = prompt;

  // 2) 上下文成本
  if (persona.chatMemoryRounds !== undefined) {
    const n = Number(persona.chatMemoryRounds);
    if (!Number.isFinite(n) || n < 0) throw new Error('persona.chatMemoryRounds 必须是非负数字');
    overlay.chatMemoryRounds = Math.floor(n);
  }

  // 3) 手感
  if (persona.physics !== undefined) {
    const p = persona.physics;
    if (p === null) {
      // 显式 null = 不改
    } else if (typeof p === 'string') {
      const preset = PHYSICS_PRESETS[p];
      if (!preset) throw new Error(`persona.physics 只能是 ${Object.keys(PHYSICS_PRESETS).join(' / ')} 或对象`);
      overlay.physics = { ...preset };
    } else if (typeof p === 'object' && !Array.isArray(p)) {
      overlay.physics = { ...PHYSICS_PRESETS.normal, ...p };
    } else {
      throw new Error('persona.physics 类型不合法');
    }
  }

  // 4) 工作状态气泡（6 档：思考 / 干活 / 整理 / 等确认 / 完成 / 出错）
  if (persona.workStatusTexts !== undefined) {
    const w = persona.workStatusTexts;
    if (!Array.isArray(w) || w.length !== 6 || w.some((line) => !Array.isArray(line) || line.length === 0)) {
      throw new Error('persona.workStatusTexts 必须是 6 个非空字符串数组（顺序：思考/干活/整理/等确认/完成/出错）');
    }
    overlay.workStatusTexts = w.map((line) => line.map((x) => String(x)));
  }

  // 5) 主动搭话（需要 proactive 补丁；未打补丁时宿主会忽略这个字段）
  if (persona.proactive !== undefined) {
    const raw = persona.proactive;
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('persona.proactive 必须是对象');
    const num = (v, field, lo, hi) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < lo || n > hi) throw new Error(`persona.proactive.${field} 必须是 ${lo}~${hi} 的数字`);
      return n;
    };
    const proactive = { enabled: raw.enabled === true };
    if (raw.minMinutes !== undefined) proactive.minMinutes = num(raw.minMinutes, 'minMinutes', 5, 1440);
    if (raw.maxMinutes !== undefined) proactive.maxMinutes = num(raw.maxMinutes, 'maxMinutes', 5, 1440);
    if (raw.quietHours !== undefined) {
      const q = raw.quietHours;
      if (!Array.isArray(q) || q.length !== 2) throw new Error('persona.proactive.quietHours 必须是 [开始小时, 结束小时]');
      q.forEach((h, i) => num(h, `quietHours[${i}]`, 0, 24));
      proactive.quietHours = q.map(Number);
    }
    if (raw.prompt !== undefined) {
      if (typeof raw.prompt !== 'string' || !raw.prompt.trim()) throw new Error('persona.proactive.prompt 必须是非空字符串');
      proactive.prompt = raw.prompt.trim();
    }
    overlay.proactive = proactive;
  }

  // 6) 显示名：只改目标实例（默认 main），其余宠物名字不动
  const targetId = String(persona.targetId ?? 'main');
  const name = String(persona.name).trim();
  const existingPets = Array.isArray(existing.pets) ? existing.pets : [];
  if (existingPets.length) {
    overlay.pets = existingPets.map((pet, idx) => {
      const isTarget = existingPets.length === 1 || pet?.id === targetId || (idx === 0 && !existingPets.some((p) => p?.id === targetId));
      return isTarget ? { ...pet, name } : { ...pet };
    });
  } else {
    overlay.pets = [{ id: targetId, name, display: 'both' }];
  }

  // 7) 其余字段原样透传（memes / notificationsEnabled / animations / eventsRefreshSec / models …）
  for (const [key, value] of Object.entries(existing)) {
    if (!(key in overlay)) overlay[key] = value;
  }
  return overlay;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.persona || !args.out) {
    console.error('用法: node build-config.mjs --persona persona.json [--existing main-config.jsonc] --out out.jsonc');
    process.exit(2);
  }
  const persona = parseJsonc(readFileSync(args.persona, 'utf8'));
  const existing = args.existing && existsSync(args.existing) ? parseJsonc(readFileSync(args.existing, 'utf8')) : {};
  const overlay = buildOverlay(persona, existing);

  const header = [
    '// dsh-pet 用户层配置（由 dsh-pet-custom 生成）',
    `// 人设来源: ${args.persona}`,
    `// 生成时间: ${new Date().toISOString()}`,
    '// 想要别的味道：改 persona.json 后重新跑 apply.sh；也可以直接手改下面任意字段。',
    '// 字段含义见 ~/.dsh/profiles/desktop/node_modules/dsh-pet/README.md 的「配置」一节。',
    '',
  ].join('\n');
  writeFileSync(args.out, header + JSON.stringify(overlay, null, 2) + '\n', 'utf8');
  const petNames = overlay.pets.map((p) => `${p.id}=${p.name}`).join(', ');
  console.log(`[build] 已生成 ${args.out}`);
  console.log(`[build] pets: ${petNames}`);
  console.log(`[build] whisperPrompt ${overlay.whisperPrompt.length} 字符，chatMemoryRounds=${overlay.chatMemoryRounds ?? '(默认)'}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (err) {
    console.error(`[build] ${err.message}`);
    process.exit(1);
  }
}
