import { auth } from "@/auth"
import db from "@/lib/db"
import { redirect, notFound } from "next/navigation"
import { Header } from "@/components/Header"
import { MessageItem } from "@/components/MessageItem"
import { MessageForm } from "@/components/MessageForm"
import { AddMemberForm } from "@/components/AddMemberForm"

interface Message {
  id: number
  content: string
  created_at: string
  display_name: string
  user_id: string
}

interface Member {
  id: string
  display_name: string
}

interface Group {
  id: number
  name: string
}

export default async function GroupPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const { id } = await params
  const groupId = parseInt(id, 10)
  if (isNaN(groupId)) notFound()

  const group = db
    .prepare("SELECT id, name FROM dm_groups WHERE id = ?")
    .get(groupId) as Group | undefined

  if (!group) notFound()

  const membership = db
    .prepare(
      "SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, session.user.id)

  if (!membership) notFound()

  const messages = db
    .prepare(
      `SELECT m.id, m.content, m.created_at, m.user_id, u.display_name
       FROM dm_messages m
       JOIN users u ON m.user_id = u.id
       WHERE m.group_id = ?
       ORDER BY m.created_at ASC
       LIMIT 200`
    )
    .all(groupId) as Message[]

  const members = db
    .prepare(
      `SELECT u.id, u.display_name
       FROM dm_group_members gm
       JOIN users u ON gm.user_id = u.id
       WHERE gm.group_id = ?
       ORDER BY gm.joined_at ASC`
    )
    .all(groupId) as Member[]

  return (
    <>
      <Header user={session.user} />
      <main className="max-w-2xl mx-auto px-4 py-6 flex flex-col gap-6">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-semibold">{group.name}</h2>
          <span className="text-xs text-gray-400">{members.length} 人のメンバー</span>
        </div>

        {/* Messages */}
        <section className="bg-white rounded-lg border border-gray-200 flex flex-col min-h-[400px] max-h-[60vh]">
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {messages.length === 0 ? (
              <p className="text-center text-sm text-gray-400 py-10">
                まだメッセージがありません
              </p>
            ) : (
              messages.map(msg => (
                <MessageItem
                  key={msg.id}
                  message={msg}
                  currentUserId={session.user.id}
                />
              ))
            )}
          </div>
          <div className="border-t border-gray-100 p-3">
            <MessageForm groupId={groupId} />
          </div>
        </section>

        {/* Members & Add member */}
        <section className="bg-white rounded-lg border border-gray-200 p-4 space-y-4">
          <h3 className="text-sm font-semibold">メンバー</h3>
          <ul className="flex flex-wrap gap-2">
            {members.map(member => (
              <li
                key={member.id}
                className="text-xs bg-gray-100 text-gray-700 px-2.5 py-1 rounded-full"
              >
                {member.display_name}
              </li>
            ))}
          </ul>
          <div>
            <p className="text-xs text-gray-500 mb-2">メンバーを追加</p>
            <AddMemberForm groupId={groupId} />
          </div>
        </section>
      </main>
    </>
  )
}
