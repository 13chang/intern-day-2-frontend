# 练习用镜像：用 Vite 开发服务器演示，不是生产构建
FROM node:20-slim

# 容器内默认访问不了 registry.npmjs.org，构建与运行统一走镜像源
ENV NPM_CONFIG_REGISTRY=https://registry.npmmirror.com

# 不用 corepack：它会先建 /usr/local/bin/pnpm 软链，导致 npm install -g pnpm 报 EEXIST
RUN npm install -g pnpm@10

WORKDIR /app

# 先装依赖，充分利用层缓存；按锁文件安装保证一致
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

COPY . .

EXPOSE 5173

CMD ["pnpm", "dev", "--host", "0.0.0.0", "--port", "5173"]
