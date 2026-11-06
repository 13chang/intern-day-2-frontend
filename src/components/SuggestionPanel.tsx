import { useState } from 'react'
import { ApiError, confirmActivityDrafts, suggestActivities } from '../api'
import type { ActivityDraft } from '../types'

type Props = {
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

/**
 * 建议草稿面板。
 *
 * 关键设计：这里拿到的是**草稿**，不是已经保存的活动。
 * 用户勾选并点「确认保存」才真正写库，届时后端会用同一套规则再校验一次
 * （免打扰、时段、已占用），所以 Agent 说什么都不能绕过校验。
 */
export default function SuggestionPanel({ onSaved, onError }: Props) {
  const [suggestions, setSuggestions] = useState<ActivityDraft[] | null>(null)
  const [picked, setPicked] = useState<boolean[]>([])
  const [explanation, setExplanation] = useState('')
  const [notice, setNotice] = useState('')
  const [loading, setLoading] = useState(false)
  const [confirming, setConfirming] = useState(false)
  const [errorText, setErrorText] = useState('')
  const [errorIndex, setErrorIndex] = useState<number | null>(null)

  async function handleSuggest() {
    if (loading) return
    setLoading(true)
    setErrorText('')
    setErrorIndex(null)
    setNotice('')
    try {
      const result = await suggestActivities()
      setSuggestions(result.suggestions)
      setPicked(result.suggestions.map(() => true))
      setExplanation(result.explanation)
      setNotice(result.notice)
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
          disabled={loading || confirming}
        >
          {loading ? '正在排…' : suggestions ? '重新建议' : '生成建议'}
        </button>
      </div>

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
          {explanation && <p className="suggest-panel__explain">{explanation}</p>}
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
              onClick={() => {
                setSuggestions(null)
                setPicked([])
                setErrorText('')
                setErrorIndex(null)
                setNotice('')
              }}
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
