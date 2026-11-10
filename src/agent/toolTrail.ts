/**
 * 工具回执的解析与文案（R4-1）。
 *
 * 后端每个工具结果末尾带一行固定格式的回执：
 *
 *     【回执】tool=get_my_today_activities rows=2 state=ok
 *
 * 这一行是给程序看的，页面据此显示「已查询：今天的安排（2 条）」。
 *
 * 为什么不让前端自己去数列表：正文是给人读的中文，数条目要靠正则匹配
 * 「1. 」「2. 」这类前缀，格式一改就静默失效；而回执是后端明确给的字段。
 * 为什么不做成 AG-UI 的自定义事件：这条链路经过 CopilotKit Runtime 转发，
 * 自定义事件未必透传；工具结果本来就以 TOOL_CALL_RESULT 原样送到前端，
 * 挂在已有事件上不需要依赖转发层的行为。
 */

export type ToolState = 'ok' | 'error' | 'rejected'

export type ToolCallRecord = {
  /** AG-UI 的 toolCallId，用于把结果关联回对应的调用 */
  id: string
  name: string
  args: Record<string, unknown>
  state: ToolState
  /** 返回条数；非列表型结果（读设置）与没查成时是 null */
  rows: number | null
  /** 结果还没回来 */
  running: boolean
}

/** 工具名 → 中文标签。新增工具时这里要同步，否则页面会直接显示英文名。 */
const TOOL_LABELS: Record<string, string> = {
  list_my_todos: '待办',
  get_my_activity_settings: '活动设置',
  get_my_today_activities: '今天的安排',
  compute_suggested_slots: '候选时段',
}

// rows 是可选的：读设置这类结果不带这个字段
const RECEIPT_RE = /【回执】\s*tool=(\S+)(?:\s+rows=(\d+))?\s+state=([a-z]+)/

/**
 * 把 AG-UI 的工具结果 content 取成文本。
 *
 * 类型上它可以是 string，也可以是 ContentPart[]（多模态内容）。
 * 我们的工具只返回字符串，但跨版本/换模型时可能出现数组 ——
 * 直接当字符串用会在运行时拿到 "[object Object]"，回执就永远解析不出来。
 */
export function resultText(content: unknown): string {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''

  return content
    .map((part) => {
      if (typeof part === 'string') return part
      const text = (part as { text?: unknown } | null)?.text
      return typeof text === 'string' ? text : ''
    })
    .join('')
}

export function parseReceipt(text: string): {
  tool: string
  rows: number | null
  state: ToolState
} | null {
  const match = RECEIPT_RE.exec(text || '')
  if (!match) return null

  const state = match[3] === 'error' || match[3] === 'rejected' ? match[3] : 'ok'
  return {
    tool: match[1],
    rows: match[2] === undefined ? null : Number(match[2]),
    state,
  }
}

export function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? name ?? '未知工具'
}

/**
 * 参数摘要。只翻我们认识的参数：
 *
 * 参数原文是模型给的，可能是任意 JSON；整段塞进一行会破坏版式，
 * 而且 `{"only_pending":true}` 这种对用户没有意义。认不出来的参数就整段省略，
 * 不要露一半。
 */
export function argsSummary(args: Record<string, unknown>): string {
  const parts: string[] = []

  if (typeof args.only_pending === 'boolean') {
    parts.push(args.only_pending ? '只看未完成' : '全部')
  }
  if (typeof args.count === 'number' || typeof args.count === 'string') {
    const count = Number(args.count)
    if (Number.isFinite(count)) parts.push(`${count} 次`)
  }

  return parts.join('，')
}

/** 一条调用的一行文案，例如「今天的安排（2 条）」。 */
export function summarize(record: ToolCallRecord): string {
  const label = toolLabel(record.name)

  if (record.running) return `${label}（查询中）`

  if (record.state === 'error') return `${label}（读不到）`
  // rejected 是"没执行"，和"执行了但读不到"不是一回事，文案要分开
  if (record.state === 'rejected') return `${label}（未查询）`

  const detail = [argsSummary(record.args), record.rows === null ? '' : `${record.rows} 条`]
    .filter(Boolean)
    .join('，')

  return detail ? `${label}（${detail}）` : label
}

/**
 * 从 messages 里按 toolCallId 取这次调用的参数。
 *
 * 为什么要绕这一圈：实测这条链路（CopilotKit Runtime 转发）上，
 * `TOOL_CALL_ARGS` 的 `partialToolCallArgs` 拿到的是空字符串，
 * `TOOL_CALL_END` 的 `toolCallArgs` 也是空对象 —— 参数在事件里丢了。
 * 但 assistant 消息的 `toolCalls[].function.arguments` 是完整的 JSON 字符串，
 * CopilotKit 自己也是靠它渲染工具调用的，所以从这里取最可靠。
 *
 * 入参用 `readonly unknown[]` 而不是具体类型：AG-UI 的 Message 是个联合类型，
 * 里面还有不带 toolCalls 的 ActivityMessage，写成 `{toolCalls?: ...}[]` 会
 * 因为"没有共同的属性"被判成不兼容。这里就在函数里做窄化，边界只此一处。
 *
 * 取不到就返回空对象：参数是锦上添花，缺了只少一行摘要，不能让整条记录消失。
 */
export function findToolArgs(
  messages: readonly unknown[] | undefined,
  toolCallId: string | undefined,
): Record<string, unknown> {
  if (!messages || !toolCallId) return {}

  // 从后往前找：同一次运行里可能有多次调用，最近的才对得上
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    for (const call of toolCallsOf(messages[index])) {
      if (call.id !== toolCallId) continue

      const raw = call.function?.arguments
      if (typeof raw !== 'string' || raw === '') return {}
      try {
        const parsed: unknown = JSON.parse(raw)
        return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {}
      } catch {
        // 模型给了不合法的 JSON：不显示参数摘要，不影响条数
        return {}
      }
    }
  }

  return {}
}

type ToolCallShape = {
  id?: string
  function?: { name?: string; arguments?: string }
}

/** 把一条消息上的 toolCalls 取成可读的形状；没有就返回空数组。 */
function toolCallsOf(message: unknown): ToolCallShape[] {
  const calls = (message as { toolCalls?: unknown } | null)?.toolCalls
  return Array.isArray(calls) ? (calls as ToolCallShape[]) : []
}
