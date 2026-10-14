import { auth } from "@/auth"
import { getTimeline } from "@/lib/db"
import PostForm from "@/components/PostForm"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function TimelinePage() {
  const session = await auth()
  const viewerId = session?.user?.id ?? null
  const posts = getTimeline(viewerId)

  return (
    <>
      <div className="page-title">タイムライン</div>

      {session?.user ? (
        <PostForm />
      ) : (
        <div className="card" style={{ marginBottom: "1.25rem", color: "var(--text-muted)", textAlign: "center" }}>
          投稿するには<a href="/login"> ログイン</a>してください。
        </div>
      )}

      {posts.length === 0 ? (
        <p className="empty-state">まだ投稿がありません。</p>
      ) : (
        <div className="stack">
          {posts.map((post) => (
            <article
              key={post.id}
              className={`post-item${post.is_private ? " private" : ""}`}
            >
              <div className="post-meta">
                <span className="post-author">{post.display_name}</span>
                <span>&middot;</span>
                <time dateTime={new Date(post.created_at * 1000).toISOString()}>
                  {formatDate(post.created_at)}
                </time>
                {post.is_private === 1 && (
                  <span className="badge-private">非公開</span>
                )}
              </div>
              <p className="post-content">{post.content}</p>
            </article>
          ))}
        </div>
      )}
    </>
  )
}
