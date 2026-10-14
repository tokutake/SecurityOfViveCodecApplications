import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { getSession } from '../../server/session'
import { createGroup, getUserByDisplayName, addGroupMember } from '../../server/db'

const createGroupFn = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as { name: string; memberNames: string[] })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Not authenticated')

    const { name, memberNames } = data
    if (!name.trim()) throw new Error('Group name is required')

    const groupId = createGroup(name.trim(), session.userId)

    // Add additional members
    for (const memberName of memberNames) {
      const trimmed = memberName.trim()
      if (!trimmed) continue
      const user = getUserByDisplayName(trimmed)
      if (!user) throw new Error(`User not found: ${trimmed}`)
      if (user.id === session.userId) continue // already added as creator
      addGroupMember(groupId, user.id)
    }

    return { groupId }
  })

export const Route = createFileRoute('/groups/new')({
  component: NewGroupPage,
})

function NewGroupPage() {
  const router = useRouter()
  const [name, setName] = useState('')
  const [membersInput, setMembersInput] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim()) return
    setSubmitting(true)
    setError('')
    try {
      const memberNames = membersInput
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
      const { groupId } = await createGroupFn({ data: { name: name.trim(), memberNames } })
      router.navigate({ to: '/groups/$groupId', params: { groupId: String(groupId) } })
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to create group')
      setSubmitting(false)
    }
  }

  return (
    <div className="container">
      <h1 className="page-title">Create New Group</h1>
      <div className="card">
        {error && <div className="alert alert-error">{error}</div>}
        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label htmlFor="group-name">Group Name</label>
            <input
              id="group-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Enter group name"
              maxLength={100}
              required
            />
          </div>
          <div className="form-group">
            <label htmlFor="members">Add Members (by display name, comma-separated)</label>
            <input
              id="members"
              type="text"
              value={membersInput}
              onChange={(e) => setMembersInput(e.target.value)}
              placeholder="e.g. Alice, Bob"
            />
            <div style={{ fontSize: '0.8rem', color: '#888', marginTop: '0.3rem' }}>
              You will be added automatically. Enter others' display names separated by commas.
            </div>
          </div>
          <div style={{ display: 'flex', gap: '0.75rem' }}>
            <button type="submit" className="btn btn-primary" disabled={submitting || !name.trim()}>
              {submitting ? 'Creating...' : 'Create Group'}
            </button>
            <a href="/groups" className="btn btn-secondary">Cancel</a>
          </div>
        </form>
      </div>
    </div>
  )
}
