#!/bin/bash
# EV-2 场景驱动：mock docker + 真实执行 scripts/scheduler-service.sh 的 install/remove/status。
# 覆盖：install 成功/幂等、防双调度器拒绝、status 心跳与 heavy slot、remove 一键清空。
#
# 平台兼容说明（CI Linux 与 Windows Git Bash 都要过）：
#   - git 在 Windows 提交会丢执行位 → 不依赖脚本的 +x：本文件与 scheduler-service.sh 一律
#     显式 `bash <file>` 执行；mock docker 经运行时生成的带 +x wrapper（bash 解释）。
set -u
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
MOCK_BIN="$HERE/mock-bin"
STATE="$(mktemp -d)"
DATA_DIR_TMP="$(mktemp -d)"
SVC_SH="$REPO/scripts/scheduler-service.sh"

# 运行时生成一个带 +x 的 docker wrapper（bash 解释 mock），绕开 git 执行位问题。
# 注意：wrapper 目录必须独立于 STATE——场景 3/5 会清空 STATE 重建（模拟无容器状态）。
BIN_DIR="$(mktemp -d)"
cat > "$BIN_DIR/docker" <<EOF
#!/bin/bash
exec bash "$MOCK_BIN/docker" "\$@"
EOF
chmod +x "$BIN_DIR/docker"

export PATH="$BIN_DIR:$PATH"
export MOCK_STATE_DIR="$STATE"
export MOCK_APP_ID="mock-app-id"
export MOCK_APP_CMD='[serve]'
export MOCK_HAS_START=1
export COMPOSE_FILES="-f compose.mock.yaml"
export DATA_DIR="$DATA_DIR_TMP"

fail=0
step() { echo "=== $1 ==="; }

step "1) install 成功（app=serve、无 scheduler 容器）"
if bash "$SVC_SH" install; then echo "PASS install"; else echo "FAIL install"; fail=1; fi

step "2) install 幂等（scheduler 已存在 → 无需重复安装）"
if bash "$SVC_SH" install | grep -q "无需重复安装"; then echo "PASS idempotent"; else echo "FAIL idempotent"; fail=1; fi

step "3) install 拒绝双调度器（app 容器仍在跑 all）"
rm -rf "$STATE"; mkdir -p "$STATE"
export MOCK_APP_CMD='[all]'
if ! bash "$SVC_SH" install >/dev/null 2>&1; then echo "PASS no-dup-guard（非零退出）"; else echo "FAIL no-dup-guard（应拒绝）"; fail=1; fi
export MOCK_APP_CMD='[serve]'

step "4) status（最近心跳 + heavy slot 任务识别）"
cat > "$DATA_DIR_TMP/scheduler-status.json" <<'EOF'
{
  "updatedAt": "2026-11-23T04:00:00.000Z",
  "tickMs": 15000,
  "jobs": [
    {
      "name": "steam-prices",
      "running": true,
      "lastResult": null
    },
    {
      "name": "sonkwo",
      "running": false,
      "lastResult": "ok"
    }
  ]
}
EOF
out="$(bash "$SVC_SH" status)"
if echo "$out" | grep -q "秒前"; then echo "PASS status-heartbeat"; else echo "FAIL status-heartbeat（输出：$out）"; fail=1; fi
if echo "$out" | grep -q "当前 heavy slot 任务：steam-prices"; then echo "PASS status-heavy"; else echo "FAIL status-heavy（输出：$out）"; fail=1; fi

step "5) remove 一键删除（容器 + data/scheduler-*.json 全清）"
rm -rf "$STATE"; mkdir -p "$STATE"
cat > "$DATA_DIR_TMP/scheduler-status.json" <<'EOF'
{"updatedAt": "2026-11-23T04:00:00.000Z", "jobs": []}
EOF
cat > "$DATA_DIR_TMP/scheduler-retry.json" <<'EOF'
{"steam-prices": {"at": "2026-11-23T05:00:00.000Z"}}
EOF
echo "mock-scheduler-1" > "$STATE/scheduler-id"
if bash "$SVC_SH" remove | grep -q "删除完成"; then echo "PASS remove"; else echo "FAIL remove"; fail=1; fi
if [ ! -f "$DATA_DIR_TMP/scheduler-status.json" ] && [ ! -f "$DATA_DIR_TMP/scheduler-retry.json" ]; then echo "PASS files-cleared"; else echo "FAIL files-cleared"; fail=1; fi
if [ ! -f "$STATE/scheduler-id" ]; then echo "PASS container-gone"; else echo "FAIL container-gone"; fail=1; fi

rm -rf "$DATA_DIR_TMP" "$STATE" "$BIN_DIR"
echo "RESULT fail=$fail"
exit "$fail"
