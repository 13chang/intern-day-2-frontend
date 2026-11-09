import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  completeActivity,
  fetchActivityOverview,
  fetchActivitySettings,
  fetchDayActivities,
  fetchSuggestionEngines,
  fetchWeeklyStats,
  generateDay,
  postponeActivity,
  skipActivity,
} from '../api'
import ActivityAssistant from '../agent/ActivityAssistant'
import AssistantBoundary from '../components/AssistantBoundary'
import ActivityCard from '../components/ActivityCard'
import type { ActivityAction } from '../components/ActivityCard'
import DayStrip from '../components/DayStrip'
import SettingsPanel from '../components/SettingsPanel'
import WeeklyStats from '../components/WeeklyStats'
import TopBar from '../components/TopBar'
import type {
  Activity,
  ActivitySettings,
  OverviewResult,
  SuggestionEngine,
  SuggestionEngineInfo,
  Tab,
  User,
  WeeklyStats as WeeklyStatsData,
} from '../types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

type Props = {
  user: User
  onLogout: () => Promise<void>
  onExpired: () => void
  onTabChange: (tab: Tab) => void
}

/** 本地时区的今天，YYYY-MM-DD。不用 toISOString：那是 UTC，东八区早上 8 点前会差一天。 */
function localIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 本地时间的 HH:MM，只用来判断「哪一条是接下来要做的」 */
function nowText(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`
}

/** 日期说成人话：今天 / 明天 / 后天 / 11 月 8 日（周六）。和后端 rules.day_label 同一套说法。 */
function dayName(iso: string, today: string): string {
  const weekday = `周${WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]}`
  const span = Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  )
  if (span === 0) return '今天'
  if (span === 1) return '明天'
  if (span === 2) return '后天'
  return `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日（${weekday}）`
}

export default function ActivityPage({ user, onLogout, onExpired, onTabChange }: Props) {
  const [activities, setActivities] = useState<Activity[]>([])
  const [settings, setSettings] = useState<ActivitySettings | null>(null)
  const [stats, setStats] = useState<WeeklyStatsData | null>(null)
  const [engines, setEngines] = useState<SuggestionEngineInfo[]>([])
  const [overview, setOverview] = useState<OverviewResult | null>(null)
  /** 正在看哪一天。往后看最多 14 天，能不能往前排由后端校验（越界返回 422） */
  const [day, setDay] = useState<string>(localIso)
  /**
   * 生成用哪个引擎：rule = 本地规则（不联网、结论确定），llm = DeepSeek 真实模型。
   * 放在页头上而不是每个动作各问一次 —— 这是"我这段时间想怎么排"的偏好，不是单次选择。
   */
  const [engine, setEngine] = useState<SuggestionEngine>('rule')
  /** 只给 llm 用：这次想让模型额外考虑什么。空着就是没有偏好 */
  const [note, setNote] = useState('')
  const [loading, setLoading] = useState(true)
  const [busyId, setBusyId] = useState<number | null>(null)
  const [generating, setGenerating] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 以服务端的"今天"为准：客户端时钟不准时，日期条和可排范围才不会整段错位。
  // overview 和列表是同一次加载拿到的，所以这里不会出现两边口径打架的情况。
  const today = overview?.today ?? localIso()
  const isToday = day === today

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
   * 一次拉齐列表 / 设置 / 统计 / 可用引擎 / 日期条。
   *
   * 都要：列表决定显示什么，设置决定高亮哪一条（提醒开关），统计决定右上角数字。
   * 引擎列表决定建议面板里能不能选 DeepSeek —— 这个只有后端知道（看 MODEL_MODE
   * 和凭证配没配），让前端猜会出现"点了按钮才报错"。
   * 日期条决定"哪几天已经有安排"，换日期后也要跟着更新条上的计数。
   * 任何写操作完成后都重新拉，不本地改状态 —— 否则刷新页面就会和后端不一致。
   */
  const load = useCallback(async () => {
    setLoading(true)
    try {
      const [list, currentSettings, weekly, engineList, days] = await Promise.all([
        fetchDayActivities(day),
        fetchActivitySettings(),
        fetchWeeklyStats(),
        fetchSuggestionEngines(),
        fetchActivityOverview(),
      ])
      setActivities(list)
      setSettings(currentSettings)
      setStats(weekly)
      setEngines(engineList)
      setOverview(days)
      setError('')
    } catch (err) {
      handleError(err, '加载安排失败')
    } finally {
      setLoading(false)
    }
  }, [handleError, day])

  useEffect(() => {
    void load()
  }, [load])

  function handleSelectDay(next: string) {
    if (next === day) return
    setDay(next)
    // 上一句提示说的是另一天的事，换日期后留在屏幕上会误导
    setNotice('')
    setError('')
  }

  async function handleGenerate() {
    if (generating) return
    // 还有待执行的条目 → 走后端的 force 重建：只清那天待执行的，已完成/已推迟/已跳过保留
    const force = activities.some((item) => item.status === 'planned')
    setGenerating(true)
    setError('')
    setNotice('')
    try {
      const result = await generateDay(force, day, {
        engine,
        // 规则引擎不读偏好，别把它传上去假装生效了
        note: engine === 'llm' ? note.trim() : undefined,
      })
      const who = result.mode === 'llm' ? 'DeepSeek' : '本地规则'
      const parts: string[] = []
      if (result.created > 0) {
        parts.push(`已用「${who}」为${dayName(result.day || day, today)}生成 ${result.created} 条安排。`)
      }
      // 模型的排程理由单独说，和"生成了几条"是两件事
      if (result.explanation) parts.push(result.explanation)
      if (result.notice) parts.push(result.notice)
      setNotice(parts.join(' '))
      await load()
    } catch (err) {
      handleError(err, '生成安排失败')
    } finally {
      setGenerating(false)
    }
  }

  function handlePickEngine(next: SuggestionEngine) {
    if (next === engine) return
    setEngine(next)
    // 上一次的提示是按另一个引擎说的（"已用规则生成…"），留着会误导
    setNotice('')
    setError('')
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
        setNotice(
          isToday
            ? '已标记为今天不方便，今天不会再安排这条。'
            : '已标记为这天不方便，这天不会再安排这条。',
        )
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

  // 接下来要做的那一条：列表本来就按 scheduled_at 排序。
  // 只有今天才按钟点筛"还没到"；未来那天的钟点全都还没到，无脑取第一条即可。
  const current = nowText()
  const nextPlanned = isToday
    ? pending.find((item) => item.scheduled_at.slice(11, 16) >= current)
    : pending[0]

  const summary = loading
    ? '正在加载…'
    : activities.length === 0
      ? `${isToday ? '今天' : '这天'}还没有安排`
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
              <h1 className="panel__title">{dayName(day, today)}的安排</h1>
              <p className="hint">{summary}</p>
            </div>
            <div className="generate-bar">
              {/* 引擎选择放在生成按钮旁边：点下去之前就知道这批是谁排的。
                  只剩一个"生成安排"按钮的话，用户没法表达"这次让模型试试"。 */}
              <div className="engine-picker" role="group" aria-label="生成引擎">
                {engines.map((item) => {
                  const disabled = !item.available || generating || loading
                  return (
                    <button
                      key={item.id}
                      type="button"
                      className={
                        item.id === engine ? 'engine-option engine-option--active' : 'engine-option'
                      }
                      disabled={disabled}
                      aria-pressed={item.id === engine}
                      title={item.reason}
                      onClick={() => handlePickEngine(item.id)}
                    >
                      <span className="engine-option__name">
                        {item.id === 'llm' ? 'DeepSeek' : item.label}
                      </span>
                      {item.id === 'llm' && item.model && (
                        <span className="engine-option__meta">{item.model}</span>
                      )}
                      {!item.available && <span className="engine-option__meta">未启用</span>}
                    </button>
                  )
                })}
              </div>
              <button
                className="button button--primary"
                type="button"
                onClick={() => void handleGenerate()}
                disabled={generating || loading}
                title={`为 ${day} 生成安排`}
              >
                {generating ? '生成中…' : pending.length > 0 ? '重新生成' : '生成安排'}
              </button>
            </div>
          </header>

          {/* 选了 DeepSeek 才问偏好：规则引擎不读这段文字，摆出来等于骗人。
              也顺手顶掉原来建议面板里那个"条件覆盖"表单 —— 长期设置就在下面的活动设置里。 */}
          {engine === 'llm' && (
            <input
              className="input generate-note"
              type="text"
              value={note}
              maxLength={200}
              placeholder="想让 DeepSeek 额外考虑什么？（可不填，例如：下午容易困、只排两次）"
              onChange={(event) => setNote(event.target.value)}
              disabled={generating}
              aria-label="给 DeepSeek 的偏好"
            />
          )}

          {error && (
            <p className="banner banner--error" role="alert">
              {error}
            </p>
          )}

          {notice && <p className="banner banner--info">{notice}</p>}

          <DayStrip
            days={overview?.days ?? []}
            today={today}
            selected={day}
            onSelect={handleSelectDay}
          />

          <SettingsPanel settings={settings} onSaved={setSettings} onError={handleError} />

          {loading ? (
            <p className="hint state-line">正在加载安排…</p>
          ) : activities.length === 0 ? (
            <p className="hint state-line">
              {isToday ? '今天' : '这天'}还没有安排。点右上角「生成安排」，会按可活动时段排{' '}
              {settings?.daily_target ?? 3} 次。
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

          <WeeklyStats stats={stats} />
        </div>

        <AssistantBoundary>
          <ActivityAssistant user={user} onExpired={onExpired} />
        </AssistantBoundary>
      </div>
    </main>
  )
}
