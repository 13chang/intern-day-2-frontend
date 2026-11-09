import { Component } from 'react'
import type { ErrorInfo, ReactNode } from 'react'

type Props = { children: ReactNode }
type State = { failed: boolean }

/**
 * 助手区域的错误边界。
 *
 * CopilotKit 的 useAgent 在 Runtime 没起来、端口不对或者 agentId 对不上时会
 * 直接在渲染期 throw。没有错误边界的话 React 会卸载整棵树 —— 用户看到的是
 * 一片纯白页面，在手机上又看不到控制台，完全无从判断是网络问题还是程序崩了。
 *
 * 这里把失败限制在助手这一块：报一句能看懂的话，页面其余部分照常可用。
 * 触发条件都是环境问题，不是用户操作问题，所以不给「重试」按钮 ——
 * 让用户反复点一个注定失败的动作只会更困惑。
 */
export default class AssistantBoundary extends Component<Props, State> {
  state: State = { failed: false }

  static getDerivedStateFromError(): State {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    // 只打到控制台：logcat 与 chrome://inspect 都能看到，便于定位。
    // 不把错误文本渲染到界面上，避免把内部地址等信息暴露给用户。
    console.error('[assistant] 渲染失败：', error.message, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <section className="assistant" aria-label="任务助手">
          <p className="banner banner--warn" role="alert">
            助手暂时不可用，页面其他功能不受影响。请确认 Agent Runtime 已启动。
          </p>
        </section>
      )
    }
    return this.props.children
  }
}
