import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { CopilotChat, CopilotKitProvider, useAgent } from '@copilotkit/react-core/v2'
import type { Message } from '@ag-ui/client'
import '@copilotkit/react-core/v2/styles.css'
import { fetchAgentInfo, readToken } from '../api'
import type { AgentInfo, User } from '../types'
import { classifyChatError, describeForConsole } from './chatError'
import type { ChatError } from './chatError'

// 默认走同源路径，由 vite.config.ts 代理到 Runtime（浏览器只认 5173）。
// 不再写死 http://localhost:4000：宿主机 4000 常被其它容器占用，VS Code 自动转发
// 会顺延到 4001，写死端口就会连到别人的 Runtime（/info 里没有 todo-agent），
// CopilotKit 判定 agent 未就绪，发送按钮会一直灰着。
// 只有 Runtime 部署在独立域名下才需要用 VITE_COPILOT_RUNTIME_URL 覆盖成绝对地址。
const RUNTIME_URL =
  (import.meta.env.VITE_COPILOT_RUNTIME_URL as string | undefined) ?? '/api/copilotkit'

// 必须和 server/index.mjs 里注册的 Agent 标识一致，否则 Runtime 找不到 Agent。
// 注意：后端 app/agent/factory.py 的 AGENT_NAME 是另一回事（只用于 /agent/info 展示），
// 这里不能跟着它改，否则 Runtime 里查不到 agentId。
const AGENT_ID = 'todo-agent'

// 重试上限。任务说明要求「不通过扩大重试次数掩盖失败」，
// 所以点两次还不行就停手，让用户看清问题，而不是无限重试烧资源。
const MAX_RETRIES = 2

export type ChatCopy = {
  welcomeTitle: string
  placeholder: string
  chatInputPlaceholder: string
  note: string
  suggestions: { title: string; text: string }[]
  /** /agent/info 拿不到工具列表时的兜底文案 */
  toolFallback: string
}

function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.7"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

// 快捷提问的图标按序号配，两份文案都固定 4 条，所以不需要额外传图标
const SUGGESTION_ICONS = [
  <Icon key="list">
    <path d="M4 7h10M4 12h10M4 17h7" />
    <path d="M18 15.5l1.6 1.6L22 14.6" />
  </Icon>,
  <Icon key="check">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M8.4 12.3l2.4 2.4 4.8-5.1" />
  </Icon>,
  <Icon key="clock">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M12 7.6V12l3 1.8" />
  </Icon>,
  <Icon key="help">
    <circle cx="12" cy="12" r="8.4" />
    <path d="M9.7 9.6a2.4 2.4 0 1 1 3.1 2.3c-.6.2-.9.7-.9 1.3v.3" />
    <path d="M11.9 16.6h.01" />
  </Icon>,
]

type Props = {
  user: User
  onExpired: () => void
  copy: ChatCopy
}

type StageProps = {
  modeText: string
  toolsText: string
  error: ChatError | null
  onClearError: () => void
  copy: ChatCopy
}

/**
 * 失败提示条。
 *
 * 只展示分类后的文案（title / detail），不展示 SDK 的原始 message ——
 * 那里面常带上游地址和端口，贴到截图里不合适。
 * 重试按钮有次数上限，到顶后禁用并改文案，避免用户反复点击。
 */
function ErrorAlert({
  error,
  retries,
  busy,
  onRetry,
}: {
  error: ChatError
  retries: number
  busy: boolean
  onRetry: () => void
}) {
  const exhausted = retries >= MAX_RETRIES

  return (
    <div className="alert" role="alert">
      <div className="alert__body">
        <p className="alert__title">{error.title}</p>
        <p className="alert__detail">{error.detail}</p>
      </div>
      {error.retryable && (
        <button
          className="button button--ghost button--small alert__retry"
          type="button"
          onClick={onRetry}
          disabled={busy || exhausted}
        >
          {exhausted ? '已达重试上限' : retries > 0 ? `重试（${retries}/${MAX_RETRIES}）` : '重试'}
        </button>
      )}
    </div>
  )
}

