import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  completeActivity,
  fetchActivitySettings,
  fetchSuggestionEngines,
  fetchTodayActivities,
  fetchWeeklyStats,
  generateToday,
  postponeActivity,
  skipActivity,
} from '../api'
import ActivityAssistant from '../agent/ActivityAssistant'
import ActivityCard from '../components/ActivityCard'
import type { ActivityAction } from '../components/ActivityCard'
import SettingsPanel from '../components/SettingsPanel'
import SuggestionPanel from '../components/SuggestionPanel'
import WeeklyStats from '../components/WeeklyStats'
import TopBar from '../components/TopBar'
import type {
  Activity,
  ActivitySettings,
  SuggestionEngineInfo,
  Tab,
  User,
  WeeklyStats as WeeklyStatsData,
} from '../types'

type Props = {
  user: User
  onLogout: () => Promise<void>
  onExpired: () => void
  onTabChange: (tab: Tab) => void
}

/** 本地时间的 HH:MM，只用来判断「哪一条是接下来要做的」 */
function nowText(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

export default function ActivityPage({ user, onLogout, onExpired, onTabChange }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [settings, setSettings] = useState<ActivitySettings | null>(null)
  const [stats, setStats] = useState<WeeklyStatsData | null>(null)
  const [engines, setEngines] = useState<SuggestionEngineInfo[]>([])
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

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

  /**
   * 一次拉齐列表 / 设置 / 统计 / 可用引擎。
   *
   * 三个都要：列表决定显示什么，设置决定高亮哪一条（提醒开关），统计决定右上角数字。
   * 引擎列表决定建议面板里能不能选 DeepSeek —— 这个只有后端知道（看 MODEL_MODE
   * 和凭证配没配），让前端猜会出现"点了按钮才报错"。
   * 任何写操作完成后都重新拉，不本地改状态 —— 否则刷新页面就会和后端不一致。
   */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, currentSettings, weekly, engineList] = await Promise.all([
        fetchTodayActivities(),
        fetchActivitySettings(),
        fetchWeeklyStats(),
        fetchSuggestionEngines(),
      ])
      setActivities(list)
      setSettings(currentSettings)
      setStats(weekly)
      setEngines(engineList)
      setError('')
    } catch (err) {
      handleError(err, '加载今日安排失败')
    } finally {
      setLoading(false)
    }
  }, [handleError])

  useEffect(() => {
    void load()
  }, [load])

  async function handleGenerate() {
    if (generating) return
    // 还有待执行的条目 → 走后端的 force 重建：只清待执行，已完成/已推迟/已跳过保留
    const force = activities.some((item) => item.status === 'planned')
    setGenerating(true)
    setError('')
    setNotice('')
    try {
      const result = await generateToday(force)
      setNotice(result.notice || (result.created > 0 ? `已生成 ${result.created} 条安排。` : ''))
      await load()
    } catch (err) {
      handleError(err, '生成安排失败')
    } finally {
      setGenerating(false)
    }
  }

  async function handleAction(id: number, action: ActivityAction) {
    setBusyId(id)
    setError('')
    setNotice('')
    try {
      if (action === 'complete') {
        const result = await completeActivity(id)
        setNotice(result.idempotent ? '这条之前已经完成过了。' : '已完成，去动一动吧。')
      } else if (action === 'postpone') {
        const result = await postponeActivity(id)
        setNotice(`已推迟到 ${result.replacement.scheduled_at.slice(11, 16)}。`)
      } else {
        await skipActivity(id)
        setNotice('已标记为今天不方便，今天不会再安排这条。')
      }
      await load()
    } catch (err) {
      // 409（没有可用时段 / 状态不对）和 422（校验不通过）都在这里显示后端给的中文
      handleError(err, '操作失败')
    } finally {
      setBusyId(null)
    }
  }

  const pending = activities.filter((item) => item.status === 'planned')
  const completed = activities.filter((item) => item.status === 'completed')

  // 接下来要做的那一条：列表本来就按 scheduled_at 排序，取第一条时间还没到的
  const current = nowText()
  const nextPlanned = pending.find((item) => item.scheduled_at.slice(11, 16) >= current)

  const summary = loading
    ? '正在加载…'
    : activities.length === 0
      ? '今天还没有安排'
      : `共 ${activities.length} 条 · 待执行 ${pending.length} · 已完成 ${completed.length}`

  return (
    <main className="screen screen--wide screen--stack">
      <TopBar user={user} tab="activity" onTabChange={onTabChange} onLogout={onLogout} />

      {/* 活动内容放主栏：设置表单、七天统计和带三个按钮的列表都需要横向空间；
          聊天面板在窄栏里本来就能正常显示 */}
      <div className="workspace workspace--activity">
        <div className="panel activity-panel">
          <header className="panel__header">
            <div>
              <h1 className="panel__title">今日安排</h1>
              <p className="hint">{summary}</p>
            </div>
            <button
              className="button button--primary"
              type="button"
              onClick={() => void handleGenerate()}
              disabled={generating || loading}
            >
              {generating ? '生成中…' : pending.length > 0 ? '重新生成' : '生成安排'}
            </button>
          </header>

          {error && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}

          {notice && <p className="banner banner--info">{notice}</p>}

          <SettingsPanel settings={settings} onSaved={setSettings} onError={handleError} />

          {loading ? (
            <p className="hint state-line">正在加载今日安排…</p>
          ) : activities.length === 0 ? (
            <p className="hint state-line">
              还没有安排。点右上角「生成安排」，会按可活动时段排 {settings?.daily_target ?? 3} 次。
            </p>
          ) : (
            <ul className="activity-list">
              {activities.map((item) => (
                <ActivityCard
                  key={item.id}
                  activity={item}
                  disabled={busyId !== null || generating}
                  busy={busyId === item.id}
                  // 提醒关掉就不高亮：验收第 10 条要求开关真的起作用，而不只是个摆设
                  highlight={Boolean(settings?.reminders_enabled) && item.id === nextPlanned?.id}
                  onAction={(id, action) => void handleAction(id, action)}
                />
              ))}
            </ul>
          )}

          <SuggestionPanel
            settings={settings}
            engines={engines}
            onError={handleError}
            onSaved={(count) => {
              setNotice(count > 0 ? `已保存 ${count} 条安排。` : '')
              void load()
            }}
          />

          <WeeklyStats stats={stats} />
        </div>

        <ActivityAssistant user={user} onExpired={onExpired} />
      </div>
    </main>
  )
}
