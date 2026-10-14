import { auth } from "@/auth"
import db from "@/lib/db"
import { redirect } from "next/navigation"
import { Header } from "@/components/Header"
import { PostForm } from "@/components/PostForm"
import { PostItem } from "@/components/PostItem"

interface Post {
  id: number
  content: string
  is_private: number
  created_at: string
  display_name: string
  user_id: string
}

export default async function TimelinePage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const posts = db
    .prepare(
      `SELECT p.id, p.content, p.is_private, p.created_at, p.user_id, u.display_name
       FROM posts p
       JOIN users u ON p.user_id = u.id
       WHERE p.is_private = 0
       ORDER BY p.created_at DESC
       LIMIT 100`
    )
    .all() as Post[]

  return (
    <>
      <Header user={session.user} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-4">
        <PostForm showPrivateToggle={false} isPrivate={false} />
        {posts.length === 0 ? (
          <p className="text-center text-sm text-gray-400 py-10">
            まだ投稿がありません
          </p>
        ) : (
          <div className="space-y-3">
            {posts.map(post => (
              <PostItem key={post.id} post={post} />
            ))}
          </div>
        )}
      </main>
    </>
  )
}
