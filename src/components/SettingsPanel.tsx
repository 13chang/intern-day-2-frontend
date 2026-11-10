import { useEffect, useState } from 'react'
import { ApiError, previewActivityRules, saveActivitySettings } from '../api'
import {
  MAX_CUSTOM_TYPES,
  MAX_TYPE_DESCRIPTION,
  MAX_TYPE_TITLE,
  nextCustomKey,
  typeOptions,
} from '../activityTypes'
import type {
  ActivityRuleset,
  ActivitySettings,
  CustomActivityType,
  ActivityWindow,
} from '../types'

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
 *
 * 偏好三项 + 自定义活动必须带上。后端 ``SettingsIn`` 里它们有默认值（空 / 5 / 10 / 空），
 * 漏传不会报错，只会**静默把用户设过的东西重置**——这类失败没有任何提示，
 * 用户下次看到"为什么又给我排拉伸"时根本联想不到是保存设置导致的。
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
    preferred_types: value.preferred_types,
    custom_types: value.custom_types,
    duration_min: value.duration_min,
    min_gap_min: value.min_gap_min,
  }
}

function rangeText(ranges: { start: string; end: string }[]): string {
  if (ranges.length === 0) return '无'
  return ranges.map((item) => `${item.start}-${item.end}`).join('、')
}

/**
 * 补齐偏好三项与自定义活动。
 *
 * 正常情况下后端一定给（SettingsOut 就带这几个字段），但这一层不能赌：
 * 少一个字段，下面 ``draft.preferred_types.includes(...)`` 就会抛 TypeError，
 * 整页白屏 —— 而这只是"设置面板少了几个控件"的程度。默认值与后端一致。
 */
function normalize(value: ActivitySettings): ActivitySettings {
  return {
    ...value,
    preferred_types: value.preferred_types ?? [],
    custom_types: value.custom_types ?? [],
    duration_min: value.duration_min ?? 5,
    min_gap_min: value.min_gap_min ?? 10,
  }
}

/**
 * 设置面板。
 *
 * 默认折叠：这一栏还要放「今日安排」和「周统计」，展开的表单会把列表挤到看不见。
 * 折叠状态下标题行直接显示当前时段与免打扰，验收「刷新后设置还在」不用展开也能看到。
 */
