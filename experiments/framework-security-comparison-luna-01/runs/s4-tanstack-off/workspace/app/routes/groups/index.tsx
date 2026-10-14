import { createFileRoute, Link } from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSession } from '../../server/session'
import { getGroupsForUser, type Group } from '../../server/db'

const getGroups = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return { groups: [], loggedIn: false }
  const groups = getGroupsForUser(session.userId)
  return { groups, loggedIn: true }
})

export const Route = createFileRoute('/groups/')({
  loader: async () => getGroups(),
  component: GroupsPage,
})

function formatDate(dateStr: string): string {
  try {
    const d = new Date(dateStr + 'Z')
    return d.toLocaleString()
  } catch {
    return dateStr
  }
}

function GroupsPage() {
  const { groups, loggedIn } = Route.useLoaderData()

  if (!loggedIn) {
    return (
      <div className="container">
        <h1 className="page-title">DM Groups</h1>
        <div className="card">
          <div className="alert alert-info">
            <a href="/api/auth/login">Log in</a> to view and create groups.
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="container">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '1.25rem' }}>
        <h1 className="page-title" style={{ marginBottom: 0 }}>DM Groups</h1>
        <Link to="/groups/new" className="btn btn-primary">+ New Group</Link>
      </div>

      {groups.length === 0 ? (
        <div className="empty-state">
          You're not in any groups yet.{' '}
          <Link to="/groups/new">Create one!</Link>
        </div>
      ) : (
        groups.map((group: Group) => (
          <Link key={group.id} to="/groups/$groupId" params={{ groupId: String(group.id) }} className="group-link">
            <div className="card">
              <h3>{group.name}</h3>
              <div style={{ fontSize: '0.82rem', color: '#888' }}>
                Created {formatDate(group.created_at)}
              </div>
            </div>
          </Link>
        ))
      )}
    </div>
  )
}
