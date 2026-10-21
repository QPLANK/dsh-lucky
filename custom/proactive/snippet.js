	/* dsh-pet-custom:proactive —— 主动搭话（自定义补丁；插件重装后需重新 apply） */
	const DEFAULT_PROACTIVE_PROMPT = "现在没有人在跟你说话。你忽然想找主人搭句话：可以问他忙完没、提醒他喝水，或者嘴硬地抱怨一句。只说你要说的那一句话，不要解释你在做什么。";
	/** 用户层覆盖文件：/proactive/settings 与设置框写这里（开关/间隔/免打扰），优先于配置默认值 */
	const PROACTIVE_STATE_FILE = () => join(userRoot, "proactive-settings.json");
	const proactiveReadState = () => {
		try {
			const raw = JSON.parse(readFileSync(PROACTIVE_STATE_FILE(), "utf8"));
			return raw && typeof raw === "object" ? raw : {};
		} catch {
			return {};
		}
	};
	const proactiveWriteState = (patch) => {
		try {
			const next = Object.assign({}, proactiveReadState(), patch);
			writeFileSync(PROACTIVE_STATE_FILE(), JSON.stringify(next, null, 2), "utf8");
			return true;
		} catch (e) {
			console.warn("[dsh-pet] 主动搭话设置写入失败：" + (e instanceof Error ? e.message : String(e)));
			return false;
		}
	};
	/** main 条目顶层 proactive 的读取与兜底（非法值逐项回默认，绝不 throw）；用户覆盖文件优先 */
	const proactiveSettings = (cfg) => {
		const raw = cfg.main?.proactive;
		const o = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
		const st = proactiveReadState();
		const num = (v, def, lo, hi) => {
			const n = Number(v);
			return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
		};
		const minMinutes = num(st.minMinutes ?? o.minMinutes, 30, 5, 1440);
		const maxMinutes = num(st.maxMinutes ?? o.maxMinutes, 70, 5, 1440);
		const quietSource = Array.isArray(st.quietHours) && st.quietHours.length === 2 ? st.quietHours : o.quietHours;
		const rawQuiet = Array.isArray(quietSource) && quietSource.length === 2 ? quietSource.map(Number) : [0, 8];
		const quietHours = rawQuiet.every((n) => Number.isFinite(n) && n >= 0 && n <= 24) ? rawQuiet : [0, 8];
		return {
			enabled: typeof st.enabled === "boolean" ? st.enabled : o.enabled === true,
			minMinutes: Math.min(minMinutes, maxMinutes),
			maxMinutes: Math.max(minMinutes, maxMinutes),
			quietHours,
			prompt: typeof o.prompt === "string" && o.prompt.trim() ? o.prompt.trim() : DEFAULT_PROACTIVE_PROMPT
		};
	};
	/** 免打扰时段：支持跨天（如 [23, 9]）；起止相同 = 不启用 */
	const inQuietHours = (quietHours, hour) => {
		const a = quietHours[0];
		const b = quietHours[1];
		if (!Number.isFinite(a) || !Number.isFinite(b) || a === b) return false;
		return a < b ? hour >= a && hour < b : hour >= a || hour < b;
	};
	/** 设置框用：读当前生效值 */
	const proactiveSettingsView = (cfg) => {
		const s = proactiveSettings(cfg);
		return { enabled: s.enabled, minMinutes: s.minMinutes, maxMinutes: s.maxMinutes, quietHours: s.quietHours };
	};
	/** 主动搭话：用**对话**链路（同一份人设 + 同一份记忆 + 同一套配图）生成一句，
	 *  只把 assistant 那条写进 memory.json（不伪造 user 消息），再写 S 的 pets.<id>.say。
	 *  与 chatWithPet 的区别：用户没说话，所以 user 侧用 proactive.prompt 当"起话头"的指令。 */
	const proactiveChat = async (petId) => withMemoryLock(async () => {
		const cfg = readAllConfig(configPaths);
		const s = proactiveSettings(cfg);
		const found = findPetInstance(cfg, petId);
		const conf = (found ?? { conf: cfg.main ?? {} }).conf;
		const system = petSystemPrompt(petId, cfg);
		const pool = conf.chatImageEnabled === true ? limitPool(readMemePool(conf.memes, memeDirsFor(found?.entry ?? "main")), Number(conf.chatImageLimit)) : [];
		const mem = await readMemory();
		const bucketKey = found?.entry ?? petId;
		const bucket = mem[bucketKey] ?? (mem[bucketKey] = {});
		const entry = bucket[petId] ?? (bucket[petId] = { messages: [] });
		const list = sliceMemoryRounds(entry.messages, memoryRounds(petId, cfg));
		const generated = await generateChat(ctx, system, list, s.prompt, pool, configuredModel(conf, "chatModel"));
		if (!generated.ok) {
			console.warn("[dsh-pet] 主动搭话生成失败 pet=" + petId + " reason=" + generated.reason + (generated.message ? " " + generated.message : ""));
			return false;
		}
		entry.messages.push({
			role: "assistant",
			content: generated.text,
			ts: Date.now()
		});
		await writeMemory(mem);
		state.writePet(petId, "say", generated.image ? {
			text: generated.text,
			image: generated.image
		} : { text: generated.text });
		return true;
	});
