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

export type Tab = 'activity' | 'todo' | 'summary'

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

// 建议草稿的响应形状（ActivityDraft / SuggestResult / ConfirmResult）随"安排建议"
// 面板一起下线了：现在生成是一次点击直接落库，中间那层草稿不再经过前端。
// 后端仍保留 POST /activity/suggestions 与 /confirm（只算不存的能力还在）。

export type GenerateResult = {
  // 这批安排写到了哪一天。页面上同时能看今天和未来几天，
  // 不靠回显的话，客户端只能假设"就是刚才选的那天"
  day: string
  created: number
  activities: Activity[]
  notice: string
  // 这批是谁排的：rule 是本地规则，llm 是 DeepSeek 真实模型
  mode: string
  // 模型给的排程理由（规则引擎没有这一段）
  explanation: string
}

export type PostponeResult = {
  original: Activity
  replacement: Activity
}

export type OperationResult = {
  activity: Activity
  idempotent?: boolean
}

// 生成引擎：rule = 服务端规则算法，llm = DeepSeek 真实模型
export type SuggestionEngine = 'rule' | 'llm'

export type SuggestionEngineInfo = {
  id: SuggestionEngine
  label: string
  // 后端是否具备调用条件（llm 需要 MODEL_MODE=real 且配好凭证）
  available: boolean
  model: string | null
  reason: string
}

// 日期条上的一天。后端按天聚合，不是每天一个完整列表
export type DayOverview = {
  date: string
  // 计划总数：只数原始条目，推迟产生的替代条目不重复计（和周统计同口径）
  total: number
  planned: number
  completed: number
  postponed: number
  skipped: number
}

export type OverviewResult = {
  today: string
  // 最多能提前几天规划，由后端 rules.MAX_PLAN_DAYS 决定，前端不自己写死
  max_plan_days: number
  days: DayOverview[]
}

// ---------- 第六天：每日总结 ----------
//
// 与后端 app/routers/summary.py 的 SummaryOut 一一对应。
// 页面上有五种状态，missing 表示"这一天还没有日报"（后端返回 200，不是 404），
// 所以 status 不能省成 ready | failed 两种 —— 少一种页面就会把"没生成"画成"出错"。

export type SummaryStatus = 'missing' | 'pending' | 'generating' | 'ready' | 'failed'

export type DailySummary = {
  date: string
  status: SummaryStatus

  // 统计数字一律照抄后端。前端不做任何加减 —— 口径只在后端一份，
  // 不然"完成数可能大于计划数"这种规则迟早两边对不上。
  planned_total: number
  completed: number
  skipped: number
  unfinished: number
  // 推迟**操作**次数，不是活动条数；不能和 completed 相加当总数
  postpone_ops: number
  // 恒为 null：本项目没有自报久坐时长的入口。页面写"未记录"，不写 0 分钟
  sedentary_minutes: number | null
  has_records: boolean

  review: string | null
  suggestion: string | null
  // rule = 本地模板（离线可用），llm = DeepSeek 真实模型
  source: 'rule' | 'llm' | null
  model: string | null
  generated_at: string | null

  error_code: string | null
  error_message: string | null
}

// POST /summary/run 的返回。**只表示入队情况，不表示已经生成好了。**
export type SummaryRunStatus = 'ready' | 'generating' | 'queued' | 'deduplicated'

export type SummaryRunResult = {
  date: string
  queued: boolean
  status: SummaryRunStatus
  job_id: string | null
  message: string
}
