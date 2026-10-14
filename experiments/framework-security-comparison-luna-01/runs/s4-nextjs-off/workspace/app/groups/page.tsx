import { auth } from "@/auth"
import db from "@/lib/db"
import { redirect } from "next/navigation"
import { Header } from "@/components/Header"
import { createGroup } from "@/app/actions"
import Link from "next/link"

interface Group {
  id: number
  name: string
  created_at: string
  member_count: number
}

export default async function GroupsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const groups = db
    .prepare(
      `SELECT g.id, g.name, g.created_at,
              COUNT(m.user_id) AS member_count
       FROM dm_groups g
       JOIN dm_group_members m ON g.id = m.group_id
       WHERE g.id IN (
         SELECT group_id FROM dm_group_members WHERE user_id = ?
       )
       GROUP BY g.id
       ORDER BY g.created_at DESC`
    )
    .all(session.user.id) as Group[]

  return (
    <>
      <Header user={session.user} />
      <main className="max-w-2xl mx-auto px-4 py-6 space-y-6">
        {/* Create group */}
        <section>
          <h2 className="text-lg font-semibold mb-3">新しい DM グループを作成</h2>
          <form action={createGroup} className="flex gap-2">
            <input
              type="text"
              name="name"
              required
              maxLength={100}
              placeholder="グループ名"
              className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-2 outline-none focus:border-blue-400 transition-colors"
            />
            <button
              type="submit"
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-md hover:bg-blue-700 transition-colors"
            >
              作成
            </button>
          </form>
        </section>

        {/* Group list */}
        <section>
          <h2 className="text-lg font-semibold mb-3">参加中のグループ</h2>
          {groups.length === 0 ? (
            <p className="text-center text-sm text-gray-400 py-10">
              参加中のグループはありません
            </p>
          ) : (
            <ul className="space-y-2">
              {groups.map(group => (
                <li key={group.id}>
                  <Link
                    href={`/groups/${group.id}`}
                    className="flex items-center justify-between bg-white rounded-lg border border-gray-200 px-4 py-3 hover:border-blue-300 transition-colors"
                  >
                    <span className="font-medium text-sm">{group.name}</span>
                    <span className="text-xs text-gray-400">
                      {group.member_count} 人
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </>
  )
}
