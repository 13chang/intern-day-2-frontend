import { useCallback, useEffect, useRef, useState } from 'react'
import { ApiError, fetchDailySummary, runDailySummary } from '../api'
import SummaryCard from '../components/SummaryCard'
import TopBar from '../components/TopBar'
import type { DailySummary, Tab, User } from '../types'

const WEEKDAYS = ['日', '一', '二', '三', '四', '五', '六']

/**
 * 轮询间隔。任务书要求 3 秒：模型通常 1-2 秒返回，3 秒够粗又不会让页面看起来卡住。
 *
 * 上限 40 次（约 2 分钟）不是拍脑袋：后端判"这次生成已经死了"的宽限期是
 * job_timeout × max_tries + retry_defer × max_tries = 120×3 + 20×3 = 420 秒，
 * 但那是留给重试的。这里只保证页面不会无限自转 —— 真卡住了，用户点「重试」
 * 后端会自己判断该重新入队还是该继续等。
 */
const POLL_INTERVAL_MS = 3000
const MAX_POLL_TICKS = 40

/** 手动补跑窗口，对应后端 routers/summary.py 的 MAX_BACKFILL_DAYS。
 *  前端只用它来禁用「前一天」，越界时后端仍会返回 422 兜底。 */
const BACKFILL_DAYS = 7

/** 本地时区的今天，YYYY-MM-DD。不用 toISOString：那是 UTC，东八区早上 8 点前会差一天。 */
function localIso(): string {
  const now = new Date()
  const month = String(now.getMonth() + 1).padStart(2, '0')
  const day = String(now.getDate()).padStart(2, '0')
  return `${now.getFullYear()}-${month}-${day}`
}

/** 按本地日期前后挪 n 天，跨月跨年交给 Date 自己处理。 */
function shiftIso(iso: string, days: number): string {
  const base = new Date(`${iso}T00:00:00`)
  base.setDate(base.getDate() + days)
  const month = String(base.getMonth() + 1).padStart(2, '0')
  const day = String(base.getDate()).padStart(2, '0')
  return `${base.getFullYear()}-${month}-${day}`
}

/**
 * 日报的日期说成人话。
 *
 * 这里只有"过去"这一侧：日报是事后回顾，所以是昨天/前天，而不是今天/明天。
 * 再往前的日子写"3 天前"不如直接给月日 —— 用户对具体日期更有感觉。
 */
