#!/usr/bin/env node
/**
 * 给已安装的 dsh-pet 打「主动搭话」补丁（只改 lib/index.js 与 assets/config.jsonc）。
 *
 * 为什么打补丁而不是装个新插件：desktop profile 由桌面 App 独占管理，CLI 装不了本地插件；
 * 而这条功能必须复用 dsh-pet 的对话链路（同一份人设 / 记忆 / 配图 / 模型回落）。
 *
 * 安全措施：改前整包备份到 $DSH_HOME/dsh-pet/backups/proactive-<时间戳>/，
 *          改完立即 node --check；任何一步失败自动还原。revert-proactive.mjs 一键回滚。
 *
 * 用法：
 *   node proactive/apply-proactive.mjs --dry-run     # 只看补丁会改哪里
 *   node proactive/apply-proactive.mjs               # 真打（需要写插件目录的权限）
 *   node proactive/apply-proactive.mjs --check       # 只检查当前状态
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:proactive';

const SNIPPET = readFileSync(join(HERE, 'snippet.js'), 'utf8').trimEnd();

const SCHEDULER = `
	/* ${MARKER} —— 主动搭话调度（随机间隔 + 免打扰时段；禁用/生成失败都不打扰） */
	ctx.effect(() => {
		let disposed$p = false;
		let timer$p = null;
		const nextDelayMs = () => {
			let min = 30;
			let max = 70;
			try {
				const s = proactiveSettings(readAllConfig(configPaths));
				min = s.minMinutes;
				max = s.maxMinutes;
			} catch {}
			return (min + Math.random() * Math.max(0, max - min)) * 60000;
		};
		const arm = () => {
			if (disposed$p) return;
			timer$p = setTimeout(() => void tick(), nextDelayMs());
		};
		async function tick() {
			try {
				const cfg = readAllConfig(configPaths);
				const s = proactiveSettings(cfg);
				if (s.enabled && !inQuietHours(s.quietHours, (/* @__PURE__ */ new Date()).getHours())) {
					const petId = resolveActivePetId();
					if (petId) await proactiveChat(petId);
				}
			} catch (e) {
				console.warn("[dsh-pet] 主动搭话调度异常：" + (e instanceof Error ? e.message : String(e)));
			}
			arm();
		}
		arm();
		return () => {
			disposed$p = true;
			if (timer$p !== null) clearTimeout(timer$p);
		};
	}, "dsh-pet: proactive poll");
`;

const ROUTE = `
		// ${MARKER} —— 主动搭话设置：GET 读生效值 / POST 写用户覆盖文件（设置框与 /proactive/settings 共用）
		if (rest === "proactive/settings") {
			if (method === "GET") {
				return { kind: "json", status: 200, obj: proactiveSettingsView(readAllConfig(configPaths)) };
			}
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let parsed$s;
			try {
				parsed$s = JSON.parse(body ?? "null");
			} catch {
				return { kind: "json", status: 400, obj: { error: "invalid JSON body" } };
			}
			if (!parsed$s || typeof parsed$s !== "object" || Array.isArray(parsed$s)) {
				return { kind: "json", status: 400, obj: { error: "body must be an object" } };
			}
			const patch$s = {};
			if (parsed$s.enabled !== undefined) {
				if (typeof parsed$s.enabled !== "boolean") return { kind: "json", status: 400, obj: { error: "enabled must be boolean" } };
				patch$s.enabled = parsed$s.enabled;
			}
			for (const key of ["minMinutes", "maxMinutes"]) {
				if (parsed$s[key] === undefined) continue;
				const n = Number(parsed$s[key]);
				if (!Number.isFinite(n) || n < 5 || n > 1440) return { kind: "json", status: 400, obj: { error: key + " must be 5..1440" } };
				patch$s[key] = Math.round(n);
			}
			if (parsed$s.quietHours !== undefined) {
				const q = parsed$s.quietHours;
				if (!Array.isArray(q) || q.length !== 2) return { kind: "json", status: 400, obj: { error: "quietHours must be [start, end]" } };
				const qn = q.map(Number);
				if (!qn.every((n) => Number.isFinite(n) && n >= 0 && n <= 24)) return { kind: "json", status: 400, obj: { error: "quietHours must be 0..24" } };
				patch$s.quietHours = qn;
			}
			const ok$s = proactiveWriteState(patch$s);
			return { kind: "json", status: ok$s ? 200 : 500, obj: Object.assign({ ok: ok$s }, proactiveSettingsView(readAllConfig(configPaths))) };
		}
		// ${MARKER} —— POST /proactive：立刻让当前桌宠主动找你说一句（手动语义：无视 enabled / 免打扰）
		if (rest === "proactive") {
			if (method !== "POST") return {
				kind: "json",
				status: 405,
				obj: { error: "method not allowed" }
			};
			const petId$p = String(url.searchParams.get("pet") ?? "") || resolveActivePetId();
			try {
				const ok = await proactiveChat(petId$p);
				return {
					kind: "json",
					status: 200,
					obj: ok ? { ok: true } : {
						ok: false,
						reason: "generate-error"
					}
				};
			} catch (e) {
				return {
					kind: "json",
					status: 200,
					obj: {
						ok: false,
						reason: "generate-error",
						message: e instanceof Error ? e.message : String(e)
					}
				};
			}
		}
