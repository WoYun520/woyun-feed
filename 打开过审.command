#!/bin/zsh
# Levi flow · 本机过审入口
# 和「打开 Levi flow.command」启动同一个本机服务，浏览器直接打开 /review-admin。
script_path=${0:A}
root=${script_path:h}
launch="${root}/frontend/launch.mjs"

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
  exit 1
fi
export LEVI_OPEN_PATH=/review-admin
exec "${node_bin}" "${launch}"
