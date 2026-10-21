# 把 dsh-pet 变成「只属于你」的宠物

结论：**可以，而且不用改源码就能做到八成**。dsh-pet 把「像什么」和「怎么动」拆成了四层，
前三层都落在 `$DSH_HOME/dsh-pet/`（默认 `~/.dsh/dsh-pet/`），属于用户数据，**插件升级不会覆盖**；
只有第四层（改行为代码）需要 fork。

| 层 | 改什么 | 落在哪 | 升级会丢吗 | 门槛 |
| --- | --- | --- | --- | --- |
| L1 身份层 | 名字、人设、口癖、称呼、工作状态气泡、对话记忆轮数、拖拽手感（重力/弹性/摩擦） | `dsh-pet/main-config.jsonc` | 不会 | 5 分钟，本 kit 一键 |
| L2 外观层 | 自己的动画（`.webm`）、表情包（`.png`） | `dsh-pet/main-animation/webm/`、`dsh-pet/memes/` | 不会 | 要会出素材 |
| L3 新物种 | 独立动画池 + 独立素材 + 独立人设的「第二只/第三只宠物」 | `dsh-pet/pet/<前缀>-config.json` + `<前缀>-animation/` | 不会 | 本 kit 一条命令起骨架 |
| L4 行为层 | 物理、积分、菜单、气泡、新事件、「主动搭话」「桌面图标互动」 | fork 源码，或给已安装产物打补丁（`proactive/`、`desktop/`） | **会**（要锁版本/重打补丁） | 要会 TS/构建 |

---

## 快速开始（L1：先让它「像你养的」）

```bash
cd dsh-pet-custom
cp persona.example.json persona.json
$EDITOR persona.json                       # 改名字、性格、口癖、称呼、气泡文案

./apply.sh --url http://127.0.0.1:59776/dsh-pet-7340/config
```

`apply.sh` 做四件事，任何一步失败都不落盘：

1. 把现有 `main-config.jsonc` 备份到 `dsh-pet/backups/`；
2. 用 `persona.json` 编译出新的 `whisperPrompt` / `workStatusTexts` / `pets[].name`，其余字段（`memes`、`notificationsEnabled`、动画池……）**原样透传**；
3. **用 dsh-pet 自己的配置解析器**验收：宿主对非法字段是「告警 + 悄悄回退默认」，所以这里直接 import 插件的 `readAllConfig`，确认你的值真的进了成品，并检查配置里引用的每个动画名在素材目录里都存在（否则右键菜单有名字、点了 404）；
4. 可选 `--url`：写完立刻向运行中的实例拉一次 `GET /dsh-pet-7340/config` 复核，不一致就自动回滚。

生效：浏览器形态刷新页面；桌面形态右键宠物 →「重载配置」。

回滚：

```bash
./rollback.sh          # 退回到上一次 apply 之前，连续执行会一步步往前退
./rollback.sh --list   # 看所有备份
```

### persona.json 字段

| 字段 | 作用 |
| --- | --- |
| `targetId` | 改哪只宠物的显示名，默认 `main` |
| `name` | 显示名（悬浮提示、`/pet` 选择、人设里的自称来源） |
| `identity` | 一句话身份，会拼进人设第一句 |
| `selfName` / `callUser` | 自称 / 称呼你 |
| `traits` | 性格列表，拼成「性格：……」 |
| `speech` | 说话方式（口头语、语气、要不要 emoji） |
| `catchphrases` | 口头禅（提示词里明确「别每句都用」，避免复读） |
| `selfTalkTopics` | 碎碎念话题池 |
| `chatStyle` | 对话风格（长度、接话方式、不知道时怎么办） |
| `taboos` | 禁忌（不许撒娇、不许自称 AI……） |
| `promptExtra` | 任意补充设定 |
| `workStatusTexts` | 6 档工作气泡：思考 / 干活 / 整理 / 等确认 / 完成 / 出错 |
| `chatMemoryRounds` | 每次对话带多少轮历史（默认 5，调大更连贯也更费 token） |
| `physics` | `normal` / `float`（无重力漂浮）/ `ice`（落地打滑）/ 自定义对象 |

> 人设提示词是**碎碎念和对话共用**的（这是插件设计），所以别写「只会说 20 字」这类硬限制——
> 碎碎念的 20 字限制由插件自己的 user 消息兜着。

