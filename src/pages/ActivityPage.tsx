import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  completeActivity,
  fetchActivityOverview,
  fetchActivitySettings,
  fetchDayActivities,
  fetchSuggestionEngines,
  fetchWeeklyStats,
  postponeActivity,
  skipActivity,
  updateActivity,
} from '../api'
import ActivityAssistant from '../agent/ActivityAssistant'
import { typeLabels } from '../activityTypes'
import AssistantBoundary from '../components/AssistantBoundary'
import ActivityCard from '../components/ActivityCard'
import type { ActivityAction } from '../components/ActivityCard'
import DayStrip from '../components/DayStrip'
import SettingsPanel from '../components/SettingsPanel'
import SuggestionPanel from '../components/SuggestionPanel'
import WeeklyStats from '../components/WeeklyStats'
import TopBar from '../components/TopBar'
import { ruleHint } from '../rules'
import type {
  Activity,
  ActivitySettings,
  ActivityUpdate,
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
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  /**
   * 是否展开建议面板。
   *
   * 这里曾经还有一个「生成安排」按钮：一点就直接落库，不经过用户确认。
   * 它和「先看建议」并存时，用户在建议里点的"完成 / 不方便"也会写进同一个列表，
   * 于是"我拒绝的"和"我定了的"混在一起。现在只保留一条路：
   * **面板里点同意才落库**，撤销只在这条路上成立。
   */
  const [showSuggestions, setShowSuggestions] = useState(false)

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
      // 规则类错误额外补一句"去改哪里"（R1-5）：后端的中文已经说清
      // "15:20 落在免打扰 15:00-16:00 内"，但用户还得自己找是哪个输入框。
      // 这里按稳定的规则码取提示，不解析中文 —— 文案改了也不会失效。
      const message = err instanceof Error ? err.message : fallback
      const hint = err instanceof ApiError ? ruleHint(err.ruleCode) : ''
      setError(hint ? `${message}（${hint}）` : message)
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

  /**
   * 保存手动修改（时间 / 内容 / 状态）。
   *
   * 失败时把错误再抛回卡片：卡片靠它决定"保持编辑态"。不然用户填了半天的表单
   * 被一次 422 关掉，还得重新打开、重新填 —— 而错误其实只出在时间那一格。
   * 文案仍由 handleError 统一显示（409/422 的中文直接来自后端）。
   */
  async function handleUpdate(id: number, patch: ActivityUpdate) {
    setBusyId(id)
    setError('')
    setNotice('')
    try {
      const updated = await updateActivity(id, patch)
      setNotice(`已保存：${updated.scheduled_at.slice(11, 16)} ${updated.title}`)
      await load()
    } catch (err) {
      handleError(err, '保存修改失败')
      throw err
    } finally {
      setBusyId(null)
    }
  }

  const pending = activities.filter((item) => item.status === 'planned')
  const completed = activities.filter((item) => item.status === 'completed')

  // 类型徽标的名字来自设置（内置四类 + 用户自定义），在渲染前算一次
  const labels = typeLabels(settings)

  /**
   * 影响排程的设置指纹：偏好 / 自定义活动 / 时长 / 间隔。
   *
   * 用拼接出来的字符串，不用 settings 对象：`load()` 每次都给出新对象，
   * 拿它当依赖会让"点完成一条"也把整批候选清掉。字符串只在值真的变了才变。
   */
  const settingsKey = settings
    ? [
        settings.preferred_types.join(','),
        settings.custom_types.map((item) => `${item.key}:${item.title}`).join(','),
        settings.duration_min,
        settings.min_gap_min,
      ].join('|')
    : ''

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
              {/* 引擎选择放在这里：点「生成建议」之前就知道这批是谁排的。
                  这个选择只影响建议面板里那一次生成，不会自己跑起来。 */}
              <div className="engine-picker" role="group" aria-label="生成引擎">
                {engines.map((item) => {
                  const disabled = !item.available || loading
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
              {/* 唯一入口：打开面板，生成要用户自己在面板里点。
                  原来那个「生成安排」是直写库的，已经删掉 —— 安排只能从"同意"进来。 */}
              <button
                className="button button--primary"
                type="button"
                onClick={() => setShowSuggestions((open) => !open)}
                disabled={loading}
                aria-expanded={showSuggestions}
              >
                {showSuggestions ? '收起建议' : '安排建议'}
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

          {/* 建议列表放在日期条和列表之间：它说的是"这一天的候选"，
              跟着日期条走；落库之后下面那个列表立刻能看到结果 */}
          {showSuggestions && (
            <SuggestionPanel
              day={day}
              engine={engine}
              note={note}
              settingsKey={settingsKey}
              onSaved={() => void load()}
              onError={handleError}
              onClose={() => setShowSuggestions(false)}
            />
          )}

          {loading ? (
            <p className="hint state-line">正在加载安排…</p>
          ) : activities.length === 0 ? (
            <p className="hint state-line">
              {isToday ? '今天' : '这天'}还没有安排。点右上角「安排建议」，在面板里生成候选、
              逐条点「同意」才会写进来；按可活动时段一次给 {settings?.daily_target ?? 3} 条。
            </p>
          ) : (
            <ul className="activity-list">
              {activities.map((item) => (
                <ActivityCard
                  key={item.id}
                  activity={item}
                  disabled={busyId !== null}
                  busy={busyId === item.id}
                  typeLabels={labels}
                  // 提醒关掉就不高亮：验收第 10 条要求开关真的起作用，而不只是个摆设
                  highlight={Boolean(settings?.reminders_enabled) && item.id === nextPlanned?.id}
                  onAction={(id, action) => void handleAction(id, action)}
                  onUpdate={handleUpdate}
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
