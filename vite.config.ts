import react from '@vitejs/plugin-react'
import { defineConfig, loadEnv } from 'vite'

// https://vite.dev/config/
//
// 浏览器只访问 5173 上的同源路径 /api/copilotkit，由 Vite 代理转发到 Runtime。
// 这样不依赖宿主机的 4000 端口转发：那个端口常被别的容器占用，
// VS Code「自动转发」会顺延到 4001，写死 4000 就会连到别人的 Runtime。
//
// target 优先级：compose 注入的进程环境变量 > .env 文件 > 同容器默认值。
// Dev Containers 里 Runtime 与 Vite 同容器，用 localhost:4000；
// Docker Compose 里 Runtime 是独立服务，compose.yaml 注入 http://runtime:4000。
export default defineConfig(({ mode }) => {
  const fileEnv = loadEnv(mode, process.cwd(), 'RUNTIME_')
  const runtimeTarget =
    process.env.RUNTIME_PROXY_TARGET ?? fileEnv.RUNTIME_PROXY_TARGET ?? 'http://localhost:4000'

  return {
    plugins: [react()],
    server: {
      // 监听 0.0.0.0，容器外（宿主机浏览器）才能访问
      host: true,
      port: 5173,
      strictPort: true,
      proxy: {
        '/api/copilotkit': {
          target: runtimeTarget,
          changeOrigin: false,
          // AG-UI 是 SSE 长连接，超时交给 Runtime 自己的空闲保护处理；
          // 代理层不要提前掐断，否则会出现「能发但不出字」。
          timeout: 0,
          proxyTimeout: 0,
        },
      },
    },
    preview: {
      host: true,
      port: 4173,
    },
  }
})