---

## L1.5 表情包（让它用你的梗）

```bash
mkdir -p ~/.dsh/dsh-pet/memes
cp 你的图.png ~/.dsh/dsh-pet/memes/加班.png
```

然后在 `main-config.jsonc` 顶层的 `memes` 里加一条（**键 = 文件名去掉 .png**，值 = 给模型看的描述）：

```jsonc
"memes": {
  "加班": "趴在键盘上装死，适合吐槽加班、deadline、被榨干"
}
```

碎碎念会随机抽一张、对话会按语境挑一张。只删配置键不删图也能停用。

---

## L2 自己的动画

- 格式：**VP9-Alpha 的 `.webm`**（Chrome/Edge/Firefox 与桌面 Electron 通用，透明底）；
  macOS Safari/WKWebView 不认 webm alpha，要改用 `.mov`（见插件 README「macOS 使用 mov」）。
- 放主宠物：`~/.dsh/dsh-pet/main-animation/webm/我的动作.webm`（**必须放在 `webm/` 子目录**）。
- 让配置认识它：在 `main-config.jsonc` 的 `animations` 池里写 `"我的动作"`（名字 = 文件名去扩展名）。
- 规范：640×360、人物脚底线对齐（宠物永远站在"地面"上）、首尾姿势尽量对齐（切换才不跳）。
- 自查：`node validate-config.mjs --config ~/.dsh/dsh-pet/main-config.jsonc` 会列出所有找不到的动画。

> 想从零画：插件作者用「AI 提示词 → 绿幕视频 → 透明动画」的流水线（豆包生成），
> 理论上任何能出「绿幕 + 固定机位 + 单一动作」的视频工具都能接。

---

## L3 第二只宠物（pet pack，和主宠物完全隔离）

```bash
node pet-pack/new-species.mjs salt "海盐"
#   --link   软链包内 97 段动画当占位（省 52MB，macOS/Linux）
#   不加     复制一份（52MB，Windows 用这个）
#   --persona persona.json   给它单独的人设
```

产出：

```
~/.dsh/dsh-pet/pet/
├─ salt-config.json          # 独立动画池 + 独立人设 + 独立实例列表
└─ salt-animation/           # 只查这个目录，绝不回落到主宠物素材
```

之后把 `salt-animation/` 里的 webm 换成你自己的画（同名替换即可），或在 `salt-config.json`
的 `animations` 里增删动作名。刷新页面就出现第二只。

规则（踩坑点）：

- 动画池、素材、表情包（`salt-memes/`）都是这个种类独占，**不回落**；
- `animations` / `animationWeights` 必须整段合法（`balance` 档位至少一项）；
- 实例 `id` 全局唯一，`display` 必填（`web` / `desktop` / `both` / `none`）；
- 设置页不会列出文件宠物——改文件即生效，也不会被设置页保存覆盖。

---

## L4 改行为（fork）

改物理手感、点击积分、右键菜单、新事件动画这类，只能改源码：

```bash
git clone https://github.com/PC2005-cloud/dsh-pet.git
cd dsh-pet && npm install && npm run build
```

可改的热点：`src/shared/physics.ts`（拖拽/抛掷）、`src/shared/score.ts`（点击积分）、
`src/shared/menu.ts`（右键菜单）、`src/host/whisper.ts` / `chat.ts`（提示词与生成流程）。

装回去的两种方式：

1. **推荐**：把 `~/.dsh/profiles/desktop/package.json` 里的 `"dsh-pet": "^0.3.7"` 改成
   `"dsh-pet": "file:/绝对路径/dsh-pet"`，在 profile 目录跑一次 `pnpm install`，重开桌面应用；
2. 临时验证：直接改 `~/.dsh/profiles/desktop/node_modules/dsh-pet/` 里的产物（`lib/client.js`、
   `runtime/electron-helper/shared-core.js`），**下次插件更新会被覆盖**，只适合试水。

> 注意：`desktop` profile 由桌面 App 独占管理，`dsh plugin --profile desktop add ...` 会被拒绝
> （报 "managed exclusively by the Electron application"），所以 fork 走上面两条路，不要指望 CLI。
> 这两条路在本机只验证了前半段（profile 的 `package.json` 依赖、node_modules 布局确实如此），
> 没实际替换过依赖——真要走 L4，先备份 profile 目录再动。

