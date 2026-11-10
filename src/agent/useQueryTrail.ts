import { useEffect, useState } from 'react'
import { findToolArgs, parseReceipt, resultText } from './toolTrail'
import type { ToolCallRecord } from './toolTrail'

/**
 * 订阅 AG-UI 的工具调用事件，攒出「这一轮查了什么」（R4-1）。
 *
 * 用结构化类型而不是 import AbstractAgent：CopilotKit 的 useAgent 返回的是
 * 它自己的子类，只用到 subscribe 一个方法，写死类型反而会在升级 SDK 时
 * 因为无关的签名变化报错。
 */
type ToolEventAgent = {
  /** 已发生的消息列表；工具参数从这里的 toolCalls 取，见 findToolArgs 的说明 */
  messages?: readonly unknown[]
  subscribe: (subscriber: {
    onRunStartedEvent?: (params: { event?: { runId?: string } }) => void
    onToolCallStartEvent?: (params: {
      event: { toolCallId?: string; toolCallName?: string }
    }) => void
    onToolCallResultEvent?: (params: {
      event: { toolCallId?: string; content?: unknown }
    }) => void
  }) => { unsubscribe: () => void }
}

/**
 * 收集本轮的工具调用。
 *
 * 三个细节，都是实测出来的：
 *
 * - **新一轮开始时清空**，而不是结束时。结束就清会让用户看不到刚查了什么 ——
 *   他最想确认的正是"这条回答是查过的，不是编的"。
 * - **结果按 toolCallId 关联回调用**。按顺序配对在并发调用时会错位，
 *   错位后条数会挂到另一个工具名上，看着像后端算错了。
 * - **参数从 messages 取，不从 TOOL_CALL_ARGS 取**。实测这条链路上
 *   `partialToolCallArgs` 是空字符串、`toolCallArgs` 是空对象，参数在事件里丢了；
 *   而 assistant 消息的 `toolCalls[].function.arguments` 是完整的 JSON。
 */
export function useQueryTrail(agent: ToolEventAgent): {
  calls: ToolCallRecord[]
  /** 本轮运行的 runId：链路视图靠它反查 trace（R5-4）。拿不到就是 null */
  runId: string | null
  /** 清空。新建对话时用：不然上一次的「已查询」会挂在空白会话上方 */
  clear: () => void
} {
  const [calls, setCalls] = useState<ToolCallRecord[]>([])
  const [runId, setRunId] = useState<string | null>(null)

  useEffect(() => {
    const subscription = agent.subscribe({
      // 新一轮开始：清掉上一轮的工具列表，同时记下这一轮的 runId。
      // runId 只在 RUN_STARTED 里有，后面的事件都不带，所以必须在这里取。
      onRunStartedEvent: ({ event }) => {
        setCalls([])
        setRunId(typeof event?.runId === 'string' && event.runId ? event.runId : null)
      },

      onToolCallStartEvent: ({ event }) => {
        setCalls((prev) => [
          ...prev,
          {
            id: event.toolCallId ?? `call-${prev.length}`,
            name: event.toolCallName ?? '',
            args: {},
            state: 'ok',
            rows: null,
            running: true,
          },
        ])
      },

      onToolCallResultEvent: ({ event }) => {
        const receipt = parseReceipt(resultText(event.content))
        // 参数在事件里丢了，从 messages 里的 toolCalls 补回来
        const args = findToolArgs(agent.messages, event.toolCallId)
        setCalls((prev) => {
          const patch = (call: ToolCallRecord): ToolCallRecord => ({
            ...call,
            running: false,
            args: Object.keys(args).length > 0 ? args : call.args,
            // 没有回执也要结束"查询中"：真实模型或旧版本后端可能不带，
            // 那就只显示工具名，不要一直转着
            state: receipt?.state ?? 'ok',
            rows: receipt?.rows ?? null,
          })

          const index = prev.findIndex((call) => call.id === event.toolCallId)
          if (index >= 0) {
            return prev.map((call, at) => (at === index ? patch(call) : call))
          }
          // 找不到 id 就落到还在跑的最后一条；都没有就原样返回
          const running = prev.findIndex((call) => call.running)
          if (running < 0) return prev
          return prev.map((call, at) => (at === running ? patch(call) : call))
        })
      },
    })

    return () => subscription.unsubscribe()
  }, [agent])

  return {
    calls,
    runId,
    clear: () => {
      setCalls([])
      setRunId(null)
    },
  }
}
