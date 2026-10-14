import { auth } from "@/auth"
import db from "@/lib/db"
import { NextRequest } from "next/server"

export const runtime = "nodejs"

export async function GET(req: NextRequest) {
  const session = await auth()
  if (!session?.user?.id) {
    return Response.json({ error: "Unauthorized" }, { status: 401 })
  }

  const q = req.nextUrl.searchParams.get("q")?.trim() ?? ""
  if (q.length < 1) return Response.json([])

  const users = db
    .prepare(
      `SELECT id, display_name
       FROM users
       WHERE display_name LIKE ? AND id != ?
       LIMIT 10`
    )
    .all(`%${q}%`, session.user.id)

  return Response.json(users)
}
