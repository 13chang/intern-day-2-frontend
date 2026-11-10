import type { RunTrace, TraceSignal, TraceSpan } from '../types'

/**
 * 链路视图的展示层换算（R5-4）。
 *
 * 放在单独文件里，是为了让组件只管画、这里只管算 —— 百分比、
 * 缩进层级、文案映射这类东西一旦混进 JSX，就没法单测了。
 */

/** 评分扣分项 → 人话。后端只给 kind，文案在前端维护（改文案不用动后端） */
export const FINDING_LABELS: Record<string, string> = {
  tool_missing: '该查没查',
  overreach: '越界调用',
  redundant_tool: '多余查询',
  tool_error: '工具报错',
  injection_marker: '疑似注入',
  output_truncated: '输出被截断',
}

/** 安全信号 → 人话 */
export const SIGNAL_LABELS: Record<string, string> = {
  'security.injection_marker': '工具结果里出现疑似指令',
  'security.output_truncated': '工具输出被截断',
}

export const VERDICT_LABELS: Record<string, string> = {
  good: '正常',
  warn: '注意',
  bad: '有问题',
}

export function findingLabel(kind: string): string {
  return FINDING_LABELS[kind] ?? kind
}

export function signalLabel(kind: string): string {
  return SIGNAL_LABELS[kind] ?? kind
}

/** 一条 span 画成一行时需要的东西 */
export type SpanRow = {
  span: TraceSpan
  /** 缩进层级，最多 3 层：再深就把右侧的时间条挤没了 */
  depth: number
  /** 时间条起点与宽度，单位是百分比；最小宽度兜底 2%，否则 1ms 的条看不见 */
  left: number
  width: number
}

/**
 * 把 span 列表摊平成可以直接画的行。
 *
 * 三点说明：
 *
 * - **层级从 parent_id 推**，不用后端给深度：后端只存父子关系，
 *   深度是展示需求，不该让后端跟着页面改。
 * - **偏移和宽度都换算成百分比**，相对 total_ms。这样容器宽度怎么变都不用重算。
 * - **最小宽度 2%**：真实链路里工具执行常常是 1ms，按比例算出来不到 1 像素，
 *   用户会以为那一步没画。
 */
export function spanRows(trace: RunTrace): SpanRow[] {
  const total = Math.max(trace.total_ms, 1)
  const depthOf = new Map<string, number>()

  return trace.spans.map((span) => {
    const parent = span.parent_id
    const depth = parent === null ? 0 : Math.min((depthOf.get(parent) ?? 0) + 1, 3)
    depthOf.set(span.span_id, depth)

    const left = Math.min(99, Math.max(0, (span.started_ms / total) * 100))
    const width = Math.max(2, Math.min(100 - left, (span.duration_ms / total) * 100))

    return { span, depth, left, width }
  })
}

/**
 * span 上最有信息量的那个属性：工具名 > 模型 > agent 名。
 *
 * 名字里已经包含这个值时就返回空串。后端的 span 名本身常带类型
 * （``chat deepseek-chat``、``execute_tool list_my_todos``），
 * 再拼一遍会变成 ``chat deepseek-chat deepseek-chat`` —— 实测就是这样，
 * 两段一样的文字挨着，看着像渲染出错。
 */
export function spanDetail(span: TraceSpan): string {
  const attributes = span.attributes ?? {}
  const candidates = [
    attributes['gen_ai.tool.name'],
    attributes['gen_ai.request.model'],
    attributes['gen_ai.agent.name'],
  ]
  for (const value of candidates) {
    if (typeof value !== 'string' || !value) continue
    return span.name.includes(value) ? '' : value
  }
  return ''
}

/** 这条 span 上有没有安全事件（有就在行尾挂个标记） */
export function hasSignal(span: TraceSpan): boolean {
  return (span.events ?? []).some((event) => event.name.startsWith('security.'))
}

/** 信号去重：同一类信号命中三次也只显示一行 */
export function uniqueSignals(signals: TraceSignal[]): TraceSignal[] {
  const seen = new Set<string>()
  return signals.filter((signal) => {
    if (seen.has(signal.kind)) return false
    seen.add(signal.kind)
    return true
  })
}

/** 意图分类 → 人话。拿不到意图时返回空串，页面上就不显示这一项 */
export function intentLabel(intent: string | null): string {
  const labels: Record<string, string> = {
    query: '查待办',
    today: '查今天的安排',
    schedule: '要建议',
    write: '写操作（只读，会被拒）',
    out_of_scope: '离题请求',
    ambiguous: '问得不清楚',
    small_talk: '闲聊',
  }
  return intent ? (labels[intent] ?? intent) : ''
}
