import { useState } from 'react'
import type { Tab, User } from '../types'

type Props = {
  user: User
  tab: Tab
  onTabChange: (tab: Tab) => void
  onLogout: () => Promise<void>
}

/**
 * 页签固定成一张表，而不是三个手写的 <button>。
 *
 * 第三个页签（每日总结）加进来时，手写会变成三段几乎一样的 JSX：
 * 改样式或改 aria 属性就得同步改三处，漏一处只有键盘用户会发现。
 * 顺序也在这里定：总结紧跟活动助手，因为两者看的是同一批数据的前后两天。
 */
const TABS: { id: Tab; label: string }[] = [
  { id: 'activity', label: '活动助手' },
  { id: 'summary', label: '每日总结' },
  { id: 'todo', label: '我的待办' },
]

/**
 * 顶部导航。
 *
 * 三个页面共用一条，登录用户与退出按钮都收在这里，
 * 页内就不用再各放一个「退出登录」——重复的按钮会让人不确定点哪个。
 */
export default function TopBar({ user, tab, onTabChange, onLogout }: Props) {
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    setLoggingOut(true)
    await onLogout()
  }

  return (
    <header className="topbar">
      <div className="topbar__brand">
        <div className="topbar__text">
          <p className="topbar__title">久坐活动助手</p>
          <p className="hint hint--small">
            {user.display_name}（{user.username}）
          </p>
        </div>
      </div>

      <nav className="tabs" aria-label="页面切换">
        {TABS.map((item) => (
          <button
            key={item.id}
            className={tab === item.id ? 'tab tab--active' : 'tab'}
            type="button"
            aria-current={tab === item.id ? 'page' : undefined}
            onClick={() => onTabChange(item.id)}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <button
        className="button button--ghost topbar__logout"
        type="button"
        onClick={() => void handleLogout()}
        disabled={loggingOut}
      >
        {loggingOut ? '退出中…' : '退出登录'}
      </button>
    </header>
  )
}
