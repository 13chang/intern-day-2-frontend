import { Capacitor } from '@capacitor/core'
import type {
  Activity,
  ActivityDraft,
  ActivityRuleset,
  ActivitySettings,
  AgentInfo,
  ConfirmResult,
  DailySummary,
  GenerateResult,
  LoginResponse,
  OperationResult,
  OverviewResult,
  PostponeResult,
  ReshuffleQuota,
  ReshuffleResult,
  SlotExplanation,
  SuggestResult,
  SuggestionDecision,
  SuggestionEngine,
  SuggestionEngineInfo,
  SummaryRunResult,
  TodoItem,
  UndoResult,
  User,
  WeeklyStats,
} from './types'

// 后端地址按运行环境取默认值，优先级从高到低：
// 1. 构建时注入的 VITE_API_BASE_URL —— 实体机联调用局域网 IP，例如
//    VITE_API_BASE_URL=http://192.168.1.20:8000 pnpm build
// 2. Capacitor 原生平台 —— Android 模拟器里只有 10.0.2.2 指向宿主机，
//    localhost 指的是模拟器自己，所以不能沿用浏览器那套默认值
// 3. 浏览器 / vite dev —— 直接访问宿主机映射出来的端口
const NATIVE_DEFAULT_BASE_URL = 'http://10.0.2.2:8000'
const WEB_DEFAULT_BASE_URL = 'http://localhost:8000'

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ??
  (Capacitor.isNativePlatform() ? NATIVE_DEFAULT_BASE_URL : WEB_DEFAULT_BASE_URL)

const TOKEN_KEY = 'intern-day-2:token'

export class ApiError extends Error {
  readonly status: number
  /**
   * 违反了哪条时间规则（后端 ``X-Rule-Code`` 响应头）。
   *
   * 有这个码，调用方就能说"去改工作时段"而不是只显示一句中文；
   * 没有（网络错误、401、非规则错误）时为 null。
   * 之所以不解析 ``detail`` 里的中文：文案改一个字匹配就静默失效，
   * 而失效的样子只是"提示突然变通用"，没人会发现。
   */
  readonly ruleCode: string | null

  constructor(status: number, message: string, ruleCode: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.ruleCode = ruleCode
  }
}

// 令牌保存在 localStorage：前后端分属不同端口，使用 Bearer 头比跨域 Cookie 更简单。
export function readToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function saveToken(token: string): void {
  localStorage.setItem(TOKEN_KEY, token)
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY)
}

function extractDetail(data: unknown): string | null {
  if (!data || typeof data !== 'object' || !('detail' in data)) return null
  const detail = (data as { detail: unknown }).detail
  if (typeof detail === 'string') return detail
  if (Array.isArray(detail) && detail.length > 0) {
    const first: unknown = detail[0]
    if (first && typeof first === 'object' && 'msg' in first) {
      const message = (first as { msg: unknown }).msg
      if (typeof message === 'string') return message
    }
  }
  return null
}

type RequestOptions = {
  method?: string
  body?: unknown
  withAuth?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, withAuth = true } = options
  const headers: Record<string, string> = {}

  if (body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  if (withAuth) {
    const token = readToken()
    if (token) headers.Authorization = `Bearer ${token}`
  }

  let response: Response
  try {
    response = await fetch(`${BASE_URL}${path}`, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    })
  } catch {
    throw new ApiError(0, '无法连接后端服务，请确认服务已启动')
  }

  if (response.status === 401) {
    // 凭证缺失、伪造、过期或已退出：清掉本地状态，由调用方回到登录页。
    clearToken()
    throw new ApiError(401, '登录状态已失效，请重新登录')
  }

  if (!response.ok) {
    let message = `请求失败（HTTP ${response.status}）`
    try {
      const detail = extractDetail(await response.json())
      if (detail) message = detail
    } catch {
      // 响应不是 JSON 时保留默认提示
    }
    // 后端的规则错误会带这个头。跨域下要能读到，后端在 CORS 里配了
    // expose_headers，否则这里永远是 null —— 表现为"按码映射文案"整段失效。
    throw new ApiError(response.status, message, response.headers.get('X-Rule-Code'))
  }

  if (response.status === 204) return undefined as T
  return (await response.json()) as T
}

export function login(username: string, password: string): Promise<LoginResponse> {
  return request<LoginResponse>('/auth/login', {
    method: 'POST',
    body: { username, password },
    withAuth: false,
  })
}

export function fetchMe(): Promise<User> {
  return request<User>('/auth/me')
}

