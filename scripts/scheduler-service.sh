#!/bin/bash
# EV 批（docs/SCHEDULER-AS-SERVICE.md）：调度器独立服务的一键安装/删除/状态管理。
#
# 用法：
#   ./scripts/scheduler-service.sh install   安装：防双调度器检查 → up -d scheduler → 校验 scheduler.start 日志
#   ./scripts/scheduler-service.sh remove    一键删除：停容器 + 删容器 + 清 data/scheduler-*.json 状态 → 校验无容器
#   ./scripts/scheduler-service.sh status    状态：容器状态 + 最近心跳（状态文件 updatedAt）+ 当前 heavy slot 任务
#
# 环境变量：
#   COMPOSE_FILES   compose 文件列表，如 "-f docker-compose.yml"；默认让 docker compose 自动发现
#                   （生产服务器若主文件叫 docker-compose.yml 而非 compose.yaml，请显式传入）。
#   DATA_DIR        状态文件目录（默认 ./data；容器挂载点不同时覆盖）。
#
# 说明：
#   - install 前必须把 app 从 command: ["all"] 改成 ["serve"]（compose 变体已改好），
#     否则 app 与 scheduler 两个调度器并行，任务会重复执行——install 会检测并拒绝。
#   - 一键删除只删调度服务与调度状态（scheduler-status/retry/resume 等），业务数据（PostgreSQL）不动。
#   - 本文件保持 LF 换行 + 可执行位（服务器上直接 ./scripts/scheduler-service.sh install）。
set -eu

SVC=scheduler
COMPOSE_FILES="${COMPOSE_FILES:-}"
DATA_DIR="${DATA_DIR:-./data}"
HEAVY_JOBS='^(steam-prices|rename|backfill|rating-backfill|heat|steam-status|steam-discovery|catalog)$' # 与 src/scheduler.js STEAM_HEAVY 保持同步
STATUS_FILE="$DATA_DIR/scheduler-status.json"

compose() { docker compose $COMPOSE_FILES "$@"; }

log() { echo "[scheduler-service] $*"; }

fail() { echo "[scheduler-service] 错误：$*" >&2; exit 1; }

# 取 app 容器 id（不存在返回空）
app_container_id() { compose ps -q app 2>/dev/null || true; }

# 取 scheduler 容器 id（不存在返回空）
scheduler_container_id() { compose ps -q "$SVC" 2>/dev/null || true; }

# 防双调度器：app 还在跑 all 时拒绝安装
check_no_legacy_all() {
    local app_id
    app_id="$(app_container_id)"
    [ -n "$app_id" ] || return 0 # app 没起（首次部署）不拦截
    local cmd
    cmd="$(docker inspect -f '{{.Config.Cmd}}' "$app_id" 2>/dev/null || true)"
    case "$cmd" in
        *"all"*)
            fail "app 容器仍在跑一体化模式（command=all，会与 scheduler 双重执行任务）。请先把 app 改成 command: [\"serve\"] 并 up -d app，再执行 install。"
            ;;
    esac
}

install() {
    log "安装调度器服务（compose: ${COMPOSE_FILES:-默认发现}）"
    check_no_legacy_all

    local id
    id="$(scheduler_container_id)"
    if [ -n "$id" ]; then
        log "scheduler 容器已存在（$id），无需重复安装"
        return 0
    fi

    compose up -d "$SVC"

    # 校验 scheduler 已真正启动：等 scheduler.start 日志（最多 90 秒）
    log "等待 scheduler.start 启动日志（最多 90 秒）…"
    local i
    for i in $(seq 1 30); do
        if docker logs "$(scheduler_container_id)" 2>/dev/null | grep -q 'scheduler.start'; then
            log "✅ scheduler 已启动（检测到 scheduler.start）"
            return 0
        fi
        sleep 3
    done
    log "⚠ 90 秒内未检测到 scheduler.start，请检查：docker compose $COMPOSE_FILES logs scheduler"
    return 1
}

remove() {
    log "一键删除调度器服务与调度状态（业务数据不动）"
    local id
    id="$(scheduler_container_id)"

    if [ -n "$id" ]; then
        log "停止并删除 scheduler 容器…"
        compose stop "$SVC" || true
        compose rm -f "$SVC" || true
    else
        log "没有 scheduler 容器，跳过容器清理"
    fi

    # 删除调度器状态文件：任务表状态 / 429 重排 / 断点续跑 / 兼容旧名 lastrun
    log "删除调度器状态文件（$DATA_DIR/scheduler-*.json）…"
    rm -f "$DATA_DIR"/scheduler-status.json "$DATA_DIR"/scheduler-retry.json \
          "$DATA_DIR"/scheduler-resume.json "$DATA_DIR"/scheduler-lastrun.json

    # 校验：容器已不在、compose 里无残留
    if [ -n "$(scheduler_container_id)" ]; then
        fail "scheduler 容器仍存在：$(scheduler_container_id)"
    fi
    log "✅ 删除完成：容器已移除、状态文件已清理，不再有任务执行"
}

status() {
    log "调度器服务状态"
    echo "── 容器状态 ──────────────────────────────"
    compose ps "$SVC" 2>/dev/null || echo "（compose 项目内没有 scheduler 服务）"
    echo ""

    if [ ! -f "$STATUS_FILE" ]; then
        echo "状态文件 $STATUS_FILE 不存在（scheduler 未运行或从未写状态）"
        return 0
    fi

    echo "── 最近心跳 ──────────────────────────────"
    local updated now_s up_s
    updated="$(grep -o '"updatedAt": "[^"]*"' "$STATUS_FILE" | head -1 | sed 's/.*"\([^"]*\)".*/\1/')"
    if [ -n "$updated" ]; then
        now_s="$(date +%s)"
        up_s="$(date -d "$updated" +%s)"
        echo "updatedAt：$updated（$(( now_s - up_s )) 秒前）"
    else
        echo "（状态文件里没有 updatedAt）"
    fi

    echo ""
    echo "── 当前任务 ──────────────────────────────"
    local running heavy
    # 状态文件是两空格缩进的 JSON，job 对象里 name 在最前、running 在后：
    # 用 awk 记录最近的 name，遇到 running=true 输出（比 grep -B3 稳，不依赖对象行数）
    running="$(awk -F'"' '/"name": "/{name=$4} /"running": true/{print name}' "$STATUS_FILE" | paste -sd, - 2>/dev/null || true)"
    echo "运行中：${running:-（无）}"
    heavy="$(printf '%s\n' "${running:-}" | tr ',' '\n' | grep -E "$HEAVY_JOBS" | paste -sd, - 2>/dev/null || true)"
    echo "当前 heavy slot 任务：${heavy:-（无）}"
}

case "${1:-}" in
    install) install ;;
    remove) remove ;;
    status) status ;;
    *)
        echo "用法: $0 install|remove|status" >&2
        exit 2
        ;;
esac