function dayName(iso: string, today: string): string {
  const weekday = `周${WEEKDAYS[new Date(`${iso}T00:00:00`).getDay()]}`
  const span = Math.round(
    (new Date(`${iso}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86_400_000,
  )
  const text = `${Number(iso.slice(5, 7))} 月 ${Number(iso.slice(8, 10))} 日（${weekday}）`
  if (span === -1) return `昨天 · ${text}`
  if (span === -2) return `前天 · ${text}`
  return text
}

type Props = {
  user: User
  onLogout: () => Promise<void>
  onExpired: () => void
  onTabChange: (tab: Tab) => void
}

export default function SummaryPage({ user, onLogout, onExpired, onTabChange }: Props) {
  const today = localIso()
  // 默认看最近一个**已经结束**的自然日：今天的日报本来就不该存在，
  // 一进来就显示"这一天还没结束"会让人以为功能坏了。
  const latest = shiftIso(today, -1)
  const earliest = shiftIso(latest, -(BACKFILL_DAYS - 1))

  const [day, setDay] = useState(latest)
  const [summary, setSummary] = useState<DailySummary | null>(null)
  const [loading, setLoading] = useState(true)
  const [running, setRunning] = useState(false)
  /**
   * 刚提交过生成任务，但任务还在队列里没被 Worker 领走 —— 这段时间
   * `GET /summary` 仍然回 missing。不记住这个状态的话，页面提交完就停在
   * "还没有总结"，用户会以为按钮没生效。
   */
  const [awaiting, setAwaiting] = useState(false)
  const [stalled, setStalled] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')

  // 轮询次数放 ref：它只在计时器回调里加减，不需要触发重新渲染。
  // 放 state 反而会让 effect 依赖自己写出来的值，绕成一圈。
  const pollTicks = useRef(0)

  const handleError = useCallback(
    (err: unknown, fallback: string) => {
      if (err instanceof ApiError && err.status === 401) {
        onExpired()
        return
      }
      setError(err instanceof Error ? err.message : fallback)
    },
    [onExpired],
  )

  /**
   * 拉一次日报。
   *
   * `silent` 用于轮询：不要切 loading，否则页面每 3 秒闪一次"正在加载"，
   * 正文会跟着卸载再挂载，读长句子时会跳。只有换日期和首次进入才显示加载态。
   */
  const load = useCallback(
    async (options: { silent?: boolean } = {}) => {
      const silent = options.silent === true
      if (!silent) setLoading(true)
      try {
        const data = await fetchDailySummary(day)
        setSummary(data)
        setError('')
        // ready 一定是这次的新结果。failed 要分开看：
        // 刚点完「重试」那次查询（pollTicks 还是 0）读到的很可能还是上一轮的 failed，
        // 据此收工的话，页面会一直停在"生成失败"，用户以为重试没生效。
        // 等轮询过一轮（pollTicks > 0）再遇到 failed，才算这次真的又失败了。
        const settled =
          data.status === 'ready' || (data.status === 'failed' && pollTicks.current > 0)
        if (settled) {
          setAwaiting(false)
          pollTicks.current = 0
          setStalled(false)
          // 结果已经落地，"已提交 / 正在生成"这类过渡提示就过期了，
          // 留着会和正文里的"生成失败"或日报内容并列，读起来互相打架
          setNotice('')
        }
      } catch (err) {
        handleError(err, '加载日报失败')
      } finally {
        if (!silent) setLoading(false)
      }
    },
    [day, handleError],
  )

  useEffect(() => {
    void load()
  }, [load])

  const status = summary?.status ?? 'missing'
  /**
   * 提交过任务、结果还没落地 —— 这段时间里 missing / failed 也要继续轮询。
   *
   * 只看 `status === 'generating'` 是不够的：任务刚入队时 Worker 还没领取，
   * 接口返回的还是 missing（首次生成）或 failed（点重试之后），页面会停在原地不动。
   * ready 是终态，一旦拿到就没必要再盯。
   */
  const shouldPoll =
    status === 'generating' ||
    status === 'pending' ||
    (awaiting && status !== 'ready')

  // 轮询：靠 summary 这个依赖把自己接下去。
  // 如果只依赖 status 字符串，generating → generating 不算变化，effect 不会重跑，
  // 计时器就只排一次 —— 现象是"只在提交后刷新了一次，之后再也不动"。
  useEffect(() => {
    if (!shouldPoll) {
      pollTicks.current = 0
      return
    }
    if (pollTicks.current >= MAX_POLL_TICKS) {
      setStalled(true)
      return
    }
    const timer = setTimeout(() => {
      pollTicks.current += 1
      void load({ silent: true })
    }, POLL_INTERVAL_MS)
    return () => clearTimeout(timer)
  }, [shouldPoll, summary, load])

  function handleShift(delta: number) {
    const next = shiftIso(day, delta)
    if (next > latest || next < earliest) return
    setDay(next)
    // 上一天的内容和提示留在屏幕上会张冠李戴
    setSummary(null)
    setNotice('')
    setError('')
    setAwaiting(false)
    setStalled(false)
    pollTicks.current = 0
  }

  async function handleRun() {
    if (running) return
    setRunning(true)
    setError('')
    setNotice('')
    try {
      const result = await runDailySummary(day)
      if (result.status === 'ready') {
        setNotice('这一天已经有日报了，不用再生成。')
      } else {
        if (result.status === 'deduplicated') {
          setNotice(result.message || '刚提交过一次，请等任务执行完再刷新。')
        } else if (result.status === 'generating') {
          // 后端在宽限期内认为任务还活着：这里不要假装重新提交了
          setNotice(result.message || '正在生成，稍等一会儿再刷新。')
        }
        // queued 不额外弹提示：正文的状态行已经写着"任务已提交，正在等待后台处理…"，
        // 再来一条横幅就是同一句话说两遍。
        // deduplicated 也置位：这说明任务已经在队列里，页面同样该盯着它。
        setAwaiting(true)
      }
      setStalled(false)
      pollTicks.current = 0
      // 立刻再查一次：任务可能已经被领走，状态就能从 missing/failed 变成 generating
      await load({ silent: true })
    } catch (err) {
      // 503（Redis 挂了）、422（日期越界）、401（登录失效）都在这里显示后端的中文
      handleError(err, '提交生成任务失败')
    } finally {
      setRunning(false)
    }
  }

  const atEarliest = day <= earliest
  const atLatest = day >= latest
  const missing = status === 'missing'

  // 按钮文案跟着当前状态走，一个按钮把"生成 / 重试 / 等它跑完"三种语义说清
  let runLabel = '立即生成'
  if (running) runLabel = '提交中…'
  else if (status === 'ready') runLabel = '已生成'
  else if (awaiting) runLabel = '等待中…'
  else if (status === 'generating' || status === 'pending') runLabel = '生成中…'
  else if (status === 'failed') runLabel = '重试'

  // 这些状态下按钮只是"状态指示"，没有可执行的动作，用浅色样式。
  // awaiting 也算：刚提交完那几秒再点一次，后端会用分钟级的任务标识挡回来，
  // 与其让用户点一个注定被去重的按钮，不如直接锁住。
  const runQuiet =
    status === 'ready' || status === 'generating' || status === 'pending' || awaiting

  const runDisabled = running || runQuiet

  return (
    <main className="screen screen--wide screen--stack">
      <TopBar user={user} tab="summary" onTabChange={onTabChange} onLogout={onLogout} />

      <div className="panel summary-panel">
        <header className="panel__header">
          <div>
            <h1 className="panel__title">每日总结</h1>
            <p className="hint">{dayName(day, today)}</p>
          </div>

          <div className="summary-nav">
            <button
              className="button button--ghost"
              type="button"
              onClick={() => handleShift(-1)}
              disabled={atEarliest || loading}
              title={atEarliest ? `最多回看 ${BACKFILL_DAYS} 天` : '看前一天'}
            >
              前一天
            </button>
            <button
              className="button button--ghost"
              type="button"
              onClick={() => handleShift(1)}
              disabled={atLatest || loading}
              title={atLatest ? '只能为已经结束的自然日生成日报' : '看后一天'}
            >
              后一天
            </button>
            {/* 不可用时换成 ghost 样式：primary 蓝底即使 disabled 也像可点，
                用户会反复去戳一个永远不会响应的按钮 */}
            <button
              className={runQuiet ? 'button button--ghost' : 'button button--primary'}
              type="button"
              onClick={() => void handleRun()}
              disabled={runDisabled}
              title={
                status === 'ready'
                  ? '已有日报，不需要再生成'
                  : `为 ${day} 生成日报（只入队，不等待）`
              }
            >
              {runLabel}
            </button>
          </div>
        </header>

        {error && (
          <p className="banner banner--error" role="alert">
            {error}
          </p>
        )}

        {notice && <p className="banner banner--info">{notice}</p>}

        {loading ? (
          <p className="hint state-line">正在加载日报…</p>
        ) : missing ? (
          // 没生成不是错误：后端故意返回 200 + missing，让页面能把
          // "这一天还没生成"和"请求挂了"分开显示。
          <p className="hint state-line" aria-live="polite">
            {awaiting
              ? '任务已提交，正在等待后台处理…'
              : '这一天还没有总结。点右上角「立即生成」，会按当天已保存的活动记录统计。'}
          </p>
        ) : status === 'generating' || status === 'pending' ? (
          <p className="hint state-line" aria-live="polite">
            {stalled
              ? '这次生成比预期久。可以稍后刷新页面，或点「重试」让后端重新判断。'
              : '正在生成…（每 3 秒自动刷新）'}
          </p>
        ) : status === 'failed' ? (
          awaiting ? (
            // 刚点过重试：库里那条 failed 是上一轮留下的，这一刻还展示失败原因，
            // 看起来就像"重试没生效"。等 Worker 把状态改成 generating 再切回去。
            <p className="hint state-line" aria-live="polite">
              已重新提交，正在等待后台结果…
            </p>
          ) : (
            <div className="summary-failed" role="status">
              <p className="banner banner--warn">
                生成失败：{summary?.error_message || '原因未记录'}。
              </p>
              <p className="hint">
                后台已经按策略试过若干次。点右上角「重试」可以重新提交一次；如果一直失败，
                多半是模型配置或网络的问题，不是当天的数据有问题。
              </p>
            </div>
          )
        ) : summary ? (
          <SummaryCard summary={summary} />
        ) : null}
      </div>
    </main>
  )
}
