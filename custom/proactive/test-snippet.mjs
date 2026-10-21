#!/usr/bin/env node
/**
 * 离线验收 proactive/snippet.js —— 用的就是 apply-proactive.mjs 即将插入 lib/index.js 的那段源码，
 * 依赖用桩替代。这样在重启 DSH 之前就能确认：配置兜底、免打扰时段、记忆只写 assistant、失败不落盘。
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const snippet = readFileSync(join(HERE, 'snippet.js'), 'utf8');

const fails = [];
const check = (name, cond, extra = '') => {
  if (cond) console.log(`  ✓ ${name}`);
  else {
    fails.push(`${name} ${extra}`);
    console.log(`  ✗ ${name} ${extra}`);
  }
};

function makeHarness({ memory = {}, generate }) {
  const writes = [];
  const says = [];
  const written = [];
  const api = new Function(
    'withMemoryLock',
    'readAllConfig',
    'configPaths',
    'findPetInstance',
    'petSystemPrompt',
    'limitPool',
    'readMemePool',
    'memeDirsFor',
    'readMemory',
    'sliceMemoryRounds',
    'memoryRounds',
    'generateChat',
    'ctx',
    'configuredModel',
    'writeMemory',
    'state',
    'console',
    `${snippet}\nreturn { proactiveSettings, inQuietHours, proactiveChat };`,
  )(
    (fn) => fn(),
    () => ({ main: { proactive: currentProactive, whisperPrompt: '人设', chatImageEnabled: false, chatMemoryRounds: 4 } }),
    {},
    () => ({ entry: 'main', conf: { chatImageEnabled: false, chatMemoryRounds: 4 } }),
    () => 'SYSTEM',
    (pool) => pool,
    () => [],
    () => [],
    async () => memory,
    (list) => list.slice(-8),
    () => 4,
    generate,
    {},
    () => undefined,
    async (mem) => {
      written.push(JSON.parse(JSON.stringify(mem)));
    },
    {
      writePet: (id, leaf, value) => says.push({ id, leaf, value }),
    },
    { warn: (...a) => writes.push(a.join(' ')) },
  );
  return { api, says, written, writes };
}

let currentProactive = {};

console.log('[1] 配置兜底');
{
  const { api } = makeHarness({ generate: async () => ({ ok: true, text: 'x' }) });
  currentProactive = undefined;
  let s = api.proactiveSettings({});
  check('缺省关闭', s.enabled === false);
  check('默认 30–70 分钟', s.minMinutes === 30 && s.maxMinutes === 70);
  check('默认免打扰 0–8', s.quietHours[0] === 0 && s.quietHours[1] === 8);
  check('空 prompt 回落默认', s.prompt.startsWith('现在没有人在跟你说话'));

  s = api.proactiveSettings({ main: { proactive: { enabled: 'yes', minMinutes: 200, maxMinutes: 10, quietHours: [25, -1] } } });
  check('enabled 只认布尔 true', s.enabled === false);
  check('min/max 自动交换', s.minMinutes === 10 && s.maxMinutes === 200);
  check('非法 quietHours 回默认', s.quietHours[0] === 0 && s.quietHours[1] === 8);
}

console.log('[2] 免打扰时段');
{
  const { api } = makeHarness({ generate: async () => ({ ok: true, text: 'x' }) });
  check('0–8 内 3 点安静', api.inQuietHours([0, 8], 3) === true);
  check('0–8 内 9 点不安静', api.inQuietHours([0, 8], 9) === false);
  check('跨天 23–9 内 2 点安静', api.inQuietHours([23, 9], 2) === true);
  check('跨天 23–9 内 12 点不安静', api.inQuietHours([23, 9], 12) === false);
  check('起止相同 = 不启用', api.inQuietHours([5, 5], 5) === false);
}

console.log('[3] 主动搭话写入');
{
  const memory = { main: { main: { messages: [{ role: 'user', content: '早', ts: 1 }, { role: 'assistant', content: '早啊', ts: 2 }] } } };
  let seen = null;
  const { api, says, written } = makeHarness({
    memory,
    generate: async (ctx, system, history, userText) => {
      seen = { system, history, userText };
      return { ok: true, text: '哼，忙完没？' };
    },
  });
  currentProactive = { enabled: true, prompt: '起个话头' };
  const ok = await api.proactiveChat('main');
  check('返回 true', ok === true);
  check('人设走 petSystemPrompt', seen.system === 'SYSTEM');
  check('历史带上了之前 1 轮', seen.history.length === 2);
  check('user 侧用 proactive.prompt', seen.userText === '起个话头');
  check('记忆只追加 assistant', memory.main.main.messages.length === 3 && memory.main.main.messages[2].role === 'assistant' && memory.main.main.messages[2].content === '哼，忙完没？');
  check('落盘一次', written.length === 1);
  check('写 S 的 say 叶子', says.length === 1 && says[0].id === 'main' && says[0].leaf === 'say' && says[0].value.text === '哼，忙完没？');
}

console.log('[4] 生成失败不落盘');
{
  const memory = { main: { main: { messages: [] } } };
  const { api, says, written, writes } = makeHarness({
    memory,
    generate: async () => ({ ok: false, reason: 'generate-error', message: 'boom' }),
  });
  currentProactive = { enabled: true };
  const ok = await api.proactiveChat('main');
  check('返回 false', ok === false);
  check('记忆未变', memory.main.main.messages.length === 0);
  check('未落盘', written.length === 0);
  check('未写 S', says.length === 0);
  check('有告警不静默', writes.some((w) => w.includes('主动搭话生成失败')));
}

console.log('[5] 配图随回复带出');
{
  const memory = { main: { main: { messages: [] } } };
  const { api, says } = makeHarness({ memory, generate: async () => ({ ok: true, text: '看图', image: '可爱' }) });
  currentProactive = { enabled: true };
  await api.proactiveChat('main');
  check('image 一起写进 say', says[0].value.image === '可爱');
}

if (fails.length) {
  console.error(`\n[test] 失败 ${fails.length} 项`);
  process.exit(1);
}
console.log('\n[test] snippet 全部通过');
