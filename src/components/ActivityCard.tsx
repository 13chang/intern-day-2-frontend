import { useState, type FormEvent } from 'react'
import { BUILTIN_TYPES } from '../activityTypes'
import type { Activity, ActivityStatus, ActivityUpdate } from '../types'

export type ActivityAction = 'complete' | 'postpone' | 'skip'

// 与后端 rules.STATUS_LABELS 保持同一份文案。
// 前端的徽标和接口返回的报错里都出现这几个词，不一致会让人以为是两回事。
const STATUS_LABELS: Record<ActivityStatus, string> = {
  planned: '待执行',
  completed: '已完成',
  postponed: '已推迟',
  skipped: '今天不方便',
}

/**
 * 类型徽标的兜底文案（只有内置四类）。
 *
 * 自定义类型不在这里：它们是用户自己的，只有 ``settings.custom_types`` 知道叫什么。
 * 页面会把算好的映射通过 ``typeLabels`` 传进来；没传时（独立渲染这个组件、
 * 或历史记录里留着一个已删除的自定义 key）就退回内置四类，再不行显示 key ——
 * 显示 key 很难看，但比渲染出一个空角标强：至少能看出它是"同一类"。
 */
const BUILTIN_LABELS: Record<string, string> = Object.fromEntries(
  BUILTIN_TYPES.map((item) => [item.value, item.label]),
)

/**
 * 手动能选的状态。没有「已推迟」：那个状态只能由「推迟」这条路径产生，
 * 它同时会新增一条替代记录，手写成 postponed 会让那对关系断掉（后端也会拒）。
 */
const EDITABLE_STATUS: { value: 'planned' | 'completed' | 'skipped'; label: string }[] = [
  { value: 'planned', label: '待执行' },
  { value: 'completed', label: '已完成' },
  { value: 'skipped', label: '今天不方便' },
]

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

/**
 * 只换钟点，日期和时区偏移照抄。
 *
 * scheduled_at 形如 ``2026-11-06T10:00:00+08:00``：拼完整 ISO 而不是交给
 * ``new Date()`` 再 toISOString()，否则非东八区浏览器会把时间算歪 8 小时。
 */
function withTime(iso: string, hhmm: string): string {
  return `${iso.slice(0, 11)}${hhmm}:00${iso.slice(19)}`
}

type Props = {
  activity: Activity
  /** 当前有别的操作在跑：整页按钮都该禁用，避免连点产生两次推迟 */
  disabled: boolean
  /** 正在跑的就是这一条 */
  busy: boolean
  /** 高亮"最近要做的这一条"；提醒开关关掉时为 false */
  highlight: boolean
  /**
   * 类型 key → 中文名（内置四类 + 用户自定义）。
   * 由页面按当前设置算好传进来；不传时只认内置四类。
   */
  typeLabels?: Record<string, string>
  onAction: (id: number, action: ActivityAction) => void
  /** 保存手动修改。失败时由页面显示后端的中文原因，卡片只管把错误抛回来 */
  onUpdate: (id: number, patch: ActivityUpdate) => Promise<void>
}

