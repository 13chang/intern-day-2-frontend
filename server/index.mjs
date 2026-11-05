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
const DEFAULT_ORIGINS = "http://localhost:5173,http://127.0.0.1:5173";
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
