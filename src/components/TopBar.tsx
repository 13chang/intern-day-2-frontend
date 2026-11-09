import { useState } from 'react'
import type { Tab, User } from '../types'

type Props = {
  user: User
  tab: Tab
  onTabChange: (tab: Tab) => void
  onLogout: () => Promise<void>
}

/**
 * 顶部导航。
 *
 * 两个页面共用一条，登录用户与退出按钮都收在这里，
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
        <button
          className={tab === 'activity' ? 'tab tab--active' : 'tab'}
          type="button"
          aria-current={tab === 'activity' ? 'page' : undefined}
          onClick={() => onTabChange('activity')}
        >
          活动助手
        </button>
        <button
          className={tab === 'todo' ? 'tab tab--active' : 'tab'}
          type="button"
          aria-current={tab === 'todo' ? 'page' : undefined}
          onClick={() => onTabChange('todo')}
        >
          我的待办
        </button>
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
