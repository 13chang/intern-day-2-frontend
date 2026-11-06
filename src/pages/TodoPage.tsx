import { useCallback, useEffect, useState } from 'react'
import type { FormEvent } from 'react'
import { ApiError, createItem, listItems, removeItem, setItemDone } from '../api'
import TodoAssistant from '../agent/TodoAssistant'
import TopBar from '../components/TopBar'
import type { Tab, TodoItem, User } from '../types'

type Props = {
  user: User
  onLogout: () => Promise<void>
  onExpired: () => void
  onTabChange: (tab: Tab) => void
}

export default function TodoPage({ user, onLogout, onExpired, onTabChange }: Props) {
  const [items, setItems] = useState<TodoItem[]>([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  const [creating, setCreating] = useState(false)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [error, setError] = useState('')

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        onExpired()
        return
      }
      setError(err instanceof Error ? err.message : fallback)
    },
    [onExpired],
  )

  useEffect(() => {
    let active = true
    setLoading(true)
    listItems()
      .then((data) => {
        if (!active) return
        setItems(data)
        setError('')
      })
      .catch((err: unknown) => {
        if (!active) return
        handleError(err, '加载待办失败')
      })
      .finally(() => {
        if (active) setLoading(false)
      })
    return () => {
      active = false
    }
  }, [handleError])

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = draft.trim()
    if (!title || creating) return

    setCreating(true)
    setError('')
    try {
      const item = await createItem(title)
      setItems((prev) => [item, ...prev])
      setDraft('')
    } catch (err) {
      handleError(err, '新增待办失败')
    } finally {
      setCreating(false)
    }
  }

  async function handleToggle(item: TodoItem) {
    if (busyId !== null) return
    setBusyId(item.id)
    setError('')
    try {
      const updated = await setItemDone(item.id, !item.done)
      setItems((prev) => prev.map((current) => (current.id === updated.id ? updated : current)))
    } catch (err) {
      handleError(err, '更新待办失败')
    } finally {
      setBusyId(null)
    }
  }

  async function handleRemove(item: TodoItem) {
    if (busyId !== null) return
    setBusyId(item.id)
    setError('')
    try {
      await removeItem(item.id)
      setItems((prev) => prev.filter((current) => current.id !== item.id))
    } catch (err) {
      handleError(err, '删除待办失败')
    } finally {
      setBusyId(null)
    }
  }

  const doneCount = items.filter((item) => item.done).length

  return (
    <main className="screen screen--wide screen--stack">
      {/* 退出登录与账号信息收在顶部导航里，面板头部不再重复放一个 */}
      <TopBar user={user} tab="todo" onTabChange={onTabChange} onLogout={onLogout} />

      <div className="workspace">
        {/* 聊天区放主栏：它是这页的主角，待办列表退成右侧栏 */}
        <TodoAssistant user={user} onExpired={onExpired} />

        <div className="panel">
          <header className="panel__header">
            <div>
              <h1 className="panel__title">我的待办</h1>
              <p className="hint">原有自选功能，保留它用来对照活动助手</p>
            </div>
          </header>

          <form className="create-form" onSubmit={handleCreate} noValidate>
            <input
              className="input"
              type="text"
              value={draft}
              maxLength={100}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="要做什么？回车或点击添加"
              disabled={creating}
              aria-label="待办内容"
            />
            <button
              className="button button--primary"
              type="submit"
              disabled={creating || draft.trim() === ''}
            >
              {creating ? '添加中…' : '添加'}
            </button>
          </form>

          {error && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}

          {loading ? (
            <p className="hint state-line">正在加载待办…</p>
          ) : items.length === 0 ? (
            <p className="hint state-line">还没有待办，先添加一条试试。</p>
          ) : (
            <ul className="todo-list">
              {items.map((item) => (
                <li key={item.id} className={item.done ? 'todo todo--done' : 'todo'}>
                  <label className="todo__main">
                    <input
                      type="checkbox"
                      className="todo__checkbox"
                      checked={item.done}
                      disabled={busyId === item.id}
                      onChange={() => void handleToggle(item)}
                    />
                    <span className="todo__title">{item.title}</span>
                  </label>
                  <button
                    className="todo__remove"
                    type="button"
                    onClick={() => void handleRemove(item)}
                    disabled={busyId === item.id}
                    aria-label={`删除 ${item.title}`}
                  >
                    删除
                  </button>
                </li>
              ))}
            </ul>
          )}

          <footer className="panel__footer">
            <span>
              共 {items.length} 项
              {items.length > 0 ? `，已完成 ${doneCount} 项` : ''}
            </span>
            <span className="hint hint--small">数据由后端接口读写</span>
          </footer>
        </div>
      </div>
    </main>
  )
}
