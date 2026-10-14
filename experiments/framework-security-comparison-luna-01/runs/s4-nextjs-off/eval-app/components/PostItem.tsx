interface Post {
  id: number
  content: string
  is_private: number
  created_at: string
  display_name: string
  user_id: string
}

interface Props {
  post: Post
}

export function PostItem({ post }: Props) {
  const date = new Date(post.created_at + "Z").toLocaleString("ja-JP", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <article className="bg-white rounded-lg border border-gray-200 p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <span className="font-medium text-sm">{post.display_name}</span>
          {post.is_private === 1 && (
            <span className="text-xs bg-yellow-100 text-yellow-700 px-2 py-0.5 rounded-full">
              非公開
            </span>
          )}
        </div>
        <time className="text-xs text-gray-400">{date}</time>
      </div>
      <p className="text-sm leading-relaxed whitespace-pre-wrap break-words">
        {post.content}
      </p>
    </article>
  )
}