`;

const CONFIG_BLOCK = `
  // ===================== 主动搭话（dsh-pet-custom 补丁） =====================
  // 由 proactive/apply-proactive.mjs 注入；插件升级后需要重新 apply。
  // enabled 开关 / minMinutes–maxMinutes 随机间隔 / quietHours 免打扰（支持跨天，如 [23, 9]）/ prompt 起话头指令。
  // 用户层 main-config.jsonc 里写了 proactive 就整段覆盖这里（缺的子键由宿主逐项兜底）。
  "proactive": {
    "enabled": true,
    "minMinutes": 30,
    "maxMinutes": 70,
    "quietHours": [0, 8],
    "prompt": "现在没有人在跟你说话。你忽然想找主人搭句话：可以问他忙完没、提醒他喝水，或者嘴硬地抱怨一句。只说你要说的那一句话，不要解释你在做什么。"
  },
`;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--check') out.check = true;
    else if (a.startsWith('--home=')) out.home = a.slice(7);
    else if (a.startsWith('--package=')) out.package = a.slice(10);
    else {
      console.error(`未知参数：${a}`);
      process.exit(2);
    }
  }
  return out;
}

function count(haystack, needle) {
  let n = 0;
  let i = 0;
  for (;;) {
    const at = haystack.indexOf(needle, i);
    if (at === -1) return n;
    n += 1;
    i = at + needle.length;
  }
}

const args = parseArgs(process.argv.slice(2));
const home = resolve(args.home ?? process.env.DSH_HOME ?? join(homedir(), '.dsh'));
const pkg = resolve(args.package ?? process.env.DSH_PET_PACKAGE ?? join(home, 'profiles', 'desktop', 'node_modules', 'dsh-pet'));
const indexFile = join(pkg, 'lib', 'index.js');
const configFile = join(pkg, 'assets', 'config.jsonc');

if (!existsSync(indexFile)) {
  console.error(`找不到 ${indexFile}（用 --package= 指定 dsh-pet 包目录）`);
  process.exit(2);
}

const original = readFileSync(indexFile, 'utf8');
const patchedAlready = original.includes(MARKER);
const configText = readFileSync(configFile, 'utf8');
const configPatched = configText.includes('"proactive"');

if (args.check) {
  console.log(`[check] 包目录: ${pkg}`);
  console.log(`[check] lib/index.js 补丁: ${patchedAlready ? '已打' : '未打'}`);
  console.log(`[check] assets/config.jsonc 默认块: ${configPatched ? '已加' : '未加'}`);
  process.exit(patchedAlready && configPatched ? 0 : 1);
}

if (args.dryRun) {
  console.log(`[dry-run] 包目录: ${pkg}`);
  console.log(`[dry-run] lib/index.js 需插入 3 段（snippet / scheduler / route），当前${patchedAlready ? '已打过' : '未打'}`);
  console.log(`[dry-run] assets/config.jsonc 需加 proactive 默认块，当前${configPatched ? '已有' : '没有'}`);
  for (const [name, anchor] of [
    ['snippet', '\t/** 宠物的显示名（name，缺失回落 id）——命令文案用 */'],
    ['scheduler', '\t}, "dsh-pet: whisper poll");\n'],
    ['route', '\t\tif (rest === "broadcast") {'],
  ]) {
    console.log(`[dry-run] 锚点 ${name}: 命中 ${count(original, anchor)} 次`);
  }
  process.exit(0);
}

if (patchedAlready) {
  console.error('[apply] 已经打过补丁了（找到标记）。要重打先跑 revert-proactive.mjs');
  process.exit(2);
}

const A_SNIPPET = '\t/** 宠物的显示名（name，缺失回落 id）——命令文案用 */';
const A_SCHED = '\t}, "dsh-pet: whisper poll");\n';
const A_ROUTE = '\t\tif (rest === "broadcast") {';
for (const [name, anchor] of [['snippet', A_SNIPPET], ['scheduler', A_SCHED], ['route', A_ROUTE]]) {
  const hits = count(original, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次）——这个插件版本(${readFileSync(join(pkg, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? '?'})的产物结构变了，停止打补丁`);
    process.exit(2);
  }
}

