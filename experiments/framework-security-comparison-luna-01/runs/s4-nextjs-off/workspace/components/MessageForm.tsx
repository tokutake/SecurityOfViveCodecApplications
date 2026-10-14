"use client"

import { useRef, useTransition } from "react"
import { sendMessage } from "@/app/actions"

interface Props {
  groupId: number
}

export function MessageForm({ groupId }: Props) {
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)
  const sendWithId = sendMessage.bind(null, groupId)

  function handleAction(formData: FormData) {
    startTransition(async () => {
      await sendWithId(formData)
      formRef.current?.reset()
    })
  }

  return (
    <form ref={formRef} action={handleAction} className="flex gap-2">
      <input
        type="text"
        name="content"
        required
        maxLength={2000}
        placeholder="メッセージを入力…"
        className="flex-1 text-sm border border-gray-200 rounded-full px-4 py-2 outline-none focus:border-blue-400 transition-colors"
      />
      <button
        type="submit"
        disabled={isPending}
        className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors"
      >
        {isPending ? "…" : "送信"}
      </button>
    </form>
  )
}
