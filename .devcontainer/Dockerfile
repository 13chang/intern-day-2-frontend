# 基镜像使用 Docker Hub 的 node 官方镜像（glibc 版，与 WSL 本地依赖匹配），
# 避免 mcr.microsoft.com 在国内拉取大层时断流
FROM node:20-bookworm

ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 不用 corepack：它会先建 /usr/local/bin/pnpm 软链，导致 npm install -g pnpm 报 EEXIST
RUN npm install -g pnpm@10
