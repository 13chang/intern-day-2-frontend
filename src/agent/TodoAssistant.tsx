import AgentChat from './AgentChat'
import type { ChatCopy } from './AgentChat'
import type { User } from '../types'

// 待办页的文案。与抽出共享组件之前逐字一致，避免顺手改坏已验证过的页面。
const COPY: ChatCopy = {
  welcomeTitle: '问问你的待办',
  placeholder: '问问你的待办，例如：我还有哪些没做完？',
  chatInputPlaceholder: '继续问点什么…',
  note: '助手可能出错，重要内容请以列表为准。',
  toolFallback: 'list_my_todos',
  suggestions: [
    { title: '我还有哪些没做完的待办？', text: '我还有哪些没做完的待办？' },
    { title: '我一共完成了多少项？', text: '我一共完成了多少项待办？' },
    { title: '哪几条还没做完？', text: '我的待办里，哪几条还没做完？' },
    { title: '你能帮我做什么？', text: '你能帮我做什么？' },
  ],
}

type Props = {
  user: User
  onExpired: () => void
}

export default function TodoAssistant({ user, onExpired }: Props) {
  return <AgentChat user={user} onExpired={onExpired} copy={COPY} />
}
