import { summarize } from './toolTrail'
import type { ToolCallRecord } from './toolTrail'

/**
 * 「已查询：今天的安排（2 条）」这样一行（R4-1）。
 *
 * 位置放在会话区顶部而不是气泡里：同一次运行可能查好几个工具，
 * 塞进气泡会跟着回答一起滚动，用户想回头确认"到底查没查"时已经看不见了。
 *
 * 用 aria-live=polite 是给它一个明确语义：这是一条状态播报，
 * 会随运行变化，但不需要打断读屏（不要用 assertive 抢焦点）。
 */
export default function QueryTrail({ calls }: { calls: ToolCallRecord[] }) {
  if (calls.length === 0) return null

  return (
    <div className="trail" role="status" aria-live="polite">
      <span className="trail__lead">已查询</span>
      <ul className="trail__list">
        {calls.map((call) => (
          <li
            key={call.id}
            className={`trail__item trail__item--${call.running ? 'running' : call.state}`}
          >
            {summarize(call)}
          </li>
        ))}
      </ul>
    </div>
  )
}
