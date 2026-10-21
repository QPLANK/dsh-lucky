# dsh-lucky 🐾

> 基于 [PC2005-cloud/dsh-pet](https://github.com/PC2005-cloud/dsh-pet) 0.3.7 的「小肥鱼」定制版。
> 插件包名仍是 `dsh-pet`（插件 id / 路由 / 素材路径保持不变），仓库名是 `dsh-lucky`。

一只住在 DeepSeek Harness 里的桌面宠物：傲娇、嘴硬心软的小肥鱼，会主动找你说话、会把桌面图标抱到别处、
会慢慢记住你的偏好和发生过的事。

## 相比上游多了什么

| 能力 | 说明 |
| --- | --- |
| 小肥鱼人设 | 傲娇 + 温柔，口癖/称呼/工作状态气泡/拖拽手感全部可配 |
| 主动搭话 | 5–10 分钟随机一次，带对话记忆；0–8 点免打扰；可手动触发 |
| 设置面板 | 右键「设置…」：开关 + **可收起的参数**（间隔/免打扰），另有「长期记忆」区 |
| 抱图标搬运 | 走到图标旁 → 抱起 → 与图标同步一步步走到目标 → 放下 |
| 桌面图标互动 | 只改图标坐标（Finder `set position`），不删/不改名/不动文件；可开关 |
| 长期记忆 | `profile.json` 画像（摘要 + 事实）+ `episodes.json` 情节；按话题检索注入；置信度衰减 |
| 设置页开关 | DSH 设置 → 桌宠配置 → 全局：桌面图标互动开关 |

所有定制补丁的源码、安装脚本、回滚脚本都在 [`custom/`](./custom/README.md)。

## 安装

本仓库是**可直接装进 DSH 的插件包**（`package.json` + `lib/` + `assets/` + `runtime/` + `src/`）。

```bash
git clone https://github.com/QPLANK/dsh-lucky.git
cd dsh-lucky

# dsh web 用户（profile 名按实际来的填）
dsh plugin --profile web add /绝对路径/dsh-lucky

# 桌面应用用户：desktop profile 由 App 独占管理，CLI 会被拒绝；
# 把 ~/.dsh/profiles/desktop/package.json 的 dsh-pet 依赖指向本目录（file:...）后 pnpm install，
# 或用 App 的插件管理入口安装。
```

装完重启 DSH。首次使用桌面图标互动需要在
系统设置 → 隐私与安全性 → 自动化 → 允许 DeepSeek Harness 控制「Finder」。

## 记忆文件

- `~/.dsh/dsh-pet/memory.json`：原始对话（全存，上下文只带最近 N 轮）
- `~/.dsh/dsh-pet/profile.json`：长期画像（摘要 + 事实）
- `~/.dsh/dsh-pet/episodes.json`：情节记忆
- `~/.dsh/dsh-pet/proactive-settings.json` / `desktop-interaction.json`：主动搭话 / 桌面互动的开关与参数

全部本地明文，可随时删除。查看：`/profile`；清空：`/profile clear` 或设置面板「长期记忆 → 清空」。

## 常用命令

| 命令 | 作用 |
| --- | --- |
| `/profile` | 查看画像摘要、事实、最近回忆 |
| `/profile forget <id>` | 删除单条事实 |
| `/profile clear` | 清空长期记忆（画像 + 情节，自动备份） |
| `/desk on\|off\|status\|now` | 桌面图标互动开关 / 体检 / 立刻搬一次 |
| `/chat <消息>` | 和桌宠对话（留空 = 催一句碎碎念） |
| `/pet [id]` | 选择当前桌宠 |

HTTP（端口以 DSH 实际为准）：`/dsh-pet-7340/profile`、`/desktop/state`、`/proactive/settings`。

## 许可证

MIT，继承上游 [dsh-pet](https://github.com/PC2005-cloud/dsh-pet)。上游原始 README 见 [README.upstream.md](./README.upstream.md)。
