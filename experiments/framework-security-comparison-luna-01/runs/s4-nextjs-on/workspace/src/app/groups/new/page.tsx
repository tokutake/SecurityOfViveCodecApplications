import { auth } from "@/auth"
import { listUsers } from "@/lib/db"
import { redirect } from "next/navigation"
import { actionCreateGroup } from "@/lib/actions"

export const dynamic = "force-dynamic"

export default async function NewGroupPage() {
  const session = await auth()
  if (!session?.user) redirect("/login")

  const users = listUsers().filter((u) => u.id !== session.user.id)

  return (
    <>
      <div className="page-title">新規 DM グループ</div>

      <form action={actionCreateGroup} className="card">
        <div className="form-group">
          <label htmlFor="group-name">グループ名</label>
          <input
            id="group-name"
            name="name"
            type="text"
            placeholder="グループ名を入力"
            maxLength={100}
            required
          />
        </div>

        {users.length > 0 && (
          <div className="form-group">
            <label>メンバーを追加（自分は自動で追加されます）</label>
            <div className="user-checklist">
              {users.map((u) => (
                <label key={u.id}>
                  <input type="checkbox" name="members" value={u.id} />
                  {u.display_name}
                </label>
              ))}
            </div>
          </div>
        )}

        <div style={{ display: "flex", gap: "0.75rem" }}>
          <button type="submit" className="btn btn-primary">
            作成する
          </button>
          <a href="/groups" className="btn btn-secondary">
            キャンセル
          </a>
        </div>
      </form>
    </>
  )
}
