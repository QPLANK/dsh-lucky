#!/usr/bin/env bash
# 把 persona.json 编译并写入 dsh-pet 用户配置：备份 → 生成 → 用插件自己的解析器校验 → 落盘 →（可选）向运行中实例复核。
# 任何一步失败都会自动回滚到备份。
#
# 用法：
#   ./apply.sh                                  # 用同目录 persona.json
#   ./apply.sh --persona my-persona.json        # 换一份人设
#   ./apply.sh --url http://127.0.0.1:59776/dsh-pet-7340/config   # 写完立刻向运行中的 DSH 复核
#   DSH_HOME=/path/to/.dsh ./apply.sh           # 非默认 DSH_HOME
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PKG="${DSH_PET_PACKAGE:-$DSH_HOME/profiles/desktop/node_modules/dsh-pet}"
CFG="$DSH_HOME/dsh-pet/main-config.jsonc"
PERSONA=""
URL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --persona) PERSONA="${2:?--persona 需要路径}"; shift 2 ;;
    --url) URL="${2:?--url 需要地址}"; shift 2 ;;
    -h|--help) sed -n '2,12p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [[ -z "$PERSONA" ]]; then
  if [[ -f "$HERE/persona.json" ]]; then
    PERSONA="$HERE/persona.json"
  else
    PERSONA="$HERE/persona.example.json"
    echo "[apply] 没找到 persona.json，先用 persona.example.json 试跑（想自定义就 cp persona.example.json persona.json 再改）"
  fi
fi

[[ -f "$PERSONA" ]] || { echo "[apply] 人设文件不存在：$PERSONA" >&2; exit 2; }
[[ -d "$PKG" ]] || { echo "[apply] 找不到 dsh-pet 包：$PKG（用 DSH_PET_PACKAGE 指定）" >&2; exit 2; }
mkdir -p "$DSH_HOME/dsh-pet/backups"

TMP="$(mktemp "$DSH_HOME/dsh-pet/.main-config.XXXXXX")"
BACKUP=""
cleanup() { [[ -f "$TMP" ]] && rm -f "$TMP"; }
trap cleanup EXIT

if [[ -f "$CFG" ]]; then
  BACKUP="$DSH_HOME/dsh-pet/backups/main-config-$(date +%Y%m%d-%H%M%S).jsonc"
  cp "$CFG" "$BACKUP"
  echo "[apply] 已备份：$BACKUP"
else
  echo "[apply] 当前没有用户配置，直接新建"
fi

echo "[apply] 生成配置…"
node "$HERE/build-config.mjs" --persona "$PERSONA" --existing "$CFG" --out "$TMP"

echo "[apply] 用 dsh-pet 自己的解析器校验…"
if ! node "$HERE/validate-config.mjs" --config "$TMP" --home "$DSH_HOME" --package "$PKG"; then
  echo "[apply] 校验失败，未写入任何文件" >&2
  exit 1
fi

cp "$TMP" "$CFG"
echo "[apply] 已写入：$CFG"

if [[ -n "$URL" ]]; then
  echo "[apply] 向运行中实例复核…"
  if ! node "$HERE/validate-config.mjs" --config "$CFG" --home "$DSH_HOME" --package "$PKG" --url "$URL"; then
    if [[ -n "$BACKUP" ]]; then
      cp "$BACKUP" "$CFG"
      echo "[apply] 运行中实例没认这份配置，已回滚到 $BACKUP" >&2
    else
      rm -f "$CFG"
      echo "[apply] 运行中实例没认这份配置，已删除新建的配置" >&2
    fi
    exit 1
  fi
fi

echo
echo "[apply] 生效方式："
echo "  浏览器形态  → 刷新页面（Cmd+R）"
echo "  桌面形态    → 右键宠物 →「重载配置」"
echo "  回滚        → ./rollback.sh"
