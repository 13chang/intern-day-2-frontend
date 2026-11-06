import type { WeeklyStats as WeeklyStatsData } from '../types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/** 本地时区的今天，YYYY-MM-DD。不用 toISOString：那是 UTC，东八区早上 8 点前会差一天。 */
function todayIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

type Props = {
  stats: WeeklyStatsData | null
}

/**
 * 周统计。
 *
 * 四个数字的口径来自后端 weekly_stats：
 * 计划数只算未被推迟过的原始条目，推迟产生的新条目不算"又计划了一次"。
 */
export default function WeeklyStats({ stats }: Props) {
  if (!stats) {
    return (
      <section className="stats">
        <p className="hint">正在加载周统计…</p>
      </section>
    )
  }

  const today = todayIso()
  const numbers = [
    { label: '计划', value: stats.planned, tone: 'plain' },
    { label: '完成', value: stats.completed, tone: 'good' },
    { label: '推迟', value: stats.postponed, tone: 'warn' },
    { label: '跳过', value: stats.skipped, tone: 'plain' },
  ]

  return (
    <section className="stats">
      <div className="stats__head">
        <h2 className="stats__title">本周</h2>
        <span className="hint hint--small">
          {stats.week_start.slice(5)} 至 {stats.week_end.slice(5)}
        </span>
      </div>

      <div className="stats__numbers">
        {numbers.map((item) => (
          <div className={`stat stat--${item.tone}`} key={item.label}>
            <span className="stat__value">{item.value}</span>
            <span className="stat__label">{item.label}</span>
          </div>
        ))}
      </div>

      <div className="stats__days">
        {stats.days.map((day) => {
          const weekday = WEEKDAYS[new Date(`${day.date}T00:00:00`).getDay()]
          const ratio = day.total === 0 ? 0 : Math.min(1, day.completed / day.total)
          return (
            <div
              className={`stat-day${day.date === today ? ' stat-day--today' : ''}`}
              key={day.date}
              title={`${day.date} 完成 ${day.completed} / 计划 ${day.total}`}
            >
              <div className="stat-day__bar">
                <span className="stat-day__fill" style={{ height: `${Math.round(ratio * 100)}%` }} />
              </div>
              <span className="stat-day__label">{weekday}</span>
            </div>
          )
        })}
      </div>
    </section>
  )
}
