#!/usr/bin/env node
/** 离线验收 memory/snippet.js：配置兜底 / 合并去重 / 敏感过滤 / 注入 / 抽取节流。 */
import { readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, mkdtempSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const snippet = readFileSync(join(HERE, 'snippet.js'), 'utf8');
const fails = [];
const check = (n, c, x = '') => { if (c) console.log(`  ✓ ${n}`); else { fails.push(n); console.log(`  ✗ ${n} ${x}`); } };

const userRoot = mkdtempSync(join(tmpdir(), 'dsh-profile-'));
let cfg = { main: { memoryProfile: { enabled: true, updateEveryTurns: 3 } } };
let memory = {};
let lastGenerate = null;
let profileSettingsRuntime = null;

const api = new Function(
  'join', 'readFileSync', 'writeFileSync', 'mkdirSync', 'renameSync', 'existsSync', 'userRoot',
  'readAllConfig', 'configPaths', 'findPetInstance', 'readMemory', 'generateChat', 'configuredModel', 'ctx', 'console',
  `${snippet}\nreturn { profileSettings, readProfileFile, writeProfileFile, clearProfile, mergeProfileDelta, profileParseJson, profileBlock, updateProfileAfterChat, profileSimilarity, emptyProfile, profileRetrieve, profileQueryScore, mergeEpisodes, readEpisodesFile, writeEpisodesFile, episodeRetrieve };`,
)(
  join, readFileSync, writeFileSync, mkdirSync, renameSync, existsSync, userRoot,
  () => cfg, {},
  () => ({ entry: 'main', conf: cfg.main }),
  async () => memory,
  async (ctx, system, history, payload) => { lastGenerate = { system, payload }; return { ok: true, text: JSON.stringify({ summary: '主人喜欢冰美式', add: [{ kind: 'preference', text: '喜欢冰美式不加糖', confidence: 0.9 }], update: [], archive: [] }) }; },
  () => undefined,
  {},
  { warn: () => {} },
);

console.log('[1] 配置兜底');
{
  cfg = { main: {} };
  let s = api.profileSettings(cfg);
  check('默认开启', s.enabled === true);
  check('默认 3 轮', s.updateEveryTurns === 3);
  check('默认 200 条', s.maxFacts === 200);
  cfg = { main: { memoryProfile: { enabled: false, updateEveryTurns: 99 } } };
  s = api.profileSettings(cfg);
  check('可关闭', s.enabled === false);
  check('轮数夹到 20', s.updateEveryTurns === 20);
}

console.log('[2] 合并 / 去重 / 敏感过滤');
{
  const settings = api.profileSettings({ main: {} });
  let p = api.emptyProfile();
  p = api.mergeProfileDelta(p, { summary: '主人是工程师', add: [
    { kind: 'preference', text: '喜欢冰美式' },
    { kind: 'trait', text: '讨厌被催' },
    { kind: 'fact', text: '银行卡密码是 123456' },
  ] }, settings);
  check('写入 2 条（敏感被丢）', p.facts.length === 2, String(p.facts.length));
  check('摘要写入', p.summary === '主人是工程师');
  p = api.mergeProfileDelta(p, { add: [{ kind: 'preference', text: '喜欢喝冰美式' }] }, settings);
  check('相似事实合并', p.facts.length === 2, String(p.facts.length));
  check('hits 增加', p.facts.find((f) => f.text.includes('冰美式')).hits === 2);
  const id = p.facts.find((f) => f.kind === 'trait').id;
  p = api.mergeProfileDelta(p, { update: [{ id, text: '很讨厌被催', confidence: 0.95 }], archive: [] }, settings);
  check('update 生效', p.facts.find((f) => f.id === id).text === '很讨厌被催');
  p = api.mergeProfileDelta(p, { archive: [id] }, settings);
  check('archive 移出', !p.facts.some((f) => f.id === id) && p.archived.some((f) => f.id === id));
}

console.log('[3] JSON 解析与注入');
{
  check('带 fence 也能解析', api.profileParseJson('```json\n{"summary":"x"}\n```').summary === 'x');
  check('坏 JSON 返回 null', api.profileParseJson('not json') === null);
  api.writeProfileFile({ version: 1, updatedAt: 1, lastExtractedTs: 0, summary: '主人爱喝冰美式', facts: [{ id: 'b1', kind: 'boundary', text: '别提体重', confidence: 0.9, text2: '' }], archived: [] });
  const block = api.profileBlock({ main: {} }, false);
  check('摘要注入', block.includes('关于主人') && block.includes('冰美式'));
  check('边界注入', block.includes('别提体重'));
  check('碎碎念默认不注入', api.profileBlock({ main: {} }, true) === '');
  check('配置开启后碎碎念才注入', api.profileBlock({ main: { memoryProfile: { injectInWhisper: true } } }, true).includes('冰美式'));
}

console.log('[4] 抽取节流');
{
  api.clearProfile();
  cfg = { main: { memoryProfile: { updateEveryTurns: 3 } } };
  memory = { main: { main: { messages: [
    { role: 'user', content: 'a', ts: 1000 },
    { role: 'assistant', content: 'b', ts: 1001 },
    { role: 'user', content: 'c', ts: 1002 },
  ] } } };
  await api.updateProfileAfterChat('main');
  check('不足 3 轮不抽取', lastGenerate === null && api.readProfileFile().facts.length === 0);
  memory.main.main.messages.push({ role: 'assistant', content: 'd', ts: 1003 }, { role: 'user', content: 'e', ts: 1004 });
  await api.updateProfileAfterChat('main');
  check('满 3 轮触发抽取', lastGenerate !== null);
  const saved = api.readProfileFile();
  check('落盘 summary', saved.summary === '主人喜欢冰美式');
  check('落盘 fact', saved.facts.some((f) => f.text.includes('冰美式')));
  check('记录 lastExtractedTs', saved.lastExtractedTs === 1004);
}

console.log('[5] 检索与衰减');
{
  cfg = { main: {} };
  api.writeProfileFile({ version: 1, updatedAt: 1, lastExtractedTs: 0, summary: '', facts: [
    { id: 'f1', kind: 'preference', text: '喜欢冰美式', confidence: 0.9, lastSeen: Date.now(), hits: 3 },
    { id: 'f2', kind: 'trait', text: '讨厌被催', confidence: 0.8, lastSeen: Date.now(), hits: 2 },
    { id: 'f3', kind: 'fact', text: '养了一只猫', confidence: 0.7, lastSeen: Date.now(), hits: 1 },
  ], archived: [] });
  const rel = api.profileRetrieve({ main: {} }, '今天喝了冰美式，好困', 5);
  check('命中冰美式', rel.length >= 1 && rel[0].text.includes('冰美式'), JSON.stringify(rel.map(f => f.text)));
  check('无关事实不返回', !rel.some(f => f.text.includes('猫')));
  check('无关查询返回空', api.profileRetrieve({ main: {} }, '今天天气不错', 5).length === 0);

  const settings = api.profileSettings({ main: { memoryProfile: { decayAfterDays: 30, decayPerDay: 0.01, minConfidence: 0.25 } } });
  const old = Date.now() - 100 * 86400000;
  const p = api.mergeProfileDelta({ version: 1, summary: '', facts: [
    { id: 'old', kind: 'fact', text: '很久没提过的事', confidence: 0.6, lastSeen: old, hits: 1 }
  ], archived: [] }, { add: [] }, settings);
  check('长期未命中被归档', p.facts.length === 0 && p.archived.some(f => f.id === 'old'));
}

console.log('[6] 情节记忆');
{
  const settings = api.profileSettings({ main: {} });
  let eps = api.mergeEpisodes([], { episodes: [
    { summary: '主人加班到很晚，聊了咖啡', tags: ['加班', '咖啡'] },
    { summary: '主人加班到很晚，聊了咖啡', tags: ['加班'] },
    { summary: '周末提醒主人休息', tags: ['休息'] },
  ] }, settings);
  check('重复情节合并', eps.length === 2, String(eps.length));
  check('带日期与 id', !!eps[0].id && /^\d{4}-\d{2}-\d{2}$/.test(eps[0].date));
  api.writeEpisodesFile(eps);
  const hit = api.episodeRetrieve({ main: {} }, '今天又喝了咖啡', 2);
  check('按话题检索情节', hit.length >= 1 && hit[0].summary.includes('咖啡'));
  check('无关查询返回空', api.episodeRetrieve({ main: {} }, '天气不错', 2).length === 0);
  api.clearProfile();
  check('清空会连情节一起清', api.readEpisodesFile().length === 0);
}

rmSync(userRoot, { recursive: true, force: true });
if (fails.length) { console.error(`失败 ${fails.length} 项`); process.exit(1); }
console.log('\n[test] memory snippet 通过');
