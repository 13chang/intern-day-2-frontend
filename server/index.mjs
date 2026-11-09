/**
 * CopilotKit Runtime：浏览器和 Python Agent 之间的一层 Node 服务。
 *
 * 它是干什么的：
 * - 浏览器里的 CopilotKit 只认识 HTTP，不认识 Python；
 * - 它把浏览器的请求转成 AG-UI 的 RunAgentInput，用 POST 发给 Python 的 /agent；
 * - 把 Python 回来的 SSE 事件流原样转回浏览器。
 *
 * 为什么不能省掉它：Vite 开发服务器只负责提供前端静态资源和热更新，
 * 它没有 CopilotKit 的运行时能力（/info、/agent/run、线程管理等）。
 * 所以这里单独起一个 Express 服务，作为 Compose 里的第二个服务运行。
 *
 * 认证怎么过去：浏览器把 Authorization 头带给本服务，
 * 本服务按请求把它塞进 HttpAgent 的 headers，再带给 Python。
 * 本服务不解析、不缓存、不记录令牌，也不持有任何特权凭证——
 * 每个用户只带自己的令牌，Python 那边用同一张会话表校验。
 */

import { createHash } from "node:crypto";
import express from "express";
import { CopilotRuntime, createCopilotExpressHandler } from "@copilotkit/runtime/v2";
import { HttpAgent } from "@ag-ui/client";

const PORT = Number(process.env.PORT ?? 4000);
const AGENT_ID = process.env.AGENT_ID ?? "todo-agent";
// 容器里访问宿主机映射端口，靠 compose 里的 host.docker.internal:host-gateway
const AGENT_URL = process.env.AGENT_URL ?? "http://localhost:8000/agent";
const BASE_PATH = process.env.COPILOT_BASE_PATH ?? "/api/copilotkit";
// 浏览器来源 + Capacitor App 的 WebView 来源（http://localhost，不带端口）。
// 后者漏了的话，App 里 AgentChat 拉 /info 会被 CORS 拦掉，整块区域没有响应。
const DEFAULT_ORIGINS =
  "http://localhost:5173,http://127.0.0.1:5173,http://localhost";
const ALLOWED_ORIGINS = (process.env.RUNTIME_CORS_ORIGINS ?? DEFAULT_ORIGINS)
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

/**
 * 给 Runtime 一个「谁在用它」的标识，用于线程归属。
 *
 * 注意边界：这里不验证令牌，真正的鉴权在 Python 侧。
 * 这里只是把令牌的摘要当作归属人，好处是别人拿着别人的 threadId
 * 也读不到对方的会话记录；代价是同一个账号重新登录后令牌变了，
 * 旧会话就找不回来了——本项目的会话本来也不跨登录保留。
 */
function identifyUser(request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (!authorization) return { id: "anonymous", name: "未登录" };
  const digest = createHash("sha256").update(authorization).digest("hex").slice(0, 16);
  return { id: `bearer-${digest}`, name: "练习用户" };
}

const runtime = new CopilotRuntime({
  // 每个请求都重新解析一次 Agent，这样才能把该请求自己的 Authorization 传下去。
  // 写成静态对象的话，所有用户会共用同一个不带令牌（或带同一个令牌）的 Agent。
  agents: ({ request }) => {
    const authorization = request.headers.get("authorization") ?? undefined;
    return {
      [AGENT_ID]: new HttpAgent({
        url: AGENT_URL,
        headers: authorization ? { Authorization: authorization } : {},
      }),
    };
  },
  identifyUser,
});

const app = express();
app.disable("x-powered-by");

// 只记方法和路径。请求头里有登录令牌，一律不入日志。
app.use((req, _res, next) => {
  console.log(`[runtime] ${req.method} ${req.path}`);
  next();
});

app.get("/health", (_req, res) => {
  res.json({ status: "ok", agent: AGENT_ID, agentUrl: AGENT_URL });
});

/**
 * 上游无响应时的兜底：不让浏览器一直转圈。
 *
 * 实测过的两种情况差别很大：
 * - 后端进程被杀 → 连接直接被拒，Runtime 立刻发出 RUN_ERROR（约 60ms），页面正常报错；
 * - 后端被 SIGSTOP 暂停 / 模型挂住 / 网络黑洞 → SSE 响应能建立，但永远没有数据。
 *   这种"连得上但不说话"最难受：没有任何错误事件，前端就一直停在"发送中"。
 *
 * 所以这里加一道空闲保护：本次运行超过 STREAM_IDLE_TIMEOUT_MS 吐不出任何字节，
 * 就主动写一条 RUN_ERROR 再关闭连接，前端据此结束等待并提示失败。
 * 只要还在持续输出（Mock 的增量间隔是 50ms），计时就会被不断重置，不会误伤长回复。
 */
const STREAM_IDLE_TIMEOUT_MS = Number(process.env.STREAM_IDLE_TIMEOUT_MS ?? 20000);

app.use(BASE_PATH, (req, res, next) => {
  if (!req.path.endsWith("/run")) return next();

  let finished = false;
  const timer = setTimeout(() => {
    if (finished || res.writableEnded) return;
    const seconds = Math.round(STREAM_IDLE_TIMEOUT_MS / 1000);
    console.warn(`[runtime] 上游 ${STREAM_IDLE_TIMEOUT_MS}ms 无任何数据，主动结束本次运行`);
    try {
      res.write(
        `data: ${JSON.stringify({
          type: "RUN_ERROR",
          message: `后端 Agent 超过 ${seconds} 秒没有响应，已断开`,
          code: "UPSTREAM_TIMEOUT",
        })}\n\n`,
      );
    } catch {
      // 连接已经断了，不需要再处理
    }
    res.end();
  }, STREAM_IDLE_TIMEOUT_MS);

  const stop = () => {
    finished = true;
    clearTimeout(timer);
  };
  res.on("finish", stop);
  res.on("close", stop);

  // 有数据写出就重置计时：只要上游还在吐，就不算空闲
  const originalWrite = res.write.bind(res);
  res.write = (...args) => {
    timer.refresh();
    return originalWrite(...args);
  };

  next();
});

app.use(
  createCopilotExpressHandler({
    runtime,
    basePath: BASE_PATH,
    cors: {
      origin: ALLOWED_ORIGINS,
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      maxAge: 600,
    },
  }),
);

app.listen(PORT, "0.0.0.0", () => {
  console.log(`[runtime] listening on :${PORT}${BASE_PATH} -> ${AGENT_URL}`);
});
