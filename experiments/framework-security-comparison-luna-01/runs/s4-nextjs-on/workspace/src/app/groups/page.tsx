import { auth } from "@/auth"
import { listGroupsForUser } from "@/lib/db"
import { redirect } from "next/navigation"
import Link from "next/link"
import { formatDate } from "@/lib/format"

export const dynamic = "force-dynamic"

export default async function GroupsPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const groups = listGroupsForUser(session.user.id)

  return (
    <>
      <div className="page-title">
        DM グループ
        <Link href="/groups/new" className="btn btn-primary btn-sm">
          + 新規グループ
        </Link>
      </div>

      {groups.length === 0 ? (
        <p className="empty-state">参加しているグループがありません。</p>
      ) : (
        <div className="stack">
          {groups.map((g) => (
            <Link
              key={g.id}
              href={`/groups/${g.id}`}
              style={{ textDecoration: "none" }}
            >
              <div className="card" style={{ cursor: "pointer" }}>
                <div style={{ fontWeight: 600 }}>{g.name}</div>
                <div style={{ fontSize: "0.8rem", color: "var(--text-muted)", marginTop: "0.2rem" }}>
                  作成日: {formatDate(g.created_at)}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </>
  )
}
