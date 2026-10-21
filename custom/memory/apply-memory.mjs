#!/usr/bin/env node
/**
 * 给已安装的 dsh-pet 打「长期画像」补丁（Phase 1）：
 *   - profile.json：摘要 + 事实（偏好/性格/事实/边界/目标）
 *   - 每次对话后按「用户发言数」节流抽取（默认 3 轮）
 *   - 对话 / 主动搭话的 system 里注入摘要与边界；碎碎念默认不注入
 *   - /profile 查看 / 清空 / 删除单条；GET /profile、DELETE /profile
 *
 * 只改 lib/index.js 与 assets/config.jsonc。
 *
 * 用法：
 *   node memory/apply-memory.mjs --check
 *   node memory/apply-memory.mjs
 *   node memory/revert-memory.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:memory';
const SNIPPET = readFileSync(join(HERE, 'snippet.js'), 'utf8').trimEnd();

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
const indexFile = join(pkg, 'lib', 'index.js');
const configFile = join(pkg, 'assets', 'config.jsonc');
if (!existsSync(indexFile)) {
  console.error(`找不到 ${indexFile}`);
  process.exit(2);
}

const source = readFileSync(indexFile, 'utf8');
const configText = readFileSync(configFile, 'utf8');
const patched = source.includes(MARKER);

if (args.check) {
  console.log(`[check] 长期画像补丁: ${patched ? '已打' : '未打'}`);
  console.log(`[check] config memoryProfile: ${configText.includes('"memoryProfile"') ? '已有' : '没有'}`);
  process.exit(patched ? 0 : 1);
}
if (patched) {
  console.error('[apply] 已经打过补丁了；要重打先跑 revert-memory.mjs');
  process.exit(2);
}

const A_SNIPPET = '\t/** 宠物的显示名（name，缺失回落 id）——命令文案用 */';
const A_PROMPT_SIG = '\tconst petSystemPrompt = (petId, cfg) => {';
const A_PROMPT_BODY = '\t\tconst base = prompt ? prompt + "\\n" + nameLine : nameLine;\n\t\tconst time = timeContextOf(new Date());\n\t\treturn time ? base + "\\n" + time : base;';
const A_WHISPER_CALL = '\t\tconst entry = found ? found.entry : "main";\n\t\tconst system = petSystemPrompt(petId, cfg);';
const A_CHAT_SYS = '\t\tconst rounds = memoryRounds(petId, cfg);\n\t\tconst found = findPetInstance(cfg, petId);\n\t\tconst conf = (found ?? { conf: cfg.main ?? {} }).conf;\n\t\tconst system = petSystemPrompt(petId, cfg);';
const A_CHAT_WRITE = '\t\tawait writeMemory(mem);\n\t\tstate.writePet(petId, "say", generated.image ? {\n\t\t\ttext: generated.text,\n\t\t\timage: generated.image\n\t\t} : { text: generated.text });\n\t\treturn { ok: true };';
const A_ROUTE = '\t\tif (rest === "broadcast") {';
const A_CMD = '\tctx.effect(() => ctx.commands.register({\n\t\tname: "pet",';