---

## 主动搭话（自定义补丁）

dsh-pet 原生的「碎碎念」是**单向独白**（不进对话记忆，你回它也不知道自己刚说过什么）。
`proactive/` 给已安装的插件打一个小补丁，加一条真正走**对话链路**的主动搭话：

- 每 30–70 分钟随机一次（可配），落在免打扰时段外才说话；
- 用同一份人设 + **同一份对话记忆** + 同一套配图/模型回落生成一句；
- 只把 assistant 那条写进 `memory.json`（**不伪造 user 消息**），然后走原有的 `say` 气泡链路；
- 你打开「对话」时能看到它说过的话，接着回就能续上上下文。

```bash
node proactive/apply-proactive.mjs --dry-run   # 先看会改哪三处
node proactive/apply-proactive.mjs             # 打补丁（自动备份 + node --check）
node proactive/test-snippet.mjs                # 离线验收插入的那段逻辑
node proactive/apply-proactive.mjs --check     # 看当前是否已打
```

改的是 `lib/index.js` 三处（插入函数 / 调度器 / `POST /proactive` 路由）和
`assets/config.jsonc` 的默认块；备份在 `$DSH_HOME/dsh-pet/backups/proactive-<时间戳>/`。

配置（`main-config.jsonc` 顶层）：

```jsonc
"proactive": {
  "enabled": true,
  "minMinutes": 30,      // 随机间隔下限
  "maxMinutes": 70,      // 上限
  "quietHours": [0, 8],  // 免打扰，支持跨天如 [23, 9]；起止相同 = 关闭
  "prompt": "现在没有人在跟你说话。你忽然想找主人搭句话……只说你要说的那一句话。"
}
```

- **手动触发**：右键 → 动作 →「主动搭话」，立刻说一句（忽略开关与免打扰）；
- **右键小肥鱼 →「设置…」**：紧凑面板，每项只露一行「开关 + 参数 ▾」；
  点「参数 ▾」就地展开该功能的参数（再点收起），默认收起：
  - 主动搭话：最短/最长间隔（分钟）、免打扰起止（点）；
  - 抱桌面图标：最短/最长间隔（分钟）、免打扰起止（点）；
  保存立即生效（主动搭话写 `$DSH_HOME/dsh-pet/proactive-settings.json`，
  抱图标写 `desktop-interaction.json`），不用重启、不用等保存；
  配套接口 `GET/POST /proactive/settings` 与 `GET /desktop/state?light=1` /
  `POST /desktop/toggle`（toggle 也接受 `minMinutes` / `maxMinutes` / `quietHours`）
  （桌面渲染层补丁：`desktop/apply-pet-settings.mjs`）；
- **生效要重启 DSH 桌面应用**（host 侧代码不随「重载配置」热加载）；
- 手动试一句：`curl -X POST http://127.0.0.1:59776/dsh-pet-7340/proactive`；
- 关掉：`"enabled": false`（不用回滚补丁）；
- 插件升级会覆盖 `lib/index.js` → 升级后重跑 `apply-proactive.mjs`；不想要了就
  `node proactive/revert-proactive.mjs`。

> 代价：每次搭话 = 一次对话模型调用（带最近 `chatMemoryRounds` 轮历史）。嫌贵就把间隔调大，
> 或给 `chatModel` 单独配一个便宜模型。

## 桌面图标互动（自定义补丁）

小肥鱼会隔一阵去"搬"一个桌面图标：**走到图标旁边 → 播抱起动作 → 抱着它一步一步走到目标位置 → 放下**。
图标全程跟着她走（不是瞬间跳过去）。

**手动触发**：右键小肥鱼 → 动作 →「抱个图标」，点一下立刻搬一次（忽略开关与免打扰，和碎碎念/对话的手动语义一致）。
主动搭话同理：动作 →「主动搭话」。

**硬边界（写死在代码里）**：只调用 Finder 的 `set position` 改图标坐标。
不删除、不改名、不移动文件、不写文件内容——唯一变化是图标在桌面上的摆放位置。

### 装 / 拆

