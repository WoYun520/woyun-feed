#!/bin/zsh
# Levi flow · 本机过审入口
# 和「打开 Levi flow.command」启动同一个本机服务，浏览器直接打开 /review-admin。
# 失败时留在这个窗口里：先让启动程序打出原文，再停住等按键，避免终端一闪而过。
script_path=${0:A}
root=${script_path:h}
launch="${root}/frontend/launch.mjs"

pause_if_failed() {
  local exit_code=$1
  if (( exit_code == 0 )); then
    return 0
  fi
  print -u2 "打开过审没有完成。请看上面的报错，按任意键关闭这个窗口。"
  read -k
  print
  exit "$exit_code"
}

typeset -a candidates
candidates=(
  /opt/homebrew/bin/node
  /usr/local/bin/node
  /usr/bin/node
  "${HOME}/.local/bin/node"
  "${HOME}/.volta/bin/node"
  "${HOME}/.fnm/current/bin/node"
)
nvm_dir="${NVM_DIR:-${HOME}/.nvm}"
if [[ -d "${nvm_dir}/versions/node" ]]; then
  candidates+=("${nvm_dir}"/versions/node/*/bin/node(NnOn))
fi

node_bin=""
for candidate in "${candidates[@]}"; do
  if [[ -n "${candidate}" && -x "${candidate}" ]]; then
    node_bin="${candidate}"
    break
  fi
done
if [[ -z "${node_bin}" ]]; then
  path=(/opt/homebrew/bin /usr/local/bin "${HOME}/.local/bin" "${HOME}/.volta/bin" ${path})
  node_bin="${commands[node]:-}"
fi
if [[ -z "${node_bin}" ]]; then
  print -u2 "需要 Node.js 22 或更新版本，请先安装。"
  pause_if_failed 1
fi
export LEVI_OPEN_PATH=/review-admin
"${node_bin}" "${launch}"
pause_if_failed $?
