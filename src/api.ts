import type { LoginResponse, TodoItem, User } from './types'

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
