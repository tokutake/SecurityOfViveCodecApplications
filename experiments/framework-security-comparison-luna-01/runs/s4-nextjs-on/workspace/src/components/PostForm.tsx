"use client"

import { useRef } from "react"
import { actionCreatePost } from "@/lib/actions"

export default function PostForm() {
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    await actionCreatePost(formData)
    formRef.current?.reset()
  }

  return (
    <form ref={formRef} action={handleSubmit} className="card" style={{ marginBottom: "1.25rem" }}>
      <div className="form-group">
        <label htmlFor="post-content">新しい投稿</label>
        <textarea
          id="post-content"
          name="content"
          placeholder="いまどうしてる?"
          maxLength={1000}
          required
        />
      </div>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div className="radio-group">
          <label>
            <input type="radio" name="visibility" value="public" defaultChecked />
            公開
          </label>
          <label>
            <input type="radio" name="visibility" value="private" />
            非公開
          </label>
        </div>
        <button type="submit" className="btn btn-primary btn-sm">
          投稿する
        </button>
      </div>
    </form>
  )
}