export function logout(): Promise<void> {
  return request<void>('/auth/logout', { method: 'POST' })
}

export function listItems(): Promise<TodoItem[]> {
  return request<TodoItem[]>('/items')
}

export function createItem(title: string): Promise<TodoItem> {
  return request<TodoItem>('/items', { method: 'POST', body: { title } })
}

export function setItemDone(id: number, done: boolean): Promise<TodoItem> {
  return request<TodoItem>(`/items/${id}`, { method: 'PATCH', body: { done } })
}

export function removeItem(id: number): Promise<void> {
  return request<void>(`/items/${id}`, { method: 'DELETE' })
}

// 第三天：Agent 的运行信息。用来在页面上区分 Mock 和真实模型，
// 也用来确认后端 Agent 端点确实挂了（未登录会被 401 挡掉）。
export function fetchAgentInfo(): Promise<AgentInfo> {
  return request<AgentInfo>('/agent/info')
}

// ---------- 第五天：久坐活动助手 ----------
//
// 全部沿用上面的 request<T>()：错误统一抛 ApiError，message 就是后端 detail 里的中文。
// 页面只负责显示 message，不再自己拼错误文案。

export function fetchActivitySettings(): Promise<ActivitySettings> {
  return request<ActivitySettings>('/activity/settings')
}

export function saveActivitySettings(body: ActivitySettings): Promise<ActivitySettings> {
  return request<ActivitySettings>('/activity/settings', { method: 'PUT', body })
}

// 不传 day 就是今天。往前规划时前端把选中的日期传上来，
// 后端会校验它落在 [今天, 今天+14 天] 里，越界返回 422 并说清原因。
export function fetchDayActivities(day?: string): Promise<Activity[]> {
  const query = day ? `?day=${day}` : ''
  return request<Activity[]>(`/activity/today${query}`)
}

// 日期条用的数据：从今天起连续几天各排了几条，一次查完（后端一条 GROUP BY）
export function fetchActivityOverview(days = 15): Promise<OverviewResult> {
  return request<OverviewResult>(`/activity/overview?days=${days}`)
}

// force=true 用来"重建"：后端只清那天待执行的，已完成/已推迟/已跳过保留，周统计不会被打乱。
// engine 决定由谁排：rule=本地规则（不联网），llm=DeepSeek 真实模型。
// 两条路后端都会写库，也都过同一套 validate_slot —— 选模型不等于可以绕过免打扰和冲突。
export function generateDay(
  force = false,
  day?: string,
  options: { engine?: SuggestionEngine; note?: string } = {},
): Promise<GenerateResult> {
  const params = new URLSearchParams()
  if (force) params.set('force', 'true')
  if (day) params.set('day', day)
  const query = params.toString()
  return request<GenerateResult>(`/activity/generate${query ? `?${query}` : ''}`, {
    method: 'POST',
    body: { engine: options.engine ?? 'rule', note: options.note ?? null },
  })
}

export function completeActivity(id: number): Promise<OperationResult> {
  return request<OperationResult>(`/activity/${id}/complete`, { method: 'POST' })
}

export function postponeActivity(id: number): Promise<PostponeResult> {
  return request<PostponeResult>(`/activity/${id}/postpone`, { method: 'POST' })
}

export function skipActivity(id: number, reason?: string): Promise<OperationResult> {
  return request<OperationResult>(`/activity/${id}/skip`, {
    method: 'POST',
    body: { reason: reason ?? null },
  })
}

export function fetchWeeklyStats(): Promise<WeeklyStats> {
  return request<WeeklyStats>('/activity/stats/weekly')
}

// 哪些引擎现在能用。llm 需要后端 MODEL_MODE=real 且配好凭证，
// 所以必须问后端，不能在前端猜。
export async function fetchSuggestionEngines(): Promise<SuggestionEngineInfo[]> {
  const result = await request<{ engines: SuggestionEngineInfo[] }>('/activity/engines')
  return result.engines
}

// ---------- 第八天：时间规则 ----------
//
// 三个接口都不做本地规则计算：区间运算（跨天免打扰、窗口裁剪、间隔）只在后端一份。
// 前端算第二份的后果不是"性能更好"，而是两边在边界上慢慢漂，且漂了不报错。

// 当前生效的规则清单 + 那一天算出来的三段区间。
export function fetchActivityRules(day?: string): Promise<ActivityRuleset> {
  return request<ActivityRuleset>(`/activity/rules${day ? `?day=${day}` : ''}`)
}

