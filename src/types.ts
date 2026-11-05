export type User = {
  id: number
  username: string
  display_name: string
}

export type LoginResponse = {
  token: string
  token_type: string
  expires_in: number
  user: User
}

export type TodoItem = {
  id: number
  title: string
  done: boolean
  created_at: number
}

// 后端 GET /agent/info 的返回，用来在页面上如实标注当前是 Mock 还是真实模型
export type AgentInfo = {
  agent: string
  mode: 'mock' | 'openai'
  model: string | null
  tools: string[]
  reason: string
}
