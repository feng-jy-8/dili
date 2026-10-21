#!/usr/bin/env bash
# Restarts Dili on this machine, safe to run from a shell that
# Dili itself hosts (the bottom terminal, even over remote access).
#
# The work runs detached in its own session, so stopping the service does not
# kill the restart halfway. Every running agent session is stopped with the
# service; contacts keep their native IDs and resume from their cards.
set -euo pipefail

project_dir="$(CDPATH='' cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
port="${SESSIONDECK_PORT:-${PORT:-4317}}"
log="${TMPDIR:-/tmp}/dili-restart.log"

if ! systemctl --user cat dili.service >/dev/null 2>&1; then
  echo "尚未安装 systemd 单元，先执行 scripts/install-service.sh" >&2
  exit 1
fi

if [[ "${1:-}" != --detached ]]; then
  setsid nohup "$0" --detached >"$log" 2>&1 < /dev/null &
  echo "正在后台重启 Dili，日志：$log"
  echo "这个终端会随旧服务一起关闭；十几秒后刷新页面即可。"
  exit 0
fi

# Build before touching the running instance: a failed build then just aborts
# the restart, and the atomic publish never empties assets it is still serving.
if [[ "$(cd "$project_dir" && npx tsx scripts/needs-build.ts)" == yes ]]; then
  echo "$(date '+%F %T') 前端代码已变化，重新构建"
  (cd "$project_dir" && npm run build)
fi

# Only stop a listener that is provably this project's server, never by port alone.
pid="$(lsof -nP -tiTCP:"$port" -sTCP:LISTEN 2>/dev/null | head -1 || true)"
if [[ -n "$pid" ]]; then
  cmd="$(tr '\0' ' ' < "/proc/$pid/cmdline" 2>/dev/null || true)"
  cwd="$(readlink "/proc/$pid/cwd" 2>/dev/null || true)"
  if [[ ("$cmd" != *server/index.ts* && "$cmd" != *bin/dili.mjs*) || "$cwd" != "$project_dir" ]]; then
    echo "端口 $port 上的进程 $pid 不是本项目的 Dili（$cmd），已放弃。" >&2
    exit 1
  fi
  unit_pid="$(systemctl --user show dili -p MainPID --value 2>/dev/null || echo 0)"
  if [[ "$unit_pid" == "$pid" ]]; then
    echo "$(date '+%F %T') 通过 systemd 重启"
    exec systemctl --user restart dili
  fi
  # Instance started by the pre-rename unit: stop it there, then start dili.
  legacy_pid="$(systemctl --user show sessiondeck -p MainPID --value 2>/dev/null || echo 0)"
  if [[ "$legacy_pid" == "$pid" ]]; then
    echo "$(date '+%F %T') 停止旧的 sessiondeck.service"
    systemctl --user stop sessiondeck
    systemctl --user disable sessiondeck 2>/dev/null || true
  fi
  if kill -0 "$pid" 2>/dev/null; then
    echo "$(date '+%F %T') 停止旧实例 $pid（$cmd）"
    kill -TERM "$pid"
  fi
  for _ in $(seq 1 60); do
    kill -0 "$pid" 2>/dev/null || break
    sleep 1
  done
  if kill -0 "$pid" 2>/dev/null; then echo "旧实例 30 秒内未退出，放弃启动新实例。" >&2; exit 1; fi
fi
for _ in $(seq 1 20); do
  lsof -nP -tiTCP:"$port" -sTCP:LISTEN >/dev/null 2>&1 || break
  sleep 1
done
echo "$(date '+%F %T') 启动 systemd 服务"
systemctl --user enable --now dili
sleep 2
systemctl --user --no-pager --lines=5 status dili || true
