import { createFileRoute, useRouter } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { useState } from 'react'
import { getSession } from '../../server/session'
import {
  getGroupById,
  isGroupMember,
  getGroupMessages,
  createGroupMessage,
  getGroupMembers,
  addGroupMember,
  getUserByDisplayName,
  type GroupMessage,
} from '../../server/db'

const getGroupData = createServerFn({ method: 'GET' })
  .validator((data: unknown) => data as { groupId: number })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) return { status: 'unauthenticated' as const }

    const group = getGroupById(data.groupId)
    if (!group) return { status: 'not_found' as const }

    const isMember = isGroupMember(data.groupId, session.userId)
    if (!isMember) return { status: 'forbidden' as const }

    const messages = getGroupMessages(data.groupId)
    const members = getGroupMembers(data.groupId)

    return {
      status: 'ok' as const,
      group,
      messages,
      members,
      currentUserId: session.userId,
    }
  })

const sendMessage = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as { groupId: number; content: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Not authenticated')

    const isMember = isGroupMember(data.groupId, session.userId)
    if (!isMember) throw new Error('Access denied')

    createGroupMessage(data.groupId, session.userId, data.content)
    return { ok: true }
  })

const addMember = createServerFn({ method: 'POST' })
  .validator((data: unknown) => data as { groupId: number; displayName: string })
  .handler(async ({ data }) => {
    const session = await getSession()
    if (!session) throw new Error('Not authenticated')

    const isMember = isGroupMember(data.groupId, session.userId)
    if (!isMember) throw new Error('Access denied')

    const user = getUserByDisplayName(data.displayName.trim())
    if (!user) throw new Error(`User not found: ${data.displayName}`)

    addGroupMember(data.groupId, user.id)
    return { ok: true }
  })

export const Route = createFileRoute('/groups/$groupId')({
  loader: async ({ params }) =>
    getGroupData({ data: { groupId: Number(params.groupId) } }),
  component: GroupChatPage,
})

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'Z')
    return d.toLocaleString()
  } catch {
    return dateStr
  }
}

function GroupChatPage() {
  const result = Route.useLoaderData()
  const router = useRouter()
  const { groupId } = Route.useParams()

  const [messageContent, setMessageContent] = useState('')
  const [sendingMsg, setSendingMsg] = useState(false)
  const [msgError, setMsgError] = useState('')

  const [newMemberName, setNewMemberName] = useState('')
  const [addingMember, setAddingMember] = useState(false)
  const [memberError, setMemberError] = useState('')

  if (result.status === 'unauthenticated') {
    return (
      <div className="container">
        <div className="alert alert-info">
          <a href="/api/auth/login">Log in</a> to view this group.
        </div>
      </div>
    )
  }

  if (result.status === 'not_found') {
    return (
      <div className="container">
        <div className="alert alert-error">Group not found.</div>
      </div>
    )
  }

  if (result.status === 'forbidden') {
    return (
      <div className="container">
        <div className="card">
          <h2>Access Denied</h2>
          <p>You are not a member of this group.</p>
        </div>
      </div>
    )
  }

  const { group, messages, members } = result

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault()
    if (!messageContent.trim()) return
    setSendingMsg(true)
    setMsgError('')
    try {
      await sendMessage({ data: { groupId: Number(groupId), content: messageContent.trim() } })
      setMessageContent('')
      router.invalidate()
    } catch (err: unknown) {
      setMsgError(err instanceof Error ? err.message : 'Failed to send message')
    } finally {
      setSendingMsg(false)
    }
  }

  async function handleAddMember(e: React.FormEvent) {
    e.preventDefault()
    if (!newMemberName.trim()) return
    setAddingMember(true)
    setMemberError('')
    try {
      await addMember({ data: { groupId: Number(groupId), displayName: newMemberName.trim() } })
      setNewMemberName('')
      router.invalidate()
    } catch (err: unknown) {
      setMemberError(err instanceof Error ? err.message : 'Failed to add member')
    } finally {
      setAddingMember(false)
    }
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>{group.name}</h1>
        <a href="/groups" className="btn btn-secondary" style={{ fontSize: '0.85rem' }}>← Back to Groups</a>
      </div>

      {/* Members section */}
      <div className="card">
        <h3>Members</h3>
        <div className="member-list">
          {members.map((m) => (
            <span key={m.id} className="member-chip">{m.display_name}</span>
          ))}
        </div>
        <hr className="divider" />
        <form onSubmit={handleAddMember} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-end' }}>
          <div className="form-group" style={{ flex: 1, marginBottom: 0 }}>
            <label htmlFor="new-member">Add Member by Display Name</label>
            <input
              id="new-member"
              type="text"
              value={newMemberName}
              onChange={(e) => setNewMemberName(e.target.value)}
              placeholder="Enter display name"
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={addingMember || !newMemberName.trim()}>
            {addingMember ? 'Adding...' : 'Add'}
          </button>
        </form>
        {memberError && <div className="alert alert-error" style={{ marginTop: '0.5rem' }}>{memberError}</div>}
      </div>

      {/* Messages */}
      <div className="card">
        <h3>Messages</h3>
        {messages.length === 0 ? (
          <div className="empty-state">No messages yet. Say hello!</div>
        ) : (
          <div style={{ marginBottom: '1rem' }}>
            {messages.map((msg: GroupMessage) => (
              <div key={msg.id} className="message-bubble">
                <div className="meta">
                  <span className="author">{msg.display_name}</span>
                  {' · '}
                  <span>{formatDate(msg.created_at)}</span>
                </div>
                <div className="text">{msg.content}</div>
              </div>
            ))}
          </div>
        )}
        <hr className="divider" />
        {msgError && <div className="alert alert-error">{msgError}</div>}
        <form onSubmit={handleSendMessage}>
          <div className="form-group">
            <textarea
              value={messageContent}
              onChange={(e) => setMessageContent(e.target.value)}
              placeholder="Type a message..."
              rows={2}
              maxLength={1000}
            />
          </div>
          <button type="submit" className="btn btn-primary" disabled={sendingMsg || !messageContent.trim()}>
            {sendingMsg ? 'Sending...' : 'Send'}
          </button>
        </form>
      </div>
    </div>
  )
}