export default function SettingsPanel({ settings, onSaved, onError }: Props) {
  const [open, setOpen] = useState(false)
  const [draft, setDraft] = useState<ActivitySettings | null>(settings ? normalize(settings) : null)
  const [synced, setSynced] = useState<ActivitySettings | null>(settings)
  const [saving, setSaving] = useState(false)
  const [localError, setLocalError] = useState('')
  const [ruleset, setRuleset] = useState<ActivityRuleset | null>(null)
  const [rulesError, setRulesError] = useState('')
  /**
   * 「添加自定义活动」两格输入。
   *
   * 放在草稿之外（独立 state）而不是塞进 draft.custom_types：填了一半的输入框
   * 还不是一条活动，混进列表里就会被一起提交、被偏好勾选、被排程选中。
   */
  const [newTypeTitle, setNewTypeTitle] = useState('')
  const [newTypeDesc, setNewTypeDesc] = useState('')
  const [typeError, setTypeError] = useState('')

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
    if (!open) setDraft(settings ? normalize(settings) : settings)
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

  /**
   * 勾/取消一类活动。
   *
   * 全不勾 = 所有类型都接受，不是"什么都别排"。这个语义在后端
   * （``allowed_activity_types``）和设置里的说明都写成一样，前端不许自己发明第三种解释。
   */
  function toggleType(type: string) {
    setDraft((prev) => {
      if (!prev) return prev
      const picked = prev.preferred_types.includes(type)
        ? prev.preferred_types.filter((item) => item !== type)
        : [...prev.preferred_types, type]
      return { ...prev, preferred_types: picked }
    })
  }

  /**
   * 加一条自定义活动。
   *
   * 顺序：校验 → 生 key → 追加 → 视情况勾进偏好。
   *
   * 最后一步是最容易被漏掉的："加了却没有被推荐"比"根本没加"更让人困惑。
   * 两种情况分开处理：
   *
   * - 偏好**非空**（用户已经勾了"只排这几类"）→ **自动勾上**。不勾的话，
   *   后端严格按偏好挑，用户刚加的活动永远排不出来（第十天真实踩过：
   *   四类全勾着再加"喝咖啡"，推荐里一份都不出来）。
   * - 偏好**为空**（= 全都接受）→ 不勾。勾上会把语义从"全都接受"变成
   *   "只排这一个"，而用户点的只是「添加」。
   */
  function addCustomType() {
    if (!draft) return
    const title = newTypeTitle.trim()
    if (!title) {
      setTypeError('先给它起个名字，例如「去楼下买咖啡」。')
      return
    }
    if (title.length > MAX_TYPE_TITLE) {
      setTypeError(`标题最多 ${MAX_TYPE_TITLE} 个字。`)
      return
    }
    if (draft.custom_types.length >= MAX_CUSTOM_TYPES) {
      setTypeError(`最多 ${MAX_CUSTOM_TYPES} 个自定义活动。`)
      return
    }
    // 标题重复直接拒：列表上是按标题认的，两个一样的分不清该勾哪个。
    // 后端允许重名（它按 key 区分），所以这条只能在界面上拦。
    if (draft.custom_types.some((item) => item.title === title)) {
      setTypeError('已经有一条叫这个名字的活动了。')
      return
    }

    const next: CustomActivityType = {
      key: nextCustomKey(draft.custom_types),
      title,
      description: newTypeDesc.trim().slice(0, MAX_TYPE_DESCRIPTION),
    }
    setDraft({
      ...draft,
      custom_types: [...draft.custom_types, next],
      preferred_types:
        draft.preferred_types.length > 0
          ? [...draft.preferred_types, next.key]
          : draft.preferred_types,
    })
    setNewTypeTitle('')
    setNewTypeDesc('')
    setTypeError('')
  }

  /**
   * 删一条自定义活动。
   *
   * 顺手把它从偏好里摘掉：不摘的话偏好里会留一个失效 key，
   * 排程时被忽略（后端不会报错），但设置页上那条说明会一直显示着一个不存在的活动名。
   */
  function removeCustomType(key: string) {
    if (!draft) return
    setDraft({
      ...draft,
      custom_types: draft.custom_types.filter((item) => item.key !== key),
      preferred_types: draft.preferred_types.filter((item) => item !== key),
    })
    setTypeError('')
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
    // 输入框里有内容但没点「添加」：保存会把它一起丢掉，而用户以为已经加上了。
    // 拦住比"保存成功但活动没进来"好解释 —— 后者要过一周才会被发现。
    if (newTypeTitle.trim()) {
      return '自定义活动还没加进列表：先点「添加」或按回车，或者清空那个输入框再保存。'
    }
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
    // 范围和后端 validate_settings 一致，先在这里挡一次，省掉一次往返
    if (!Number.isFinite(value.duration_min) || value.duration_min < 1 || value.duration_min > 30) {
      return '单次时长需要在 1 到 30 分钟之间。'
    }
    if (!Number.isFinite(value.min_gap_min) || value.min_gap_min < 0 || value.min_gap_min > 120) {
      return '两条之间的最小间隔需要在 0 到 120 分钟之间。'
    }
    // 自定义活动：添加时已经拦过，这里再挡一次是因为草稿可能来自服务端
    // （例如另一个页面刚存过一条不合规的数据）。范围和后端
    // service.clean_custom_types 完全一致，先在这里挡掉一次往返。
    if (value.custom_types.length > MAX_CUSTOM_TYPES) {
      return `最多 ${MAX_CUSTOM_TYPES} 个自定义活动。`
    }
    for (const item of value.custom_types) {
      if (!item.title.trim()) return '自定义活动需要有名字。'
      if (item.title.length > MAX_TYPE_TITLE) return `标题最多 ${MAX_TYPE_TITLE} 个字。`
      if (item.description.length > MAX_TYPE_DESCRIPTION) {
        return `说明最多 ${MAX_TYPE_DESCRIPTION} 个字。`
      }
    }
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

  // 可选类型在渲染前算一次：内置四类 + 自定义，下面两处都用它。
  // 每次 `.map` 里现算会得到新数组，React 的 key 虽然还在，
  // 但"勾选后那一格要不要重画"只能靠 diff，没必要多这一层开销
  const typeChoices = typeOptions(draft)
  const builtinChoices = typeChoices.filter((option) => !option.custom)
  const preferredText =
    draft.preferred_types.length === 0
      ? '下面这些都可以被推荐'
      : `只排：${draft.preferred_types
          .map((item) => typeChoices.find((opt) => opt.value === item)?.label ?? item)
          .join('、')}`

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

          {/*
            偏好（R2-3）。这一块之前只有后端有、前端没有界面：
            用户根本设不了，而且每次点「保存设置」都会把它们重置成默认值
            （payloadOf 漏传这三个字段 → pydantic 用默认值兜底）。
            现在补齐，并且三者一起提交。

            第十天起"四类"这个说法不再成立：可选类型 = 内置四类 + 用户自己加的。
            自定义活动不做成另一种控件 —— 它们和内置四类一样是被勾选的对象，
            只是多了「说明」和「删除」。
          */}
          <div className="settings__group">
            <div className="settings__group-head">
              <span className="field__label">活动偏好</span>
              <span className="hint hint--small">{preferredText}</span>
            </div>

            <div className="chips">
              {builtinChoices.map((option) => {
                const checked = draft.preferred_types.includes(option.value)
                return (
                  <label key={option.value} className={checked ? 'chip chip--active' : 'chip'}>
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggleType(option.value)}
                    />
                    <span>{option.label}</span>
                  </label>
                )
              })}
            </div>

            <div className="type-list">
              {draft.custom_types.map((item) => {
                const checked = draft.preferred_types.includes(item.key)
                return (
                  <div className={checked ? 'type-row type-row--active' : 'type-row'} key={item.key}>
                    <label className="type-row__main">
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggleType(item.key)}
                      />
                      <span className="type-row__title">{item.title}</span>
                      <span className="type-row__desc">
                        {item.description || '（没有说明，会直接用标题）'}
                      </span>
                    </label>
                    <button
                      className="type-row__remove"
                      type="button"
                      onClick={() => removeCustomType(item.key)}
                      aria-label={`删除自定义活动「${item.title}」`}
                    >
                      删除
                    </button>
                  </div>
                )
              })}
            </div>

            {/*
              自定义活动：用户原话是"不需要是固定这四大类"。
              加进来的活动会立刻参与轮换（偏好为空时排在四类之后），
              勾上偏好就只排它。key 由 nextCustomKey 生成且保持不变，
              所以改标题不会让历史记录里的类型变成孤儿。
            */}
            <div className="type-add">
              <input
                className="input input--compact"
                type="text"
                value={newTypeTitle}
                maxLength={MAX_TYPE_TITLE}
                placeholder="加一个自己的活动，例如：去楼下买咖啡"
                aria-label="自定义活动名称"
                onChange={(event) => {
                  setNewTypeTitle(event.target.value)
                  setTypeError('')
                }}
                onKeyDown={(event) => {
                  // 回车即添加：这里是一行输入，不是表单，没必要逼用户去点按钮
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addCustomType()
                  }
                }}
              />
              <input
                className="input input--compact"
                type="text"
                value={newTypeDesc}
                maxLength={MAX_TYPE_DESCRIPTION}
                placeholder="一句说明（可不填）"
                aria-label="自定义活动说明"
                onChange={(event) => setNewTypeDesc(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    addCustomType()
                  }
                }}
              />
              <button
                className={
                  newTypeTitle.trim()
                    ? 'button button--primary button--small'
                    : 'button button--ghost button--small'
                }
                type="button"
                onClick={addCustomType}
                disabled={draft.custom_types.length >= MAX_CUSTOM_TYPES}
                title={
                  draft.custom_types.length >= MAX_CUSTOM_TYPES
                    ? `最多 ${MAX_CUSTOM_TYPES} 个`
                    : '添加到上面的列表'
                }
              >
                添加
              </button>
            </div>

            {/*
              输入框填了字但没点「添加」时给一句提示。
              第十天真实踩过：用户把「喜欢咖啡，给我安排一个喝咖啡的」打进框里，
              以为已经加好了，然后问"为什么推荐里没有咖啡"。
              回车和按钮都能加，但没人知道这件事 —— 写出来比让他猜便宜得多。
            */}
            {newTypeTitle.trim() && (
              <p className="hint hint--small">
                还没加进去 —— 点「添加」或按回车，它才会出现在上面的列表里并参与推荐。
              </p>
            )}

            {typeError && (
              <p className="hint hint--warn" role="alert">
                {typeError}
              </p>
            )}

            <div className="settings__row">
              <label className="settings__field">
                <span className="field__label">单次时长（分钟）</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={30}
                  value={draft.duration_min}
                  onChange={(event) => patch({ duration_min: Number(event.target.value) })}
                />
              </label>
              <label className="settings__field">
                <span className="field__label">两条之间至少间隔（分钟）</span>
                <input
                  className="input"
                  type="number"
                  min={0}
                  max={120}
                  value={draft.min_gap_min}
                  onChange={(event) => patch({ min_gap_min: Number(event.target.value) })}
                />
              </label>
            </div>
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
                setDraft(settings ? normalize(settings) : settings)
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
