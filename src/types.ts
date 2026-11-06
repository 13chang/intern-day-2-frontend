export type User = {
  id: number
  username: string
  display_name: string
}

export type LoginResponse = {
  token: string
  token_type: string
  expires_in: number
  user: User
}

export type TodoItem = {
  id: number
  title: string
  done: boolean
  created_at: number
}

// 后端 GET /agent/info 的返回，用来在页面上如实标注当前是 Mock 还是真实模型
export type AgentInfo = {
  agent: string
  mode: 'mock' | 'openai'
  model: string | null
  tools: string[]
  reason: string
}

// ---------- 第五天：久坐活动助手 ----------

export type Tab = 'activity' | 'todo'

// 四个字面量与后端 ActivityOut.status 一一对应，
// 少写一个就会在状态徽标那里漏掉分支（tsc 会报 exhaustive 相关的错）。
export type ActivityStatus = 'planned' | 'completed' | 'postponed' | 'skipped'
export type ActivityType = 'walk' | 'water' | 'stretch' | 'stand'
export type ActivitySource = 'rule' | 'agent'

export type Activity = {
  id: number
  activity_type: ActivityType
  title: string
  description: string
  // ISO 文本，带 +08:00 偏移，例如 2026-11-06T10:00:00+08:00
  scheduled_at: string
  duration_min: number
  status: ActivityStatus
  source: ActivitySource
  postponed_from: number | null
  postpone_count: number
  skipped_reason: string | null
}

export type ActivityWindow = {
  label: string
  start: string
  end: string
}

// 提交给 PUT /activity/settings 的形状。
// 响应里还多一个 user_id，前端用不到，故意不声明（结构类型允许多余字段）。
export type ActivitySettings = {
  work_start: string
  work_end: string
  windows: ActivityWindow[]
  quiet_start: string | null
  quiet_end: string | null
  reminders_enabled: boolean
  allow_during_work: boolean
  daily_target: number
  postpone_policy: 'next_slot' | 'ask'
}

export type ActivityDay = {
  date: string
  completed: number
  total: number
}

export type WeeklyStats = {
  week_start: string
  week_end: string
  planned: number
  completed: number
  postponed: number
  skipped: number
  days: ActivityDay[]
}

// 建议草稿：没有 id，因为它还没进库
export type ActivityDraft = {
  scheduled_at: string
  activity_type: string
  title: string
  description: string
  duration_min: number
  reason: string
}

export type GenerateResult = {
  created: number
  activities: Activity[]
  notice: string
}

export type PostponeResult = {
  original: Activity
  replacement: Activity
}

export type OperationResult = {
  activity: Activity
  idempotent?: boolean
}

export type SuggestResult = {
  suggestions: ActivityDraft[]
  explanation: string
  notice: string
  mode: string
}

export type ConfirmResult = {
  saved: number
  activities: Activity[]
}
