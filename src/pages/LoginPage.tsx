import { useState } from 'react'
import type { FormEvent } from 'react'
import { login } from '../api'
import type { User } from '../types'

type Props = {
  notice: string
  onAuthenticated: (token: string, user: User) => void
}

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
    <main className="screen screen--center">
      <section className="card auth-card">
        <header className="auth-card__header">
          <h1 className="auth-card__title">待办清单</h1>
          <p className="hint">登录后管理属于自己的待办事项</p>
        </header>

        {notice && <p className="banner banner--info">{notice}</p>}
        {error && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}

        <form className="form" onSubmit={handleSubmit} noValidate>
          <label className="field">
            <span className="field__label">账号</span>
            <input
              className="input"
              type="text"
              name="username"
              autoComplete="username"
              value={username}
              maxLength={32}
              onChange={(event) => setUsername(event.target.value)}
              disabled={submitting}
              placeholder="请输入账号"
            />
          </label>

          <label className="field">
            <span className="field__label">密码</span>
            <input
              className="input"
              type="password"
              name="password"
              autoComplete="current-password"
              value={password}
              maxLength={128}
              onChange={(event) => setPassword(event.target.value)}
              disabled={submitting}
              placeholder="请输入密码"
            />
          </label>

          <button className="button button--primary" type="submit" disabled={submitting}>
            {submitting ? '登录中…' : '登录'}
          </button>
        </form>

        <p className="hint hint--small">
          账号由后端初始化脚本创建，用户名和密码见仓库 README。
        </p>
      </section>
    </main>
  )
}
