import { App as CapacitorApp } from '@capacitor/app'
import { Capacitor } from '@capacitor/core'
import { useCallback, useEffect, useState } from 'react'
import './App.css'
import { clearToken, fetchMe, logout as logoutRequest, readToken, saveToken } from './api'
import ActivityPage from './pages/ActivityPage'
import LoginPage from './pages/LoginPage'
import SummaryPage from './pages/SummaryPage'
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

  // Android 返回键：本项目没有 react-router，页签靠 tab 状态切换，
  // WebView 里没有 history 可退。不拦截的话按一次返回就把 App 关掉，
  // 用户会当成闪退。约定改为：不在「活动助手」页签时先切回去，
  // 已经在活动助手（或停在登录页）时再按一次才真正退出。
  useEffect(() => {
    if (!Capacitor.isNativePlatform()) return

    const handle = CapacitorApp.addListener('backButton', () => {
      if (phase === 'authenticated' && tab !== 'activity') {
        setTab('activity')
        return
      }
      void CapacitorApp.exitApp()
    })

    return () => {
      void handle.then((listener) => listener.remove())
    }
  }, [phase, tab])

  // 切页签时回到页面顶部。手机上页面一长就滚得很远，切过去还停在半截，
  // 顶栏和标题都滚出了视野，看起来像"页面少了头部"。
  // 桌面浏览器很少滚这么深，所以这个现象只在手机上明显。
  useEffect(() => {
    window.scrollTo(0, 0)
  }, [tab])

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

  // 三个页面共用同一份登录态；页签切换不卸载登录状态，
  // 各自的列表由页面自己重新拉，切回来时不会看到过期数据。
  //
  // 用 if 而不是嵌套三元：页签从两个变成三个后，`a ? <A/> : b ? <B/> : <C/>`
  // 的缩进已经看不下去了，再加第四个页签时改起来更容易出错。
  //
  // currentUser 走参数而不是直接用外层的 user：函数体里 TS 不做跨函数收窄，
  // 上面那个 `if (!user) return` 管不到这里，user 仍被当成 User | null。
  function renderPage(currentUser: User) {
    const common = {
      user: currentUser,
      onLogout: handleLogout,
      onExpired: handleExpired,
      onTabChange: setTab,
    }
    if (tab === 'activity') return <ActivityPage {...common} />
    if (tab === 'summary') return <SummaryPage {...common} />
    return <TodoPage {...common} />
  }

  return renderPage(user)
}

export default App
