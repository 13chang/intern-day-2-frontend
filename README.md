# intern-day-2-frontend

登录页 + 待办清单 + Agent 对话前端，React 19 + TypeScript + Vite；
第三天新增 CopilotKit 接入，以及一个轻量 Node Runtime 服务。

- 配套后端仓库：`intern-day-2-backend`（地址：`https://github.com/13chang/intern-day-2-backend`）
- 第二天 PR：`https://github.com/13chang/intern-day-2-frontend/pull/1`（分支 `feat/login-and-custom-feature`）
- 第三天分支：`feat/agent-chat`，第三天 PR 以 `feat/login-and-custom-feature` 为 base（第二天 PR 尚未合并）
- 原理说明与交互图（维护在后端仓库，两处不重复）：
  - `intern-day-2-backend` 仓库 `docs/day-3-agent-learning.md`
  - `intern-day-2-backend` 仓库 `docs/diagrams/day-3-agent-interaction.png`

## 1. 功能范围与验收条件

必做流程：打开登录页 → 输入账号密码 → 后端校验 → 登录成功进入功能页 → 展示当前用户 → 增删改待办 → 退出登录。

| 页面 | 内容 |
| --- | --- |
| 登录页 | 账号输入、密码输入（`type="password"`）、登录按钮、错误提示、提交中禁用按钮 |
| 待办页 | 左侧：当前用户与退出按钮、新增/勾选/删除/统计；右侧：任务助手对话 |
| 任务助手 | 输入问题、展示用户消息、流式显示 Agent 回复、发送中与失败状态、新建对话 |

关键行为约定：

- **未登录**：应用直接渲染登录页，功能页与助手都不可见；但**后端鉴权才是真正的拦截**，前端只是不渲染。
- **刷新页面**：本地有令牌时先调用 `GET /auth/me` 向后端复验，校验通过才进入功能页；失败则清掉令牌回到登录页。**不靠前端标志位判断登录**。
- **接口返回 401**：统一清除本地令牌并回到登录页，提示「登录状态已失效」。
- **退出登录**：先调用 `POST /auth/logout` 让服务端会话失效，再清理本地令牌并回登录页；即使后端不可用也会清理本地状态。
- **异常提示**：网络不可用、后端返回 4xx/5xx、校验失败都有对应文案，不会静默失败。

## 2. 目录结构

```text
server/
└── index.mjs           # 第三天新增：CopilotKit Runtime（Express），独立进程
src/
├── api.ts              # fetch 封装、令牌读写、错误归一化、Agent 信息查询
├── types.ts            # User / LoginResponse / TodoItem / AgentInfo
├── App.tsx             # 登录状态机：checking → anonymous / authenticated
├── App.css             # 页面与组件样式（含第三天双栏布局）
├── index.css           # 基础样式与设计变量
├── main.tsx            # 应用入口
├── agent/
│   └── TodoAssistant.tsx   # 第三天：CopilotKitProvider + CopilotChat + 新建对话
└── pages/
    ├── LoginPage.tsx   # 登录页
    └── TodoPage.tsx    # 登录后的待办页（左右双栏）
```

## 3. 令牌保存与发送方式

- 保存在 `localStorage`，键名 `intern-day-2:token`。
- 每次请求通过 `Authorization: Bearer <token>` 发送，不使用跨域 Cookie，因此不需要处理 `credentials: include`。
- 令牌只在登录响应中出现一次，前端不做任何解析，只负责存取。
- 退出或收到 401 时立即删除本地令牌。
- Agent 请求也带同一个令牌：`CopilotKitProvider` 的 `headers` 传的是**函数**而不是对象，
  每次请求前现取一次，这样退出登录后接下来的请求立刻不带旧令牌。

## 4. 第三天：CopilotKit 与 Runtime

### 4.1 为什么多了一个 Node 服务

CopilotKit 的架构是「前端 → Runtime → Agent」。Vite 开发服务器只做模块编译、静态资源和 HMR，
没有 CopilotKit 需要的运行时接口（`/info`、`/agent/:id/run`、线程管理等），也不能替代它。
所以本仓库多了一个 `server/index.mjs`，作为 Compose 里的第二个服务跑在 4000 端口。

