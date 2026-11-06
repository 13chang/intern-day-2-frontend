import type {
  Activity,
  ActivityDraft,
  ActivitySettings,
  AgentInfo,
  ConfirmResult,
  GenerateResult,
  LoginResponse,
  OperationResult,
  PostponeResult,
  SuggestResult,
  TodoItem,
  User,
  WeeklyStats,
} from './types'

const BASE_URL =
  (import.meta.env.VITE_API_BASE_URL as string | undefined) ?? 'http://localhost:8000'

const TOKEN_KEY = 'intern-day-2:token'

export class ApiError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiError'
    this.status = status
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
    throw new ApiError(response.status, message)
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

export function fetchTodayActivities(): Promise<Activity[]> {
  return request<Activity[]>('/activity/today')
}

// force=true 用来"重建"：后端只清当天待执行的，已完成/已推迟/已跳过保留，周统计不会被打乱
export function generateToday(force = false): Promise<GenerateResult> {
  const query = force ? '?force=true' : ''
  return request<GenerateResult>(`/activity/generate${query}`, { method: 'POST' })
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

// 只算不存：返回的是草稿，用户点"确认保存"才走 confirmActivityDrafts
export function suggestActivities(body: { count?: number; note?: string } = {}): Promise<SuggestResult> {
  return request<SuggestResult>('/activity/suggestions', { method: 'POST', body })
}

export function confirmActivityDrafts(items: ActivityDraft[]): Promise<ConfirmResult> {
  return request<ConfirmResult>('/activity/confirm', { method: 'POST', body: { items } })
}
