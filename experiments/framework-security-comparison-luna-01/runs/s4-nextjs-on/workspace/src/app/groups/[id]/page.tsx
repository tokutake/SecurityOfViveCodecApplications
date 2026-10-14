import { auth } from "@/auth"
import { getGroup, getMessages, isMember, listMembers } from "@/lib/db"
import { notFound, redirect } from "next/navigation"
import Link from "next/link"
import MessageForm from "@/components/MessageForm"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

type Props = { params: Promise<{ id: string }> }

export default async function GroupPage({ params }: Props) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { id } = await params
  const groupId = parseInt(id, 10)
  if (isNaN(groupId)) notFound()

  const group = getGroup(groupId)
  if (!group) notFound()

  if (!isMember(groupId, session.user.id)) {
    redirect("/groups")
  }

  const messages = getMessages(groupId)
  const members = listMembers(groupId)

  return (
    <>
      <div className="page-title">
        <span>{group.name}</span>
        <Link href="/groups" className="btn btn-secondary btn-sm">
          ← グループ一覧
        </Link>
      </div>

      <div className="card" style={{ marginBottom: "1rem", padding: "0.75rem 1rem" }}>
        <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginBottom: "0.3rem" }}>
          メンバー
        </div>
        <div className="members-list">
          {members.map((m) => (
            <span key={m.id} className="member-chip">
              {m.display_name}
              {m.id === session.user.id && " (あなた)"}
            </span>
          ))}
        </div>
      </div>

      <hr className="divider" />

      <div className="chat-messages">
        {messages.length === 0 ? (
          <p className="empty-state">まだメッセージがありません。</p>
        ) : (
          messages.map((msg) => (
            <div key={msg.id} className="post-item">
              <div className="post-meta">
                <span className="post-author">{msg.display_name}</span>
                <span>&middot;</span>
                <time dateTime={new Date(msg.created_at * 1000).toISOString()}>
                  {formatDate(msg.created_at)}
                </time>
              </div>
              <p className="post-content">{msg.content}</p>
            </div>
          ))
        )}
      </div>

      <MessageForm groupId={groupId} />
    </>
  )
}
