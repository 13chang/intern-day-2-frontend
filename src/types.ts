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
  // 模型给出、但被规则（免打扰/时段/冲突）丢掉的条数
  dropped: number
}

// 生成建议的引擎：rule = 服务端规则算法，llm = DeepSeek 真实模型
export type SuggestionEngine = 'rule' | 'llm'

export type SuggestionEngineInfo = {
  id: SuggestionEngine
  label: string
  // 后端是否具备调用条件（llm 需要 MODEL_MODE=real 且配好凭证）
  available: boolean
  model: string | null
  reason: string
}

// 建议面板里的条件表单。只对这一次生成生效，不写回 /activity/settings
export type SuggestConditions = {
  work_start: string
  work_end: string
  windows: ActivityWindow[]
  quiet_start: string
  quiet_end: string
  // 勾上就用"本次不考虑免打扰"代替上面两个时间
  ignore_quiet: boolean
  count: number
  note: string
}

// 发给后端的形状：表单里空字符串表示"没填"，接口上要传 null 才表示"没有免打扰"
export type SuggestConditionsPayload = {
  work_start: string
  work_end: string
  windows: ActivityWindow[]
  quiet_start: string | null
  quiet_end: string | null
  ignore_quiet: boolean
}

export type ConfirmResult = {
  saved: number
  activities: Activity[]
}
