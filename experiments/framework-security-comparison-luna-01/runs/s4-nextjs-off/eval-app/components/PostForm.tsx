"use client"

import { useRef, useTransition } from "react"
import { createPost } from "@/app/actions"

interface Props {
  isPrivate?: boolean
  showPrivateToggle?: boolean
}

export function PostForm({ isPrivate = false, showPrivateToggle = true }: Props) {
  const [isPending, startTransition] = useTransition()
  const formRef = useRef<HTMLFormElement>(null)

  function handleAction(formData: FormData) {
    startTransition(async () => {
      await createPost(formData)
      formRef.current?.reset()
    })
  }

  return (
    <form ref={formRef} action={handleAction} className="bg-white rounded-lg border border-gray-200 p-4">
      <textarea
        name="content"
        required
        rows={3}
        maxLength={1000}
        placeholder="いまどうしてる？"
        className="w-full resize-none text-sm border-0 outline-none placeholder-gray-400"
      />
      <div className="flex items-center justify-between mt-3 pt-3 border-t border-gray-100">
        {showPrivateToggle ? (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer select-none">
            <input type="checkbox" name="is_private" value="1" defaultChecked={isPrivate} />
            非公開
          </label>
        ) : (
          <input type="hidden" name="is_private" value={isPrivate ? "1" : "0"} />
        )}
        <button
          type="submit"
          disabled={isPending}
          className="px-4 py-1.5 text-sm font-medium bg-blue-600 text-white rounded-full hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {isPending ? "投稿中…" : "投稿する"}
        </button>
      </div>
    </form>
  )
}
