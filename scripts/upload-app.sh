#!/usr/bin/env bash
# SteamDeals App 安装包上传（客户端；需先在服务器 root 跑一次 scripts/server/install-put-app.sh）
#
# 用法：
#   bash scripts/upload-app.sh <apk 路径> [latest.json 路径]
# 例：
#   bash scripts/upload-app.sh F:\dsh\steamdeals-app\app\build\outputs\apk\release\app-release.apk frontend/public/app/latest.json
#
# 原理：站点 /app/dl/<file> 只读容器 /app/data/app（宿主挂载），所以上传后**立即**可下载，
#       不需要重建站点镜像。走专用 key + command="put-app" 白名单，不动 deploy 发布通道。
set -euo pipefail

APK="${1:-}"
LATEST="${2:-}"
HOST="${STEAMDEALS_HOST:-sd.yyliucha.cn}"
KEY="${STEAMDEALS_PUTAPP_KEY:-$HOME/.ssh/id_ed25519_steamdeals_putapp}"

if [ -z "$APK" ] || [ ! -f "$APK" ]; then
  echo "用法: bash scripts/upload-app.sh <apk 路径> [latest.json 路径]" >&2
  exit 1
fi
if [ ! -f "$KEY" ]; then
  echo "ERROR: 找不到专用 key $KEY（先按 scripts/server/install-put-app.sh 头部说明生成）" >&2
  exit 1
fi

NAME="$(basename "$APK")"
case "$NAME" in
  steamdeals-[0-9]*.[0-9]*.[0-9]*.apk) ;;
  *) echo "ERROR: APK 文件名必须是 steamdeals-x.y.z.apk，当前：$NAME" >&2; exit 1 ;;
esac

echo "[1/2] 上传 $NAME（$(du -h "$APK" | cut -f1)）…"
ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "deploy@$HOST" "put-app $NAME" < "$APK"

if [ -n "$LATEST" ]; then
  if [ ! -f "$LATEST" ]; then echo "ERROR: latest.json 不存在：$LATEST" >&2; exit 1; fi
  echo "[2/2] 上传 latest.json…"
  ssh -i "$KEY" -o IdentitiesOnly=yes -o ConnectTimeout=20 "deploy@$HOST" "put-latest" < "$LATEST"
else
  echo "[2/2] 未提供 latest.json，跳过（App 内置更新读它，别忘了补传）"
fi

echo ""
echo "验证（只读）：curl -sI https://$HOST/app/dl/$NAME | head -3"
echo "        curl -s  https://$HOST/api/app/latest"