```text
浏览器 :5173  →  Runtime :4000 /api/copilotkit  →  后端 :8000/agent（AG-UI，SSE）
```

### 4.2 认证怎么过去

1. 浏览器发给 Runtime 的每个请求都带 `Authorization: Bearer <令牌>`（由 Provider 的 `headers` 提供）；
2. `server/index.mjs` 里的 `agents` 是**工厂函数**，每个请求重新构造 `HttpAgent`，把该请求自己的
   Authorization 原样放进去；
3. Python 后端用同一张会话表校验，失败返回 401。

工厂函数这一点不能省：写成静态的 `agents: { "todo-agent": new HttpAgent(...) }`，
所有用户会共用同一个 Agent 实例，等于所有人共用一个令牌（或都没有令牌）。

Runtime 自己不解析、不缓存、不记录令牌；日志只打方法与路径。

### 4.3 版本与接口

| 组件 | 版本 |
| --- | --- |
| `@copilotkit/react-core` | 1.84.1（使用 `./v2` 子路径） |
| `@copilotkit/runtime` | 1.84.1（使用 `./v2` 的 `createCopilotExpressHandler`） |
| `@ag-ui/client` | 1.0.3（`HttpAgent`） |
| React / Vite | 19.3.1 / 8.3.5 |

- Agent 标识：前端 `agentId="todo-agent"`，Runtime 注册的 key 也是 `todo-agent`，**两处必须一致**。
- Runtime 基地址：`http://localhost:4000/api/copilotkit`（浏览器视角）。
- Runtime 访问后端的地址：`http://host.docker.internal:8000/agent`（容器视角，compose 里配了 `host-gateway`）。

### 4.4 会话与上下文

- 对话历史由浏览器维护，CopilotKit 每次运行把整个会话的 `messages` 一起发出去；服务端不落库。
- 「新建对话」= 换 `key` 重新挂载 `<CopilotChat />`，等于开一个新 `threadId`，旧对话不再显示。
- 退出或换账号：Provider 用 `key={user.id}` 重新挂载，界面上的会话立即清空。
- 刷新页面：对话从空白开始（令牌还在，登录状态保留）。
- Runtime 侧用 `identifyUser` 把令牌摘要作为线程归属，别人拿到 `threadId` 也读不到我的会话；
  **这不是鉴权**，鉴权始终在 Python 后端。

## 5. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | 浏览器访问后端的基地址 |
| `VITE_COPILOT_RUNTIME_URL` | `http://localhost:4000/api/copilotkit` | 浏览器访问 Runtime 的基地址 |
| `AGENT_URL` | `http://host.docker.internal:8000/agent` | Runtime 容器访问后端的地址 |
| `AGENT_ID` | `todo-agent` | Runtime 注册的 Agent 标识，需与前端一致 |
| `PORT` | `4000` | Runtime 监听端口 |
| `RUNTIME_CORS_ORIGINS` | `http://localhost:5173,http://127.0.0.1:5173` | Runtime 放行的来源 |
| `COPILOTKIT_TELEMETRY_DISABLED` | `true`（compose 中设置） | 练习项目不向第三方发送使用数据 |

`.env.example` 提供模板；`.env` 已被 `.gitignore` 忽略。`VITE_` 开头的变量会进打包产物，
**不要往里放任何密钥**——模型密钥只在后端容器的环境变量里。

## 6. 在开发容器中开发

需要 Docker、VS Code 与 Dev Containers 扩展。仓库根目录打开后执行 `Dev Containers: Reopen in Container`，容器内提供 Git、Node 20 与 pnpm。

```bash
pnpm install
pnpm dev            # 前端，vite.config.ts 已配置 host 0.0.0.0 与 5173 端口
pnpm dev:runtime    # 另开一个终端：CopilotKit Runtime，监听 4000
```

两个进程都要起，只起 `pnpm dev` 时聊天框会报连接失败。

## 7. 独立启动（Docker Compose）

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs --tail=100
```

本仓库的 compose 现在包含两个服务：

| 服务 | 容器名 | 端口 | 说明 |
| --- | --- | --- | --- |
| `frontend` | `intern-day-2-frontend` | 5173 | Vite 开发服务器 |
| `runtime` | `intern-day-2-runtime` | 4000 | CopilotKit Runtime |

两个服务用同一份镜像，只是启动命令不同，避免把依赖装两遍。

- 前端地址：`http://localhost:5173`
- Runtime 健康检查：`http://localhost:4000/health`
- 停止：`docker compose down`

