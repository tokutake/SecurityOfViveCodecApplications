"use server";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { SESSION_COOKIE, destroySession, requireUser } from "@/lib/auth";
import {
  MAX_BODY,
  MAX_GROUP_NAME,
  addMessage,
  createGroup,
  createPost,
} from "@/lib/data";

function text(fd: FormData, key: string, max: number): string | null {
  const v = fd.get(key);
  if (typeof v !== "string") return null;
  const t = v.trim();
  return t && t.length <= max ? t : null;
}

export async function logout() {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) destroySession(token);
  jar.delete(SESSION_COOKIE);
  redirect("/");
}

export async function postAction(fd: FormData) {
  const user = await requireUser();
  const body = text(fd, "body", MAX_BODY);
  if (!body) return;
  createPost(user.sub, body, fd.get("private") === "on");
  revalidatePath("/");
}

export async function createGroupAction(fd: FormData) {
  const user = await requireUser();
  const name = text(fd, "name", MAX_GROUP_NAME);
  if (!name) return;
  const members = fd.getAll("members").filter((v): v is string => typeof v === "string");
  const id = createGroup(user.sub, name, members);
  redirect(`/groups/${id}`);
}

export async function sendMessageAction(groupId: number, fd: FormData) {
  const user = await requireUser();
  const body = text(fd, "body", MAX_BODY);
  if (!body) return;
  if (!addMessage(groupId, user.sub, body)) return;
  revalidatePath(`/groups/${groupId}`);
}
