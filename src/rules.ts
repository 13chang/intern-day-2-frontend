import type { RuleCode } from './types'

/**
 * 规则码 → 「该去改哪个设置」。
 *
 * 为什么需要这张表：后端返回的中文已经说清了"15:20 落在免打扰 15:00-16:00 内"，
 * 但用户看到之后还得自己找"免打扰在哪一栏"。码是稳定的、文案是会改的，
 * 所以把"指向哪个输入框"挂在码上，而不是靠匹配中文。
 *
 * 记录类型（``Record<RuleCode, …>``）而不是普通对象：后端新增一条规则时，
 * 这里缺键会直接编译失败，而不是在页面上渲染出一行空名字。
 */
export const RULE_HINTS: Record<RuleCode, { field: string; hint: string }> = {
  PLAN_HORIZON: {
    field: '目标日期',
    hint: '只能给今天起的两周内安排，换一个更近的日期。',
  },
  WORK_WINDOW: {
    field: '工作时段',
    hint: '把工作时段放宽到这个时间之内，可活动时段也不会超出它。',
  },
  ACTIVE_WINDOW: {
    field: '可活动时段',
    hint: '这个时间不在任何可活动时段里，换时间或加一段时段。',
  },
  QUIET_HOURS: {
    field: '免打扰',
    hint: '这个时间在免打扰里，换一个时间或缩短免打扰。',
  },
  MIN_GAP: {
    field: '已有安排',
    hint: '离上一条太近，往后挪一点。',
  },
  DAILY_TARGET: {
    field: '每天次数',
    hint: '已经达到今天的次数目标；这一条只是提示，不影响保存。',
  },
}

/**
 * 把 ``ApiError.ruleCode`` 变成一句「去改哪里」。
 *
 * 未知码返回空串而不是抛错：后端先上线了新规则时，前端不该因此白屏 ——
 * 少一句补充说明，比整个按钮点不动好。
 */
export function ruleHint(code: string | null | undefined): string {
  if (!code) return ''
  const entry = RULE_HINTS[code as RuleCode]
  return entry ? `${entry.field}：${entry.hint}` : ''
}
