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
