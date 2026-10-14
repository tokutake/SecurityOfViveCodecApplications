"use client"

import { useState, useTransition } from "react"
import { addGroupMember } from "@/app/actions"

interface User {
  id: string
  display_name: string
}

interface Props {
  groupId: number
}

export function AddMemberForm({ groupId }: Props) {
  const [query, setQuery] = useState("")
  const [results, setResults] = useState<User[]>([])
  const [searching, setSearching] = useState(false)
  const [isPending, startTransition] = useTransition()
  const addMember = addGroupMember.bind(null, groupId)

  async function search() {
    if (!query.trim()) return
    setSearching(true)
    try {
      const res = await fetch(`/api/users?q=${encodeURIComponent(query)}`)
      const data = await res.json()
      setResults(data)
    } finally {
      setSearching(false)
    }
  }

  function handleAddUser(userId: string) {
    const formData = new FormData()
    formData.set("user_id", userId)
    startTransition(async () => {
      await addMember(formData)
      setResults(prev => prev.filter(u => u.id !== userId))
    })
  }

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <input
          type="text"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === "Enter" && (e.preventDefault(), search())}
          placeholder="ユーザー名で検索…"
          className="flex-1 text-sm border border-gray-200 rounded-md px-3 py-1.5 outline-none focus:border-blue-400"
        />
        <button
          type="button"
          onClick={search}
          disabled={searching}
          className="px-3 py-1.5 text-sm border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
        >
          {searching ? "…" : "検索"}
        </button>
      </div>
      {results.length > 0 && (
        <ul className="space-y-1">
          {results.map(user => (
            <li
              key={user.id}
              className="flex items-center justify-between text-sm bg-gray-50 rounded-md px-3 py-2"
            >
              <span>{user.display_name}</span>
              <button
                type="button"
                disabled={isPending}
                onClick={() => handleAddUser(user.id)}
                className="text-blue-600 hover:text-blue-800 disabled:opacity-50 text-xs font-medium"
              >
                追加
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
