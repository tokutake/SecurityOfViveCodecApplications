interface Message {
  id: number
  content: string
  created_at: string
  display_name: string
  user_id: string
}

interface Props {
  message: Message
  currentUserId: string
}

export function MessageItem({ message, currentUserId }: Props) {
  const isMine = message.user_id === currentUserId
  const date = new Date(message.created_at + "Z").toLocaleString("ja-JP", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })

  return (
    <div className={`flex flex-col ${isMine ? "items-end" : "items-start"}`}>
      <div className="flex items-center gap-2 mb-1">
        {!isMine && (
          <span className="text-xs font-medium text-gray-700">{message.display_name}</span>
        )}
        <time className="text-xs text-gray-400">{date}</time>
        {isMine && (
          <span className="text-xs font-medium text-gray-700">あなた</span>
        )}
      </div>
      <div
        className={`max-w-xs px-3 py-2 rounded-2xl text-sm leading-relaxed break-words whitespace-pre-wrap ${
          isMine
            ? "bg-blue-600 text-white rounded-br-md"
            : "bg-white border border-gray-200 text-gray-900 rounded-bl-md"
        }`}
      >
        {message.content}
      </div>
    </div>
  )
}
