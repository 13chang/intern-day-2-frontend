FROM mcr.microsoft.com/devcontainers/typescript-node:20-bookworm

# 开发容器只提供工具链（Git / Node / pnpm），服务由 compose 启动
RUN corepack enable && npm install -g pnpm@latest
