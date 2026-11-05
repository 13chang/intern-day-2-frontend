import { useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import { login } from '../api'
import type { User } from '../types'

type Props = {
  notice: string
  onAuthenticated: (token: string, user: User) => void
}

/**
 * 登录页图标。
 *
 * 全部内联 SVG，不引第三方图标库：这个页面只用四个图标，
 * 为它多装一个依赖不划算，也不利于首包体积（本项目的首包已经偏大了）。
 */
function Icon({ children }: { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="18"
      height="18"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {children}
    </svg>
  )
}

const userIcon = (
  <Icon>
    <circle cx="12" cy="8" r="3.4" />
    <path d="M5 20c0-3.3 3.1-5.4 7-5.4s7 2.1 7 5.4" />
  </Icon>
)

const lockIcon = (
  <Icon>
    <rect x="5" y="10.5" width="14" height="9" rx="2.5" />
    <path d="M8.5 10.5V8a3.5 3.5 0 0 1 7 0v2.5" />
  </Icon>
)

const arrowIcon = (
  <Icon>
    <path d="M5 12h13" />
    <path d="M13 7l5 5-5 5" />
  </Icon>
)

export default function LoginPage({ notice, onAuthenticated }: Props) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (submitting) return

    const account = username.trim()
    if (!account || !password) {
      setError('请输入账号和密码')
      return
    }

    setError('')
    setSubmitting(true)
    try {
      const result = await login(account, password)
      onAuthenticated(result.token, result.user)
    } catch (err) {
      setError(err instanceof Error ? err.message : '登录失败，请稍后重试')
      setSubmitting(false)
    }
  }

  return (
    <main className="auth">
      <section className="auth__card">
        <div className="auth__form">
          <header className="auth__brand">
            <span className="auth__logo">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="none" aria-hidden="true">
                <rect
                  x="4"
                  y="3.5"
                  width="12"
                  height="16"
                  rx="2.5"
                  stroke="currentColor"
                  strokeWidth="1.8"
                />
                <path
                  d="M7.5 8.5h5M7.5 12h5M7.5 15.5h3"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                />
                <circle cx="17" cy="16" r="4.6" fill="currentColor" opacity="0.16" />
                <path
                  d="M15.4 16.2l1.2 1.2 2-2.2"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                />
              </svg>
            </span>
            <h1 className="auth__title">待办清单</h1>
            <p className="auth__tagline">登录以管理属于你的任务</p>
          </header>

          {notice && <p className="banner banner--info">{notice}</p>}
          {error && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}

          <form className="form" onSubmit={handleSubmit} noValidate>
            <div className="field">
              <span className="field__icon">{userIcon}</span>
              <input
                className="input input--icon"
                type="text"
                name="username"
                autoComplete="username"
                aria-label="账号"
                value={username}
                maxLength={32}
                onChange={(event) => setUsername(event.target.value)}
                disabled={submitting}
                placeholder="账号"
              />
            </div>

            <div className="field">
              <span className="field__icon">{lockIcon}</span>
              <input
                className="input input--icon"
                type="password"
                name="password"
                autoComplete="current-password"
                aria-label="密码"
                value={password}
                maxLength={128}
                onChange={(event) => setPassword(event.target.value)}
                disabled={submitting}
                placeholder="密码"
              />
            </div>

            <button className="button button--primary button--lg" type="submit" disabled={submitting}>
              {submitting ? '登录中…' : '登录'}
              {!submitting && <span className="button__icon">{arrowIcon}</span>}
            </button>
          </form>

          <p className="hint hint--small auth__foot">
            账号由后端初始化脚本创建，用户名和密码见仓库 README
          </p>
        </div>

        <aside className="auth__aside">
          <span className="auth__aside-icon">
            <svg viewBox="0 0 24 24" width="34" height="34" fill="none" aria-hidden="true">
              <circle cx="12" cy="12" r="9.2" stroke="currentColor" strokeWidth="1.5" opacity="0.55" />
              <path
                d="M7.6 12.2l2.7 2.7 5.6-6"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          </span>
          <h2 className="auth__aside-title">欢迎回来</h2>
          <p className="auth__aside-text">
            登录后可以查看自己的待办，
            <br />
            还能和任务助手对话。
            <br />
            助手只读取你本人的数据。
          </p>
        </aside>
      </section>
    </main>
  )
}
