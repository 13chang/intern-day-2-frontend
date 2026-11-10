import { useCallback, useState } from 'react'
import { ApiError, fetchRunTrace } from '../api'
import type { RunTrace } from '../types'
import {
  findingLabel,
  hasSignal,
  intentLabel,
  signalLabel,
  spanDetail,
  spanRows,
  uniqueSignals,
  VERDICT_LABELS,
} from './trace'

/**
 * 「链路」面板（R5-4）：点开看这一次运行走了哪几步、每步多久、有没有安全标记、规则分多少。
 *
 * 为什么不挂在气泡里：CopilotChat 没有暴露气泡插槽（v1.84.1），
 * 要挂进气泡就得整个重写消息列表 —— 那会把这个版本已经验证过的流式增量、
 * 工具调用展示一起推翻。所以放在会话区顶部、紧跟「已查询」那一行：
 * 位置固定在回答上方，滚动时不会跟着气泡跑掉，点开就地展开。
 *
 * 折叠而不是常驻：链路是"想核对时才看"的信息，常驻会把对话挤下去。
 * 但**有没有分数**要在折叠状态下也露出来 —— 用户不点开也该知道这次回答靠不靠谱。
 */
export default function TracePanel({ runId }: { runId: string | null }) {
  const [open, setOpen] = useState(false)
  const [trace, setTrace] = useState<RunTrace | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  // 换一轮对话要收起并清空，否则上一轮的链路会挂在这一轮的回答下面、看着像它的。
  // 这件事交给调用方用 key={runId} 重挂载来做，不用 useEffect 里 setState：
  // 那会多触发一次渲染，而且"该不该清"的判断和状态生命周期本来就该由 key 表达。

  const load = useCallback(async () => {
    if (!runId) return
    setLoading(true)
    setError(null)
    try {
      setTrace(await fetchRunTrace(runId))
    } catch (caught) {
      // 两种 404 都要说清楚，但说的话不一样：
      // 面板没开是配置问题，还没采到只是慢了几百毫秒。
      if (caught instanceof ApiError && caught.status === 404) {
        setError('链路还没采到（导出是异步的，稍等一下再取）')
      } else {
        setError('链路取不到，稍后重试')
      }
    } finally {
      setLoading(false)
    }
  }, [runId])

  const toggle = useCallback(() => {
    const next = !open
    setOpen(next)
    if (next && trace === null) void load()
  }, [open, trace, load])

  // 没有 runId 就不显示：拿不到 runId 说明这一轮没跑起来（发送前、或事件流没建立）
  if (!runId) return null

  const evaluation = trace?.evaluation ?? null
  const verdictClass = evaluation ? `trace__score--${evaluation.verdict}` : ''

  return (
    <div className="trace">
      <button
        className="trace__toggle"
        type="button"
        onClick={toggle}
        aria-expanded={open}
        aria-controls="trace-panel"
      >
        <span className="trace__caret" aria-hidden="true">
          {open ? '▾' : '▸'}
        </span>
        链路
        {evaluation && (
          <span className={`trace__score ${verdictClass}`}>
            {evaluation.score} 分 · {VERDICT_LABELS[evaluation.verdict] ?? evaluation.verdict}
          </span>
        )}
      </button>

      {open && (
        <div className="trace__panel" id="trace-panel" role="region" aria-label="本次运行的链路">
          {loading && <p className="trace__hint">正在取链路…</p>}

          {error && (
            <p className="trace__hint trace__hint--warn">
              {error}
              <button className="trace__retry" type="button" onClick={() => void load()}>
                重新获取
              </button>
            </p>
          )}

          {trace && (
            <>
              <p className="trace__summary">
                共 {trace.span_count} 步 · 总耗时 {trace.total_ms} ms
                {evaluation?.intent ? ` · 判定意图：${intentLabel(evaluation.intent)}` : ''}
              </p>

              <ul className="trace__rows">
                {spanRows(trace).map((row, index) => (
                  <li className="trace__row" key={`${row.span.span_id}-${index}`}>
                    <span
                      className="trace__name"
                      style={{ paddingLeft: `${row.depth * 14}px` }}
                      title={row.span.name}
                    >
                      {hasSignal(row.span) && (
                        <span className="trace__mark" title="这一步有安全判定">
                          ⚠
                        </span>
                      )}
                      {row.span.name}
                      {spanDetail(row.span) && (
                        <span className="trace__detail">{spanDetail(row.span)}</span>
                      )}
                    </span>
                    <span className="trace__bar" aria-hidden="true">
                      <span
                        className={`trace__bar-fill${row.span.status === 'ERROR' ? ' trace__bar-fill--error' : ''}`}
                        style={{ left: `${row.left}%`, width: `${row.width}%` }}
                      />
                    </span>
                    <span className="trace__ms">{row.span.duration_ms} ms</span>
                  </li>
                ))}
              </ul>

              {trace.signals.length > 0 && (
                <div className="trace__signals">
                  <span className="trace__signals-lead">安全标记</span>
                  <ul className="trace__signals-list">
                    {uniqueSignals(trace.signals).map((signal) => (
                      <li className="trace__signal" key={signal.kind}>
                        {signalLabel(signal.kind)}
                        <span className="trace__signal-at">（{signal.span} · {signal.at_ms} ms）</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation && evaluation.findings.length > 0 && (
                <div className="trace__findings">
                  <span className="trace__findings-lead">扣分项</span>
                  <ul className="trace__findings-list">
                    {evaluation.findings.map((finding) => (
                      <li className="trace__finding" key={finding.kind}>
                        {findingLabel(finding.kind)}
                        <span className="trace__finding-penalty">-{finding.penalty}</span>
                        <span className="trace__finding-detail">{finding.detail}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}

              {evaluation && evaluation.findings.length === 0 && (
                <p className="trace__ok">没有扣分项：该查的查了，没有越界，也没有安全标记。</p>
              )}
            </>
          )}
        </div>
      )}
    </div>
  )
}
