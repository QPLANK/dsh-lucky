#!/usr/bin/env bash
# 回滚 dsh-pet 用户配置到最近一次（或指定一次）备份。
#
# 用法：
#   ./rollback.sh                                # 恢复最近一次备份
#   ./rollback.sh --list                         # 看有哪些备份
#   ./rollback.sh --file <备份路径>              # 恢复指定备份
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DSH_HOME="${DSH_HOME:-$HOME/.dsh}"
PKG="${DSH_PET_PACKAGE:-$DSH_HOME/profiles/desktop/node_modules/dsh-pet}"
CFG="$DSH_HOME/dsh-pet/main-config.jsonc"
DIR="$DSH_HOME/dsh-pet/backups"
FILE=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --list) ls -lt "$DIR" 2>/dev/null | sed -n '1,20p'; exit 0 ;;
    --file) FILE="${2:?--file 需要路径}"; shift 2 ;;
    -h|--help) sed -n '2,8p' "$0"; exit 0 ;;
    *) echo "未知参数：$1" >&2; exit 2 ;;
  esac
done

if [[ -z "$FILE" ]]; then
  FILE="$(ls -t "$DIR"/main-config-*.jsonc 2>/dev/null | head -1 || true)"
fi
[[ -n "$FILE" && -f "$FILE" ]] || { echo "[rollback] 没有可用的备份（$DIR）" >&2; exit 2; }

echo "[rollback] 恢复：$FILE"
# 先把当前状态也存一份（不叫 main-config-*，不会被下一次 rollback 选中），再恢复
if [[ -f "$CFG" ]]; then
  cp "$CFG" "$DIR/pre-rollback-$(date +%Y%m%d-%H%M%S).jsonc"
fi
cp "$FILE" "$CFG"
# 用过的备份改名，连续 rollback 会继续往前退，而不是原地打转
mv "$FILE" "$FILE.restored"
node "$HERE/validate-config.mjs" --config "$CFG" --home "$DSH_HOME" --package "$PKG" || echo "[rollback] 注意：这份备份本身没通过校验（仍然写回去了）"
echo "[rollback] 完成。刷新页面 / 右键「重载配置」生效。"
