import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { clearToken, fetchMe, logout as logoutRequest, readToken, saveToken } from './api'
import ActivityPage from './pages/ActivityPage'
import LoginPage from './pages/LoginPage'
import TodoPage from './pages/TodoPage'
import type { Tab, User } from './types'

type Phase = 'checking' | 'anonymous' | 'authenticated'

function App() {
  const [phase, setPhase] = useState<Phase>('checking')
  const [user, setUser] = useState<User | null>(null)
  const [notice, setNotice] = useState('')
  // 任务书要求「登录后进入活动助手页面」，所以默认落在活动页；
  // 待办页保留在页签里，用来证明原有自选功能没被破坏
  const [tab, setTab] = useState<Tab>('activity')

  // 刷新页面时：本地有令牌就向后端复验，只有后端确认才算登录。
  useEffect(() => {
    let active = true

    async function restore() {
      if (!readToken()) {
        if (active) setPhase('anonymous')
        return
      }
      try {
        const current = await fetchMe()
        if (!active) return
        setUser(current)
        setPhase('authenticated')
      } catch {
        if (!active) return
        clearToken()
        setUser(null)
        setNotice('登录状态已失效，请重新登录')
        setPhase('anonymous')
      }
    }

    void restore()
    return () => {
      active = false
    }
  }, [])

  const handleAuthenticated = useCallback((token: string, nextUser: User) => {
    saveToken(token)
    setUser(nextUser)
    setNotice('')
    setPhase('authenticated')
  }, [])

  const handleLogout = useCallback(async () => {
    try {
      await logoutRequest()
    } catch {
      // 后端不可用时仍然清理本地状态，避免卡在登录页之外
    }
    clearToken()
    setUser(null)
    setNotice('已退出登录')
    setPhase('anonymous')
    setTab('activity')
  }, [])

  const handleExpired = useCallback(() => {
    clearToken()
    setUser(null)
    setNotice('登录状态已失效，请重新登录')
    setPhase('anonymous')
    setTab('activity')
  }, [])

  if (phase === 'checking') {
    return (
      <main className="screen screen--center">
        <p className="hint">正在校验登录状态…</p>
      </main>
    )
  }

  if (phase === 'anonymous') {
    return <LoginPage notice={notice} onAuthenticated={handleAuthenticated} />
  }

  if (!user) {
    return (
      <main className="screen screen--center">
        <p className="hint">正在加载用户信息…</p>
      </main>
    )
  }

  // 两个页面共用同一份登录态；页签切换不卸载登录状态，
  // 各自的列表由页面自己重新拉，切回来时不会看到过期数据。
  return tab === 'activity' ? (
    <ActivityPage
      user={user}
      onLogout={handleLogout}
      onExpired={handleExpired}
      onTabChange={setTab}
    />
  ) : (
    <TodoPage
      user={user}
      onLogout={handleLogout}
      onExpired={handleExpired}
      onTabChange={setTab}
    />
  )
}

export default App
