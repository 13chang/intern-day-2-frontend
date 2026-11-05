import { useCallback, useEffect, useState } from 'react'
import { CopilotChat, CopilotKitProvider } from '@copilotkit/react-core/v2'
import '@copilotkit/react-core/v2/styles.css'
import { fetchAgentInfo, readToken } from '../api'
import type { AgentInfo, User } from '../types'

// 浏览器访问的是宿主机映射出来的 Runtime 端口，不是容器内地址
const RUNTIME_URL =
  (import.meta.env.VITE_COPILOT_RUNTIME_URL as string | undefined) ??
  'http://localhost:4000/api/copilotkit'

// 必须和 server/index.mjs 里注册的 Agent 标识一致，否则 Runtime 找不到 Agent
const AGENT_ID = 'todo-agent'

type Props = {
  user: User
  onExpired: () => void
}

export default function TodoAssistant({ user, onExpired }: Props) {
  // 新建对话：换一个 key 重新挂载聊天组件，历史只存在于浏览器和内存里
  const [chatKey, setChatKey] = useState(() => crypto.randomUUID())
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

  const modeLabel =
    agentInfo === null
      ? 'Agent 状态未知'
      : agentInfo.mode === 'mock'
        ? 'Mock 模式（未连接真实模型）'
        : `真实模型：${agentInfo.model ?? '已配置'}`

  return (
    <section className="assistant" aria-label="任务助手">
      <header className="assistant__header">
        <div>
          <h2 className="assistant__title">任务助手</h2>
          <p className="hint hint--small">
            {modeLabel} · 只读工具：{agentInfo?.tools.join('、') ?? 'list_my_todos'}
          </p>
        </div>
        <button
          className="button button--ghost button--small"
          type="button"
          onClick={() => {
            setChatError('')
            setChatKey(crypto.randomUUID())
          }}
        >
          新建对话
        </button>
      </header>

      {agentInfo?.mode === 'mock' && (
        <p className="banner banner--warn">
          当前没有接入真实模型，回复由后端 Mock 规则生成；登录校验、AG-UI 事件流和只读工具都是真的。
        </p>
      )}

      {chatError && (
        <p className="banner banner--error" role="alert">
          {chatError}
        </p>
      )}

      <div className="assistant__body">
        <CopilotKitProvider
          // 换账号时重新挂载，避免上一个账号的会话残留在界面里
          key={user.id}
          runtimeUrl={RUNTIME_URL}
          agentId={AGENT_ID}
          headers={buildHeaders}
          onError={handleError}
        >
          <CopilotChat
            key={chatKey}
            agentId={AGENT_ID}
            labels={{
              chatInputPlaceholder: '问问你的待办，例如：我还有哪些没做完？',
            }}
          />
        </CopilotKitProvider>
      </div>
    </section>
  )
}
