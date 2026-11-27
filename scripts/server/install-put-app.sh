#!/bin/bash
# SteamDeals「上传 App 安装包」通道安装脚本（**服务器上以 root 执行一次**）
#
# 背景：站点 server.js 的 /app/dl/<file> 只读容器内 /app/data/app（宿主挂载目录），
#       所以只要把 APK 写进该目录，就能立即用 /app/dl/steamdeals-x.y.z.apk 下载，
#       **不需要重建站点镜像**。deploy 账号被 ForceCommand 限制为只读命令，故新增
#       一条独立的「专用 key + command="put-app"」白名单，不动 deploy 现有通道。
#
# 用法（在服务器 root 下）：
#   bash install-put-app.sh '<专用公钥内容>'
# 例：
#   bash install-put-app.sh 'ssh-ed25519 AAAAC3... steamdeals-put-app'
#
# 装好后客户端可执行：
#   ssh -i ~/.ssh/id_ed25519_steamdeals_putapp deploy@sd.yyliucha.cn "put-app steamdeals-2.32.0.apk" < steamdeals-2.32.0.apk
#   ssh -i ... "put-latest" < latest.json
set -euo pipefail

PUBKEY="${1:-}"
if [ -z "$PUBKEY" ]; then
  echo "用法: bash install-put-app.sh '<专用 ssh 公钥>'" >&2
  exit 1
fi

# ---- 1. 探测 app 容器的 /app/data 宿主挂载目录 ----
DATA_ROOT="$(docker inspect steamdeals --format '{{range .Mounts}}{{if eq .Destination "/app/data"}}{{.Source}}{{end}}{{end}}' 2>/dev/null || true)"
if [ -z "$DATA_ROOT" ]; then
  echo "ERROR: 找不到容器 steamdeals 的 /app/data 挂载源（容器未运行或挂载名不同）" >&2
  echo "      请先 docker inspect steamdeals 确认挂载，或手工指定 DATA_ROOT 后重试" >&2
  exit 1
fi
APP_DIR="$DATA_ROOT/app"
mkdir -p "$APP_DIR"
echo "[1/4] data 挂载源: $DATA_ROOT"

# ---- 2. 生成 put-app.sh（DATA_ROOT 写死，运行时不需要 docker 权限）----
cat > /opt/steamdeals/put-app.sh <<EOS
#!/bin/bash
# 由 install-put-app.sh 生成；仅允许 deploy 通过专用 key 触发（command="put-app"）。
# 行为：把 stdin 写入 \$DATA_ROOT/app/<name>；文件名必须是 steamdeals-x.y.z.apk。
set -euo pipefail
DATA_ROOT="$DATA_ROOT"
APP_DIR="\$DATA_ROOT/app"

CMD="\${SSH_ORIGINAL_COMMAND:-}"
set -- \$CMD
if [ "\${1:-}" = "put-app" ]; then shift; fi
FILENAME="\${1:-}"

if [ "\$FILENAME" = "put-latest" ]; then
  # 传 latest.json（覆盖）
  TMP=\$(mktemp)
  cat > "\$TMP"
  mv "\$TMP" "\$APP_DIR/latest.json"
  chmod 644 "\$APP_DIR/latest.json"
  echo "ok: latest.json (\$(stat -c%s "\$APP_DIR/latest.json") bytes)"
  exit 0
fi

case "\$FILENAME" in
  steamdeals-[0-9]*.[0-9]*.[0-9]*.apk) ;;
  *) echo "invalid filename: \${FILENAME:-<empty>}（只允许 steamdeals-x.y.z.apk / put-latest）" >&2; exit 2 ;;
esac

TMP=\$(mktemp)
cat > "\$TMP"
SIZE=\$(stat -c%s "\$TMP")
if [ "\$SIZE" -lt 100000 ]; then echo "ERROR: 文件太小（\$SIZE bytes），疑似传输失败" >&2; rm -f "\$TMP"; exit 3; fi
mv "\$TMP" "\$APP_DIR/\$FILENAME"
chmod 644 "\$APP_DIR/\$FILENAME"
echo "ok: \$FILENAME (\$SIZE bytes, sha256=\$(sha256sum "\$APP_DIR/\$FILENAME" | cut -d' ' -f1 | cut -c1-16)…)"
EOS
chmod 755 /opt/steamdeals/put-app.sh
echo "[2/4] 已生成 /opt/steamdeals/put-app.sh"

# ---- 3. 让 deploy 可写该目录（只给它 app 子目录，不给整个 data）----
chown -R deploy:deploy "$APP_DIR" 2>/dev/null || chmod 775 "$APP_DIR"
echo "[3/4] 已授权 deploy 写 $APP_DIR"

# ---- 4. 追加专用 key 的 authorized_keys 行（幂等；不碰 deploy 现有条目）----
AK=/home/deploy/.ssh/authorized_keys
mkdir -p /home/deploy/.ssh
touch "$AK"
if grep -q "steamdeals-put-app" "$AK"; then
  echo "[4/4] authorized_keys 已含 put-app 专用 key，跳过"
else
  printf 'command="/opt/steamdeals/put-app.sh",no-port-forwarding,no-agent-forwarding,no-pty %s  # steamdeals-put-app\n' "$PUBKEY" >> "$AK"
  chown deploy:deploy "$AK"
  chmod 600 "$AK"
  echo "[4/4] 已追加 put-app 专用 key"
fi

echo ""
echo "===== 安装完成 ====="
echo "客户端验证（在 Mac/Windows 上）："
echo "  ssh -i ~/.ssh/id_ed25519_steamdeals_putapp deploy@sd.yyliucha.cn \"put-app steamdeals-9.9.9.apk\" < /dev/null   # 应报 invalid/too small，证明通道已通"
echo "  （用真实 APK 时把 stdin 换成文件重定向；latest.json 用 put-latest）"
echo "文件落点：$APP_DIR/（站点路径 /app/dl/<file>）"
