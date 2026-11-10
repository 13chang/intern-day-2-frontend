// 老内核兜底。必须在任何业务代码之前执行，所以从 main.tsx 第一行 import。
//
// 背景：Android 的 WebView 版本跟着系统或应用商店走，不由 App 决定。
// API 29（Android 10）出厂镜像里是 Chrome 74，只到 ES2019；
// 而 Vite 的 build.target 只降级「语法」，不补「API」——
// 语法能转译，但 Array.prototype.at、crypto.randomUUID 这类新方法转不出来。
//
// 这里补的 6 个是 CopilotKit / AG-UI 实际会调到的：
// 生成 messageId 和 runId、深拷贝会话状态、按索引取消息、判断字段是否存在、
// 拼接文本、并发等多个工具请求。少任何一个，表现都不是报错，而是
// 「点发送没反应」：没有网络请求、控制台没有异常、按钮也不是禁用态，
// 单看日志完全定位不到，所以在 API 29 上排查了很久。
//
// 新内核里每一项都因为条件不成立而跳过，不会覆盖原生实现。
/* eslint-disable @typescript-eslint/no-explicit-any */

type CryptoWithUUID = Crypto & { randomUUID?: () => string }

const cryptoApi = globalThis.crypto as CryptoWithUUID | undefined

if (cryptoApi && typeof cryptoApi.randomUUID !== 'function') {
  // DOM 的类型定义把返回值写成 `${string}-${string}-...` 的模板字面量，
  // 而拼接出来的是普通 string，这里断言一下省得为它绕路。
  type UUID = `${string}-${string}-${string}-${string}-${string}`
  cryptoApi.randomUUID = function randomUUID(): UUID {
    // 按 RFC 4122 第 4 版格式拼装；随机源仍然用浏览器的 CSPRNG，
    // 不要换成 Math.random，messageId 撞车会让会话串台。
    const bytes = new Uint8Array(16)
    cryptoApi.getRandomValues(bytes)
    bytes[6] = (bytes[6] & 0x0f) | 0x40
    bytes[8] = (bytes[8] & 0x3f) | 0x80
    const hex = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}` as UUID
  }
}

if (typeof (globalThis as any).structuredClone !== 'function') {
  // 只覆盖 JSON 能表达的数据。会话状态本来就是要发给后端的纯 JSON，
  // 不会带 Date / Map / 函数，也不存在循环引用，所以够用；
  // 真遇到这类值需要换成带类型表的手写实现。
  ;(globalThis as any).structuredClone = (value: unknown) =>
    value === undefined ? undefined : JSON.parse(JSON.stringify(value))
}

if (typeof (Array.prototype as any).at !== 'function') {
  Object.defineProperty(Array.prototype, 'at', {
    value: function at(this: unknown[], index: number) {
      const length = this.length
      let k = Math.trunc(index) || 0
      if (k < 0) k += length
      return k < 0 || k >= length ? undefined : this[k]
    },
    writable: true,
    configurable: true,
  })
}

if (typeof (Object as any).hasOwn !== 'function') {
  Object.defineProperty(Object, 'hasOwn', {
    value: (target: object, prop: PropertyKey) => Object.prototype.hasOwnProperty.call(target, prop),
    writable: true,
    configurable: true,
  })
}

if (typeof (String.prototype as any).replaceAll !== 'function') {
  Object.defineProperty(String.prototype, 'replaceAll', {
    value: function replaceAll(this: string, search: string | RegExp, replacement: string) {
      if (search instanceof RegExp) {
        // 原生实现也是这个约束：正则不带 g 会直接抛错，而不是悄悄只替换第一个
        if (!search.global) throw new TypeError('replaceAll 需要带 g 标志的正则表达式')
        return this.replace(search, replacement)
      }
      return this.split(String(search)).join(String(replacement))
    },
    writable: true,
    configurable: true,
  })
}

if (typeof (Promise as any).allSettled !== 'function') {
  Object.defineProperty(Promise, 'allSettled', {
    value: <T>(items: Iterable<T | Promise<T>>) =>
      Promise.all(
        Array.from(items, (item) =>
          Promise.resolve(item).then(
            (value) => ({ status: 'fulfilled' as const, value }),
            (reason) => ({ status: 'rejected' as const, reason }),
          ),
        ),
      ),
    writable: true,
    configurable: true,
  })
}
