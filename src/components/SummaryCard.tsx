import type { DailySummary } from '../types'

type Props = {
  summary: DailySummary
}

/**
 * 日报正文：数字区 + 回顾 + 建议 + 来源。
 *
 * 这里**只显示数字，不做任何加减**。四个数字的口径全在后端一份
 * （尤其在"完成数可能大于计划数""未完成里含推迟替代条"这两条上），
 * 前端一旦自己算 total，就会出现页面上几个数相加对不上的情况。
 *
 * 推迟次数单独一行而不是并进四个格子：它是"操作次数"，和"活动条数"
 * 不是同一个量，摆在一起会让人下意识想把它加进总数。
 */

/** 秒级时间戳以外的情况这里不处理：后端 generated_at 是带偏移的 ISO 串。 */
function formatStamp(value: string | null): string | null {
  if (!value) return null
  // 2026-11-09T00:05:03+08:00 → 11-09 00:05
  const date = value.slice(5, 10)
  const time = value.slice(11, 16)
  return `${date} ${time}`
}

export default function SummaryCard({ summary }: Props) {
  const numbers = [
    { label: '计划', value: summary.planned_total, tone: 'plain' },
    { label: '完成', value: summary.completed, tone: 'good' },
    { label: '跳过', value: summary.skipped, tone: 'plain' },
    { label: '未完成', value: summary.unfinished, tone: 'warn' },
  ]

  // null 和 0 是两件事：0 分钟是一个确定的事实，"没记录"什么都不说明。
  // 写成 `summary.sedentary_minutes ?? 0` 就是把"不知道"说成了"零"。
  const sedentary =
    summary.sedentary_minutes === null ? '未记录' : `${summary.sedentary_minutes} 分钟`

  const sourceLabel =
    summary.source === 'llm' ? 'DeepSeek' : summary.source === 'rule' ? '本地模板' : '来源未知'
  const generatedAt = formatStamp(summary.generated_at)

  return (
    <section className="summary-card" aria-label="日报内容">
      <div className="summary-numbers">
        {numbers.map((item) => (
          <div className={`stat stat--${item.tone}`} key={item.label}>
            <span className="stat__value">{item.value}</span>
            <span className="stat__label">{item.label}</span>
          </div>
        ))}
      </div>

      <p className="summary-card__meta">
        <span>推迟操作 {summary.postpone_ops} 次</span>
        <span className="summary-card__sep" aria-hidden="true">
          ·
        </span>
        <span>久坐情况：{sedentary}</span>
      </p>

      {/* 空数据日：四个 0 看起来像加载失败，这里说清是"那天没排活动"。
          不写"没有活动记录"——那是回顾正文的原话，重复一遍就啰嗦了。 */}
      {!summary.has_records && (
        <p className="hint">四个数字是 0，因为这一天没有排过任何活动。</p>
      )}

      <div className="summary-block">
        <h3 className="summary-block__label">回顾</h3>
        <p className="summary-block__text">{summary.review || '—'}</p>
      </div>

      <div className="summary-block">
        <h3 className="summary-block__label">建议</h3>
        <p className="summary-block__text">{summary.suggestion || '—'}</p>
      </div>

      <footer className="summary-card__foot">
        <span>
          {sourceLabel}
          {summary.source === 'llm' && summary.model ? ` · ${summary.model}` : ''}
        </span>
        {generatedAt && <span>生成于 {generatedAt}</span>}
      </footer>
    </section>
  )
}
