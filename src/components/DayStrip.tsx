import type { DayOverview } from '../types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

type Props = {
  /** 从今天开始连续的几天（后端 /activity/overview 返回，空着的日子也在里面） */
  days: DayOverview[]
  /** 服务端的今天，用来决定"今天/明天"怎么叫 */
  today: string
  /** 当前选中的日期 */
  selected: string
  onSelect: (date: string) => void
}

/**
 * 日期条：今天往后两周，每天一格，格子上带"已完成/共几条"。
 *
 * 为什么单独做成一条：活动安排本来是"当天"的视图，往前规划后第一件事就是
 * "我在看哪一天"必须一直可见。把日期藏在原生 date 选择器里，用户改完就把面板忘了；
 * 摆成一排还能顺便看出哪几天已经排过、哪几天还空着。
 *
 * 只从今天开始往后排：过去的日子在页面上没有任何可做的操作（不能重排、不能建议），
 * 把它塞进这条只会让"生成安排"变灰、让用户以为坏了。
 */
export default function DayStrip({ days, today, selected, onSelect }: Props) {
  if (days.length === 0) {
    return <div className="day-strip day-strip--loading" aria-hidden="true" />
  }

  return (
    <div className="day-strip" role="tablist" aria-label="选择日期">
      {days.map((item) => {
        const weekday = WEEKDAYS[new Date(`${item.date}T00:00:00`).getDay()]
        // 只有今天/明天说得上用相对说法，再往后写"周X"更实用（"大后天"没人这么讲）
        const name =
          item.date === today ? '今天' : item.date === shift(today, 1) ? '明天' : `周${weekday}`
        const active = item.date === selected
        const empty = item.total === 0
        return (
          <button
            key={item.date}
            type="button"
            role="tab"
            aria-selected={active}
            className={active ? 'day-chip day-chip--active' : 'day-chip'}
            onClick={() => onSelect(item.date)}
            title={`${item.date}　计划 ${item.total} 条，已完成 ${item.completed} 条`}
          >
            <span className="day-chip__name">{name}</span>
            <span className="day-chip__date">
              {Number(item.date.slice(5, 7))}/{Number(item.date.slice(8, 10))}
            </span>
            <span className={empty ? 'day-chip__count day-chip__count--empty' : 'day-chip__count'}>
              {empty ? '空' : `${item.completed}/${item.total}`}
            </span>
          </button>
        )
      })}
    </div>
  )
}

/** 往后挪 n 天，按本地日期算（跨月、跨年都走 Date 自己处理）。 */
function shift(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00`)
  base.setDate(base.getDate() + days)
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const date = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${month}-${date}`
}
