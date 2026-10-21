	/* dsh-pet-custom:desktop —— 桌面图标互动（自定义补丁）
	 * 能力边界（硬约束）：**只调用 Finder 的 set position**，不改名、不移动文件、不删除、不写文件内容。
	 * 唯一副作用是图标在桌面上的坐标（.DS_Store 里的排布），文件本身原样不动。 */
	const DESK_LIST_SCRIPT = `on run argv
	set sep to (ASCII character 31)
	set out to ""
	tell application "Finder"
		set theItems to every item of desktop
		set theCount to count of theItems
		set out to "COUNT" & sep & theCount & linefeed
		repeat with i from 1 to theCount
			set itm to item i of theItems
			set nm to "?"
			set posTxt to "?"
			set diskTxt to "0"
			try
				set nm to (name of itm) as text
			end try
			try
				set p to position of itm
				set posTxt to (((item 1 of p) as integer) as text) & "," & (((item 2 of p) as integer) as text)
			end try
			try
				if class of itm is disk then set diskTxt to "1"
			end try
			set out to out & nm & sep & posTxt & sep & diskTxt & linefeed
		end repeat
	end tell
	return out
end run`;
	const DESK_BOUNDS_SCRIPT = `on run argv
	tell application "Finder" to get bounds of window of desktop
end run`;
	const DESK_MOVE_SCRIPT = `on run argv
	set nm to (item 1 of argv)
	set nx to (item 2 of argv) as integer
	set ny to (item 3 of argv) as integer
	tell application "Finder"
		set itm to item nm of desktop
		set position of itm to {nx, ny}
		delay 0.15
		set p to position of itm
	end tell
	return ((item 1 of p) as text) & "," & ((item 2 of p) as text)
end run`;
	/** 最近一次挪动每个图标的时间（同进程内节流，避免逮着一只图标反复挪） */
	const deskLastMoved = new Map();
	/** 权限失败只提醒一次，避免每个周期都弹同一句 */
	let deskPermWarned = false;
	/** 进行中的「抱图标」会话：id → {name, from, to, at}（grab 请求据此启动图标的同步位移） */
	const deskCarrySessions = new Map();
	const DESK_STATE_FILE = () => join(userRoot, "desktop-interaction.json");
	const deskReadState = () => {
		try {
			const raw = JSON.parse(readFileSync(DESK_STATE_FILE(), "utf8"));
			return raw && typeof raw === "object" ? raw : {};
		} catch {
			return {};
		}
	};
	const deskWriteState = (patch) => {
		try {
			const next = Object.assign({}, deskReadState(), patch);
			writeFileSync(DESK_STATE_FILE(), JSON.stringify(next, null, 2), "utf8");
			return true;
		} catch (e) {
			console.warn("[dsh-pet] 桌面互动开关写入失败：" + (e instanceof Error ? e.message : String(e)));
			return false;
		}
	};
	/** main 条目 desktopInteraction 的读取与兜底（/desk 的开关文件优先于配置） */
	const deskSettings = (cfg) => {
		const raw = cfg.main?.desktopInteraction;
		const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
		const num = (v, def, lo, hi) => {
			const n = Number(v);
			return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
		};
		const st = deskReadState();
		const minMinutes = num(st.minMinutes ?? o.minMinutes, 25, 5, 1440);
		const maxMinutes = num(st.maxMinutes ?? o.maxMinutes, 50, 5, 1440);
		const quietSource = Array.isArray(st.quietHours) && st.quietHours.length === 2 ? st.quietHours : o.quietHours;
		const rawQuiet = Array.isArray(quietSource) && quietSource.length === 2 ? quietSource.map(Number) : [0, 8];
		const quietHours = rawQuiet.every((n) => Number.isFinite(n) && n >= 0 && n <= 24) ? rawQuiet : [0, 8];
		return {
			enabled: typeof st.enabled === "boolean" ? st.enabled : o.enabled === true,
			minMinutes: Math.min(minMinutes, maxMinutes),
			maxMinutes: Math.max(minMinutes, maxMinutes),
			quietHours
		};
	};
	const deskInQuiet = (quietHours, hour) => {
		const a = quietHours[0];
		const b = quietHours[1];
		if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
		return a < b ? hour >= a && hour < b : hour >= a || hour < b;
	};
	const deskErrorText = (r) => {
		if (r.reason === "no-automation") {
			return "还没拿到 Finder 权限：系统设置 → 隐私与安全性 → 自动化 → 允许 DeepSeek Harness 控制「Finder」";
		}
		if (r.reason === "timeout") return "Finder 没响应（脚本超时）";
		return r.message || "Finder 脚本执行失败";
	};
	/** 跑一段 AppleScript（参数走 argv，绝不拼字符串——图标名里带引号也安全） */
	const deskOsascript = (script, args = [], timeoutMs = 8000) => new Promise((resolve) => {
		let child;
		let settled = false;
		const done = (value) => {
			if (settled) return;
			settled = true;
			resolve(value);
		};
		try {
			child = spawn("osascript", ["-e", script, "--", ...args], { stdio: ["ignore", "pipe", "pipe"] });
		} catch (e) {
			done({ ok: false, reason: "spawn-error", message: e instanceof Error ? e.message : String(e) });
			return;
		}
		let out = "";
		let err = "";
		const timer = setTimeout(() => {
			try {
				child.kill("SIGKILL");
			} catch {}
			done({ ok: false, reason: "timeout", message: "osascript timeout" });
		}, timeoutMs);
		child.stdout.on("data", (b) => {
			out += b;
		});
		child.stderr.on("data", (b) => {
			err += b;
		});
		child.on("error", (e) => {
			clearTimeout(timer);
			done({ ok: false, reason: "spawn-error", message: e.message });
		});
		child.on("close", (code) => {
			clearTimeout(timer);
			if (code === 0) return done({ ok: true, out: out.trim() });
			const reason = /-1743|-10004|Not authorized|not allowed|权限违例|未获授权/i.test(err) ? "no-automation" : "osascript-error";
			done({ ok: false, reason, message: (err || out).trim() });
		});
	});
	/** 列出桌面图标（含坐标与是否宗卷）——只读 */
	const deskListIcons = async () => {
		const r = await deskOsascript(DESK_LIST_SCRIPT, [], 15000);
		if (!r.ok) return r;
		const lines = String(r.out).split("\n").filter(Boolean);
		let count = -1;
		const icons = [];
		const bad = [];
		for (const line of lines) {
			const parts = line.split("\x1f");
			if (parts[0] === "COUNT") {
				count = Number(parts[1]);
				continue;
			}
			const name = parts[0];
			const pos = parts[1];
			const disk = parts[2] === "1";
			if (!name || !pos || pos === "?") {
				bad.push(name || "?");
				continue;
			}
			const xy = pos.split(",");
			const x = Number(xy[0]);
			const y = Number(xy[1]);
			if (!Number.isFinite(x) || !Number.isFinite(y)) {
				bad.push(name);
				continue;
			}
			icons.push({ name, x, y, isDisk: disk });
		}
		if (icons.length === 0) {
			try {
				writeFileSync(join(userRoot, "desktop-debug.log"), new Date().toISOString() + "\n" + String(r.out) + "\n--- stderr ---\n", "utf8");
			} catch {}
		}
		return { ok: true, icons, count: count >= 0 ? count : icons.length, bad, raw: String(r.out) };
	};
	/** 只改坐标（set position），并读回确认真的生效（桌面若开着「排序方式」，Finder 会把它排回去） */
	const deskMoveIcon = async (name, x, y) => {
		const r = await deskOsascript(DESK_MOVE_SCRIPT, [name, String(Math.round(x)), String(Math.round(y))], 10000);
		if (!r.ok) return r;
		const m = /^(-?\d+),(-?\d+)$/.exec(String(r.out));
		if (!m) return { ok: false, reason: "bad-output", message: String(r.out) };
		return { ok: true, x: Number(m[1]), y: Number(m[2]) };
	};
	const deskBounds = async () => {
		const r = await deskOsascript(DESK_BOUNDS_SCRIPT, [], 5000);
		if (r.ok) {
			const nums = (String(r.out).match(/-?\d+/g) ?? []).map(Number);
			if (nums.length >= 4 && nums[2] > nums[0] && nums[3] > nums[1]) {
				return { left: nums[0], top: nums[1], right: nums[2], bottom: nums[3] };
			}
		}
		return { left: 0, top: 0, right: 1440, bottom: 900 };
	};
	/** 在一个安全区域内挑空位：避开菜单栏 / Dock / 四边，并尽量不压到别的图标 */
	const deskPickTarget = (icons, bounds, self) => {
		// 目标限制在图标附近（同屏、肉眼可见），避免搬到另一块显示器后"看起来没动"
		const left = Math.max(bounds.left + 40, self.x - 420);
		const right = Math.min(bounds.right - 160, self.x + 420);
		const top = Math.max(bounds.top + 70, self.y - 260);
		const bottom = Math.min(bounds.bottom - 180, self.y + 260);
		if (right <= left || bottom <= top) return null;
		for (let i = 0; i < 16; i += 1) {
			const x = Math.round(left + Math.random() * (right - left));
			const y = Math.round(top + Math.random() * (bottom - top));
			const clash = icons.some((ic) => ic.name !== self.name && Math.abs(ic.x - x) < 110 && Math.abs(ic.y - y) < 95);
			if (!clash) return { x, y };
		}
		return null;
	};
	/** 图标跟手脚本：把图标从 from 沿直线分 steps 步移到 to，步间 delay 秒——与宠物走路同步。
	 *  仍然只调用 set position（不删、不改名、不移动文件）。 */
	const DESK_CARRY_SCRIPT = `on run argv
	set nm to (item 1 of argv)
	set x0 to (item 2 of argv) as integer
	set y0 to (item 3 of argv) as integer
	set x1 to (item 4 of argv) as integer
	set y1 to (item 5 of argv) as integer
	set steps to (item 6 of argv) as integer
	set stepDelay to (item 7 of argv) as real
	tell application "Finder"
		set itm to item nm of desktop
		repeat with i from 1 to steps
			set t to i / steps
			set nx to (round (x0 + (x1 - x0) * t)) as integer
			set ny to (round (y0 + (y1 - y0) * t)) as integer
			set position of itm to {nx, ny}
			delay stepDelay
		end repeat
	end tell
	return "ok"
end run`;
	/** 宠物走到图标旁、抱起后调用：按宠物步行的时长把图标沿直线搬过去 */
	const deskCarryGrab = async (id, durationSec, petX, petY) => {
		for (const [key, session] of deskCarrySessions) {
			if (Date.now() - session.at > 120000) deskCarrySessions.delete(key);
		}
		const session = deskCarrySessions.get(String(id));
		if (!session) return { ok: false, reason: "no-session" };
		deskCarrySessions.delete(String(id));
		// 渲染端把「抱起时宠物中心的屏幕坐标」带上来：图标第一步就贴到她手边，
		// 不从 Finder 里那个可能已经过期的旧坐标起跳（否则会先瞬移一下）。
		if (Number.isFinite(petX) && Number.isFinite(petY)) {
			session.from = { x: Math.round(petX) - 32, y: Math.round(petY) - 32 };
		}
		const duration = Math.max(0.6, Math.min(8, Number(durationSec) || 3));
		// ~24 步/秒，扣掉每次 set position 的固有开销（~16ms），让图标跟手而不是一格一格跳
		const steps = Math.max(12, Math.min(90, Math.round(duration * 24)));
		const stepDelay = Math.max(0.006, duration / steps - 0.016);
		// 不 await：脚本要跑 duration 秒，而宠物这边要立刻开始同步步行（返回太晚就不同步了）
		deskOsascript(
			DESK_CARRY_SCRIPT,
			[session.name, String(Math.round(session.from.x)), String(Math.round(session.from.y)), String(Math.round(session.to.x)), String(Math.round(session.to.y)), String(steps), String(stepDelay)],
			Math.max(6000, duration * 1000 + 4000)
		).then((r) => {
			if (!r.ok) {
				console.warn("[dsh-pet] 搬图标失败：" + deskErrorText(r));
				if (session.petId) state.writePet(session.petId, "say", { text: "「" + session.name + "」搬不动：" + deskErrorText(r) });
			} else {
				deskLastMoved.set(session.name, Date.now());
			}
		}).catch(() => {});
		return { ok: true, name: session.name, to: session.to, duration };
	};
	/** 一次互动：挑一只图标 → 播个动作 + 说一句 → 挪到空位 → 读回确认。
	 *  manual = true 时忽略开关与免打扰（/desk now 与 POST /desktop/nudge 用）。 */
	const deskInteract = async (petId, manual = false) => {
		const cfg = readAllConfig(configPaths);
		const s = deskSettings(cfg);
		if (!manual && !s.enabled) return { ok: false, reason: "disabled" };
		if (!manual && deskInQuiet(s.quietHours, (/* @__PURE__ */ new Date()).getHours())) return { ok: false, reason: "quiet-hours" };
		const listed = await deskListIcons();
		if (!listed.ok) {
			const permIssue = listed.reason === "no-automation";
			if (permIssue && deskPermWarned) return listed;
			if (permIssue) deskPermWarned = true;
			state.writePet(petId, "say", {
				text: permIssue ? "……本鱼想碰桌面，但没拿到 Finder 权限（系统设置 → 隐私与安全性 → 自动化）。" : "……本鱼碰不到桌面：" + deskErrorText(listed)
			});
			return listed;
		}
		// Finder 对「自动排列 / 从未拖动过」的图标返回 (-1,-1)：没有真实坐标，
		// 用它当起点会让宠物跑到屏幕角落、图标位置也对不上——这类图标不参与搬运。
		const icons = listed.icons.filter((ic) => !ic.isDisk && !(ic.x === -1 && ic.y === -1));
		if (icons.length === 0) {
			const total = Number(listed.count) || 0;
			state.writePet(petId, "say", {
				text:
					total > 0
						? "Finder 说桌面有 " + total + " 个图标，但都没给坐标（桌面大概开着「排序方式」），本鱼不知道该往哪走。"
						: "桌面上一个图标都没有，本鱼没得碰。"
			});
			return { ok: false, reason: "no-positions", count: listed.count, bad: listed.bad };
		}
		const now = Date.now();
		// 优先主屏（x >= 0）上的图标：左/上副屏会是负坐标，搬过去在主屏上根本看不见
		const primary = icons.filter((ic) => ic.x >= 0);
		const basePool = primary.length ? primary : icons;
		const cooled = basePool.filter((ic) => now - (deskLastMoved.get(ic.name) ?? 0) > 20 * 60000);
		const pool = cooled.length ? cooled : basePool;
		const target = pool[Math.floor(Math.random() * pool.length)];
		const bounds = await deskBounds();
		const spot = deskPickTarget(icons, bounds, target);
		if (!spot) return { ok: false, reason: "no-space" };
		const found = findPetInstance(cfg, petId);
		const anims = found?.conf?.animations ?? cfg.main?.animations;
		const lift = anims?.clicks?.[0] ?? anims?.idle?.[0];
		const taDa = anims?.categories?.[0]?.actions?.[0] ?? anims?.idle?.[0];
		// 桌面形态：交给渲染端演「走过去 → 抱起 → 一步步搬过去」，图标由 grab 端点同步移动
		if (found?.pet?.display === "desktop") {
			const id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
			deskCarrySessions.set(id, { name: target.name, from: { x: target.x, y: target.y }, to: spot, at: Date.now(), petId });
			state.writePet(petId, "say", { text: "本鱼把「" + target.name + "」搬过去。" });
			state.writePet(petId, "anim", { name: "@carry:" + JSON.stringify({ id, name: target.name, from: { x: target.x, y: target.y }, to: spot }) });
			return { ok: true, mode: "carry", name: target.name, from: { x: target.x, y: target.y }, to: spot };
		}
		// 浏览器形态没有「抱着走」的渲染端：退化为瞬间挪位（行为与旧版一致）
		if (lift) state.writePet(petId, "anim", { name: lift });
		state.writePet(petId, "say", { text: "本鱼把「" + target.name + "」挪个位置。" });
		const moved = await deskMoveIcon(target.name, spot.x, spot.y);
		if (!moved.ok) {
			if (!(moved.reason === "no-automation" && deskPermWarned)) {
				if (moved.reason === "no-automation") deskPermWarned = true;
				state.writePet(petId, "say", { text: "「" + target.name + "」挪不动：" + deskErrorText(moved) });
			}
			return moved;
		}
		const drift = Math.abs(moved.x - spot.x) + Math.abs(moved.y - spot.y);
		if (drift > 6) {
			state.writePet(petId, "say", { text: "挪不动「" + target.name + "」：桌面开着「排序方式」，Finder 会把它排回去。" });
			return { ok: false, reason: "sorted", wanted: spot, actual: { x: moved.x, y: moved.y } };
		}
		deskLastMoved.set(target.name, Date.now());
		if (taDa) state.writePet(petId, "anim", { name: taDa });
		state.writePet(petId, "say", { text: "放这儿了，不许说本鱼多管闲事。" });
		return { ok: true, name: target.name, from: { x: target.x, y: target.y }, to: { x: moved.x, y: moved.y } };
	};
	/** /desk 与 /desktop/state 共用的体检文案：开关、权限、图标数 */
	const deskStatus = async (cfg) => {
		const s = deskSettings(cfg);
		const listed = await deskListIcons();
		const movable = listed.ok ? listed.icons.filter((ic) => !ic.isDisk && !(ic.x === -1 && ic.y === -1)).length : 0;
		const perm = listed.ok
			? "Finder 权限正常，可搬运图标 " + movable + "/" + (Number(listed.count) || listed.icons.length) + "（其余没有坐标）"
			: "权限/脚本问题：" + deskErrorText(listed);
		return { enabled: s.enabled, minMinutes: s.minMinutes, maxMinutes: s.maxMinutes, quietHours: s.quietHours, permission: listed.ok, detail: perm };
	};
