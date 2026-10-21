#!/usr/bin/env node
/**
 * 在 dsh-pet 的设置页（DSH 设置 → 桌宠配置 → 全局）加一个「桌面图标互动」开关。
 *
 * 只改 lib/client.js：
 *   - 中英文案（deskToggle / deskToggleHint / deskOn / deskOff）
 *   - 组件状态 + 从 GET /desktop/state?light=1 读当前开关
 *   - toggleDesk()：POST /desktop/toggle（立即生效，写入 dsh-pet/desktop-interaction.json，不需要点保存）
 *   - 全局卡片里加一个 toggle 格子
 *
 * 用法：
 *   node settings-ui/apply-settings-ui.mjs --check
 *   node settings-ui/apply-settings-ui.mjs
 *   node settings-ui/revert-settings-ui.mjs
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { homedir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const MARKER = 'dsh-pet-custom:settings-desk';

const ZH = `\tdeskToggle: "桌面图标互动",
\tdeskToggleHint: "允许小肥鱼偶尔把桌面图标抱到别的位置：只改图标坐标，不删、不改名、不动文件内容。开关立即生效（写入 dsh-pet/desktop-interaction.json），不用点保存；首次使用需要「系统设置 → 隐私与安全性 → 自动化 → Finder」权限。",
\tdeskOn: "桌面图标互动已开启",
\tdeskOff: "桌面图标互动已关闭",
`;

const EN = `\tdeskToggle: "Desktop icon play",
\tdeskToggleHint: "Let the pet occasionally carry a desktop icon to another spot: it only changes icon coordinates — never deletes, renames, or modifies files. The switch applies immediately (written to dsh-pet/desktop-interaction.json), no Save needed; first use needs Automation → Finder permission.",
\tdeskOn: "Desktop icon play enabled",
\tdeskOff: "Desktop icon play disabled",
`;

const STATE = `\t\tconst [deskEnabled, setDeskEnabled] = useState(false);\n`;

const FETCH = `\t\t\tfetch("/dsh-pet-7340/desktop/state?light=1").then((r) => r.ok ? r.json() : null).then((s) => {
\t\t\t\tif (s && typeof s.enabled === "boolean") setDeskEnabled(s.enabled);
\t\t\t}).catch(() => {});
`;

const TOGGLE = `\t\t/** ${MARKER} —— 设置页开关：立即 POST /desktop/toggle（写开关文件），不参与「保存」批处理 */
\t\tconst toggleDesk = async (v) => {
\t\t\tsetBusy(true);
\t\t\tsetMsg({
\t\t\t\tkind: "",
\t\t\t\ttext: ""
\t\t\t});
\t\t\ttry {
\t\t\t\tconst res = await fetch("/dsh-pet-7340/desktop/toggle", {
\t\t\t\t\tmethod: "POST",
\t\t\t\t\theaders: { "content-type": "application/json" },
\t\t\t\t\tbody: JSON.stringify({ enabled: v })
\t\t\t\t});
\t\t\t\tif (!res.ok) throw new Error("HTTP " + res.status);
\t\t\t\tsetDeskEnabled(v);
\t\t\t\tsetMsg({
\t\t\t\t\tkind: "ok",
\t\t\t\t\ttext: t(v ? "deskOn" : "deskOff")
\t\t\t\t});
\t\t\t} catch (e) {
\t\t\t\tsetMsg({
\t\t\t\t\tkind: "err",
\t\t\t\t\ttext: String(e && e.message ? e.message : e)
\t\t\t\t});
\t\t\t} finally {
\t\t\t\tsetBusy(false);
\t\t\t}
\t\t};
`;

function parseArgs(argv) {
  const out = {};
  for (const a of argv) {
    if (a === '--check') out.check = true;
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
const clientFile = join(pkg, 'lib', 'client.js');
if (!existsSync(clientFile)) {
  console.error(`找不到 ${clientFile}`);
  process.exit(2);
}

const source = readFileSync(clientFile, 'utf8');
const patched = source.includes(MARKER);

if (args.check) {
  console.log(`[check] lib/client.js 设置页开关: ${patched ? '已打' : '未打'}`);
  process.exit(patched ? 0 : 1);
}
if (patched) {
  console.error('[apply] 已经打过补丁了；要重打先跑 revert-settings-ui.mjs');
  process.exit(2);
}

const A_ZH = '\tconfineToggleHint: "多屏用户：甩出去的宠物只在松手时所在那块屏幕内弹（屏缝当墙，不飞到隔壁屏）；关掉则照常跨屏飞行。只影响桌面模式——浏览器 overlay 本来就只在视口内弹。",\n';
const A_EN = '\tconfineToggleHint: "Multi-monitor: a thrown pet bounces only inside the screen it was released on (screen seams act as walls, so it never flies to the neighbouring monitor); turn this off to let it cross screens as usual. Desktop only — the browser overlay always bounces inside the viewport anyway.",\n';
const A_STATE = '\t\tconst [confineScreen, setConfineScreen] = useState(false);\n';
const A_FETCH = '\t\t\tif (typeof m.confineToScreen === "boolean") setConfineScreen(m.confineToScreen);\n';
const A_TOGGLE = '\t\tconst toggleNotify = async (v) => {\n\t\t\tsetNotifyEnabled(v);\n\t\t\tif (v) await requestNotificationPermission();\n\t\t};\n';
const A_CELL = '\t\t\t\t\t\t\ttoggleCell("confineToggle", confineScreen, busy, setConfineScreen, true)';

for (const [name, anchor] of [['zh', A_ZH], ['en', A_EN], ['state', A_STATE], ['fetch', A_FETCH], ['toggle', A_TOGGLE], ['cell', A_CELL]]) {
  const hits = count(source, anchor);
  if (hits !== 1) {
    console.error(`[apply] 锚点 ${name} 命中 ${hits} 次（预期 1 次），停止`);
    process.exit(2);
  }
}

let next = source;
next = next.replace(A_ZH, A_ZH + ZH);
next = next.replace(A_EN, A_EN + EN);
next = next.replace(A_STATE, A_STATE + STATE);
next = next.replace(A_FETCH, A_FETCH + FETCH);
next = next.replace(A_TOGGLE, A_TOGGLE + TOGGLE);
next = next.replace(A_CELL, `${A_CELL},\n\t\t\t\t\t\t\ttoggleCell("deskToggle", deskEnabled, busy, (v) => void toggleDesk(v), true)`);

const stamp = new Date().toISOString().replace(/[:.]/g, '-');
const backupDir = join(home, 'dsh-pet', 'backups', `settings-ui-${stamp}`);
mkdirSync(backupDir, { recursive: true });
copyFileSync(clientFile, join(backupDir, 'client.js.orig'));
writeFileSync(join(backupDir, 'meta.json'), JSON.stringify({ createdAt: new Date().toISOString(), pkg, clientFile, marker: MARKER }, null, 2));
console.log(`[apply] 已备份到 ${backupDir}`);

try {
  writeFileSync(clientFile, next, 'utf8');
  const check = spawnSync(process.execPath, ['--check', clientFile], { encoding: 'utf8' });
  if (check.status !== 0) throw new Error(`node --check 失败：\n${check.stderr || check.stdout}`);
  console.log('[apply] node --check 通过');
} catch (e) {
  console.error(`[apply] ${e instanceof Error ? e.message : String(e)}`);
  copyFileSync(join(backupDir, 'client.js.orig'), clientFile);
  console.error('[apply] 已回滚');
  process.exit(1);
}

console.log(`
[apply] 完成。刷新页面（Cmd+R）后：DSH 设置 → 桌宠配置 → 全局，多出「桌面图标互动」开关。
  开关立即生效（POST /desktop/toggle），不需要点保存。
  回滚：node settings-ui/revert-settings-ui.mjs
`);