export default function ActivityCard({
  activity,
  disabled,
  busy,
  highlight,
  typeLabels,
  onAction,
  onUpdate,
}: Props) {
  const planned = activity.status === 'planned'
  // 「已推迟」是推迟动作留下的历史记录，和替代条目成对出现，不提供编辑
  const editable = activity.status !== 'postponed'

  const [editing, setEditing] = useState(false)
  const [saving, setSaving] = useState(false)
  const [form, setForm] = useState({
    time: '',
    title: '',
    description: '',
    duration: '',
    status: 'planned' as 'planned' | 'completed' | 'skipped',
  })

  function openEditor() {
    setForm({
      time: timeText(activity.scheduled_at),
      title: activity.title,
      description: activity.description,
      duration: String(activity.duration_min),
      // 已推迟的记录进不来这里，所以这三个值够用
      status: activity.status === 'postponed' ? 'planned' : activity.status,
    })
    setEditing(true)
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (disabled || saving) return

    // 只提交真正变了的字段：后端对"没变"的字段是幂等空操作，
    // 但少传几个字段能让请求体自己说明"这次到底改了什么"。
    const patch: ActivityUpdate = {}
    if (form.status !== activity.status) patch.status = form.status
    // 时间只有「待执行」能改（后端的口径），所以表单里也只能在这一档放开
    if (form.status === 'planned' && form.time && form.time !== timeText(activity.scheduled_at)) {
      patch.scheduled_at = withTime(activity.scheduled_at, form.time)
    }
    const title = form.title.trim()
    if (title && title !== activity.title) patch.title = title
    const description = form.description.trim()
    if (description && description !== activity.description) patch.description = description
    const duration = Number(form.duration)
    if (Number.isFinite(duration) && Math.round(duration) !== activity.duration_min) {
      patch.duration_min = Math.round(duration)
    }

    if (Object.keys(patch).length === 0) {
      // 什么都没改就点保存：直接关掉，不要往后端发一个空请求
      setEditing(false)
      return
    }

    setSaving(true)
    try {
      await onUpdate(activity.id, patch)
      setEditing(false)
    } catch {
      // 原因已经由页面显示（409 状态不对 / 422 撞规则）。
      // 这里保持编辑态，用户改一下就能重试，不用重新打开一次。
    } finally {
      setSaving(false)
    }
  }

  if (editing) {
    return (
      <li className="activity activity--editing">
        <form className="activity-editor" onSubmit={(event) => void handleSubmit(event)}>
          <div className="activity-editor__grid">
            <label className="editor-field">
              <span className="editor-field__label">时间</span>
              <input
                className="input input--compact"
                type="time"
                value={form.time}
                disabled={saving || form.status !== 'planned'}
                title={
                  form.status === 'planned'
                    ? '只改钟点，日期不变'
                    : '只有「待执行」的安排能改时间，先把状态改回待执行'
                }
                onChange={(event) => setForm((prev) => ({ ...prev, time: event.target.value }))}
                aria-label="时间"
              />
            </label>
            <label className="editor-field">
              <span className="editor-field__label">时长（分钟）</span>
              <input
                className="input input--compact"
                type="number"
                min={1}
                max={30}
                value={form.duration}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, duration: event.target.value }))
                }
                aria-label="时长"
              />
            </label>
            <label className="editor-field">
              <span className="editor-field__label">状态</span>
              <select
                className="input input--compact"
                value={form.status}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) => ({
                    ...prev,
                    status: event.target.value as 'planned' | 'completed' | 'skipped',
                  }))
                }
                aria-label="状态"
              >
                {EDITABLE_STATUS.map((option) => (
                  <option key={option.value} value={option.value}>
                    {option.label}
                  </option>
                ))}
              </select>
            </label>
            <label className="editor-field editor-field--wide">
              <span className="editor-field__label">标题</span>
              <input
                className="input input--compact"
                type="text"
                value={form.title}
                maxLength={40}
                disabled={saving}
                onChange={(event) => setForm((prev) => ({ ...prev, title: event.target.value }))}
                aria-label="标题"
              />
            </label>
            <label className="editor-field editor-field--wide">
              <span className="editor-field__label">说明</span>
              <input
                className="input input--compact"
                type="text"
                value={form.description}
                maxLength={200}
                disabled={saving}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, description: event.target.value }))
                }
                aria-label="说明"
              />
            </label>
          </div>

          <div className="activity-editor__foot">
            <button
              className="button button--primary button--small"
              type="submit"
              disabled={disabled || saving}
            >
              {saving ? '保存中…' : '保存'}
            </button>
            <button
              className="button button--ghost button--small"
              type="button"
              disabled={saving}
              onClick={() => setEditing(false)}
            >
              取消
            </button>
            <span className="hint hint--small activity-editor__tip">
              改到免打扰、或与前一条太近，后端会拒绝并说明是哪条规则。
            </span>
          </div>
        </form>
      </li>
    )
  }

  const classes = ['activity']
  if (highlight) classes.push('activity--next')
  if (activity.status !== 'planned') classes.push('activity--muted')

  /**
   * 类型角标文案。
   *
   * 三级兜底，最后一级是**留空**：被删掉的自定义类型在历史记录里仍然存在
   * （`activity_type` 存的是 `custom_1`），显示成 `custom_1` 等于把内部标识
   * 摆给用户看。标题本身就在卡片上，少一个角标不影响认这条记录。
   */
  const typeName =
    typeLabels?.[activity.activity_type] ??
    BUILTIN_LABELS[activity.activity_type] ??
    (activity.activity_type.startsWith('custom_') ? '' : activity.activity_type)

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
          {typeName && <span>{typeName}</span>}
          <span>{activity.duration_min} 分钟</span>
          {activity.source === 'agent' && <span className="activity__tag">Agent 建议</span>}
          {activity.postpone_count > 0 && <span>已推迟 {activity.postpone_count} 次</span>}
          {activity.skipped_reason && <span>原因：{activity.skipped_reason}</span>}
        </div>
      </div>

      <div className="activity__actions">
        {planned && (
          <>
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
          </>
        )}
        {editable && (
          // 「编辑」放在最后：它是低频动作，不该抢"完成"的位置。
          // 已完成/已跳过的条目也能点进来 —— 改回待执行是点错了的恢复路径。
          <button
            className="button button--ghost button--small"
            type="button"
            disabled={disabled}
            onClick={openEditor}
            title="改时间、内容或状态"
          >
            编辑
          </button>
        )}
      </div>
    </li>
  )
}