```bash
node desktop/apply-desktop.mjs --check          # 宿主侧：/desk、/desktop/* 端点、cron
node desktop/apply-carry.mjs --check            # 桌面渲染侧：走过去 → 抱起 → 同步搬
node desktop/apply-pet-settings.mjs --check     # 右键「设置…」面板（主动搭话 + 抱图标开关）
node settings-ui/apply-settings-ui.mjs --check  # 设置页开关

# 打补丁（各自独立，失败自动回滚；都会先备份到 $DSH_HOME/dsh-pet/backups/）
node desktop/apply-desktop.mjs
node desktop/apply-carry.mjs
node desktop/apply-pet-settings.mjs
node settings-ui/apply-settings-ui.mjs

# 离线验收
node desktop/test-snippet.mjs     # 开关/选位/权限兜底
node desktop/test-carry.mjs       # @carry 指令 + grab 会话 + 分步脚本
```

### 开关

**设置页**：DSH 设置 → 桌宠配置 → 全局 → 「桌面图标互动」。
拨一下立即生效（写 `$DSH_HOME/dsh-pet/desktop-interaction.json`），**不用点保存**。

另外两种等价入口：

- 聊天框 `/desk off` / `/desk on` / `/desk status` / `/desk now`；
- `POST /desktop/toggle` `{"enabled":false}`。

`main-config.jsonc` 顶层 `desktopInteraction` 是**默认值**（开关文件优先）：

```jsonc
"desktopInteraction": {
  "enabled": true,
  "minMinutes": 25,
  "maxMinutes": 50,
  "quietHours": [0, 8]
}
```

### 「抱图标走路」专用动作

`desktop/apply-carry-anim.mjs` 会把 `desktop/assets/抱图标走路.webm` 装到
`$DSH_HOME/dsh-pet/main-animation/webm/`，并在 `animations.carry.walk` 里登记。
搬运时宠物改用这段「双手抱着图标卡片、轻微上下踏步」的循环；缺这段素材就回落到原来的移动动画。

素材是在原有 `收红包` 姿势上合成了一张白色文件卡片（蓝色小鱼），再做上下踏步/微摆后编码成
VP9-alpha webm（640×360 / 24fps / 3s 循环），见 `desktop/assets/抱图标走路-预览.jpg`。
想换成真正的手绘走路循环：同名替换这个 webm 即可，代码不用动。

### 搬运是怎么同步的

1. 宿主挑一个图标 + 目标空位，把 `@carry:{id,name,from,to}` 写进 `S.pets.<id>.anim`；
2. 桌面渲染端（`runtime/electron-helper`）收到后：走到图标旁（窗口逐帧跟随，走路动画循环）→ 播抱起动作；
3. 渲染端 `POST /desktop/carry/grab` 把「宠物走完这段要几秒」告诉宿主，**立刻**开始走；
4. 宿主同时用一个 AppleScript 循环，把图标沿同一条直线分 ~10 步/秒 挪过去（步长按宠物速度补偿）；
5. 两边线性插值、同起同止，图标始终在宠物脚下；到点播放下动作。

浏览器 overlay 没有这套渲染，`display` 不是 `desktop` 时退化为瞬间挪位。

### 权限

`osascript` 控制 Finder 属于 macOS「自动化」权限。第一次触发时系统会弹窗
（"DeepSeek Harness" 想要控制 "Finder"）；没弹或误点了拒绝，手动开：
系统设置 → 隐私与安全性 → 自动化 → **DeepSeek Harness** → 勾选 **Finder**。

体检：`/desk status`（结果由小肥鱼说出来）；或
`curl http://127.0.0.1:59776/dsh-pet-7340/desktop/state`。

### 已知限制

- 路线是直线，不做绕障/寻路；目标点会避开已有图标（110×95 的占位），但不保证绝对不重叠；
- 桌面开着「排序方式 / 整理」时 Finder 会把图标排回去——会明确报「搬不动」，改成「无」即可；
- 图标在宠物窗口**下面**（窗口置顶），看起来像被她抱着/挡在身前；没有做真正的鼠标拖拽
  （那需要「辅助功能」权限 + 合成鼠标事件，误伤风险高得多）；
- 插件升级会覆盖 `lib/` 与 `runtime/`：升级后重跑三个 `apply-*.mjs`；
  回滚分别是 `revert-desktop.mjs` / `revert-carry.mjs` / `revert-settings-ui.mjs`。

### 接口

