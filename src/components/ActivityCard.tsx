import type { Activity, ActivityStatus } from '../types'

export type ActivityAction = 'complete' | 'postpone' | 'skip'

// 与后端 rules.STATUS_LABELS 保持同一份文案。
// 前端的徽标和接口返回的报错里都出现这几个词，不一致会让人以为是两回事。
const STATUS_LABELS: Record<ActivityStatus, string> = {
  planned: '待执行',
  completed: '已完成',
  postponed: '已推迟',
  skipped: '今天不方便',
}

const TYPE_LABELS: Record<string, string> = {
  walk: '走动',
  water: '喝水',
  stretch: '拉伸',
  stand: '站立',
}

/**
 * 取 HH:MM。
 *
 * 为什么不用 new Date(x).getHours()：scheduled_at 是带 +08:00 的本地墙钟时间，
 * 浏览器所在时区一旦不是东八区就会被换算成别的小时，显示和列表顺序对不上。
 * 后端保证格式固定，直接截字符串最稳。
 */
function timeText(iso: string): string {
  return iso.slice(11, 16)
}

type Props = {
  activity: Activity
  /** 当前有别的操作在跑：整页按钮都该禁用，避免连点产生两次推迟 */
  disabled: boolean
  /** 正在跑的就是这一条 */
  busy: boolean
  /** 高亮"最近要做的这一条"；提醒开关关掉时为 false */
  highlight: boolean
  onAction: (id: number, action: ActivityAction) => void
}

export default function ActivityCard({
  activity,
  disabled,
  busy,
  highlight,
  onAction,
}: Props) {
  const planned = activity.status === 'planned'
  const classes = ['activity']
  if (highlight) classes.push('activity--next')
  if (activity.status !== 'planned') classes.push('activity--muted')

  return (
    <li className={classes.join(' ')}>
      <div className="activity__time">{timeText(activity.scheduled_at)}</div>

      <div className="activity__body">
        <div className="activity__head">
          <span className="activity__title">{activity.title}</span>
          <span className={`badge badge--${activity.status}`}>
            {STATUS_LABELS[activity.status]}
          </span>
        </div>

        <p className="activity__desc">{activity.description}</p>

        <div className="activity__meta">
          <span>{TYPE_LABELS[activity.activity_type] ?? activity.activity_type}</span>
          <span>{activity.duration_min} 分钟</span>
          {activity.source === 'agent' && <span className="activity__tag">Agent 建议</span>}
          {activity.postpone_count > 0 && <span>已推迟 {activity.postpone_count} 次</span>}
          {activity.skipped_reason && <span>原因：{activity.skipped_reason}</span>}
        </div>
      </div>

      {planned && (
        <div className="activity__actions">
          <button
            className="button button--primary button--small"
            type="button"
            disabled={disabled}
            onClick={() => onAction(activity.id, 'complete')}
          >
            {busy ? '处理中…' : '完成'}
          </button>
          <button
            className="button button--ghost button--small"
            type="button"
            disabled={disabled}
            onClick={() => onAction(activity.id, 'postpone')}
          >
            推迟
          </button>
          <button
            className="button button--ghost button--small"
            type="button"
            disabled={disabled}
            onClick={() => onAction(activity.id, 'skip')}
          >
            不方便
          </button>
        </div>
      )}
    </li>
  )
}
