import { useCallback, useEffect, useState } from 'react'
import {
  ApiError,
  confirmActivitySuggestions,
  fetchActivitySuggestions,
  fetchReshuffleQuota,
  undoActivity,
} from '../api'
import { ruleHint } from '../rules'
import type { ActivityDraft, SuggestionEngine } from '../types'

/**
 * 建议列表：草稿先给人看，**点了「同意」才算数**。
 *
 * 为什么改成两个按钮（同意 / 拒绝）：
 *
 * 以前每行是「完成 / 稍后做 / 不方便」，点哪个都会立刻写库并出现在下面的安排列表里。
 * 结果就是"我明明点了不方便，它怎么排在今天的日程里" —— 否决和建议混在一处，
 * 用户看不出"哪些是我定了的、哪些只是给我看的"。
 *
 * 现在是**两道闸**：建议区只回答"这一条要不要"，点同意才落库（存成待执行），
 * 点拒绝就当场丢掉、不写库；落库之后要标完成/改时间，都在下面的安排列表里做。
 * 时间可以直接在这一行改（只改钟点，日期跟着这一天），改完仍要过后端规则校验。
 */

type Props = {
  day: string
  engine: SuggestionEngine
  /** 只给 llm 用：这次想让模型额外考虑什么 */
  note: string
  /**
   * 影响排程的设置指纹（活动偏好 / 自定义活动 / 时长 / 间隔）。
   *
   * 为什么需要它：候选是在某一份设置下算出来的。用户改完偏好（比如刚加了一种
   * 自定义活动）再回来看，屏幕上还是上一批候选 —— 看起来就像"加了没用"。
   * 指纹变了就退回未生成状态，逼着重新算一次。
   *
   * 传的是字符串而不是 settings 对象：对象每次 `load()` 都是新引用，
   * 用它当依赖会让"点完成一条"也把整批候选清掉，那是另一个 bug。
   */
  settingsKey: string
  /** 有东西落库了（列表、统计都要重拉） */
  onSaved: () => void
  onError: (error: unknown, fallback: string) => void
  onClose: () => void
}

/** 撤销窗口，和后端 UNDO_WINDOW_SECONDS 一致。前端只负责显示，能不能撤由后端判。 */
const UNDO_MS = 5000

function hhmm(iso: string): string {
  return iso.slice(11, 16)
}

function byTime(a: ActivityDraft, b: ActivityDraft): number {
  return a.scheduled_at.localeCompare(b.scheduled_at)
}