镜像内使用 **Vite 开发服务器**，这是练习用的开发启动方式，不是生产构建；生产部署应先 `pnpm build` 再用静态服务器托管 `dist/`。Compose 构建上下文为本仓库目录，不依赖后端仓库。

## 8. 与后端联调

1. 先在后端仓库执行 `docker compose up --build -d`，确认 `http://localhost:8000/health` 返回 `{"status":"ok"}`。
2. 再在本仓库执行 `docker compose up --build -d`（会同时起前端与 Runtime）。
3. 浏览器打开 `http://localhost:5173`，使用后端初始化的练习账号登录。

两个仓库是两个独立的 Compose 项目，彼此不做服务发现；联调统一走宿主机端口：

- 浏览器 → 后端：`http://localhost:8000`
- 浏览器 → Runtime：`http://localhost:4000`
- Runtime 容器 → 后端：`http://host.docker.internal:8000/agent`

因此后端需要放行 `http://localhost:5173` 的 CORS 与预检请求，Runtime 需要放行同一个来源。

## 9. 自测记录

| 检查项 | 操作 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm exec tsc -b` | ✅ 0 错误（TypeScript 7.0.2） |
| 构建 | `pnpm build` | ✅ 通过（Node 20 容器内执行，产物含 CopilotKit） |
| 依赖可复现 | `pnpm install --frozen-lockfile` | ✅ 与 `pnpm-lock.yaml` 一致 |
| Runtime 启动 | `node server/index.mjs` | ✅ `/health` 与 `/api/copilotkit/info` 均 200，`info` 列出 `todo-agent` |
| Runtime 转发 | `POST /api/copilotkit/agent/todo-agent/run` | ✅ 事件流完整返回，工具结果正确 |
| 无凭证 | 同上但不带 Authorization | ⚠️ HTTP 200 + `RUN_ERROR`（内含 401），前端据此回登录页 |
| 正常登录 | 正确账号密码 | ⬜ 待浏览器验证 |
| 错误密码 | 错误密码 / 空值 | ⬜ 待浏览器验证 |
| 刷新保持登录 | 登录后刷新 | ⬜ 待浏览器验证 |
| 未登录访问 | 直接打开页面 | ⬜ 待浏览器验证 |
| Agent 流式对话 | 登录后提问，观察 Network | ⬜ 待浏览器验证 |
| 多轮上下文 | 连续两轮，第二轮引用第一轮 | ⬜ 待浏览器验证 |
| 工具调用 | 问「我还有哪些没做完」 | ⬜ 待浏览器验证（后端侧已验证工具执行） |
| 新建对话 | 点「新建对话」后界面清空 | ⬜ 待浏览器验证 |
| 退出登录 | 点击退出后回登录页且会话清空 | ⬜ 待浏览器验证 |

类型检查、构建、依赖安装、Runtime 与后端链路已在容器内实际执行；带 ⬜ 的项是浏览器交互，
需要在本机跑起两个 compose 后逐条点一遍并补截图。

## 10. 已知问题与限制

- 未引入路由库，用状态机切换页面；因此没有可分享的功能页 URL，属于练习范围内的简化。
- 使用 Vite 开发服务器演示，未做生产构建与静态托管。
- 登录页不做账号格式的复杂校验（仅非空 + 长度限制），错误提示以后端为准。
- 令牌保存在 `localStorage`，存在 XSS 场景下的泄露风险；正式项目建议评估 HttpOnly Cookie 方案。
- 打包体积偏大：CopilotKit 会带入代码高亮、图表等依赖，首包约 2MB（gzip 后约 600KB），未做拆包优化。
- 对话历史只在内存中，刷新即丢；服务端也未持久化。
- Runtime 的 `identifyUser` 用令牌摘要作为线程归属，不是鉴权；同一账号重新登录后令牌变化，
  旧会话记录找不回来。
- 真实模型尚未接通（缺后端 `APP_LLM_*` 凭证），当前页面顶部会显示「Mock 模式」提示。
