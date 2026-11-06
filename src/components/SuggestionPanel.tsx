import { useState } from 'react'
import { ApiError, confirmActivityDrafts, suggestActivities } from '../api'
import type {
  ActivityDraft,
  ActivitySettings,
  ActivityWindow,
  SuggestConditions,
  SuggestionEngine,
  SuggestionEngineInfo,
} from '../types'

type Props = {
  /** 当前已保存的设置：条件表单以它为初始值 */
  settings: ActivitySettings | null
  /** 后端告知哪些引擎能用（llm 需要 MODEL_MODE=real + 凭证） */
  engines: SuggestionEngineInfo[]
  /** 保存成功：让页面重新拉「今日安排」和周统计，而不是本地插一条假装成功 */
  onSaved: (savedCount: number) => void
  onError: (err: unknown, fallback: string) => void
}

/** 从「第 3 条：……」里取出序号，用来把对应那张卡标红 */
function failedIndex(message: string): number | null {
  const matched = /第\s*(\d+)\s*条/.exec(message)
  if (!matched) return null
  const index = Number(matched[1]) - 1
  return Number.isInteger(index) && index >= 0 ? index : null
}

const WINDOW_LABELS: Record<string, string> = {
  morning: '上午',
  afternoon: '下午',
  evening: '晚上',
}

function emptyConditions(settings: ActivitySettings | null): SuggestConditions {
  return {
    work_start: settings?.work_start ?? '09:00',
    work_end: settings?.work_end ?? '18:00',
    windows: (settings?.windows ?? []).map((item) => ({ ...item })),
    quiet_start: settings?.quiet_start ?? '',
    quiet_end: settings?.quiet_end ?? '',
    ignore_quiet: false,
    count: settings?.daily_target ?? 3,
    note: '',
  }
}

/**
 * 条件表单的校验。和后端 validate_settings 是同一套判断标准，
 * 放在前端只是为了少一次往返：真正算数的还是后端那次校验。
 */
function validateConditions(form: SuggestConditions): string {
  if (!form.work_start || !form.work_end) return '请填写工作开始和结束时间。'
  if (form.work_start >= form.work_end) return '工作结束时间必须晚于开始时间。'
  if (form.windows.length === 0) return '至少要有一个可活动时段。'
  for (const window of form.windows) {
    if (!window.start || !window.end) return '可活动时段的开始和结束时间都要填。'
    if (window.start >= window.end) {
      return `时段 ${window.start}-${window.end} 的开始时间必须早于结束时间。`
    }
  }
  if (!form.ignore_quiet) {
    const hasStart = Boolean(form.quiet_start)
    const hasEnd = Boolean(form.quiet_end)
    if (hasStart !== hasEnd) return '免打扰的开始和结束时间需要成对填写。'
  }
  if (form.count < 1 || form.count > 8) return '每天次数需要在 1 到 8 之间。'
  return ''
}

/**
 * 建议草稿面板。
 *
 * 关键设计：这里拿到的是**草稿**，不是已经保存的活动。
 * 用户勾选并点「确认保存」才真正写库，届时后端会用同一套规则再校验一次
 * （免打扰、时段、已占用），所以模型说什么都不能绕过校验 ——
 * 这条对 DeepSeek 引擎同样成立，见 test_confirm_revalidates_llm_drafts。
 */
