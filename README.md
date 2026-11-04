# intern-day-2-frontend

登录页 + 待办清单前端，React 19 + TypeScript + Vite。

- 配套后端仓库：`intern-day-2-backend`（地址：`https://github.com/<你的账号>/intern-day-2-backend`）
- 本仓库对应 PR：`（创建 PR 后补充）`
- 联调分支：`feat/login-and-custom-feature`

## 1. 功能范围与验收条件

必做流程：打开登录页 → 输入账号密码 → 后端校验 → 登录成功进入功能页 → 展示当前用户 → 增删改待办 → 退出登录。

| 页面 | 内容 |
| --- | --- |
| 登录页 | 账号输入、密码输入（`type="password"`）、登录按钮、错误提示、提交中禁用按钮 |
| 待办页 | 顶部显示当前用户与退出按钮；输入框新增待办；勾选切换完成状态；删除单条；底部统计 |

关键行为约定：

- **未登录**：应用直接渲染登录页，功能页不可见，且不存在可绕过的前端入口。
- **刷新页面**：本地有令牌时先调用 `GET /auth/me` 向后端复验，校验通过才进入功能页；失败则清掉令牌回到登录页。**不靠前端标志位判断登录**。
- **接口返回 401**：统一清除本地令牌并回到登录页，提示「登录状态已失效」。
- **退出登录**：先调用 `POST /auth/logout` 让服务端会话失效，再清理本地令牌并回登录页；即使后端不可用也会清理本地状态。
- **异常提示**：网络不可用、后端返回 4xx/5xx、校验失败都有对应文案，不会静默失败。

## 2. 目录结构

```text
src/
├── api.ts              # fetch 封装、令牌读写、错误归一化
├── types.ts            # User / LoginResponse / TodoItem
├── App.tsx             # 登录状态机：checking → anonymous / authenticated
├── App.css             # 页面与组件样式
├── index.css           # 基础样式与设计变量
├── main.tsx            # 应用入口
└── pages/
    ├── LoginPage.tsx   # 登录页
    └── TodoPage.tsx    # 登录后的待办页
```

## 3. 令牌保存与发送方式

- 保存在 `localStorage`，键名 `intern-day-2:token`。
- 每次请求通过 `Authorization: Bearer <token>` 发送，不使用跨域 Cookie，因此不需要处理 `credentials: include`。
- 令牌只在登录响应中出现一次，前端不做任何解析，只负责存取。
- 退出或收到 401 时立即删除本地令牌。

## 4. 环境变量

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `VITE_API_BASE_URL` | `http://localhost:8000` | 浏览器访问后端的基地址 |

`.env.example` 提供模板；`.env` 已被 `.gitignore` 忽略。注意这里必须是**浏览器能访问的地址**（宿主机映射端口），不是容器内部的服务名或容器 `localhost`。

## 5. 在开发容器中开发

需要 Docker、VS Code 与 Dev Containers 扩展。仓库根目录打开后执行 `Dev Containers: Reopen in Container`，容器内提供 Git、Node 20 与 pnpm。

```bash
pnpm install
pnpm dev            # vite.config.ts 已配置 host 0.0.0.0 与 5173 端口
```

## 6. 独立启动（Docker Compose）

```bash
docker compose config
docker compose up --build -d
docker compose ps
docker compose logs --tail=100
```

- 前端地址：`http://localhost:5173`
- 停止：`docker compose down`

镜像内使用 **Vite 开发服务器**，这是练习用的开发启动方式，不是生产构建；生产部署应先 `pnpm build` 再用静态服务器托管 `dist/`。Compose 构建上下文为本仓库目录，不依赖后端仓库。

## 7. 与后端联调

1. 先在后端仓库执行 `docker compose up --build -d`，确认 `http://localhost:8000/health` 返回 `{"status":"ok"}`。
2. 再在本仓库执行 `docker compose up --build -d`。
3. 浏览器打开 `http://localhost:5173`，使用后端初始化的练习账号登录。

两个仓库是两个独立的 Compose 项目，彼此不做服务发现；联调统一走宿主机端口，因此后端需要放行 `http://localhost:5173` 的 CORS 与预检请求。

## 8. 自测记录

| 检查项 | 操作 | 结果 |
| --- | --- | --- |
| 类型检查 | `pnpm exec tsc -b` | ✅ 0 错误（TypeScript 7.0.2） |
| 构建 | `pnpm build` | ⬜ 待执行 |
| 正常登录 | 正确账号密码 | ⬜ 待浏览器验证 |
| 错误密码 | 错误密码 / 空值 | ⬜ 待浏览器验证 |
| 刷新保持登录 | 登录后刷新 | ⬜ 待浏览器验证 |
| 未登录访问 | 直接打开页面 | ⬜ 待浏览器验证 |
| 凭证失效 | 后端返回 401 | ⬜ 待浏览器验证 |
| 退出登录 | 点击退出后回登录页 | ⬜ 待浏览器验证 |
| 网络异常 | 停止后端后操作 | ⬜ 待浏览器验证 |

浏览器相关项在容器中启动后逐条验证并补充截图。

## 9. 已知问题与限制

- 未引入路由库，用状态机切换页面；因此没有可分享的功能页 URL，属于练习范围内的简化。
- 使用 Vite 开发服务器演示，未做生产构建与静态托管。
- 登录页不做账号格式的复杂校验（仅非空 + 长度限制），错误提示以后端为准。
- 令牌保存在 `localStorage`，存在 XSS 场景下的泄露风险；正式项目建议评估 HttpOnly Cookie 方案。
