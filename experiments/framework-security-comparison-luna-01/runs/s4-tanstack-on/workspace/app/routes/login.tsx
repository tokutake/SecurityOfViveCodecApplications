import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { getSession } from '../lib/session'

const checkAuth = createServerFn({ method: 'GET' }).handler(() => {
  const s = getSession()
  return { loggedIn: Boolean(s.userId) }
})

export const Route = createFileRoute('/login')({
  loader: async () => {
    const { loggedIn } = await checkAuth()
    if (loggedIn) throw redirect({ href: '/' })
    return {}
  },
  component: LoginPage,
})

function LoginPage() {
  return (
    <div className="container" style={{ maxWidth: 420, paddingTop: '4rem', textAlign: 'center' }}>
      <h1 style={{ fontSize: '1.5rem', fontWeight: 700, marginBottom: '0.5rem' }}>Micro SNS</h1>
      <p style={{ color: '#6b7280', marginBottom: '2rem', fontSize: '0.95rem' }}>
        ログインして投稿・グループメッセージを利用できます
      </p>
      <a href="/api/auth/login" className="btn btn-primary" style={{ fontSize: '1rem', padding: '0.6rem 1.5rem' }}>
        OIDCでログイン
      </a>
    </div>
  )
}