export default function SuggestionPanel({ settings, engines, onSaved, onError }: Props) {
  const [suggestions, setSuggestions] = useState<ActivityDraft[] | null>(null)
  const [picked, setPicked] = useState<boolean[]>([])
  const [explanation, setExplanation] = useState('')
  const [notice, setNotice] = useState('')
  const [mode, setMode] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [errorIndex, setErrorIndex] = useState<number | null>(null)

  const [engine, setEngine] = useState<SuggestionEngine>('rule')
  const [conditions, setConditions] = useState<SuggestConditions>(() => emptyConditions(settings))
  // 设置重新加载后把表单同步到最新的已保存值。
  // 用「渲染期比较」而不是 useEffect：effect 里 setState 会多渲染一轮，
  // 而且容易出现"刚打开面板就被覆盖"的闪烁。
  const [syncedSettings, setSyncedSettings] = useState(settings)
  if (settings !== syncedSettings) {
    setSyncedSettings(settings)
    setConditions(emptyConditions(settings))
  }

  const llmInfo = engines.find((item) => item.id === 'llm')
  const llmAvailable = Boolean(llmInfo?.available)
  const showConditions = engine === 'llm'

  function patch(changes: Partial<SuggestConditions>) {
    setConditions((prev) => ({ ...prev, ...changes }))
  }

  function patchWindow(index: number, changes: Partial<ActivityWindow>) {
    setConditions((prev) => ({
      ...prev,
      windows: prev.windows.map((item, i) => (i === index ? { ...item, ...changes } : item)),
    }))
  }

  function addWindow() {
    setConditions((prev) => ({
      ...prev,
      windows: [...prev.windows, { label: 'window', start: '15:00', end: '16:00' }],
    }))
  }

  function removeWindow(index: number) {
    setConditions((prev) => ({ ...prev, windows: prev.windows.filter((_, i) => i !== index) }))
  }

  function clearResult() {
    setSuggestions(null)
    setPicked([])
    setExplanation('')
    setNotice('')
    setMode('')
    setErrorText('')
    setErrorIndex(null)
  }

  function switchEngine(next: SuggestionEngine) {
    if (next === engine) return
    setEngine(next)
    // 换引擎就把上一次的结果清掉：两种引擎的产出混在一屏里，用户分不清哪条是谁给的
    clearResult()
    if (next === 'llm') setConditions(emptyConditions(settings))
  }

  async function handleSuggest() {
    if (loading) return

    if (showConditions) {
      const problem = validateConditions(conditions)
      if (problem) {
        setErrorText(problem)
        return
      }
    }

    // 免打扰两个框都清空 = 这次没有免打扰。
    // 不能只把 null 传上去：后端把 null 理解成"沿用已保存的设置"，
    // 于是用户清空了时间、排出来的却还是按旧免打扰避开 —— 看起来像没生效。
    const noQuiet = !conditions.quiet_start && !conditions.quiet_end

    setLoading(true)
    setErrorText('')
    setErrorIndex(null)
    setNotice('')
    try {
      const result = await suggestActivities(
        showConditions
          ? {
              engine: 'llm',
              count: conditions.count,
              note: conditions.note.trim() || undefined,
              conditions: {
                work_start: conditions.work_start,
                work_end: conditions.work_end,
                windows: conditions.windows,
                quiet_start: conditions.ignore_quiet || noQuiet ? null : conditions.quiet_start,
                quiet_end: conditions.ignore_quiet || noQuiet ? null : conditions.quiet_end,
                ignore_quiet: conditions.ignore_quiet || noQuiet,
              },
            }
          : { engine: 'rule' },
      )
      setSuggestions(result.suggestions)
      setPicked(result.suggestions.map(() => true))
      setExplanation(result.explanation)
      setMode(result.mode)
      // 请求写的是 llm，服务端回的是 rule：多半是后端还跑着不认 engine 字段的旧进程。
      // 这种情况不能静默接受 —— 否则用户「选了 DeepSeek、出来的还是规则数据」，
      // 页面看起来一切正常，只能靠肉眼猜。把差异直接摆到结果区上方。
      if (showConditions && result.mode !== 'llm') {
        setNotice('服务端没有按 DeepSeek 引擎返回，这一屏是本地规则的结果。后端可能还在跑旧版本进程，重启后重试。')
      } else {
        setNotice(result.notice)
      }
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onError(err, '生成建议失败')
        return
      }
      setErrorText(err instanceof Error ? err.message : '生成建议失败')
      setSuggestions(null)
    } finally {
      setLoading(false)
    }
  }

  async function handleConfirm() {
    if (!suggestions || confirming) return
    const chosen = suggestions.filter((_, index) => picked[index])
    if (chosen.length === 0) {
      setErrorText('至少选择一条再保存。')
      return
    }

    setConfirming(true)
    setErrorText('')
    setErrorIndex(null)
    try {
      const result = await confirmActivityDrafts(chosen)
      setSuggestions(null)
      setPicked([])
      setExplanation('')
      // 保存成功的提示交给页面统一显示，避免同一句话在面板和页头各出现一次
      setNotice('')
      setMode('')
      onSaved(result.saved)
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        onError(err, '保存建议失败')
        return
      }
      const message = err instanceof Error ? err.message : '保存建议失败'
      // 422：后端会指出是第几条不合法，把那张卡标红，用户才知道改哪一条
      setErrorIndex(err instanceof ApiError && err.status === 422 ? failedIndex(message) : null)
      setErrorText(message)
    } finally {
      setConfirming(false)
    }
  }

  function toggle(index: number) {
    setPicked((prev) => prev.map((value, i) => (i === index ? !value : value)))
  }

  return (
    <section className="suggest-panel">
      <div className="suggest-panel__head">
        <h2 className="section-title">安排建议</h2>
        <button
          className="button button--ghost button--small"
          type="button"
          onClick={() => void handleSuggest()}
          disabled={loading || confirming || (showConditions && !llmAvailable)}
        >
          {loading ? (showConditions ? 'DeepSeek 正在排…' : '正在排…') : suggestions ? '重新建议' : '生成建议'}
        </button>
      </div>

      <div className="engine-picker" role="group" aria-label="数据来源">
        {engines.map((item) => {
          const disabled = !item.available
          return (
            <button
              key={item.id}
              className={
                item.id === engine ? 'engine-option engine-option--active' : 'engine-option'
              }
              type="button"
              disabled={disabled || loading || confirming}
              aria-pressed={item.id === engine}
              title={item.reason}
              onClick={() => switchEngine(item.id)}
            >
              <span className="engine-option__name">{item.label}</span>
              {item.id === 'llm' && item.model && (
                <span className="engine-option__meta">{item.model}</span>
              )}
              {disabled && <span className="engine-option__meta">未启用</span>}
            </button>
          )
        })}
      </div>

      {/* 把"现在到底用哪个"写成一句话。
          之前只有选中态的颜色区分，很容易点完没反应还以为生效了 —— 那正是
          "选了 DeepSeek 却还是规则结果"这类误会最省成本的预防。 */}
      <p className="engine-picker__hint">
        {engine === 'llm'
          ? `当前用 DeepSeek 真实模型${llmInfo?.model ? `（${llmInfo.model}）` : ''}，点「生成建议」会真实调用一次。`
          : '当前用本地规则算法：不联网、结果确定。想让模型自己挑时间，点上面的「DeepSeek 真实模型」。'}
      </p>

      {showConditions && !llmAvailable && (
        <p className="banner banner--warn">
          {llmInfo?.reason ?? '后端未启用真实模型。'}
        </p>
      )}

      {showConditions && llmAvailable && (
        <div className="conditions">
          <p className="hint hint--small">
            下面的条件只用于这一次生成，不会改动上方已保存的设置。
          </p>

          <div className="settings__row">
            <label className="settings__field">
              <span className="field__label">工作开始</span>
              <input
                className="input"
                type="time"
                value={conditions.work_start}
                disabled={loading}
                onChange={(event) => patch({ work_start: event.target.value })}
              />
            </label>
            <label className="settings__field">
              <span className="field__label">工作结束</span>
              <input
                className="input"
                type="time"
                value={conditions.work_end}
                disabled={loading}
                onChange={(event) => patch({ work_end: event.target.value })}
              />
            </label>
            <label className="settings__field">
              <span className="field__label">安排次数</span>
              <input
                className="input"
                type="number"
                min={1}
                max={8}
                value={conditions.count}
                disabled={loading}
                onChange={(event) => patch({ count: Number(event.target.value) })}
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
                disabled={loading || conditions.windows.length >= 4}
              >
                添加时段
              </button>
            </div>
            {conditions.windows.map((window, index) => (
              <div className="settings__row" key={`${window.label}-${index}`}>
                <span className="conditions__tag">{WINDOW_LABELS[window.label] ?? window.label}</span>
                <input
                  className="input"
                  type="time"
                  value={window.start}
                  disabled={loading}
                  aria-label={`时段 ${index + 1} 开始`}
                  onChange={(event) => patchWindow(index, { start: event.target.value })}
                />
                <span className="conditions__dash">至</span>
                <input
                  className="input"
                  type="time"
                  value={window.end}
                  disabled={loading}
                  aria-label={`时段 ${index + 1} 结束`}
                  onChange={(event) => patchWindow(index, { end: event.target.value })}
                />
                <button
                  className="settings__remove"
                  type="button"
                  onClick={() => removeWindow(index)}
                  disabled={loading || conditions.windows.length <= 1}
                >
                  删除
                </button>
              </div>
            ))}
          </div>

          <div className="settings__group">
            <div className="settings__group-head">
              <span className="field__label">免打扰</span>
              <label className="settings__check">
                <input
                  type="checkbox"
                  checked={conditions.ignore_quiet}
                  disabled={loading}
                  onChange={(event) => patch({ ignore_quiet: event.target.checked })}
                />
                <span>这次不考虑免打扰（暂时关闭提醒）</span>
              </label>
            </div>
            <div className="settings__row">
              <label className="settings__field">
                <span className="field__label">免打扰开始</span>
                <input
                  className="input"
                  type="time"
                  value={conditions.quiet_start}
                  disabled={loading || conditions.ignore_quiet}
                  onChange={(event) => patch({ quiet_start: event.target.value })}
                />
              </label>
              <label className="settings__field">
                <span className="field__label">免打扰结束</span>
                <input
                  className="input"
                  type="time"
                  value={conditions.quiet_end}
                  disabled={loading || conditions.ignore_quiet}
                  onChange={(event) => patch({ quiet_end: event.target.value })}
                />
              </label>
            </div>
          </div>

          <label className="settings__field">
            <span className="field__label">偏好（可选，会一起交给模型）</span>
            <textarea
              className="input input--area"
              rows={2}
              maxLength={200}
              value={conditions.note}
              disabled={loading}
              placeholder="例如：下午容易犯困，希望多安排走动；开会多，别把活动排太密"
              onChange={(event) => patch({ note: event.target.value })}
            />
          </label>
        </div>
      )}

      <p className="hint hint--small">
        建议只算不存：勾选后点「确认保存」才会写入，写入前后端会再校验一次。
      </p>

      {errorText && (
        <p className="banner banner--error" role="alert">
          {errorText}
        </p>
      )}

      {notice && !suggestions && <p className="banner banner--info">{notice}</p>}

      {suggestions && suggestions.length === 0 && (
        <p className="hint state-line">今天没有剩余可用时段，可以调整时段或免打扰。</p>
      )}

      {suggestions && suggestions.length > 0 && (
        <>
          {explanation && (
            <p className="suggest-panel__explain">
              {/* 两个引擎都标出来。只标 DeepSeek 的话，"规则引擎的结果"在用户眼里
                  就是一段没有来源的假数据，根本分不清是不是模型没生效。 */}
              <span className={mode === 'llm' ? 'badge badge--engine' : 'badge badge--rule'}>
                {mode === 'llm' ? 'DeepSeek 生成' : '本地规则生成'}
              </span>
              {explanation}
            </p>
          )}
          {notice && <p className="banner banner--warn">{notice}</p>}

          <ul className="draft-list">
            {suggestions.map((item, index) => {
              const flagged = errorIndex === index
              return (
                <li className={flagged ? 'draft draft--error' : 'draft'} key={`${item.scheduled_at}-${index}`}>
                  <label className="draft__main">
                    <input
                      type="checkbox"
                      checked={picked[index] ?? false}
                      onChange={() => toggle(index)}
                      disabled={confirming}
                    />
                    <span className="draft__time">{item.scheduled_at.slice(11, 16)}</span>
                    <span className="draft__text">
                      <span className="draft__title">{item.title}</span>
                      <span className="draft__desc">{item.description}</span>
                      {item.reason && <span className="draft__reason">{item.reason}</span>}
                    </span>
                  </label>
                </li>
              )
            })}
          </ul>

          <div className="suggest-panel__actions">
            <button
              className="button button--primary"
              type="button"
              onClick={() => void handleConfirm()}
              disabled={confirming || picked.every((value) => !value)}
            >
              {confirming ? '保存中…' : `确认保存 ${picked.filter(Boolean).length} 条`}
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={clearResult}
              disabled={confirming}
            >
              取消
            </button>
          </div>
        </>
      )}
    </section>
  )
}
