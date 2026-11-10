import { useEffect, useState } from 'react'
import { ApiError, previewActivityRules, saveActivitySettings } from '../api'
import type { ActivityRuleset, ActivitySettings, ActivityWindow } from '../types'

type Props = {
  settings: ActivitySettings | null
  onSaved: (next: ActivitySettings) => void
  /** API 失败交回页面统一处理（401 要回登录页，不能只在本面板里报错） */
  onError: (err: unknown, fallback: string) => void
}

function windowSummary(windows: ActivityWindow[]): string {
  if (windows.length === 0) return '未设置时段'
  return windows.map((item) => `${item.start}-${item.end}`).join(' / ')
}

/**
 * 只挑后端认识的字段。
 *
 * 不整个对象发过去：``ActivitySettings`` 从服务端读回来时会带 ``user_id``，
 * 原样回传等于让客户端告诉服务端"我是谁"——虽然后端不读它，但这种形状不该存在。
 */
function payloadOf(value: ActivitySettings): ActivitySettings {
  return {
    work_start: value.work_start,
    work_end: value.work_end,
    windows: value.windows,
    quiet_start: value.quiet_start || null,
    quiet_end: value.quiet_end || null,
    reminders_enabled: value.reminders_enabled,
    allow_during_work: value.allow_during_work,
    daily_target: value.daily_target,
    postpone_policy: value.postpone_policy,
  }
}

function rangeText(ranges: { start: string; end: string }[]): string {
  if (ranges.length === 0) return '无'
  return ranges.map((item) => `${item.start}-${item.end}`).join('、')
}

/**
 * 设置面板。
 *
 * 默认折叠：这一栏还要放「今日安排」和「周统计」，展开的表单会把列表挤到看不见。
 * 折叠状态下标题行直接显示当前时段与免打扰，验收「刷新后设置还在」不用展开也能看到。
 */
