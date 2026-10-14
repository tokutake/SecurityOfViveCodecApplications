"use server"

import { auth } from "@/auth"
import db from "@/lib/db"
import { revalidatePath } from "next/cache"
import { redirect } from "next/navigation"

export async function createPost(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const content = (formData.get("content") as string)?.trim()
  if (!content) return

  const isPrivate = formData.get("is_private") === "1"

  db.prepare(
    "INSERT INTO posts (user_id, content, is_private) VALUES (?, ?, ?)"
  ).run(session.user.id, content, isPrivate ? 1 : 0)

  if (isPrivate) {
    revalidatePath("/private")
  } else {
    revalidatePath("/")
  }
}

export async function createGroup(formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const name = (formData.get("name") as string)?.trim()
  if (!name) return

  const result = db
    .prepare("INSERT INTO dm_groups (name, created_by) VALUES (?, ?)")
    .run(name, session.user.id)

  db.prepare(
    "INSERT INTO dm_group_members (group_id, user_id) VALUES (?, ?)"
  ).run(result.lastInsertRowid, session.user.id)

  redirect(`/groups/${result.lastInsertRowid}`)
}

export async function sendMessage(groupId: number, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const content = (formData.get("content") as string)?.trim()
  if (!content) return

  const member = db
    .prepare(
      "SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, session.user.id)

  if (!member) return

  db.prepare(
    "INSERT INTO dm_messages (group_id, user_id, content) VALUES (?, ?, ?)"
  ).run(groupId, session.user.id, content)

  revalidatePath(`/groups/${groupId}`)
}

export async function addGroupMember(groupId: number, formData: FormData) {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")

  const userId = (formData.get("user_id") as string)?.trim()
  if (!userId) return

  const selfMember = db
    .prepare(
      "SELECT 1 FROM dm_group_members WHERE group_id = ? AND user_id = ?"
    )
    .get(groupId, session.user.id)

  if (!selfMember) return

  const targetUser = db
    .prepare("SELECT id FROM users WHERE id = ?")
    .get(userId)

  if (!targetUser) return

  db.prepare(
    "INSERT OR IGNORE INTO dm_group_members (group_id, user_id) VALUES (?, ?)"
  ).run(groupId, userId)

  revalidatePath(`/groups/${groupId}`)
}
