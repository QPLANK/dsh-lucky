#!/usr/bin/env node
/**
 * 给已安装的 dsh-pet 打「桌面图标互动」补丁：小肥鱼会随机把桌面图标挪到别的位置，带 /desk 开关。
 *
 * 能力边界：只调用 Finder 的 `set position`（图标坐标），**不删、不改名、不移动文件、不写文件内容**。
 *
 * 用法：
 *   node desktop/apply-desktop.mjs --dry-run
 *   node desktop/apply-desktop.mjs
 *   node desktop/apply-desktop.mjs --check
 *
 * 改前整包备份到 $DSH_HOME/dsh-pet/backups/desktop-<时间戳>/；失败自动还原。
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:desktop';
const SNIPPET = readFileSync(join(HERE, 'snippet.js'), 'utf8').trimEnd();

const SCHEDULER = `
	/* ${MARKER} —— 桌面图标互动调度（随机间隔 + 免打扰；关闭/失败都不打扰） */
	ctx.effect(() => {
		let disposed$d = false;
		let timer$d = null;
		const nextDelayMs = () => {
			let min = 25;
			let max = 50;
			try {
				const s = deskSettings(readAllConfig(configPaths));
				min = s.minMinutes;
				max = s.maxMinutes;
			} catch {}
			return (min + Math.random() * Math.max(0, max - min)) * 60000;
		};
		const arm = () => {
			if (disposed$d) return;
			timer$d = setTimeout(() => void tick(), nextDelayMs());
		};
		async function tick() {
			try {
				const cfg = readAllConfig(configPaths);
				const s = deskSettings(cfg);
				if (s.enabled && !deskInQuiet(s.quietHours, (/* @__PURE__ */ new Date()).getHours())) {
					const petId = resolveActivePetId();
					if (petId) await deskInteract(petId, false);
				}
			} catch (e) {
				console.warn("[dsh-pet] 桌面互动调度异常：" + (e instanceof Error ? e.message : String(e)));
			}
			arm();
		}
		arm();
		return () => {
			disposed$d = true;
			if (timer$d !== null) clearTimeout(timer$d);
		};
	}, "dsh-pet: desktop poll");
`;

const COMMAND = `
	/* ${MARKER} —— /desk 开关与体检 */
	ctx.effect(() => ctx.commands.register({
		name: "desk",
		description: "桌面图标互动：开 / 关 / 体检 / 立刻来一次（只挪图标位置，不删改文件）",
		input: { hint: "[on|off|status|now]" },
		handler: ({ rawInput }) => {
			const arg = String(rawInput ?? "").trim().toLowerCase();
			let cfg;
			try {
				cfg = readAllConfig(configPaths);
			} catch {
				return { kind: "error", text: "读不到配置（安装可能损坏）" };
			}
			if (arg === "on" || arg === "off") {
				const ok = deskWriteState({ enabled: arg === "on" });
				return {
					kind: ok ? "success" : "error",
					text: ok ? "桌面互动已" + (arg === "on" ? "开启" : "关闭") + "。" : "开关写入失败（看宿主日志）"
				};
			}
			if (arg === "now") {
				const petId = resolveActivePetId();
				if (!petId) return { kind: "error", text: "没有可交互的桌宠" };
				deskInteract(petId, true).then((r) => {
					if (!r.ok) console.warn("[dsh-pet] 手动桌面互动失败：" + (r.reason ?? "") + (r.message ? " " + r.message : ""));
				});
				return { kind: "success", text: "本鱼去了，看桌面 / 看气泡" };
			}
			const enabled = deskSettings(cfg).enabled;
			deskStatus(cfg).then((s) => {
				const petId = resolveActivePetId();
				if (petId) state.writePet(petId, "say", { text: "桌面互动：" + (s.enabled ? "开" : "关") + "；" + s.detail });
			}).catch(() => {});
			return { kind: "success", text: "桌面互动当前" + (enabled ? "开启" : "关闭") + "（体检结果会让桌宠说出来）" };
		}
	}), "dsh-pet: /desk command");