| 端点 | 作用 |
| --- | --- |
| `GET /desktop/state` | 开关、间隔、权限体检（`?light=1` 跳过 Finder 探测） |
| `GET /desktop/icons` | 列出图标名与坐标（只读） |
| `POST /desktop/nudge` | 立刻搬一次（忽略开关/免打扰） |
| `POST /desktop/toggle` `{enabled}` | 开关（同 `/desk on/off`） |
| `POST /desktop/carry/grab` `{id,duration}` | 渲染端专用：抱起后启动图标同步移动 |
| `POST /desktop/move` `{name,x,y}` | 直接把图标挪到指定坐标（仅坐标） |

## 长期记忆（用户画像，Phase 1）

原始对话只保留最近 16 条消息，聊久了必然丢。长期记忆把「关于你的稳定信息」单独抽出来，常驻进人设。

**文件**：`$DSH_HOME/dsh-pet/profile.json`（本地明文，和 `memory.json` 分开）

```json
{
  "summary": "主人是后端工程师，常加班；喜欢冰美式不加糖；讨厌被催。",
  "facts": [
    { "id": "f_x1", "kind": "preference", "text": "喝冰美式，不加糖",
      "confidence": 0.9, "hits": 4, "firstSeen": 0, "lastSeen": 0 }
  ],
  "archived": [],
  "lastExtractedTs": 0
}
```

`kind`：`preference`（喜好）/ `trait`（性格）/ `fact`（客观信息）/ `boundary`（雷区）/ `goal`（目标）。

### 写入

- 每次普通对话成功后计数；**每 3 次用户发言**触发一次抽取（可配）；
- 抽取是一次独立的小模型请求（复用 `chatModel`）：把最近 12 条对话 + 现有画像交给模型，
  要求它只输出 JSON（summary / add / update / archive）；
- 合并规则：相似事实去重（子序列 + bigram）、冲突以新为准、旧事实进 `archived`、
  敏感信息（密码/证件/银行卡/手机号/住址/健康）**直接丢弃**；
- 失败静默、下一轮再试，**绝不阻塞聊天**。

### 读取（Phase 2：按话题检索）

每次对话 / 主动搭话时，system 变成：

```text
<人设>
你的名字是“小肥鱼”。
【关于主人】<summary ≤600 字>
【主人的边界】<boundary 事实，最多 6 条>
【相关记忆】<按当前消息检索出的 ≤5 条事实>
<当前时间>
```

检索不用向量：把「事实的 bigram 有多大比例出现在当前消息里」当相关度（阈值 0.34），
按分数取前 `retrieveFacts` 条；边界事实永远注入。主动搭话没有用户消息，只带摘要+边界。

碎碎念默认**不注入**画像（一句自言自语不需要，省 token）；要注入把
`memoryProfile.injectInWhisper` 改成 true。

### 开关与查看

```jsonc
"memoryProfile": {
  "enabled": true,
  "updateEveryTurns": 3,
  "maxFacts": 200,
  "summaryMaxChars": 600,
  "injectInWhisper": false,
  "retrieveFacts": 5,      // 每次按话题注入几条相关事实
  "decayAfterDays": 30,    // 超过多少天没被命中开始衰减
  "decayPerDay": 0.005,    // 每天降多少置信度
  "minConfidence": 0.25    // 低于此值归档
}
```

置信度衰减在每次抽取时计算：`confidence -= (闲置天数 - decayAfterDays) × decayPerDay`，
低于 `minConfidence` 进 `archived`，不再注入。

| 入口 | 作用 |
| --- | --- |
| `/profile` | 查看摘要 + 前 12 条事实（带 id） |
| `/profile clear` | 清空（旧文件自动备份为 `profile.json.bak-*`） |
| `/profile forget <id>` | 删除单条 |
| `POST /profile {forget:"id"}` | 删除单条事实（等价） |
| `POST /profile {forgetEpisode:"id"}` | 删除单条情节 |
| `POST /profile {clear:true}` | 清空（等价 DELETE） |
| `GET /profile` | JSON：summary / facts / settings |
| `POST /profile {summary}` | 手改摘要 |
| `DELETE /profile` | 清空 |

### 成本与隐私

- 抽取：每 3 轮一次，约 1–1.5k tokens（小上下文）；
- 注入：每轮对话/主动搭话 +400–800 字符；
- 全部本地明文，不出机器；`profile.json` 可随时删，删了就从零开始积累。

