/**
 * 把 CopilotKit 抛上来的原始错误翻译成「用户能看懂、且不泄露内部信息」的提示。
 *
 * 为什么要单独一层：
 * SDK 的 error.message 里经常带内部细节（上游地址、端口、堆栈片段、HTTP 状态文本）。
 * 直接贴到界面上，一方面是用户看不懂，另一方面这些信息不该出现在截图和演示里。
 *
 * 所以这里只做两件事：判断**类别**，给出对应的**可读文案**和**能否重试**。
 * 原始错误仍然会打到 console，排查时看得到，但不会进 UI。
 */

export type ChatErrorKind = 'auth' | 'timeout' | 'network' | 'upstream' | 'unknown'

export type ChatError = {
  kind: ChatErrorKind
  title: string
  detail: string
  /** 是否值得让用户点一次重试。登录失效不给重试，直接回登录页。 */
  retryable: boolean
}

const TIMEOUT_SECONDS = 20

/**
 * 判断错误类别。
 *
 * 匹配顺序有讲究：先判鉴权（决定要不要跳登录页），再判超时（最容易和网络错误混淆），
 * 最后才是通用兜底。顺序颠倒的话，超时错误里带的 "fetch failed" 会被误判成网络不通。
 */
export function classifyChatError(input: {
  error: Error
  code?: string
  context?: Record<string, unknown>
}): ChatError {
  const code = (input.code ?? '').toUpperCase()
  const raw = `${code} ${input.error?.message ?? ''}`.toLowerCase()

  if (raw.includes('401') || raw.includes('unauthor') || raw.includes('登录')) {
    return {
      kind: 'auth',
      title: '登录状态已失效',
      detail: '请重新登录后再继续对话。',
      retryable: false,
    }
  }

  if (raw.includes('upstream_timeout') || raw.includes('timeout') || raw.includes('超时')) {
    return {
      kind: 'timeout',
      title: '助手响应超时',
      detail: `后端超过 ${TIMEOUT_SECONDS} 秒没有返回任何内容，本次运行已结束。可以重试一次；若持续超时，请确认后端服务在运行。`,
      retryable: true,
    }
  }

  if (
    raw.includes('fetch failed') ||
    raw.includes('econnrefused') ||
    raw.includes('enotfound') ||
    raw.includes('network') ||
    raw.includes('socket')
  ) {
    return {
      kind: 'network',
      title: '连不上助手服务',
      detail: '浏览器没有建立到 Runtime 的连接。请确认 4000 端口的服务在运行，或稍后重试。',
      retryable: true,
    }
  }

  if (/\b5\d\d\b/.test(raw) || raw.includes('internal server error') || raw.includes('run_error')) {
    return {
      kind: 'upstream',
      title: '助手服务返回了错误',
      detail: '后端这次运行失败了。可以重试一次；若重复出现，请查看后端日志。',
      retryable: true,
    }
  }

  return {
    kind: 'unknown',
    title: '对话没能完成',
    detail: '这次运行中断了。可以重试一次，或新建对话重新提问。',
    retryable: true,
  }
}

/** 给 console 用的技术摘要。只进控制台，不进界面。 */
export function describeForConsole(input: {
  error: Error
  code?: string
}): string {
  return `[chat] code=${input.code ?? '-'} message=${input.error?.message ?? '-'}`
}