`;

const ROUTES = `
		// ${MARKER} —— 桌面图标互动端点（只改坐标；不删/不改名/不动文件内容）
		if (rest === "desktop/state") {
			if (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			if (url.searchParams.get("light") === "1") {
				const light = deskSettings(readAllConfig(configPaths));
				return { kind: "json", status: 200, obj: { enabled: light.enabled, minMinutes: light.minMinutes, maxMinutes: light.maxMinutes, quietHours: light.quietHours } };
			}
			const s = await deskStatus(readAllConfig(configPaths));
			return { kind: "json", status: 200, obj: s };
		}
		if (rest === "desktop/carry/grab") {
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let parsed$c;
			try {
				parsed$c = JSON.parse(body ?? "null");
			} catch {
				return { kind: "json", status: 400, obj: { error: "invalid JSON body" } };
			}
			const id$c = parsed$c && typeof parsed$c === "object" ? parsed$c.id : undefined;
			if (typeof id$c !== "string" || !id$c) return { kind: "json", status: 400, obj: { error: "id required" } };
			const grabbed = await deskCarryGrab(id$c, parsed$c.duration, Number(parsed$c.x), Number(parsed$c.y));
			return { kind: "json", status: grabbed.ok ? 200 : 500, obj: grabbed };
		}
		if (rest === "desktop/icons") {
			if (method !== "GET") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			const listed = await deskListIcons();
			const debug = url.searchParams.get("debug") === "1";
			const obj = debug ? listed : {
				ok: listed.ok,
				icons: listed.icons,
				count: listed.count,
				bad: listed.bad,
				reason: listed.reason,
				message: listed.message
			};
			return { kind: "json", status: listed.ok ? 200 : 500, obj };
		}
		if (rest === "desktop/nudge") {
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			const petId$d = resolveActivePetId();
			if (!petId$d) return { kind: "json", status: 200, obj: { ok: false, reason: "no-pet" } };
			const result = await deskInteract(petId$d, true);
			return { kind: "json", status: 200, obj: result };
		}
		if (rest === "desktop/toggle") {
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let parsed$d;
			try {
				parsed$d = JSON.parse(body ?? "null");
			} catch {
				return { kind: "json", status: 400, obj: { error: "invalid JSON body" } };
			}
			if (!parsed$d || typeof parsed$d !== "object" || Array.isArray(parsed$d)) return { kind: "json", status: 400, obj: { error: "body must be an object" } };
			const patch$d = {};
			if (parsed$d.enabled !== undefined) {
				if (typeof parsed$d.enabled !== "boolean") return { kind: "json", status: 400, obj: { error: "enabled must be boolean" } };
				patch$d.enabled = parsed$d.enabled;
			}
			for (const key of ["minMinutes", "maxMinutes"]) {
				if (parsed$d[key] === undefined) continue;
				const n = Number(parsed$d[key]);
				if (!Number.isFinite(n) || n < 5 || n > 1440) return { kind: "json", status: 400, obj: { error: key + " must be 5..1440" } };
				patch$d[key] = Math.round(n);
			}
			if (parsed$d.quietHours !== undefined) {
				const q = parsed$d.quietHours;
				if (!Array.isArray(q) || q.length !== 2) return { kind: "json", status: 400, obj: { error: "quietHours must be [start, end]" } };
				const qn = q.map(Number);
				if (!qn.every((n) => Number.isFinite(n) && n >= 0 && n <= 24)) return { kind: "json", status: 400, obj: { error: "quietHours must be 0..24" } };
				patch$d.quietHours = qn;
			}
			if (Object.keys(patch$d).length === 0) return { kind: "json", status: 400, obj: { error: "no fields" } };
			const ok$d = deskWriteState(patch$d);
			if (!ok$d) return { kind: "json", status: 500, obj: { ok: false } };
			const eff$d = deskSettings(readAllConfig(configPaths));
			return { kind: "json", status: 200, obj: { ok: true, enabled: eff$d.enabled, minMinutes: eff$d.minMinutes, maxMinutes: eff$d.maxMinutes, quietHours: eff$d.quietHours } };
		}
		if (rest === "desktop/move") {
			if (method !== "POST") return { kind: "json", status: 405, obj: { error: "method not allowed" } };
			let parsed$m;
			try {
				parsed$m = JSON.parse(body ?? "null");
			} catch {
				return { kind: "json", status: 400, obj: { error: "invalid JSON body" } };
			}
			const name$m = parsed$m && typeof parsed$m === "object" ? parsed$m.name : undefined;
			const x$m = parsed$m && typeof parsed$m === "object" ? Number(parsed$m.x) : NaN;
			const y$m = parsed$m && typeof parsed$m === "object" ? Number(parsed$m.y) : NaN;
			if (typeof name$m !== "string" || !name$m.trim() || name$m.length > 255) return { kind: "json", status: 400, obj: { error: "name must be a non-empty string" } };
			if (!Number.isFinite(x$m) || !Number.isFinite(y$m)) return { kind: "json", status: 400, obj: { error: "x/y must be finite numbers" } };
			const clampedX = Math.min(8000, Math.max(-4000, Math.round(x$m)));
			const clampedY = Math.min(8000, Math.max(-4000, Math.round(y$m)));
			const moved$m = await deskMoveIcon(name$m, clampedX, clampedY);
			return { kind: "json", status: moved$m.ok ? 200 : 500, obj: moved$m };
		}
`;

const CONFIG_BLOCK = `
  // ===================== 桌面图标互动（dsh-pet-custom 补丁） =====================
  // 由 desktop/apply-desktop.mjs 注入；插件升级后需要重新 apply。
  // 只调用 Finder 的 set position（图标坐标）——不删、不改名、不移动文件、不写文件内容。
  // enabled 开关（/desk on|off 会写 $DSH_HOME/dsh-pet/desktop-interaction.json 覆盖这里）/
  // minMinutes–maxMinutes 随机间隔 / quietHours 免打扰（支持跨天）。
  "desktopInteraction": {
    "enabled": true,
    "minMinutes": 25,
    "maxMinutes": 50,
    "quietHours": [0, 8]
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
const configText = readFileSync(configFile, 'utf8');
const patchedAlready = original.includes(MARKER);
const configPatched = configText.includes('"desktopInteraction"');

if (args.check) {
  console.log(`[check] lib/index.js 补丁: ${patchedAlready ? '已打' : '未打'}`);
  console.log(`[check] assets/config.jsonc 默认块: ${configPatched ? '已加' : '未加'}`);
  process.exit(patchedAlready && configPatched ? 0 : 1);
}

const A_SNIPPET = '\t/** 宠物的显示名（name，缺失回落 id）——命令文案用 */';
const A_SCHED = '\t}, "dsh-pet: whisper poll");\n';
const A_CMD = '\tctx.effect(() => ctx.commands.register({\n\t\tname: "pet",';
const A_ROUTE = '\t\tif (rest === "broadcast") {';

if (args.dryRun) {
  console.log(`[dry-run] 包目录: ${pkg}`);
  console.log(`[dry-run] 当前${patchedAlready ? '已打过' : '未打'}；config ${configPatched ? '已有' : '没有'}`);
  for (const [name, anchor] of [['snippet', A_SNIPPET], ['scheduler', A_SCHED], ['command', A_CMD], ['route', A_ROUTE]]) {
    console.log(`[dry-run] 锚点 ${name}: 命中 ${count(original, anchor)} 次`);
  }
  process.exit(0);
}

if (patchedAlready) {
  console.error('[apply] 已经打过补丁了（找到标记）。要重打先跑 revert-desktop.mjs');
  process.exit(2);
}

for (const [name, anchor] of [['snippet', A_SNIPPET], ['scheduler', A_SCHED], ['command', A_CMD], ['route', A_ROUTE]]) {
  const hits = count(original, anchor);
  if (hits !== 1) {
    const version = readFileSync(join(pkg, 'package.json'), 'utf8').match(/"version":\s*"([^"]+)"/)?.[1] ?? '?';
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次）——插件版本 ${version} 的产物结构变了，停止`);
    process.exit(2);
  }
}

let next = original;
next = next.replace(A_SNIPPET, `${SNIPPET}\n${A_SNIPPET}`);
next = next.replace(A_SCHED, `${A_SCHED}${SCHEDULER}`);
next = next.replace(A_CMD, `${COMMAND}\n${A_CMD}`);
next = next.replace(A_ROUTE, `${ROUTES}\n${A_ROUTE}`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `desktop-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(indexFile, join(backupDir, 'index.js.orig'));
copyFileSync(configFile, join(backupDir, 'config.jsonc.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, indexFile, configFile, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  writeFileSync(indexFile, next, 'utf8');
  if (!configPatched) {
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

const verify = spawnSync(process.execPath, [join(HERE, '..', 'validate-config.mjs'), '--config', join(home, 'dsh-pet', 'main-config.jsonc'), '--home', home, '--package', pkg], { encoding: 'utf8' });
if (verify.stdout) console.log(verify.stdout.trim());
if (verify.status !== 0) console.error('[apply] 配置校验没过（补丁已写入；先跑 revert 再查配置）');

console.log(`
[apply] 完成。重启 DSH 桌面应用后生效。
  /desk status   看开关与 Finder 权限（结果由小肥鱼说出来）
  /desk now      立刻挪一个图标试试
  /desk off      关掉（写入 dsh-pet/desktop-interaction.json）
  首次会请求「自动化 → 控制 Finder」权限；拒绝的话 /desk status 会告诉你缺什么。
`);