### 验收

重启应用后：

```bash
curl http://127.0.0.1:<port>/dsh-pet-7340/profile
# 连续用「对话」聊 3 轮以上（内容里带点偏好/习惯）
sleep 3
curl http://127.0.0.1:<port>/dsh-pet-7340/profile   # 应出现 summary / facts
cat ~/.dsh/dsh-pet/profile.json
```

### Phase 2 已完成

- 按当前消息检索 top-K 相关事实注入（阈值 0.34，`retrieveFacts` 可调）；
- 置信度随时间衰减 + 自动归档；
- 设置面板「长期记忆」区：摘要 + **事实/回忆列表**，每条右侧「×」逐条删除，底部一键清空
  （右键 →「设置…」→「长期记忆」）；
- `POST /profile {forget}` / `{forgetEpisode}` / `{clear:true}`。

### 情节记忆（Phase 3，已完成）

除了「你是什么样的人」，还记「发生过什么事」：

- 文件：`$DSH_HOME/dsh-pet/episodes.json`，每条 `{id,date,summary,tags,createdAt}`；
- 生成：和画像抽取同一次模型调用，额外要求输出 0–2 条 `episodes`（≤80 字 + 1–3 个 tags），
  相似情节自动合并（保留更长摘要、tags 取并集），上限 `maxEpisodes`（默认 100）；
- 检索：对话时按当前消息与 summary/tags 的 bigram 相关度（阈值 0.3）取前 `retrieveEpisodes`（默认 2）条；
- 注入：

  ```text
  【你还记得】
  - 2026-10-21：主人加班到很晚，聊了咖啡
  ```

- `GET /profile` 会附带最近 20 条情节与总数；`/profile` 命令显示最近 5 条；
- `/profile clear` / `DELETE /profile` 会**同时清空画像与情节**（各自备份）。

配置：

```jsonc
"memoryProfile": {
  ...,
  "maxEpisodes": 100,
  "retrieveEpisodes": 2
}
```

### 后续可做

事实/摘要的手动编辑、情节按天聚合、以及“记忆命中率”统计（哪些事实真正被用上）。

## 边界与成本

- 前三层写在 `$DSH_HOME/dsh-pet/`，插件更新、卸载重装都不动；`memory.json` 全存不删，删掉即清空记忆。
- 碎碎念默认开启，`eventsRefreshSec.whisper` 默认 300 秒调一次当前模型；不需要就在设置页/配置里关掉。
- 人设提示词每次请求都带，几百字符对 token 的影响可以忽略；真正贵的是 `chatMemoryRounds` 和对话配图清单。
- 多开 N 只 = N 份动画解码 + N 份定时器，按机器量力而行。

## 文件

| 文件 | 作用 |
| --- | --- |
| `persona.example.json` | 人设模板（复制成 `persona.json` 再改） |
| `build-config.mjs` | 人设 → `main-config.jsonc`（保留其余字段） |
| `validate-config.mjs` | 用插件自己的解析器验收 + 素材存在性 + 运行中实例比对 |
| `apply.sh` / `rollback.sh` | 备份 → 生成 → 校验 → 落盘；一键回滚 |
| `pet-pack/new-species.mjs` | 新建文件宠物（独立动画池 + 素材目录 + 人设） |
| `persona.fish.json` | 傲娇温柔小肥鱼的人设（含主动搭话配置） |
| `proactive/` | 主动搭话补丁：插入逻辑、调度器、`/proactive` 路由、离线测试、回滚 |
| `desktop/` | 桌面图标互动补丁：Finder 脚本、调度器、`/desk` 开关、HTTP 端点、`apply-carry` 抱行动画、回滚 |
| `settings-ui/` | 设置页「桌面图标互动」开关（改 `lib/client.js`） |
| `desktop/apply-pet-settings.mjs` | 右键「设置…」面板：开关 + 可收起的参数 |
| `desktop/apply-menu-actions.mjs` | 动作菜单里的「主动搭话」「抱个图标」手动触发项 |
| `desktop/apply-carry-anim.mjs` | 安装「抱图标走路」专用素材并接到搬运流程 |
| `memory/` | 长期记忆：画像模块、抽取/合并、`/profile`、离线测试与回滚 |
