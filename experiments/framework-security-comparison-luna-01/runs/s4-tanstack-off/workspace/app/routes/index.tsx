import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { getSession } from '../server/session'
import { getPublicPosts, getTimelinePosts, createPost, type Post } from '../server/db'

const getTimeline = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  let posts: Post[]
  if (session) {
    posts = getTimelinePosts(session.userId)
  } else {
    posts = getPublicPosts()
  }
  return { posts, currentUserId: session?.userId ?? null }
})

const submitPost = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as { content: string; isPrivate: boolean })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Not authenticated')
    createPost(session.userId, data.content, data.isPrivate)
    return { ok: true }
  })

export const Route = createFileRoute('/')({
  loader: async () => getTimeline(),
  component: TimelinePage,
})

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'Z')
    return d.toLocaleString()
  } catch {
    return dateStr
  }
}

function TimelinePage() {
  const { posts, currentUserId } = Route.useLoaderData()
  const router = useRouter()
  const { user } = Route.useRouteContext()

  const [content, setContent] = useState('')
  const [isPrivate, setIsPrivate] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!content.trim()) return
    setSubmitting(true)
    setError('')
    try {
      await submitPost({ data: { content: content.trim(), isPrivate } })
      setContent('')
      setIsPrivate(false)
      router.invalidate()
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to post')
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">Timeline</h1>

      {user ? (
        <div className="card">
          <h3>New Post</h3>
          {error && <div className="alert alert-error">{error}</div>}
          <form onSubmit={handleSubmit}>
            <div className="form-group">
              <textarea
                value={content}
                onChange={(e) => setContent(e.target.value)}
                placeholder="What's on your mind?"
                rows={3}
                maxLength={500}
              />
            </div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '0.5rem' }}>
              <label className="checkbox-row" style={{ marginBottom: 0 }}>
                <input
                  type="checkbox"
                  checked={isPrivate}
                  onChange={(e) => setIsPrivate(e.target.checked)}
                />
                <span>Private post (only visible to you)</span>
              </label>
              <button type="submit" className="btn btn-primary" disabled={submitting || !content.trim()}>
                {submitting ? 'Posting...' : 'Post'}
              </button>
            </div>
          </form>
        </div>
      ) : (
        <div className="card">
          <div className="alert alert-info">
            <a href="/api/auth/login">Log in</a> to post to the timeline.
          </div>
        </div>
      )}

      {posts.length === 0 ? (
        <div className="empty-state">No posts yet. Be the first to post!</div>
      ) : (
        posts.map((post) => (
          <div key={post.id} className="card">
            <div className="post-meta">
              <span className="author">{post.display_name}</span>
              <span>{formatDate(post.created_at)}</span>
              {post.is_private === 1 && (
                <span className="badge badge-private">private</span>
              )}
            </div>
            <div className="post-content">{post.content}</div>
          </div>
        ))
      )}
    </div>
  )
}