for (const [name, anchor] of [
  ['snippet', A_SNIPPET],
  ['promptSig', A_PROMPT_SIG],
  ['promptBody', A_PROMPT_BODY],
  ['whisperCall', A_WHISPER_CALL],
  ['chatSys', A_CHAT_SYS],
  ['chatWrite', A_CHAT_WRITE],
  ['route', A_ROUTE],
  ['command', A_CMD]
]) {
  const hits = count(source, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

const ROUTES = `
		// ${MARKER} —— 长期画像：GET 查看 / DELETE 清空 / POST 手改摘要
		if (rest === "profile") {
			const cfg$p = readAllConfig(configPaths);
			if (method === "GET") {
				const p = readProfileFile();
				const s = profileSettings(cfg$p);
				const episodes$e = readEpisodesFile();
				return { kind: "json", status: 200, obj: {
					ok: true,
					enabled: s.enabled,
					summary: p.summary,
					facts: p.facts,
					episodes: episodes$e.slice(-20),
					episodeCount: episodes$e.length,
					updatedAt: p.updatedAt,
					settings: { updateEveryTurns: s.updateEveryTurns, maxFacts: s.maxFacts, summaryMaxChars: s.summaryMaxChars, injectInWhisper: s.injectInWhisper, retrieveFacts: s.retrieveFacts, retrieveEpisodes: s.retrieveEpisodes }
				} };
			}
			if (method === "DELETE") {
				clearProfile();
				return { kind: "json", status: 200, obj: { ok: true } };
			}
			if (method === "POST") {
				let parsed$p;
				try {
					parsed$p = JSON.parse(body ?? "null");
				} catch {
					return { kind: "json", status: 400, obj: { error: "invalid JSON body" } };
				}
				const o$p = parsed$p && typeof parsed$p === "object" ? parsed$p : {};
				if (o$p.clear === true) {
					clearProfile();
					return { kind: "json", status: 200, obj: { ok: true, cleared: true } };
				}
				if (typeof o$p.forget === "string" && o$p.forget) {
					const p0 = readProfileFile();
					const hit = p0.facts.find((f) => f.id === o$p.forget);
					if (!hit) return { kind: "json", status: 404, obj: { ok: false, error: "not found" } };
					p0.facts = p0.facts.filter((f) => f.id !== o$p.forget);
					p0.updatedAt = Date.now();
					const okF = writeProfileFile(p0);
					return { kind: "json", status: okF ? 200 : 500, obj: { ok: okF, forgot: hit.text } };
				}
				if (typeof o$p.forgetEpisode === "string" && o$p.forgetEpisode) {
					const list0 = readEpisodesFile();
					const hitE = list0.find((e) => e.id === o$p.forgetEpisode);
					if (!hitE) return { kind: "json", status: 404, obj: { ok: false, error: "not found" } };
					const okE = writeEpisodesFile(list0.filter((e) => e.id !== o$p.forgetEpisode));
					return { kind: "json", status: okE ? 200 : 500, obj: { ok: okE, forgot: hitE.summary } };
				}
				const summary$p = o$p.summary;
				if (summary$p !== undefined && typeof summary$p !== "string") return { kind: "json", status: 400, obj: { error: "summary must be string" } };
				const p = readProfileFile();
				if (typeof summary$p === "string") p.summary = summary$p.trim().slice(0, profileSettings(cfg$p).summaryMaxChars);
				p.updatedAt = Date.now();
				const ok$p = writeProfileFile(p);
				return { kind: "json", status: ok$p ? 200 : 500, obj: { ok: ok$p, summary: p.summary } };
			}
			return { kind: "json", status: 405, obj: { error: "method not allowed" } };
		}
`;

const COMMAND = `
	/* ${MARKER} —— /profile：查看 / 清空 / 删除单条长期记忆 */
	ctx.effect(() => ctx.commands.register({
		name: "profile",
		description: "查看或管理小肥鱼对你的长期记忆（画像）",
		input: { hint: "[clear | forget <id>]" },
		handler: ({ rawInput }) => {
			const arg = String(rawInput ?? "").trim();
			let cfg$c;
			try {
				cfg$c = readAllConfig(configPaths);
			} catch {
				return { kind: "error", text: "读不到配置" };
			}
			const s = profileSettings(cfg$c);
			if (!s.enabled) return { kind: "error", text: "长期记忆已在配置里关闭（memoryProfile.enabled=false）" };
			if (arg === "clear") {
				clearProfile();
				return { kind: "success", text: "长期记忆已清空（旧文件已备份为 profile.json.bak-*）" };
			}
			if (arg.startsWith("forget ")) {
				const id = arg.slice(7).trim();
				const p = readProfileFile();
				const hit = p.facts.find((f) => f.id === id);
				if (!hit) return { kind: "error", text: "没找到这条记忆：" + id };
				p.facts = p.facts.filter((f) => f.id !== id);
				p.updatedAt = Date.now();
				writeProfileFile(p);
				return { kind: "success", text: "已忘记：" + hit.text };
			}
			const p = readProfileFile();
			const eps = readEpisodesFile();
			const facts = p.facts.slice(0, 12).map((f) => "- [" + f.kind + "] " + f.text + "（" + f.id + "）");
			const epText = eps.slice(-5).map((e) => "- " + e.date + "：" + e.summary);
			const text = (p.summary ? p.summary : "（还没有形成摘要）") + "\\n\\n共 " + p.facts.length + " 条事实" + (facts.length ? "：\\n" + facts.join("\\n") : "") + "\\n\\n共 " + eps.length + " 段回忆" + (epText.length ? "：\\n" + epText.join("\\n") : "") + "\\n\\n/profile clear 清空；/profile forget <id> 删单条";
			return { kind: "success", text };
		}
	}), "dsh-pet: /profile command");
`;

let next = source;
next = next.replace(A_SNIPPET, `${SNIPPET}\n${A_SNIPPET}`);
next = next.replace(A_PROMPT_SIG, '\tconst petSystemPrompt = (petId, cfg, forWhisper, query) => {');
next = next.replace(
  A_PROMPT_BODY,
  '\t\tconst base = prompt ? prompt + "\\n" + nameLine : nameLine;\n\t\tconst withProfile = base + profileBlock(cfg, forWhisper === true, query);\n\t\tconst time = timeContextOf(new Date());\n\t\treturn time ? withProfile + "\\n" + time : withProfile;'
);
next = next.replace(A_WHISPER_CALL, '\t\tconst entry = found ? found.entry : "main";\n\t\tconst system = petSystemPrompt(petId, cfg, true);');
next = next.replace(A_CHAT_SYS, '\t\tconst rounds = memoryRounds(petId, cfg);\n\t\tconst found = findPetInstance(cfg, petId);\n\t\tconst conf = (found ?? { conf: cfg.main ?? {} }).conf;\n\t\tconst system = petSystemPrompt(petId, cfg, false, text);');
next = next.replace(
  A_CHAT_WRITE,
  '\t\tawait writeMemory(mem);\n\t\tstate.writePet(petId, "say", generated.image ? {\n\t\t\ttext: generated.text,\n\t\t\timage: generated.image\n\t\t} : { text: generated.text });\n\t\tsetTimeout(() => {\n\t\t\tvoid updateProfileAfterChat(petId).catch(() => {});\n\t\t}, 250);\n\t\treturn { ok: true };'
);
next = next.replace(A_ROUTE, `${ROUTES}\n${A_ROUTE}`);
next = next.replace(A_CMD, `${COMMAND}\n${A_CMD}`);

const CONFIG_BLOCK = `
  // ===================== 长期记忆 / 用户画像（dsh-pet-custom 补丁） =====================
  // enabled 总开关；updateEveryTurns 每几次用户发言抽取一次；
  // maxFacts 事实上限；summaryMaxChars 摘要上限；injectInWhisper 碎碎念是否也带画像（默认否）。
  "memoryProfile": {
    "enabled": true,
    "updateEveryTurns": 3,
    "maxFacts": 200,
    "summaryMaxChars": 600,
    "injectInWhisper": false,
    "retrieveFacts": 5,
    "decayAfterDays": 30,
    "decayPerDay": 0.005,
    "minConfidence": 0.25,
    "maxEpisodes": 100,
    "retrieveEpisodes": 2
  },
`;

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `memory-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(indexFile, join(backupDir, 'index.js.orig'));
copyFileSync(configFile, join(backupDir, 'config.jsonc.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, indexFile, configFile, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  writeFileSync(indexFile, next, 'utf8');
  if (!configText.includes('"memoryProfile"')) {
    const at = configText.indexOf('\n{\n');
    if (at === -1) throw new Error('assets/config.jsonc 里找不到开头的 "{"');
    writeFileSync(configFile, configText.slice(0, at + 2) + CONFIG_BLOCK + configText.slice(at + 2), 'utf8');
  }
  const check = spawnSync(process.execPath, ['--check', indexFile], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check 失败：\n${check.stderr || check.stdout}`);
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  copyFileSync(join(backupDir, 'index.js.orig'), indexFile);
  copyFileSync(join(backupDir, 'config.jsonc.orig'), configFile);
  console.error('[apply] 已回滚');
  process.exit(1);
}

console.log(`
[apply] 完成。重启 DSH 桌面应用后：
  /profile            查看画像摘要与事实
  /profile clear      清空（旧文件自动备份）
  curl http://127.0.0.1:<port>/dsh-pet-7340/profile
  每 3 次用户发言会自动抽取一次画像，写入 ~/.dsh/dsh-pet/profile.json
  回滚：node memory/revert-memory.mjs
`);
