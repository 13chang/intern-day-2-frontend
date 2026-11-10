import type { ActivitySettings, CustomActivityType } from './types'

/**
 * 内置四类活动。和 backend `rules.ACTIVITY_CATALOG` 一一对应。
 *
 * 这只是"出厂设置"，不是全部可选类型：用户可以在设置页里自己加，
 * 加出来的那些由 `settings.custom_types` 提供（见下面的 `typeOptions`）。
 */
export const BUILTIN_TYPES: { value: string; label: string }[] = [
  { value: 'walk', label: '走动' },
  { value: 'water', label: '喝水' },
  { value: 'stretch', label: '拉伸' },
  { value: 'stand', label: '站立' },
]

/** 和后端 `rules.MAX_CUSTOM_TYPES` / `MAX_TYPE_TITLE` / `MAX_TYPE_DESCRIPTION` 一致 */
export const MAX_CUSTOM_TYPES = 12
export const MAX_TYPE_TITLE = 20
export const MAX_TYPE_DESCRIPTION = 60

/** 设置里带了自定义活动就取出来，否则空数组。 */
function customTypes(settings: ActivitySettings | null | undefined): CustomActivityType[] {
  // `?? []` 不是防御性冗余：老版本后端的响应里没有这个字段，
  // 少了它下面每个 `.map` 都会抛 TypeError，整页白屏
  return settings?.custom_types ?? []
}

/**
 * 当前可选的类型：内置四类 + 自定义。
 *
 * `custom` 标记让界面能把两者分开画 —— 自定义的可以删、可以显示说明，
 * 内置的删不掉（它们在后端是常量，删了下次会原样回来）。
 */
export function typeOptions(
  settings: ActivitySettings | null | undefined,
): { value: string; label: string; custom: boolean }[] {
  return [
    ...BUILTIN_TYPES.map((item) => ({ ...item, custom: false })),
    ...customTypes(settings).map((item) => ({
      value: item.key,
      label: item.title,
      custom: true,
    })),
  ]
}

/**
 * key → 中文名。给列表上的类型徽标用。
 *
 * 为什么必须带兜底：历史记录里可能留着已经删掉的自定义 key，
 * 直接 `labels[key]` 会渲出一个空白角标 —— 看起来像"类型丢了"，
 * 实际只是名字查不到。查不到时显示 key 本身，至少还能认出是同一条。
 */
export function typeLabels(settings: ActivitySettings | null | undefined): Record<string, string> {
  const labels: Record<string, string> = {}
  for (const item of typeOptions(settings)) labels[item.value] = item.label
  return labels
}

/** 取一条活动的类型名，查不到就退回 key。 */
export function typeLabel(
  settings: ActivitySettings | null | undefined,
  key: string,
): string {
  return typeLabels(settings)[key] ?? key
}

/**
 * 造下一个可用的 key：`custom_<最小未占用序号>`。
 *
 * 保留已有 key（编辑时不换 key）、跳过已被占用的序号（删了中间一条不会连带别的），
 * 这样 `preferred_types` 里那些引用不会因为"加了一个又删了一个"而指向别的活动。
 * 和后端 `service._free_custom_key` 同一套规则。
 */
export function nextCustomKey(existing: CustomActivityType[]): string {
  // 内置四类的 key 也占位：撞上 `walk` 之类的，后端会另补一个 key，
  // 于是"页面上显示的 key"和"存下的 key"不一致，勾选状态就对不上了
  const taken = new Set([
    ...BUILTIN_TYPES.map((item) => item.value),
    ...existing.map((item) => item.key),
  ])
  let index = 1
  while (taken.has(`custom_${index}`)) index += 1
  return `custom_${index}`
}
