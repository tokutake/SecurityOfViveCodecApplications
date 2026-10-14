"use client"

import { useRef } from "react"
import { actionSendMessage } from "@/lib/actions"

export default function MessageForm({ groupId }: { groupId: number }) {
  const formRef = useRef<HTMLFormElement>(null)

  async function handleSubmit(formData: FormData) {
    await actionSendMessage(groupId, formData)
    formRef.current?.reset()
  }

  return (
    <form ref={formRef} action={handleSubmit} className="card">
      <div className="form-group" style={{ marginBottom: "0.5rem" }}>
        <textarea
          name="content"
          placeholder="メッセージを送信..."
          maxLength={1000}
          required
          style={{ minHeight: "60px" }}
        />
      </div>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button type="submit" className="btn btn-primary btn-sm">
          送信
        </button>
      </div>
    </form>
  )
}
