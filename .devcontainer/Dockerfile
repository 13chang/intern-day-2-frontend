FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm

# 开发容器只提供工具链（Git / Node / pnpm），服务由 compose 启动
# 先指定 npm 镜像源，避免构建时访问 registry.npmjs.org 超时
RUN npm config set registry https://registry.npmmirror.com \
    && corepack enable \
    && npm install -g pnpm@latest
