import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  confirmActivitySuggestions,
  fetchActivitySuggestions,
  fetchReshuffleQuota,
  reshuffleActivitySuggestion,
  undoActivity,
} from '../api'
import { ruleHint } from '../rules'
import type {
  ActivityDraft,
  SuggestionDecision,
  SuggestionEngine,
} from '../types'

/**
 * 建议列表：草稿先给人看，用户点了才算数。
 *
 * 为什么值得单独一层（第六天曾经把它下线过）：那时候点「生成安排」直接落库，
 * 用户想表达"这条我不想做"只能先生成、再去列表里点跳过 —— 中间多一次写入。
 * 现在每一行直接给「完成 / 稍后 / 不方便」，点哪个就按哪个状态存，
 * 而且 5 秒内可以撤销（[撤销] 会真的把那条记录删掉，不是只改界面）。
 */

type Props = {
  day: string
  engine: SuggestionEngine
  /** 只给 llm 用：这次想让模型额外考虑什么 */
  note: string
  /** 有东西落库了（列表、统计都要重拉） */
  onSaved: () => void
  onError: (error: unknown, fallback: string) => void
  onClose: () => void
}

/** 撤销窗口，和后端 UNDO_WINDOW_SECONDS 一致。前端只负责显示，能不能撤由后端判。 */
const UNDO_MS = 5000

const DECISION_LABEL: Record<SuggestionDecision, string> = {
  done: '已完成',
  later: '待执行',
  skip: '今天不方便',
}

function hhmm(iso: string): string {
  return iso.slice(11, 16)
}

function byTime(a: ActivityDraft, b: ActivityDraft): number {
  return a.scheduled_at.localeCompare(b.scheduled_at)
}

/**
 * 错误文案：后端的中文原样显示，再按规则码补一句"去改哪里"。
 *
 * 放在模块级而不是组件里：组件内每渲染一次就是一个新函数，
 * 任何把它放进依赖数组的 useCallback 都会节节失效（这里吃过一次亏）。
 */
function errorText(err: unknown, fallback: string): string {
  const message = err instanceof Error ? err.message : fallback
  const hint = err instanceof ApiError ? ruleHint(err.ruleCode) : ''
  return hint ? `${message}（${hint}）` : message
}

/** 登录过期要交给页面统一处理（它会把人踢回登录页），面板不能自己弹一条提示就不管了。 */
function isUnauthorized(err: unknown): boolean {
  return err instanceof ApiError && err.status === 401
}

