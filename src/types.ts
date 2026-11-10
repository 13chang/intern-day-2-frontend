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

// ---------- 第八天：链路视图 ----------
//
// 对应后端 GET /agent/runs/{runId}/trace。字段都是结构信息：
// span 名字、耗时、白名单内属性、安全事件、规则评分。
// 里面**没有**对话原文 —— 后端刻意不存，这里也就不可能显示。

export type TraceEvent = {
  name: string
  at_ms: number
  attributes: Record<string, unknown>
}

export type TraceSpan = {
  name: string
  span_id: string
  parent_id: string | null
  /** 相对这次运行起点的毫秒偏移。只有时长画不出瀑布图（会一律看着像串行） */
  started_ms: number
  duration_ms: number
  attributes: Record<string, unknown>
  status: string
  events: TraceEvent[]
}

/** 安全信号：由 span 上的安全事件聚合而来（注入命中、输出被截断） */
export type TraceSignal = {
  kind: string
  span: string
  at_ms: number
  attributes: Record<string, unknown>
}

/** 规则评分。返回 null 表示后端还没算（旧版本或面板关掉） */
export type TraceEvaluation = {
  version: number
  score: number
  verdict: 'good' | 'warn' | 'bad'
  intent: string | null
  findings: { kind: string; detail: string; penalty: number }[]
  span_count: number
}

export type RunTrace = {
  trace_id: string
  run_id: string | null
  span_count: number
  total_ms: number
  spans: TraceSpan[]
  signals: TraceSignal[]
  evaluation: TraceEvaluation | null
}

// ---------- 第五天：久坐活动助手 ----------

export type Tab = 'activity' | 'todo' | 'summary'

// 四个字面量与后端 ActivityOut.status 一一对应，
// 少写一个就会在状态徽标那里漏掉分支（tsc 会报 exhaustive 相关的错）。
export type ActivityStatus = 'planned' | 'completed' | 'postponed' | 'skipped'
/** 内置四类。它们在后端是常量（`rules.ACTIVITY_CATALOG`），删不掉 */
export type BuiltinActivityType = 'walk' | 'water' | 'stretch' | 'stand'
/**
 * 活动类型。
 *
 * 第十天起**不再是固定四类**：用户可以在设置页里自己加（key 形如 `custom_1`），
 * 后端把内置四类和自定义合并成一份目录。所以这里放开成 string ——
 * 收窄成四个字面量的话，自定义类型的活动在列表上会直接写不进 `Activity` 类型。
 *
 * `(string & {})` 而不是 `string`：前者保留四个内置值的补全与拼写检查，
 * 后者一写就全丢。
 */
export type ActivityType = BuiltinActivityType | (string & {})

/**
 * 一条自定义活动类型。
 *
 * `key` 是稳定标识，`activities.activity_type` 和 `preferred_types` 都按它引用。
 * 改标题不能改 key —— 否则历史记录里的类型会变成查不到名字的孤儿。
 */
export type CustomActivityType = {
  key: string
  title: string
  /** 可以留空；后端会用标题顶上，保证每条安排都有一行说明 */
  description: string
}
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

// PATCH /activity/{id} 的请求体：只传要改的字段。
// 状态到 completed / skipped 为止，没有 postponed ——
// 那个状态只能由「推迟」这条路径产生（它会同时新增一条替代记录）。
export type ActivityUpdate = {
  // 带 +08:00 偏移的完整 ISO 串。只给 HH:MM 的话后端猜不出是哪一天
  scheduled_at?: string
  title?: string
  description?: string
  activity_type?: ActivityType
  duration_min?: number
  status?: 'planned' | 'completed' | 'skipped'
}// 提交给 PUT /activity/settings 的形状。
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
  // 偏好三项（后端 R2-3）。三个都不是"约束"而是参数：
  // - preferred_types 只影响推荐时挑哪几类，空数组 = 全都接受（等于没偏好）；
  // - duration_min / min_gap_min 真的参与排程计算（排点之间的间距就是它们算出来的）。
  //
  // 这三个字段必须一起提交：后端 SettingsIn 的默认值是"空/5/10"，
  // 少传就等于每次保存都把用户设过的偏好重置掉。
  //
  // preferred_types 里可以出现自定义类型的 key（custom_1 …），
  // 所以是 string[] 而不是 BuiltinActivityType[]。
  preferred_types: ActivityType[]
  /**
   * 自定义活动类型（第十天）。**整份覆盖**：传什么就是什么，删掉一个就是真删掉。
   *
   * 和上面三项一样必须每次一起提交 —— 漏传会被后端当成"用户把自定义活动全删了"，
   * 而且没有任何报错，只是那些活动下次就不见了。
   */
  custom_types: CustomActivityType[]
  duration_min: number
  min_gap_min: number
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