// 设置面板边改边看用的预览：用**未保存**的草稿算，只算不存。
// 矛盾的条件不会报错，而是通过 notice 说明（编辑到一半本来就可能是矛盾的）。
export function previewActivityRules(
  settings: ActivitySettings,
  day?: string,
): Promise<ActivityRuleset> {
  return request<ActivityRuleset>(`/activity/rules/preview${day ? `?day=${day}` : ''}`, {
    method: 'POST',
    body: settings,
  })
}

// 解释某一个时刻：能不能排、卡在哪条规则、六条规则各自怎么说。
// at 传 HH:MM（配合 day）或完整 ISO 串。
export function explainActivitySlot(at: string, day?: string): Promise<SlotExplanation> {
  const params = new URLSearchParams({ at })
  if (day) params.set('day', day)
  return request<SlotExplanation>(`/activity/explain?${params.toString()}`)
}

// ---------- 第八天：建议列表、换一批、换一条、撤销 ----------
//
// 这一组接口的共同点：**草稿不落库**。只有用户在某一行的三个按钮上点了一下，
// 才走 /confirm 写入。所以"生成建议"可以随便点，不会在日程里留下痕迹。

export type SuggestOptions = {
  engine?: SuggestionEngine
  count?: number
  // 只给 llm 用：这次想让模型额外考虑什么
  note?: string
  day?: string
  // 换一批：上一批的时刻，后端会排除掉。不传就是首次生成
  exclude?: string[]
}

// 只算不存。后端会把"那天还剩哪些可活动时段"和规则清单一起用掉，
// 返回的每条草稿都已经过了 validate_slot。
export function fetchActivitySuggestions(
  options: SuggestOptions = {},
): Promise<SuggestResult> {
  return request<SuggestResult>('/activity/suggestions', {
    method: 'POST',
    body: {
      engine: options.engine ?? 'rule',
      count: options.count ?? null,
      note: options.note ?? null,
      day: options.day ?? null,
      exclude: options.exclude ?? [],
    },
  })
}

export type ConfirmItem = ActivityDraft & { decision: SuggestionDecision }

// 保存草稿并**同时**落地用户点的那个决策。
// 分两步（先存待执行、再调 complete）会在第二步失败时留下一条
// "用户以为已完成、实际待执行"的记录，周统计里少一次。
export function confirmActivitySuggestions(items: ConfirmItem[]): Promise<ConfirmResult> {
  return request<ConfirmResult>('/activity/confirm', { method: 'POST', body: { items } })
}

// 换一条：把某一条挪到最近的空位。
// keep 必须带上同批其他几条的时刻 —— 它们还没入库，后端不知道它们占着位置。
export function reshuffleActivitySuggestion(payload: {
  at: string
  activity_type?: string
  keep?: string[]
  day?: string
}): Promise<ReshuffleResult> {
  return request<ReshuffleResult>('/activity/suggestions/reshuffle', {
    method: 'POST',
    body: payload,
  })
}

// 今天还能换几次。由后端按自然日算：前端自己数一定对不上
// （另一个标签页、手机上也有人在消耗），最后表现为"按钮亮着但点了报错"。
export function fetchReshuffleQuota(): Promise<ReshuffleQuota> {
  return request<ReshuffleQuota>('/activity/reshuffle/quota')
}

// 撤销刚才在建议里点的那一下。5 秒窗口由后端判，前端只负责显示倒计时。
// 撤销 = 删掉那条记录（它本来就不存在），不是把状态改回待执行。
export function undoActivity(id: number): Promise<UndoResult> {
  return request<UndoResult>(`/activity/${id}/undo`, { method: 'POST' })
}

// ---------- 第六天：每日总结 ----------
//
// 两个接口都不做本地缓存：任务书要求「刷新后读取服务端保存的日报」，
// 存进 localStorage 只会让人看到一份和后端不一致的旧数字。

// 不传 day 就是昨天。后端把"这一天还没生成"当成 200 + status="missing"，
// 所以"没有日报"不会抛错，页面按 status 分支画不同状态即可。
export function fetchDailySummary(day?: string): Promise<DailySummary> {
  return request<DailySummary>(`/summary${day ? `?day=${day}` : ''}`)
}

// **只入队，不等模型**：返回时任务通常还没开始跑。
// 200 里也可能带 status=ready / generating / deduplicated（都不是失败），
// 只有 Redis 挂了才是 503，那种情况由 request() 抛 ApiError。
export function runDailySummary(day?: string): Promise<SummaryRunResult> {
  return request<SummaryRunResult>(`/summary/run${day ? `?day=${day}` : ''}`, {
    method: 'POST',
  })
}
