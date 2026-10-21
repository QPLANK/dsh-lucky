	/* dsh-pet-custom:memory —— 长期画像（本地记忆，第三层） */
	const PROFILE_FILE = () => join(userRoot, "profile.json");
	const EPISODES_FILE = () => join(userRoot, "episodes.json");
	const PROFILE_SENSITIVE = /(密码|口令|身份证|银行卡|信用卡|手机号|电话号码|家庭住址|住址|护照号|病例|诊断|处方|药名)/;
	const PROFILE_KINDS = new Set(["preference", "trait", "fact", "boundary", "goal"]);
	const profileUpdating = new Set();

	const profileSettings = (cfg) => {
		const o = cfg.main?.memoryProfile;
		const raw = o && typeof o === "object" && !Array.isArray(o) ? o : {};
		const num = (v, def, lo, hi) => {
			const n = Number(v);
			return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : def;
		};
		return {
			enabled: raw.enabled !== false,
			updateEveryTurns: num(raw.updateEveryTurns, 3, 1, 20),
			maxFacts: num(raw.maxFacts, 200, 10, 1000),
			summaryMaxChars: num(raw.summaryMaxChars, 600, 100, 2000),
			injectInWhisper: raw.injectInWhisper === true,
			retrieveFacts: num(raw.retrieveFacts, 5, 0, 12),
			decayAfterDays: num(raw.decayAfterDays, 30, 7, 365),
			decayPerDay: num(raw.decayPerDay, 0.005, 0, 0.05),
			minConfidence: num(raw.minConfidence, 0.25, 0.05, 0.9),
			maxEpisodes: num(raw.maxEpisodes, 100, 10, 1000),
			retrieveEpisodes: num(raw.retrieveEpisodes, 2, 0, 8)
		};
	};

	const emptyProfile = () => ({ version: 1, updatedAt: 0, lastExtractedTs: 0, summary: "", facts: [], archived: [] });

	const readProfileFile = () => {
		try {
			const raw = JSON.parse(readFileSync(PROFILE_FILE(), "utf8"));
			if (!raw || typeof raw !== "object") return emptyProfile();
			return {
				version: 1,
				updatedAt: Number(raw.updatedAt) || 0,
				lastExtractedTs: Number(raw.lastExtractedTs) || 0,
				summary: typeof raw.summary === "string" ? raw.summary : "",
				facts: Array.isArray(raw.facts) ? raw.facts.filter((f) => f && typeof f.text === "string" && f.id) : [],
				archived: Array.isArray(raw.archived) ? raw.archived : []
			};
		} catch {
			return emptyProfile();
		}
	};

	const writeProfileFile = (profile) => {
		try {
			mkdirSync(userRoot, { recursive: true });
			writeFileSync(PROFILE_FILE(), JSON.stringify(profile, null, 2), "utf8");
			return true;
		} catch (e) {
			console.warn("[dsh-pet] 画像写入失败：" + (e instanceof Error ? e.message : String(e)));
			return false;
		}
	};

	const clearProfile = () => {
		try {
			if (existsSync(PROFILE_FILE())) {
				renameSync(PROFILE_FILE(), PROFILE_FILE() + ".bak-" + Date.now());
			}
			if (existsSync(EPISODES_FILE())) {
				renameSync(EPISODES_FILE(), EPISODES_FILE() + ".bak-" + Date.now());
			}
		} catch {}
		writeProfileFile(emptyProfile());
		writeEpisodesFile([]);
	};

	const readEpisodesFile = () => {
		try {
			const raw = JSON.parse(readFileSync(EPISODES_FILE(), "utf8"));
			if (!Array.isArray(raw)) return [];
			return raw.filter((e) => e && typeof e.summary === "string" && e.summary.trim());
		} catch {
			return [];
		}
	};

	const writeEpisodesFile = (list) => {
		try {
			mkdirSync(userRoot, { recursive: true });
			writeFileSync(EPISODES_FILE(), JSON.stringify(list, null, 2), "utf8");
			return true;
		} catch (e) {
			console.warn("[dsh-pet] 情节记忆写入失败：" + (e instanceof Error ? e.message : String(e)));
			return false;
		}
	};

	const mergeEpisodes = (existing, delta, settings) => {
		const now = Date.now();
		const list = Array.isArray(existing) ? existing.slice() : [];
		for (const e of Array.isArray(delta.episodes) ? delta.episodes : []) {
			if (!e || typeof e !== "object" || typeof e.summary !== "string") continue;
			const summary = e.summary.trim().slice(0, 200);
			if (!summary) continue;
			const tags = Array.isArray(e.tags) ? e.tags.filter((t) => typeof t === "string" && t.trim()).map((t) => t.trim().slice(0, 16)).slice(0, 5) : [];
			const dup = list.find((x) => profileSimilarity(x.summary, summary) > 0.7);
			if (dup) {
				if (summary.length > dup.summary.length) dup.summary = summary;
				dup.tags = Array.from(new Set([...(Array.isArray(dup.tags) ? dup.tags : []), ...tags])).slice(0, 6);
				dup.updatedAt = now;
				continue;
			}
			list.push({
				id: "e_" + now.toString(36) + Math.random().toString(36).slice(2, 5),
				date: new Date(now).toISOString().slice(0, 10),
				summary,
				tags,
				createdAt: now
			});
		}
		if (list.length > settings.maxEpisodes) list.splice(0, list.length - settings.maxEpisodes);
		return list;
	};

	const episodeRetrieve = (cfg, query, limit) => {
		if (!query || limit <= 0) return [];
		const list = readEpisodesFile();
		return list
			.map((e) => {
				let score = profileQueryScore(query, e.summary);
				for (const t of Array.isArray(e.tags) ? e.tags : []) {
					score = Math.max(score, profileQueryScore(query, t) * 0.9);
				}
				return { e, score };
			})
			.filter((x) => x.score >= 0.3)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((x) => x.e);
	};

	const profileNormalize = (s) =>
		String(s || "")
			.replace(/\s+/g, "")
			.replace(/[，。！？、；：""''（）()\[\]【】…—\-·,\.!\?;:]/g, "")
			.toLowerCase();

	const profileBigrams = (s) => {
		const set = new Set();
		for (let i = 0; i + 1 < s.length; i += 1) set.add(s.slice(i, i + 2));
		return set;
	};

	const profileSubsequence = (shortText, longText) => {
		let i = 0;
		for (let j = 0; j < longText.length && i < shortText.length; j += 1) {
			if (shortText[i] === longText[j]) i += 1;
		}
		return i === shortText.length;
	};

	const profileSimilarity = (a, b) => {
		const x = profileNormalize(a);
		const y = profileNormalize(b);
		if (!x || !y) return 0;
		if (x === y) return 1;
		if (x.includes(y) || y.includes(x)) return 0.85;
		// 「喜欢冰美式」vs「喜欢喝冰美式」：短的是长的子序列，且长度接近 → 视为同一条
		const shortText = x.length <= y.length ? x : y;
		const longText = x.length <= y.length ? y : x;
		if (shortText.length >= 3 && shortText.length / longText.length >= 0.7 && profileSubsequence(shortText, longText)) return 0.8;
		const A = profileBigrams(x);
		const B = profileBigrams(y);
		if (!A.size || !B.size) return 0;
		let hit = 0;
		for (const g of A) if (B.has(g)) hit += 1;
		return hit / (A.size + B.size - hit);
	};

	const profileClamp01 = (n) => Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0.6));

	const profileParseJson = (text) => {
		if (typeof text !== "string") return null;
		let s = text.trim();
		s = s.replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
		const start = s.indexOf("{");
		const end = s.lastIndexOf("}");
		if (start === -1 || end <= start) return null;
		try {
			const obj = JSON.parse(s.slice(start, end + 1));
			return obj && typeof obj === "object" && !Array.isArray(obj) ? obj : null;
		} catch {
			return null;
		}
	};

	/** 把模型吐出的 delta 合并进画像：去重 / 敏感过滤 / 冲突更新 / 上限淘汰 */
	const mergeProfileDelta = (profile, delta, settings) => {
		const now = Date.now();
		const base = profile && typeof profile === "object" ? profile : emptyProfile();
		const archived = Array.isArray(base.archived) ? base.archived.slice(-200) : [];
		const byId = new Map();
		for (const f of Array.isArray(base.facts) ? base.facts : []) {
			if (!f || !f.id || typeof f.text !== "string") continue;
			const item = Object.assign({}, f);
			// Phase 2：长期没被命中的事实慢慢降置信度，低于阈值归档
			const idleDays = (now - (Number(item.lastSeen) || now)) / 86400000;
			if (idleDays > settings.decayAfterDays) {
				item.confidence = Math.max(0, (Number(item.confidence) || 0.6) - (idleDays - settings.decayAfterDays) * settings.decayPerDay);
				if (item.confidence < settings.minConfidence) {
					archived.push(Object.assign({}, item, { archivedAt: now, reason: "decay" }));
					continue;
				}
			}
			byId.set(String(item.id), item);
		}

		for (const id of Array.isArray(delta.archive) ? delta.archive : []) {
			const key = String(id || "");
			const f = byId.get(key);
			if (f) {
				archived.push(Object.assign({}, f, { archivedAt: now }));
				byId.delete(key);
			}
		}

		for (const u of Array.isArray(delta.update) ? delta.update : []) {
			const key = u && typeof u === "object" ? String(u.id || "") : "";
			const f = byId.get(key);
			if (!f) continue;
			if (typeof u.text === "string" && u.text.trim()) f.text = u.text.trim().slice(0, 120);
			f.confidence = profileClamp01(Number(u.confidence) || f.confidence || 0.6);
			f.lastSeen = now;
			f.hits = (Number(f.hits) || 1) + 1;
		}

		for (const a of Array.isArray(delta.add) ? delta.add : []) {
			if (!a || typeof a !== "object" || typeof a.text !== "string") continue;
			const text = a.text.trim().slice(0, 120);
			if (!text || PROFILE_SENSITIVE.test(text)) continue;
			const kind = PROFILE_KINDS.has(a.kind) ? a.kind : "fact";
			const confidence = profileClamp01(Number(a.confidence) || 0.6);
			let dup = null;
			for (const f of byId.values()) {
				if (profileSimilarity(f.text, text) > 0.7) {
					dup = f;
					break;
				}
			}
			if (dup) {
				dup.hits = (Number(dup.hits) || 1) + 1;
				dup.lastSeen = now;
				dup.confidence = Math.max(Number(dup.confidence) || 0.6, confidence);
				if (text.length > dup.text.length) dup.text = text;
				continue;
			}
			const fact = {
				id: "f_" + now.toString(36) + Math.random().toString(36).slice(2, 6),
				kind,
				text,
				confidence,
				firstSeen: now,
				lastSeen: now,
				hits: 1
			};
			byId.set(fact.id, fact);
		}

		let list = Array.from(byId.values());
		if (list.length > settings.maxFacts) {
			list.sort((a, b) => (Number(b.confidence) || 0) + (Number(b.hits) || 0) * 0.05 - ((Number(a.confidence) || 0) + (Number(a.hits) || 0) * 0.05));
			const keep = list.slice(0, settings.maxFacts);
			const drop = list.slice(settings.maxFacts);
			for (const f of drop) archived.push(Object.assign({}, f, { archivedAt: now }));
			list = keep;
		}

		let summary = typeof delta.summary === "string" ? delta.summary.trim() : "";
		if (!summary) summary = base.summary || "";
		summary = summary.slice(0, settings.summaryMaxChars);

		return {
			version: 1,
			updatedAt: now,
			lastExtractedTs: Number(base.lastExtractedTs) || 0,
			summary,
			facts: list,
			archived: archived.slice(-200)
		};
	};

	/** 当前消息与事实的相关度：事实的 bigram 有多大比例出现在消息里 */
	const profileQueryScore = (query, text) => {
		const q = profileNormalize(query);
		const t = profileNormalize(text);
		if (!q || !t) return 0;
		if (q.includes(t)) return 1;
		const T = profileBigrams(t);
		const Q = profileBigrams(q);
		if (!T.size) return 0;
		let hit = 0;
		for (const g of T) if (Q.has(g)) hit += 1;
		return hit / T.size;
	};

	/** 按当前消息挑相关事实（Phase 2）：边界之外，最多 retrieveFacts 条 */
	const profileRetrieve = (cfg, query, limit) => {
		if (!query || limit <= 0) return [];
		const p = readProfileFile();
		return p.facts
			.filter((f) => f.kind !== "boundary")
			.map((f) => ({ f, score: profileQueryScore(query, f.text) }))
			.filter((x) => x.score >= 0.34)
			.sort((a, b) => b.score - a.score)
			.slice(0, limit)
			.map((x) => x.f);
	};

	/** 注入 system 的画像块：摘要 + 边界（雷区）+ 与当前消息相关的事实；碎碎念默认不带 */
	const profileBlock = (cfg, forWhisper, query) => {
		const s = profileSettings(cfg);
		if (!s.enabled) return "";
		if (forWhisper && !s.injectInWhisper) return "";
		const p = readProfileFile();
		const parts = [];
		if (p.summary) parts.push("【关于主人】" + p.summary.slice(0, s.summaryMaxChars));
		const boundaries = p.facts.filter((f) => f.kind === "boundary").slice(0, 6);
		if (boundaries.length) parts.push("【主人的边界】" + boundaries.map((f) => f.text).join("；"));
		const related = profileRetrieve(cfg, query, s.retrieveFacts);
		if (related.length) parts.push("【相关记忆】" + related.map((f) => "- " + f.text).join("\n"));
		const episodes = episodeRetrieve(cfg, query, s.retrieveEpisodes);
		if (episodes.length) parts.push("【你还记得】" + episodes.map((e) => "- " + e.date + "：" + e.summary).join("\n"));
		return parts.length ? "\n" + parts.join("\n") : "";
	};

	const PROFILE_EXTRACT_SYSTEM = [
		"你是「记忆整理器」，只负责把对话里长期稳定的用户信息合并进画像。",
		"规则：",
		"1) 只记录长期稳定的偏好、性格、客观事实、边界/雷区、目标；忽略一次性情绪、寒暄、临时状态。",
		"2) 不记录密码、证件号、银行卡、手机号、住址、健康诊断等敏感信息。",
		"3) 与已有 facts 重复的用 update（按 id）合并；冲突以新信息为准；明确过时的用 archive。",
		"4) 只输出一个 JSON 对象，不要 markdown、不要解释，格式：",
		'{"summary":"不超过 600 字的第三人称画像","add":[{"kind":"preference|trait|fact|boundary|goal","text":"...","confidence":0.8}],"update":[{"id":"f_x","text":"...","confidence":0.9}],"archive":["f_y"]}',
		"5) summary 用「主人/他」描述，不要复述具体聊天；没有可合并的信息就返回原 summary 与空数组。",
		"6) episodes：把这段时间发生过的、值得以后提起的事写成 0–2 条，每条 ≤80 字，带 1–3 个 tags；没有就返回空数组。",
		'最终格式：{"summary":"...","add":[],"update":[],"archive":[],"episodes":[{"summary":"...","tags":["..."]}]}'
	].join("\n");

	/** 一次对话后按「用户发言数」节流抽取；失败静默，绝不阻塞聊天 */
	const updateProfileAfterChat = async (petId) => {
		if (profileUpdating.has(petId)) return;
		profileUpdating.add(petId);
		try {
			const cfg = readAllConfig(configPaths);
			const s = profileSettings(cfg);
			if (!s.enabled) return;
			const profile = readProfileFile();
			const mem = await readMemory();
			const found = findPetInstance(cfg, petId);
			const bucketKey = found?.entry ?? petId;
			const messages = mem[bucketKey]?.[petId]?.messages ?? [];
			const lastTs = Number(profile.lastExtractedTs) || 0;
			const fresh = messages.filter((m) => Number(m.ts) > lastTs);
			const userTurns = fresh.filter((m) => m.role === "user").length;
			if (userTurns < s.updateEveryTurns) return;

			const recent = messages.slice(-12).map((m) => ({
				role: m.role,
				content: String(m.content || "").slice(0, 300)
			}));
			const payload = JSON.stringify({
				summary: profile.summary || "",
				facts: profile.facts.slice(-40).map((f) => ({ id: f.id, kind: f.kind, text: f.text })),
				messages: recent
			});
			const conf = (found ? found.conf : cfg.main) || {};
			const out = await generateChat(ctx, PROFILE_EXTRACT_SYSTEM, [], payload, [], configuredModel(conf, "chatModel"));
			if (!out.ok) return;
			const delta = profileParseJson(out.text);
			if (!delta) return;
			const next = mergeProfileDelta(profile, delta, s);
			const lastMessage = messages[messages.length - 1];
			next.lastExtractedTs = Number(lastMessage?.ts) || Date.now();
			writeProfileFile(next);
			if (Array.isArray(delta.episodes) && delta.episodes.length) {
				writeEpisodesFile(mergeEpisodes(readEpisodesFile(), delta, s));
			}
		} catch (e) {
			console.warn("[dsh-pet] 画像抽取失败：" + (e instanceof Error ? e.message : String(e)));
		} finally {
			profileUpdating.delete(petId);
		}
	};