let next = original;
next = next.replace(A_SNIPPET, `${SNIPPET}\n${A_SNIPPET}`);
next = next.replace(A_SCHED, `${A_SCHED}${SCHEDULER}`);
next = next.replace(A_ROUTE, `${ROUTE}\n${A_ROUTE}`);

// 备份
const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `proactive-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(indexFile, join(backupDir, 'index.js.orig'));
copyFileSync(configFile, join(backupDir, 'config.jsonc.orig'));
writeFileSync(
  join(backupDir, 'meta.json'),
  JSON.stringify({ createdAt: new Date().toISOString(), pkg, indexFile, configFile, marker: MARKER }, null, 2),
);
console.log(`[apply] 已备份到 ${backupDir}`);

const restore = () => {
  copyFileSync(join(backupDir, 'index.js.orig'), indexFile);
  copyFileSync(join(backupDir, 'config.jsonc.orig'), configFile);
  console.log('[apply] 已回滚');
};

try {
  writeFileSync(indexFile, next, 'utf8');
  if (!configPatched) {
    const at = configText.indexOf('\n{\n');
    if (at === -1) throw new Error('assets/config.jsonc 里找不到开头的 "{"');
    const inserted = configText.slice(0, at + 2) + CONFIG_BLOCK + configText.slice(at + 2);
    writeFileSync(configFile, inserted, 'utf8');
  }
  const check = spawnSync(process.execPath, ['--check', indexFile], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check 失败：\n${check.stderr || check.stdout}`);
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  restore();
  process.exit(1);
}

const verify = spawnSync(process.execPath, [join(HERE, '..', 'validate-config.mjs'), '--config', join(home, 'dsh-pet', 'main-config.jsonc'), '--home', home, '--package', pkg], {
  encoding: 'utf8',
});
if (verify.stdout) console.log(verify.stdout.trim());
if (verify.status !== 0) {
  console.error('[apply] 配置校验没过（补丁仍已写入；先跑 revert 再查配置）');
  process.exit(1);
}

console.log(`
[apply] 完成。生效需要**重启 DSH 桌面应用**（host 侧代码改动不随「重载配置」热加载）。
  立即试一句：curl -X POST http://127.0.0.1:59776/dsh-pet-7340/proactive
  关闭功能：main-config.jsonc 里 "proactive": { "enabled": false }
  回滚补丁：node proactive/revert-proactive.mjs
`);
