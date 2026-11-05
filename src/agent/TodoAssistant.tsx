import { useCallback, useEffect, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { CopilotChat, CopilotKitProvider, useAgent } from '@copilotkit/react-core/v2'
import type { Message } from '@ag-ui/client'
import '@copilotkit/react-core/v2/styles.css'
import { fetchAgentInfo, readToken } from '../api'
import type { AgentInfo, User } from '../types'

// 浏览器访问的是宿主机映射出来的 Runtime 端口，不是容器内地址
const RUNTIME_URL =
  (import.meta.env.VITE_COPILOT_RUNTIME_URL as string | undefined) ??
  'http://localhost:4000/api/copilotkit'

// 必须和 server/index.mjs 里注册的 Agent 标识一致，否则 Runtime 找不到 Agent
const AGENT_ID = 'todo-agent'

// 空会话时的快捷提问，对应参考设计里的「I can help you with」卡片
const SUGGESTIONS = [
  { title: '我还有哪些没做完的待办？', text: '我还有哪些没做完的待办？' },
  { title: '我一共完成了多少项？', text: '我一共完成了多少项待办？' },
  { title: '哪几条还没做完？', text: '我的待办里，哪几条还没做完？' },
  { title: '你能帮我做什么？', text: '你能帮我做什么？' },
]

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
}

type StageProps = {
  modeText: string
  toolsText: string
  onClearError: () => void
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
function ChatStage({ modeText, toolsText, onClearError }: StageProps) {
  const { agent } = useAgent({ agentId: AGENT_ID })
  const [hasMessages, setHasMessages] = useState(false)
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)

  useEffect(() => {
    const subscription = agent.subscribe({
      onMessagesChanged: () => setHasMessages(agent.messages.length > 0),
    })
    setHasMessages(agent.messages.length > 0)
    return () => subscription.unsubscribe()
  }, [agent])

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

      <div className="assistant__body">
        {/* CopilotChat 一直挂着，空会话时只是隐藏：
            这样它从第一轮开始就在订阅同一个 agent，运行中途不会才挂载、
            也就不会丢掉已经发出的增量。 */}
        <div className={hasMessages ? 'chat-host' : 'chat-host chat-host--hidden'}>
          <CopilotChat
            agentId={AGENT_ID}
            labels={{
              chatInputPlaceholder: '继续问点什么…',
              chatDisclaimerText: '助手可能出错，重要内容请以列表为准。',
            }}
          />
        </div>

        {!hasMessages && (
          <div className="welcome">
            <h2 className="welcome__title">问问你的待办</h2>

            <form className="welcome__box" onSubmit={handleSubmit}>
              <input
                className="welcome__input"
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                placeholder="问问你的待办，例如：我还有哪些没做完？"
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

            <p className="welcome__note">助手可能出错，重要内容请以列表为准。</p>

            <div className="welcome__suggests">
              <p className="welcome__suggests-title">我可以帮你</p>
              <div className="welcome__grid">
                {SUGGESTIONS.map((item, index) => (
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

export default function TodoAssistant({ user, onExpired }: Props) {
  const [agentInfo, setAgentInfo] = useState<AgentInfo | null>(null)
  const [chatError, setChatError] = useState('')

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
      const text = `${event.code} ${event.error.message}`.toLowerCase()
      // 事件流还没建立就被拒（401），说明登录状态不可用，回到登录页
      if (text.includes('401') || text.includes('unauthor') || text.includes('登录')) {
        onExpired()
        return
      }
      // 事件流已经建立后出的错，留在页面上提示，让用户可以重试
      setChatError(`对话失败：${event.error.message || '请稍后重试'}`)
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

      {chatError && (
        <p className="banner banner--error" role="alert">
          {chatError}
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
          toolsText={`只读工具 ${agentInfo?.tools.join('、') ?? 'list_my_todos'}`}
          onClearError={() => setChatError('')}
        />
      </CopilotKitProvider>
    </section>
  )
}