/** 只换钟点，日期和偏移照抄（同 ActivityCard 里的同名逻辑，理由见那边注释）。 */
function withTime(iso: string, clock: string): string {
  return `${iso.slice(0, 11)}${clock}:00${iso.slice(19)}`
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

export default function SuggestionPanel({
  day,
  engine,
  note,
  settingsKey,
  onSaved,
  onError,
  onClose,
}: Props) {
  const [drafts, setDrafts] = useState<ActivityDraft[]>([])
  const [explanation, setExplanation] = useState('')
  const [engineNote, setEngineNote] = useState('')
  const [evidence, setEvidence] = useState<string[]>([])
  const [notice, setNotice] = useState('')
  const [engineError, setEngineError] = useState('')
  /**
   * 是否已经生成过。
   *
   * 打开面板**不再自动生成**：生成要么烧一次 DeepSeek 调用，要么按规则算一批可能
   * 用户根本不想要的东西，然后还得逐条拒绝。所以先停在这里，等用户自己点「生成建议」。
   */
  const [started, setStarted] = useState(false)
  const [loading, setLoading] = useState(false)
  /** 正在处理的行下标；整批操作时用 -1 */
  const [busy, setBusy] = useState<number | null>(null)
  const [remaining, setRemaining] = useState<number | null>(null)
  /**
   * 这一轮里被拒绝掉的时刻。「换一批」时一起带上：
   * 拒绝是"这条我不要"，换个位置再给同一条等于没听用户的话。
   */
  const [rejected, setRejected] = useState<string[]>([])
  /**
   * 刚被接受的那一条。5 秒内可以撤销 —— 保存 id 和原始草稿，
   * 撤销成功后把草稿放回列表，用户能重新决定。
   */
  const [undo, setUndo] = useState<{ id: number; draft: ActivityDraft } | null>(null)
  const [undoLeft, setUndoLeft] = useState(0)

  const load = useCallback(
    async (exclude: string[] = []): Promise<boolean> => {
      // 只有走到这里才算"用户要求生成"：面板打开本身不算
      setStarted(true)
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

  // 条件变了（换日期 / 换引擎 / 改给模型的偏好文本），屏幕上这批草稿就是按旧条件算的。
  // 以前这里会自动重算；现在改成**退回"未生成"状态**，让用户自己决定要不要重新生成 ——
  // 不然只是切一下引擎就会悄悄烧掉一次模型调用。
  //
  // settingsKey 也在依赖里：偏好/时长改过之后，这批候选是按旧规则算的。
  // 留着它是错的（"我刚加了喝咖啡，怎么还是只有走动"），所以一起退回未生成。
  useEffect(() => {
    setStarted(false)
    setDrafts([])
    setExplanation('')
    setEngineError('')
    setNotice('')
    setRejected([])
    setUndo(null)
  }, [day, engine, note, settingsKey])

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

  /** 在这一行改钟点。改完立刻按时间重排，列表顺序始终和时刻一致。 */
  function handleTimeChange(index: number, clock: string) {
    if (!clock) return
    setDrafts((prev) =>
      prev
        .map((item, position) =>
          position === index ? { ...item, scheduled_at: withTime(item.scheduled_at, clock) } : item,
        )
        .sort(byTime),
    )
    setNotice('')
  }

  /** 同意 = 存成待执行，之后它就出现在下面的安排列表里，可以在那里改时间/标完成。 */
  async function handleAccept(index: number) {
    const draft = drafts[index]
    if (!draft || busy !== null) return
    setBusy(index)
    setEngineError('')
    try {
      const result = await confirmActivitySuggestions([{ ...draft, decision: 'later' }])
      // 保存后的那条在返回列表里：按时刻找，比按 title 找可靠
      const saved = result.activities.find((item) => item.scheduled_at === draft.scheduled_at)
      setDrafts((prev) => prev.filter((_, position) => position !== index))
      if (saved) setUndo({ id: saved.id, draft })
      setNotice('已接受，这条已写进下面的安排。点错了可以 5 秒内撤销。')
      onSaved()
    } catch (err) {
      // 改过时间之后，后端可能按规则拒掉（免打扰、间隔不足、撞上别的安排）
      fail(err, '保存失败')
    } finally {
      setBusy(null)
    }
  }

  /**
   * 拒绝 = 这条不要，**不写库**。
   *
   * 以前这里会存一条 status=skipped 的记录，于是"我拒绝的"和"我安排好的"
   * 挤在同一个列表里，用户分不清哪个是日程。现在拒绝只影响这一批候选。
   */
  function handleReject(index: number) {
    const draft = drafts[index]
    if (!draft || busy !== null) return
    setDrafts((prev) => prev.filter((_, position) => position !== index))
    // 只留最近 16 个：这个列表只用来喂"换一批"的 exclude（后端上限 24），
    // 无限增长既没用，还会在长会话里慢慢撑大请求体
    setRejected((prev) => [...prev, draft.scheduled_at].slice(-16))
    setEngineError('')
    setNotice(`已拒绝 ${hhmm(draft.scheduled_at)} 这条，它不会写进下面的安排。`)
  }

  async function handleUndo() {
    if (!undo) return
    const target = undo
    setUndo(null)
    setBusy(-1)
    try {
      await undoActivity(target.id)
      // 放回列表并重新排序：草稿回到用户手上，可以重新决定
      setDrafts((prev) => [...prev, target.draft].sort(byTime))
      setNotice('已撤销，这条又回到建议列表里了。')
      onSaved()
    } catch (err) {
      fail(err, '撤销失败')
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
      // 把当前这批和被拒绝过的时刻全部否决掉再排一次。后端会把这些时刻
      // 从可用空间里挖掉，所以换出来的位置一定是新的 —— 否则这个按钮就是摆设。
      //
      // 上限 24 是后端 exclude 字段的 max_length：当前这批最多 8 条，
      // 所以拒绝记录只带最近 16 个 —— 优先保证"这一批"一定被排除掉。
      const exclude = [
        ...drafts.map((item) => item.scheduled_at),
        ...rejected.slice(-16),
      ]
      const ok = await load(exclude)
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
      // 全部同意 = 全部存成待执行。要不要标完成，去下面的安排列表里点
      const result = await confirmActivitySuggestions(
        drafts.map((draft) => ({ ...draft, decision: 'later' as const })),
      )
      setDrafts([])
      setUndo(null)
      setNotice(`已接受 ${result.saved} 条，都在下面的安排里，可以逐条改时间或标完成。`)
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
            {!started
              ? '还没生成。点下面的「生成建议」，按当前设置算几条候选给你看。'
              : loading
                ? '正在算…'
                : explanation || '按你的可活动时段算出来的候选。点「同意」才会写进下面的安排。'}
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
          <span className="undo-bar__text">
            「{hhmm(undo.draft.scheduled_at)} {undo.draft.title}」已接受
          </span>
          <button className="undo-bar__button" type="button" onClick={() => void handleUndo()}>
            撤销（{undoLeft} 秒）
          </button>
        </div>
      )}

      {notice && <p className="banner banner--info">{notice}</p>}

      {/* 未生成：只显示一个按钮。打开面板不等于要生成 ——
          选 DeepSeek 时那是一次真金白银的调用，选规则也会算出一批用户可能根本不想要的东西。 */}
      {!started && (
        <div className="suggestions__idle">
          <button
            className="button button--primary"
            type="button"
            disabled={disabled}
            onClick={() => void load()}
          >
            生成建议
          </button>
          <span className="hint hint--small">
            用{engine === 'llm' ? ' DeepSeek ' : '本地规则'}算，生成后逐条点「同意 / 拒绝」。
            同意才会写进下面的安排，拒绝不写库。
          </span>
        </div>
      )}

      {started && loading && <p className="hint state-line">正在生成建议…</p>}

      {started && !loading && drafts.length === 0 && (
        <div className="suggestions__idle">
          <button
            className="button"
            type="button"
            disabled={disabled}
            onClick={() => void load()}
          >
            再生成一批
          </button>
          <span className="hint hint--small">这批处理完了。再点一次会按当前设置重新算。</span>
        </div>
      )}

      {started && !loading && drafts.length > 0 && (
        <ul className="suggestion-list">
          {drafts.map((draft, index) => (
            <li className="suggestion" key={`${draft.scheduled_at}-${draft.activity_type}`}>
              <div className="suggestion__time">
                <input
                  className="suggestion__time-input"
                  type="time"
                  value={hhmm(draft.scheduled_at)}
                  disabled={disabled}
                  aria-label={`${draft.title} 的时间`}
                  title="只改钟点，日期还是这一天"
                  onChange={(event) => handleTimeChange(index, event.target.value)}
                />
              </div>
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
                  onClick={() => void handleAccept(index)}
                  title="同意就写进下面的安排，之后可以在那里改时间、标完成"
                >
                  {busy === index ? '保存中…' : '同意'}
                </button>
                <button
                  className="button button--ghost button--small"
                  type="button"
                  disabled={disabled}
                  onClick={() => handleReject(index)}
                  title="不要这条，不写进安排"
                >
                  拒绝
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
            全部同意（写进下面的安排）
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