// 建议草稿的响应形状随"安排建议"面板在第六天下线过：那时生成是一次点击直接落库，
// 中间那层草稿不经过前端。第八天它回来了，但目的变了 —— 现在要的是**逐条决策**。
// 草稿仍然是草稿，只有用户点了「同意」才落库；「拒绝」只丢掉这一条候选，不写库。
//
// 与后端 SuggestOut / DraftOut / ConfirmOut 一一对应（app/routers/activity.py）。
export type ActivityDraft = {
  scheduled_at: string
  activity_type: string
  title: string
  description: string
  duration_min: number
  reason: string
}

// 后端的决策仍是三档（见 service.DECISION_STATUS），但**页面只发 later**：
// 「同意」= 存成待执行，之后的完成/不方便改到下面的安排列表里做（PATCH 或那几个按钮）。
// 状态怎么映射由后端决定（DECISION_STATUS），页面不碰状态机。
export type SuggestionDecision = 'later' | 'done' | 'skip'

export type SuggestResult = {
  suggestions: ActivityDraft[]
  explanation: string
  notice: string
  mode: string
  day: string
  // 模型给出但被规则丢掉的条数
  dropped: number
  // 本次真正避开的"否决时刻"数量（换一批时才有）
  excluded: number
  // 换一批之后还剩几次；不是换一批的请求为 null
  remaining_reshuffles: number | null
  // 推荐依据：每条都是"参数 + 结论"，不是形容词
  evidence: string[]
  // 这批到底是谁排的。页面不许在没有这个字段时写"AI 已生成"
  engine_note: string
}

export type ConfirmResult = {
  saved: number
  day: string
  // 按决策分类的条数，例如 { done: 2, later: 1 }
  applied: Record<string, number>
  activities: Activity[]
}

export type ReshuffleQuota = {
  limit: number
  used: number
  remaining: number
  day: string
}

export type ReshuffleResult = {
  suggestion: ActivityDraft
  // 已经扣掉这一次之后的剩余次数
  remaining: number
  day: string
}

export type UndoResult = {
  deleted: number
  day: string
  activities: Activity[]
}

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

// GET /summary/history：一段时间里**已经有的**日报，按日期倒序。
// 里面没有的日期就是"那天还没生成"，由页面按 start/end 补齐成日期条。
export type SummaryHistoryDay = {
  date: string
  // ready 之外还会有 generating / failed —— 列表里也要能看出"这天在跑/失败过"
  status: SummaryStatus
  planned_total: number
  completed: number
  skipped: number
  unfinished: number
  // 后端截好的短摘要（48 字 + 省略号），前端不再二次截断
  review: string | null
  suggestion: string | null
  source: 'rule' | 'llm' | null
  model: string | null
  generated_at: string | null
}

export type SummaryHistory = {
  today: string
  start: string
  end: string
  days: SummaryHistoryDay[]
}

// ---------- 第八天：时间规则 ----------

// 与后端 rules.py 的规则码一一对应。写成联合类型而不是 string：
// 后端加一条规则时，这里的映射表（src/rules.ts）会因缺键而编译报错，
// 而不是安静地渲染出一行空名字。
export type RuleCode =
  | 'PLAN_HORIZON'
  | 'WORK_WINDOW'
  | 'ACTIVE_WINDOW'
  | 'QUIET_HOURS'
  | 'MIN_GAP'
  | 'DAILY_TARGET'

export type ActivityRule = {
  code: RuleCode
  name: string
  summary: string
  // 判定顺序，小的先判。决定"先报哪句提示"，不是重要性
  priority: number
  // false = 只解释不拦截（目前只有每日次数）
  blocking: boolean
  // 人话边界，例如 "09:00-18:00"、"10:00-12:00、14:00-17:30"
  boundary: string
  params: Record<string, unknown>
}

export type SlotRange = {
  start: string
  end: string
}

// GET /activity/rules 与 POST /activity/rules/preview 的共同返回。
// 三个区间都由后端算：前端自己按字符串切会和后端漂，而且漂了不报错。
export type ActivityRuleset = {
  day: string
  rules: ActivityRule[]
  work_window: SlotRange
  // 可活动时段 ∩ 工作时段
  allowed_ranges: SlotRange[]
  quiet_ranges: SlotRange[]
  // 再扣掉免打扰、已有安排、已经过去的时间
  free_ranges: SlotRange[]
  // 边界算不出来时的原因（例如工作时段与时段没有重叠）；正常为空串
  notice: string
}

export type RuleCheck = {
  code: RuleCode
  name: string
  priority: number
  blocking: boolean
  passed: boolean
  // 通过时是"为什么可以"，不通过时就是给用户看的那句错误
  detail: string
  error_code: string | null
}

// GET /activity/explain 的返回：六条规则各判一次，不只到第一条失败
export type SlotExplanation = {
  at: string
  allowed: boolean
  rule_code: RuleCode | null
  error_code: string | null
  reason: string
  checks: RuleCheck[]
}