/**
 * 会话区。
 *
 * 为什么不用 CopilotChat 自带的空状态：它的空状态只有一行标题 + 输入框，
 * 没法在里面塞「快捷提问」卡片，而这个版本（1.84.1）的
 * useConfigureSuggestions 实测也不渲染任何可见内容。
 *
 * 所以空会话时用自绘的欢迎区（标题 + 大输入框 + 2×2 卡片 + 免责声明），
 * 发送走底层的 agent.addMessage + runAgent；一旦有了消息，
 * 就切回 CopilotChat 负责消息列表、流式增量、工具调用展示和错误兜底。
 * 这样既拿到了参考稿的版式，又不用重写已验证过的聊天逻辑。
 */
function ChatStage({ modeText, toolsText, error, onClearError, copy }: StageProps) {
  const { agent } = useAgent({ agentId: AGENT_ID })
  const [hasMessages, setHasMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const [retries, setRetries] = useState(0)

  useEffect(() => {
    const subscription = agent.subscribe({
      onMessagesChanged: () => setHasMessages(agent.messages.length > 0),
    })
    setHasMessages(agent.messages.length > 0)
    return () => subscription.unsubscribe()
  }, [agent])

  // 错误消失（用户重新提问或手动清掉）后，重试计数归零
  useEffect(() => {
    if (!error) setRetries(0)
  }, [error])

  const ask = useCallback(
    async (text: string) => {
      const content = text.trim()
      if (!content || sending || agent.isRunning) return

      setSending(true)
      onClearError()
      try {
        agent.addMessage({ id: crypto.randomUUID(), role: 'user', content } as Message)
        setDraft('')
        // 运行期间的流式增量由 CopilotChat 订阅同一个 agent 后自动渲染
        await agent.runAgent()
      } catch {
        // 错误统一由 Provider 的 onError 处理，这里不重复提示
      } finally {
        setSending(false)
      }
    },
    [agent, onClearError, sending],
  )

  /**
   * 重试 = 用现有会话重新跑一次，不重新添加用户消息。
   *
   * 这样失败的这一轮不会在对话里留下两条一样的提问；
   * 上下文也保持原样，符合「重新提交」而不是「重新提问」的语义。
   */
  const retry = useCallback(async () => {
    if (agent.isRunning || retries >= MAX_RETRIES) return
    setRetries((count) => count + 1)
    onClearError()
    try {
      await agent.runAgent()
    } catch {
      // 仍然交给 onError
    }
  }, [agent, onClearError, retries])

  const handleSubmit = useCallback(
    (event: FormEvent<HTMLFormElement>) => {
      event.preventDefault()
      void ask(draft)
    },
    [ask, draft],
  )

  const resetChat = useCallback(() => {
    onClearError()
    agent.setMessages([])
    setDraft('')
    setHasMessages(false)
    setRetries(0)
  }, [agent, onClearError])

  return (
    <div className="assistant__stage">
      <div className="assistant__bar">
        <span className="assistant__mode">
          {modeText} · {toolsText}
        </span>
        <button
          className="button button--ghost button--small assistant__reset"
          type="button"
          onClick={resetChat}
        >
          新建对话
        </button>
      </div>

      {error && (
        <ErrorAlert
          error={error}
          retries={retries}
          busy={agent.isRunning || sending}
          onRetry={() => void retry()}
        />
      )}

      <div className="assistant__body">
        {/* CopilotChat 一直挂着，空会话时只是隐藏：
            这样它从第一轮开始就在订阅同一个 agent，运行中途不会才挂载、
            也就不会丢掉已经发出的增量。 */}
        <div className={hasMessages ? 'chat-host' : 'chat-host chat-host--hidden'}>
          <CopilotChat
            agentId={AGENT_ID}
            labels={{
              chatInputPlaceholder: copy.chatInputPlaceholder,
              chatDisclaimerText: copy.note,
            }}
          />
        </div>

        {!hasMessages && (
          <div className="welcome">
            <h2 className="welcome__title">{copy.welcomeTitle}</h2>

            <form className="welcome__box" onSubmit={handleSubmit}>
              <input
                className="welcome__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder={copy.placeholder}
                aria-label="输入问题"
                disabled={sending}
              />
              <button
                className="welcome__send"
                type="submit"
                disabled={sending || draft.trim() === ''}
                aria-label="发送"
              >
                <Icon>
                  <path d="M12 19V6" />
                  <path d="M6.5 11.5L12 6l5.5 5.5" />
                </Icon>
              </button>
            </form>

            <p className="welcome__note">{copy.note}</p>

            <div className="welcome__suggests">
              <p className="welcome__suggests-title">我可以帮你</p>
              <div className="welcome__grid">
                {copy.suggestions.map((item, index) => (
                  <button
                    key={item.title}
                    className="suggest"
                    type="button"
                    disabled={sending}
                    onClick={() => void ask(item.text)}
                  >
                    <span className="suggest__icon">{SUGGESTION_ICONS[index]}</span>
                    <span className="suggest__text">{item.title}</span>
                    <span className="suggest__arrow" aria-hidden="true">
                      ›
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

/**
 * Agent 聊天面板（待办页与活动页共用）。
 *
 * 两个页面连的是同一个后端 Agent 和同一个 Runtime 键，
 * 差别只在文案：欢迎语、快捷提问、免责声明。逻辑一份，避免两份实现各自漂移。
 */
export default function AgentChat({ user, onExpired, copy }: Props) {
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)
  const [chatError, setChatError] = useState<ChatError | null>(null)

  useEffect(() => {
    let active = true
    fetchAgentInfo()
      .then((info) => {
        if (active) setAgentInfo(info)
      })
      .catch(() => {
        // 拿不到就只是不显示模式标签，不影响聊天本身
        if (active) setAgentInfo(null)
      })
    return () => {
      active = false
    }
  }, [])

  // 每次请求前重新取令牌：这样令牌续期或退出后，下一次请求带的是最新的值
  const buildHeaders = useCallback(() => {
    const token = readToken()
    return token ? { Authorization: `Bearer ${token}` } : {}
  }, [])

  const handleError = useCallback(
    (event: { error: Error; code: string; context: Record<string, unknown> }) => {
      // 原始错误只进控制台：里面的上游地址、端口、堆栈片段不该出现在界面和截图里
      console.warn(describeForConsole(event))

      const classified = classifyChatError(event)
      if (classified.kind === 'auth') {
        // 事件流没建立就被拒（401），登录状态已经不可用，回登录页
        onExpired()
        return
      }
      // 其它错误留在页面上提示，并给出一次有上限的重试
      setChatError(classified)
    },
    [onExpired],
  )

  const modeText =
    agentInfo === null
      ? 'Agent 状态未知'
      : agentInfo.mode === 'mock'
        ? 'Mock 模式（未连接真实模型）'
        : `真实模型：${agentInfo.model ?? '已配置'}`

  return (
    <section className="assistant" aria-label="任务助手">
      {agentInfo?.mode === 'mock' && (
        <p className="banner banner--warn">
          未接入真实模型，回复由后端 Mock 规则生成；登录校验、AG-UI 事件流和只读工具都是真的。
        </p>
      )}

      <CopilotKitProvider
        // 换账号时重新挂载，避免上一个账号的会话残留在界面里
        key={user.id}
        runtimeUrl={RUNTIME_URL}
        agentId={AGENT_ID}
        headers={buildHeaders}
        onError={handleError}
      >
        <ChatStage
          modeText={modeText}
          toolsText={`只读工具 ${agentInfo?.tools.join('、') ?? copy.toolFallback}`}
          error={chatError}
          onClearError={() => setChatError(null)}
          copy={copy}
        />
      </CopilotKitProvider>
    </section>
  )
}
