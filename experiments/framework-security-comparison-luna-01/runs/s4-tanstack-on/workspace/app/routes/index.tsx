import { createFileRoute, redirect } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/start'
import { useRouter } from '@tanstack/react-router'
import { useState } from 'react'
import { getSession } from '../lib/session'
import db from '../lib/db'

interface Post {
  id: number
  content: string
  is_private: number
  created_at: string
  display_name: string
  user_id: string
}

const getTimeline = createServerFn({ method: 'GET' }).handler(() => {
  const session = getSession()
  const userId = session.userId ?? null

  const posts: Post[] = userId
    ? (db
        .prepare(
          `SELECT p.id, p.content, p.is_private, p.created_at, p.user_id, u.display_name
           FROM posts p JOIN users u ON p.user_id = u.id
           WHERE p.is_private = 0 OR p.user_id = ?
           ORDER BY p.created_at DESC LIMIT 50`,
        )
        .all(userId) as Post[])
    : (db
        .prepare(
          `SELECT p.id, p.content, p.is_private, p.created_at, p.user_id, u.display_name
           FROM posts p JOIN users u ON p.user_id = u.id
           WHERE p.is_private = 0
           ORDER BY p.created_at DESC LIMIT 50`,
        )
        .all() as Post[])

  return { posts, userId, displayName: session.displayName ?? null }
})

const submitPost = createServerFn({ method: 'POST' })
  .validator((data: unknown) => {
    const d = data as { content: string; isPrivate: boolean }
    if (typeof d.content !== 'string' || !d.content.trim())
      throw new Error('本文を入力してください')
    if (d.content.length > 1000) throw new Error('1000文字以内で入力してください')
    return { content: d.content.trim(), isPrivate: Boolean(d.isPrivate) }
  })
  .handler(async ({ data }) => {
    const session = getSession()
    if (!session.userId) throw redirect({ href: '/login' })
    db.prepare('INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)').run(
      session.userId,
      data.content,
      data.isPrivate ? 1 : 0,
    )
    return { ok: true }
  })

export const Route = createFileRoute('/')({
  loader: () => getTimeline(),
  component: IndexPage,
})

function IndexPage() {
  const { posts, userId } = Route.useLoaderData()
  const router = useRouter()
  const [content, setContent] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await submitPost({ data: { content, isPrivate } })
      setContent('')
      setIsPrivate(false)
      await router.invalidate()
    } catch (err) {
      setError(err instanceof Error ? err.message : '投稿に失敗しました')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">タイムライン</h1>

      {userId && (
        <form className="form-box" onSubmit={handleSubmit}>
          <textarea
            rows={3}
            placeholder="いまどうしてる？（最大1000文字）"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            maxLength={1000}
            required
          />
          <div className="form-row">
            <label className="check">
              <input
                type="checkbox"
                checked={isPrivate}
                onChange={(e) => setIsPrivate(e.target.checked)}
              />
              非公開
            </label>
            <span className="char-count">{content.length} / 1000</span>
            <button
              type="submit"
              className="btn btn-primary btn-sm"
              disabled={submitting || !content.trim()}
            >
              {submitting ? '投稿中…' : '投稿する'}
            </button>
          </div>
          {error && <p className="msg-error">{error}</p>}
        </form>
      )}

      {!userId && (
        <div className="form-box" style={{ textAlign: 'center', color: '#6b7280', padding: '1.25rem' }}>
          <a href="/api/auth/login" className="btn btn-primary btn-sm">ログインして投稿する</a>
        </div>
      )}

      {posts.length === 0 && <p className="empty">投稿がありません</p>}

      {posts.map((post) => (
        <div key={post.id} className="card">
          <div className="post-header">
            <span className="post-author">{post.display_name}</span>
            {post.is_private === 1 && (
              <span className="badge badge-private">非公開</span>
            )}
            <span className="post-time">{formatDate(post.created_at)}</span>
          </div>
          <p className="post-content">{post.content}</p>
        </div>
      ))}
    </div>
  )
}

function formatDate(isoStr: string): string {
  try {
    return new Date(isoStr + (isoStr.endsWith('Z') ? '' : 'Z')).toLocaleString('ja-JP', {
      month: 'numeric',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    })
  } catch {
    return isoStr
  }
}