export default function SuggestionPanel({ day, engine, note, onSaved, onError, onClose }: Props) {
  const [drafts, setDrafts] = useState<ActivityDraft[]>([])
  const [explanation, setExplanation] = useState('')
  const [engineNote, setEngineNote] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [engineError, setEngineError] = useState('')
  const [loading, setLoading] = useState(true)
  /** 正在处理的行下标；整批操作时用 -1 */
  const [busy, setBusy] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  /**
   * 刚落库的那一条。5 秒内可以撤销 —— 保存 id 和原始草稿，
   * 撤销成功后把草稿放回列表，用户能重新点别的按钮。
   */
  const [undo, setUndo] = useState<{ id: number; draft: ActivityDraft; label: string } | null>(null)
  const [undoLeft, setUndoLeft] = useState(0)

  const load = useCallback(
    async (exclude: string[] = []): Promise<boolean> => {
      setLoading(true)
      setEngineError('')
      try {
        const result = await fetchActivitySuggestions({
          engine,
          day,
          // 规则引擎不读偏好，别把它传上去假装生效了
          note: engine === 'llm' ? note.trim() || undefined : undefined,
          exclude,
        })
        setDrafts([...result.suggestions].sort(byTime))
        setExplanation(result.explanation)
        setEngineNote(result.engine_note)
        setEvidence(result.evidence)
        setRemaining((prev) => result.remaining_reshuffles ?? prev)
        // dropped / excluded 是"这次为什么和上次一样/不一样"的答案，必须显示出来
        const parts: string[] = []
        if (result.notice) parts.push(result.notice)
        if (result.dropped > 0) parts.push(`模型有 ${result.dropped} 条不合条件，已丢弃。`)
        setNotice(parts.join(' '))
        return true
      } catch (err) {
        // 422 / 409 都不用页面自己编文案：后端已经写清是哪条规则卡住了
        if (isUnauthorized(err)) {
          onError(err, '生成建议失败')
          return false
        }
        setEngineError(errorText(err, '生成建议失败'))
        return false
      } finally {
        setLoading(false)
      }
    },
    // 只跟着"条件"变：日期换了、引擎换了，这批草稿就是按旧条件算的，必须重来。
    // remaining 不进依赖 —— 它只是显示，进依赖会让这个回调反复重建、反复触发加载。
    [day, engine, note, onError],
  )

  // 打开就加载；换日期或换引擎要重来一次 —— 否则屏幕上这批草稿是按旧条件算的
  useEffect(() => {
    void load()
  }, [load])

  /**
   * 登录过期交给页面统一处理（它会把人踢回登录页）。
   *
   * 面板里自己弹一条"登录已过期"是错的：提示留在界面上，用户点别处照样 401，
   * 而页面上其他请求已经跳走了 —— 两边状态不一致。
   */
  function fail(err: unknown, fallback: string) {
    if (isUnauthorized(err)) {
      onError(err, fallback)
      return
    }
    setEngineError(errorText(err, fallback))
  }

  // 剩余次数单独问一次：用户可能刚在另一个标签页换过
  useEffect(() => {
    let alive = true
    fetchReshuffleQuota()
      .then((quota) => {
        if (alive) setRemaining(quota.remaining)
      })
      .catch(() => {
        // 读不到就不显示次数，不影响主流程
      })
    return () => {
      alive = false
    }
  }, [])

  // 撤销倒计时。用 250ms 一次而不是 1s：秒数跳得准，
  // 也不会因为页面挂起恢复后停在一个陈旧的数字上。
  useEffect(() => {
    if (!undo) {
      setUndoLeft(0)
      return
    }
    const deadline = Date.now() + UNDO_MS
    const timer = window.setInterval(() => {
      const left = deadline - Date.now()
      if (left <= 0) {
        window.clearInterval(timer)
        setUndo(null)
        setUndoLeft(0)
        return
      }
      setUndoLeft(Math.ceil(left / 1000))
    }, 250)
    return () => window.clearInterval(timer)
  }, [undo])

  async function handleDecision(index: number, decision: SuggestionDecision) {
    const draft = drafts[index]
    if (!draft || busy !== null) return
    setBusy(index)
    setEngineError('')
    try {
      const result = await confirmActivitySuggestions([{ ...draft, decision }])
      // 保存后的那条在返回列表里：按时刻找，比按 title 找可靠
      const saved = result.activities.find((item) => item.scheduled_at === draft.scheduled_at)
      setDrafts((prev) => prev.filter((_, position) => position !== index))
      if (saved) {
        setUndo({
          id: saved.id,
          draft,
          label: `「${hhmm(draft.scheduled_at)} ${draft.title}」已记为${DECISION_LABEL[decision]}`,
        })
      }
      setNotice(
        decision === 'done'
          ? '已记为完成，去动一动吧。点错了可以 5 秒内撤销。'
          : `已记为${DECISION_LABEL[decision]}。`,
      )
      onSaved()
    } catch (err) {
      fail(err, '保存失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleUndo() {
    if (!undo) return
    const target = undo
    setUndo(null)
    setBusy(-1)
    try {
      await undoActivity(target.id)
      // 放回列表并重新排序：草稿回到用户手上，可以重新点
      setDrafts((prev) => [...prev, target.draft].sort(byTime))
      setNotice('已撤销，这条又回到建议列表里了。')
      onSaved()
    } catch (err) {
      fail(err, '撤销失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleReshuffle(index: number) {
    const draft = drafts[index]
    if (!draft || busy !== null) return
    setBusy(index)
    setEngineError('')
    try {
      const result = await reshuffleActivitySuggestion({
        at: draft.scheduled_at,
        activity_type: draft.activity_type,
        // 同批其他几条还没入库，不带上的话换出来的位置会在保存时撞车
        keep: drafts.filter((_, position) => position !== index).map((item) => item.scheduled_at),
        day,
      })
      setDrafts((prev) =>
        prev
          .map((item, position) => (position === index ? result.suggestion : item))
          .sort(byTime),
      )
      setRemaining(result.remaining)
      setNotice(`换到了 ${hhmm(result.suggestion.scheduled_at)}（${result.suggestion.title}）。`)
    } catch (err) {
      fail(err, '换一条失败')
    } finally {
      setBusy(null)
    }
  }

  async function handleReshuffleAll() {
    if (busy !== null) return
    setBusy(-1)
    setEngineError('')
    setNotice('')
    try {
      // 把当前这批全部否决掉再排一次。后端会把这些时刻从可用空间里挖掉，
      // 所以换出来的位置一定是新的 —— 否则这个按钮就是摆设
      const ok = await load(drafts.map((item) => item.scheduled_at))
      // 换不出来（那天只剩三个小空档）时后端会明确报错，这时不能说"换了一批"：
      // load 已经把自己的错误显示出来了，这里只负责别再说反话
      if (ok) setNotice('换了一批。')
    } finally {
      setBusy(null)
    }
  }

  async function handleAcceptAll() {
    if (busy !== null || drafts.length === 0) return
    setBusy(-1)
    setEngineError('')
    try {
      // 全部接受 = 全部存成待执行。想标完成就在行上点，别在这里猜
      const result = await confirmActivitySuggestions(
        drafts.map((draft) => ({ ...draft, decision: 'later' as const })),
      )
      setDrafts([])
      setUndo(null)
      setNotice(`已保存 ${result.saved} 条，都可以在下面的列表里逐个处理。`)
      onSaved()
    } catch (err) {
      fail(err, '保存失败')
    } finally {
      setBusy(null)
    }
  }

  const disabled = busy !== null
  const canReshuffle = remaining === null || remaining > 0

  return (
    <section className="suggestions" aria-label="安排建议">
      <header className="suggestions__head">
        <div className="suggestions__intro">
          <h2 className="suggestions__title">这几条先给你看看</h2>
          <p className="hint">
            {loading ? '正在算…' : explanation || '按你的可活动时段算出来的候选。'}
          </p>
        </div>
        <button className="button button--ghost button--small" type="button" onClick={onClose}>
          收起
        </button>
      </header>

      {engineError && (
        <p className="banner banner--error" role="alert">
          {engineError}
        </p>
      )}

      {undo && (
        // 撤销条比弹窗轻：不遮挡列表，也不会因为用户没点而卡住流程
        <div className="undo-bar">
          <span className="undo-bar__text">{undo.label}</span>
          <button className="undo-bar__button" type="button" onClick={() => void handleUndo()}>
            撤销（{undoLeft} 秒）
          </button>
        </div>
      )}

      {notice && <p className="banner banner--info">{notice}</p>}

      {loading ? (
        <p className="hint state-line">正在生成建议…</p>
      ) : drafts.length === 0 ? (
        <p className="hint state-line">
          没有待确认的建议了。可以换一批，或者直接在上面生成安排。
        </p>
      ) : (
        <ul className="suggestion-list">
          {drafts.map((draft, index) => (
            <li className="suggestion" key={`${draft.scheduled_at}-${draft.activity_type}`}>
              <div className="suggestion__time">{hhmm(draft.scheduled_at)}</div>
              <div className="suggestion__body">
                <p className="suggestion__title">{draft.title}</p>
                <p className="hint hint--small">{draft.description}</p>
                {draft.reason && <p className="hint hint--small hint--warn">{draft.reason}</p>}
              </div>
              <div className="suggestion__actions">
                <button
                  className="button button--primary button--small"
                  type="button"
                  disabled={disabled}
                  onClick={() => void handleDecision(index, 'done')}
                  title="存下来并标记为已完成，一步到位"
                >
                  完成
                </button>
                <button
                  className="button button--small"
                  type="button"
                  disabled={disabled}
                  onClick={() => void handleDecision(index, 'later')}
                  title="存成待执行，到点再提醒"
                >
                  稍后做
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  disabled={disabled}
                  onClick={() => void handleDecision(index, 'skip')}
                  title="这天不做这条，但留一条记录"
                >
                  不方便
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  disabled={disabled || !canReshuffle}
                  onClick={() => void handleReshuffle(index)}
                  title={
                    canReshuffle ? '在原来那条附近换一个空位' : '今天换的次数用完了，明天再来'
                  }
                >
                  换时间
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}

      {drafts.length > 0 && (
        <footer className="suggestions__foot">
          <button
            className="button button--primary"
            type="button"
            disabled={disabled}
            onClick={() => void handleAcceptAll()}
          >
            全部接受（存为待执行）
          </button>
          <button
            className="button"
            type="button"
            disabled={disabled || !canReshuffle}
            onClick={() => void handleReshuffleAll()}
            title={canReshuffle ? '把这一批都换掉' : '今天换的次数用完了'}
          >
            换一批
            {remaining !== null && `（今天还剩 ${remaining} 次）`}
          </button>
        </footer>
      )}

      {evidence.length > 0 && (
        // 推荐依据：给的是参数和结论，让用户能核对"有没有按我设的来"
        <ul className="evidence">
          {evidence.map((line) => (
            <li className="evidence__item" key={line}>
              {line}
            </li>
          ))}
        </ul>
      )}

      {/* 这句由后端给：没配模型时它说的是"本地规则引擎"，
          页面不许在没有依据的情况下写"AI 已生成" */}
      {engineNote && <p className="hint hint--small suggestions__engine">{engineNote}</p>}
    </section>
  )
}
