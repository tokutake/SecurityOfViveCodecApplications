"use server"

import { auth } from "@/auth"
import {
  createPost,
  createGroup,
  createMessage,
  isMember,
  listUsers,
} from "@/lib/db"
import { redirect } from "next/navigation"

async function requireAuth() {
  const session = await auth()
  if (!session?.user?.id) redirect("/login")
  return session.user
}

function validateContent(content: unknown): string {
  if (typeof content !== "string") throw new Error("Invalid content")
  const trimmed = content.trim()
  if (trimmed.length === 0) throw new Error("Content cannot be empty")
  if (trimmed.length > 1000) throw new Error("Content too long (max 1000 chars)")
  return trimmed
}

export async function actionCreatePost(formData: FormData) {
  const user = await requireAuth()
  const content = validateContent(formData.get("content"))
  const isPrivate = formData.get("visibility") === "private"
  createPost(user.id, content, isPrivate)
  redirect("/")
}

export async function actionCreateGroup(formData: FormData) {
  const user = await requireAuth()

  const name = validateContent(formData.get("name"))
  if (name.length > 100) throw new Error("Group name too long (max 100 chars)")

  // Collect selected member IDs
  const allUsers = listUsers()
  const validIds = new Set(allUsers.map((u) => u.id))
  const rawMembers = formData.getAll("members")
  const memberIds = rawMembers
    .filter((v): v is string => typeof v === "string" && validIds.has(v))

  const groupId = createGroup(name, user.id, memberIds)
  redirect(`/groups/${groupId}`)
}

export async function actionSendMessage(
  groupId: number,
  formData: FormData
) {
  const user = await requireAuth()

  if (!isMember(groupId, user.id)) {
    throw new Error("Not a member of this group")
  }

  const content = validateContent(formData.get("content"))
  createMessage(groupId, user.id, content)
  redirect(`/groups/${groupId}`)
}
