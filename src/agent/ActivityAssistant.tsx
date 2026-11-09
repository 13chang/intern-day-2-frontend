import AgentChat from './AgentChat'
import type { ChatCopy } from './AgentChat'
import type { User } from '../types'

// 活动页的文案。快捷提问按「先给建议、再问余量、再问什么时候动」的顺序排，
// 对应任务书里最常被演示的三条路径。
const COPY: ChatCopy = {
  welcomeTitle: '问问今天的安排',
  placeholder: '例如：下午比较忙，帮我排两次',
  chatInputPlaceholder: '继续问点什么…',
  note: '助手只给建议，保存前需要你确认。',
  toolFallback: 'get_my_today_activities',
  suggestions: [
    { title: '下午比较忙，帮我排两次', text: '下午比较忙，帮我排两次' },
    { title: '今天还剩几条没做？', text: '今天还剩几条没做？' },
    { title: '我什么时候可以起来动一下？', text: '我什么时候可以起来动一下？' },
    { title: '你能帮我做什么？', text: '你能帮我做什么？' },
  ],
}

type Props = {
  user: User
  onExpired: () => void
}

export default function ActivityAssistant({ user, onExpired }: Props) {
  return <AgentChat user={user} onExpired={onExpired} copy={COPY} />
}