export default function SettingsPanel({ settings, onSaved, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ActivitySettings | null>(settings)
  const [synced, setSynced] = useState<ActivitySettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [ruleset, setRuleset] = useState<ActivityRuleset | null>(null)
  const [rulesError, setRulesError] = useState('')

  // 后端返回（首次加载 / 保存成功后）以服务端为准覆盖本地草稿，
  // 避免用户改了没保存、然后列表刷新把脏值又带回来。
  //
  // 这里用「渲染期同步」而不是 useEffect：setState 放在 effect 里会多跑一轮渲染，
  // 而这条逻辑只是把 props 的变化反映到本地状态，属于官方推荐的 adjust-state-during-render 用法。
  //
  // 只在面板收起时覆盖：展开时用户正在改，如果因为点「完成」触发了列表刷新，
  // 服务端返回的旧设置会把没保存的修改无声抹掉。
  if (settings !== synced) {
    setSynced(settings)
    if (!open) setDraft(settings)
  }

  /**
   * 边改边看：草稿变化 350ms 后问后端"按这份设置算，现在的边界是什么"。
   *
   * 为什么不让前端自己按字符串切：区间运算里有跨天免打扰、窗口裁剪、已过去的时间
   * 这些坑，前端实现第二份必然和真正排程用的那份漂 —— 而且漂了不会报错，
   * 只表现为"面板上说能排，点生成却说没有可用时段"。
   *
   * 350ms 是防抖：改一个时间框会连续触发 onChange（每敲一个数字一次），
   * 每次都发请求的话，最后回来的那个不一定是最后改的那个。
   */
  useEffect(() => {
    if (!open || !draft) return
    let active = true
    const timer = window.setTimeout(() => {
      previewActivityRules(payloadOf(draft))
        .then((next) => {
          if (!active) return
          setRuleset(next)
          setRulesError('')
        })
        .catch((err: unknown) => {
          if (!active) return
          // 401 交回页面（要回登录页），其余只在本面板里提示
          if (err instanceof ApiError && err.status === 401) {
            onError(err, '读取规则失败')
            return
          }
          setRulesError(err instanceof Error ? err.message : '读取规则失败')
        })
    }, 350)
    return () => {
      active = false
      window.clearTimeout(timer)
    }
  }, [open, draft, onError])

  if (!draft) {
    return (
      <section className="settings">
        <p className="hint">正在加载设置…</p>
      </section>
    )
  }

  function patch(changes: Partial<ActivitySettings>) {
    setDraft((prev) => (prev ? { ...prev, ...changes } : prev))
  }

  function patchWindow(index: number, changes: Partial<ActivityWindow>) {
    setDraft((prev) => {
      if (!prev) return prev
      const windows = prev.windows.map((item, i) => (i === index ? { ...item, ...changes } : item))
      return { ...prev, windows }
    })
  }

  function addWindow() {
    setDraft((prev) => {
      if (!prev || prev.windows.length >= 6) return prev
      return {
        ...prev,
        windows: [
          ...prev.windows,
          { label: `window-${prev.windows.length + 1}`, start: '10:00', end: '12:00' },
        ],
      }
    })
  }

  function removeWindow(index: number) {
    setDraft((prev) => {
      if (!prev) return prev
      return { ...prev, windows: prev.windows.filter((_, i) => i !== index) }
    })
  }

  /** 跨字段校验：pydantic 只管单字段格式，"结束要晚于开始"必须在这里先挡一次。 */
  function validate(value: ActivitySettings): string {
    if (value.work_start >= value.work_end) return '工作结束时间必须晚于开始时间。'
    if (value.windows.length === 0) return '至少保留一个可活动时段。'
    for (const item of value.windows) {
      if (item.start >= item.end) {
        return `时段 ${item.start}-${item.end} 的开始时间必须早于结束时间。`
      }
    }
    if (Boolean(value.quiet_start) !== Boolean(value.quiet_end)) {
      return '免打扰的开始和结束时间需要成对填写。'
    }
    if (value.daily_target < 1 || value.daily_target > 8) return '每天次数需要在 1 到 8 之间。'
    return ''
  }

  async function handleSave() {
    if (!draft || saving) return
    const message = validate(draft)
    if (message) {
      setLocalError(message)
      return
    }

    setSaving(true)
    setLocalError('')
    try {
      const saved = await saveActivitySettings(payloadOf(draft))
      onSaved(saved)
      setOpen(false)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onError(err, '保存设置失败')
        return
      }
      setLocalError(err instanceof Error ? err.message : '保存设置失败')
    } finally {
      setSaving(false)
    }
  }

  const quietText =
    draft.quiet_start && draft.quiet_end ? `${draft.quiet_start}-${draft.quiet_end}` : '未设置'

  return (
    <section className="settings">
      <button
        className="settings__toggle"
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
      >
        <span className="settings__toggle-title">
          活动设置
          <span className="hint hint--small">
            时段 {windowSummary(draft.windows)} · 免打扰 {quietText}
          </span>
        </span>
        <span className="settings__chevron" aria-hidden="true">
          {open ? '收起' : '调整'}
        </span>
      </button>

      {open && (
        <div className="settings__form">
          <div className="settings__row">
            <label className="settings__field">
              <span className="field__label">上班开始</span>
              <input
                className="input"
                type="time"
                value={draft.work_start}
                onChange={(event) => patch({ work_start: event.target.value })}
              />
            </label>
            <label className="settings__field">
              <span className="field__label">上班结束</span>
              <input
                className="input"
                type="time"
                value={draft.work_end}
                onChange={(event) => patch({ work_end: event.target.value })}
              />
            </label>
          </div>

          <div className="settings__group">
            <div className="settings__group-head">
              <span className="field__label">可活动时段</span>
              <button
                className="button button--ghost button--small"
                type="button"
                onClick={addWindow}
                disabled={draft.windows.length >= 6}
              >
                加一段
              </button>
            </div>
            {draft.windows.map((item, index) => (
              <div className="settings__row" key={`${item.label}-${index}`}>
                <input
                  className="input"
                  type="time"
                  value={item.start}
                  aria-label={`第 ${index + 1} 段开始`}
                  onChange={(event) => patchWindow(index, { start: event.target.value })}
                />
                <input
                  className="input"
                  type="time"
                  value={item.end}
                  aria-label={`第 ${index + 1} 段结束`}
                  onChange={(event) => patchWindow(index, { end: event.target.value })}
                />
                <button
                  className="settings__remove"
                  type="button"
                  onClick={() => removeWindow(index)}
                  disabled={draft.windows.length <= 1}
                  aria-label={`删除第 ${index + 1} 段`}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          <div className="settings__row">
            <label className="settings__field">
              <span className="field__label">免打扰开始</span>
              <input
                className="input"
                type="time"
                value={draft.quiet_start ?? ''}
                onChange={(event) => patch({ quiet_start: event.target.value || null })}
              />
            </label>
            <label className="settings__field">
              <span className="field__label">免打扰结束</span>
              <input
                className="input"
                type="time"
                value={draft.quiet_end ?? ''}
                onChange={(event) => patch({ quiet_end: event.target.value || null })}
              />
            </label>
          </div>

          <div className="settings__row">
            <label className="settings__field">
              <span className="field__label">每天次数</span>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={draft.daily_target}
                onChange={(event) => patch({ daily_target: Number(event.target.value) })}
              />
            </label>
            <label className="settings__field">
              <span className="field__label">推迟策略</span>
              <select
                className="input"
                value={draft.postpone_policy}
                onChange={(event) =>
                  patch({ postpone_policy: event.target.value as ActivitySettings['postpone_policy'] })
                }
              >
                <option value="next_slot">自动排到下一个可用时段</option>
                <option value="ask">先问我</option>
              </select>
            </label>
          </div>

          <label className="settings__check">
            <input
              type="checkbox"
              checked={draft.reminders_enabled}
              onChange={(event) => patch({ reminders_enabled: event.target.checked })}
            />
            <span>到点提醒（关闭后不再高亮最近一条）</span>
          </label>

          {/*
            规则清单（R1-3）。把"现在到底按什么规则在排"直接列出来：
            上面几个输入框只写了参数，看不出这些参数合起来意味着什么 ——
            例如可活动时段 14:00-17:30 被工作时段 09:00-18:00 裁过之后
            仍然是 14:00-17:30，但反过来就会被裁掉一截，只有算出来才看得见。
          */}
          <div className="rulestack">
            <div className="rulestack__head">
              <span className="field__label">当前生效的规则</span>
              <span className="hint hint--small">改上面的参数会立刻反映在这里</span>
            </div>

            {rulesError && (
              <p className="hint hint--warn" role="alert">
                {rulesError}
              </p>
            )}

            {ruleset && (
              <>
                <ol className="rulestack__list">
                  {ruleset.rules.map((rule) => (
                    <li className="rule" key={rule.code} data-rule={rule.code}>
                      <span className="rule__name">{rule.name}</span>
                      <span className="rule__boundary">{rule.boundary}</span>
                      {!rule.blocking && <span className="rule__tag">仅提示</span>}
                      <span className="rule__summary">{rule.summary}</span>
                    </li>
                  ))}
                </ol>
                <p className="hint hint--small">
                  可活动 {rangeText(ruleset.allowed_ranges)} · 免打扰{' '}
                  {rangeText(ruleset.quiet_ranges)} · 实际可用{' '}
                  {rangeText(ruleset.free_ranges)}
                </p>
                {/* 边界算不出来时说明原因：编辑到一半条件矛盾是正常的，
                    但要让用户知道"现在这个组合排不出东西"以及该改哪一侧。 */}
                {ruleset.notice && <p className="hint hint--warn">{ruleset.notice}</p>}
              </>
            )}
          </div>

          {localError && (
            <p className="banner banner--error" role="alert">
              {localError}
            </p>
          )}

          <div className="settings__actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void handleSave()}
              disabled={saving}
            >
              {saving ? '保存中…' : '保存设置'}
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => {
                setDraft(settings)
                setLocalError('')
              }}
              disabled={saving}
            >
              放弃修改
            </button>
          </div>
        </div>
      )}
    </section>
  )
}
