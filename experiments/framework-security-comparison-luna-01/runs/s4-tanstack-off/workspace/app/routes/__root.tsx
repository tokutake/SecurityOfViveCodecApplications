import {
  createRootRoute,
  Link,
  Outlet,
  HeadContent,
  Scripts,
  redirect,
} from '@tanstack/react-router'
import { createServerFn } from '@tanstack/react-start'
import { getSession } from '../server/session'
import { deleteSession } from '../server/session'

const getCurrentUser = createServerFn({ method: 'GET' }).handler(async () => {
  const session = await getSession()
  if (!session) return null
  return { userId: session.userId, displayName: session.displayName }
})

const logoutFn = createServerFn({ method: 'POST' }).handler(async () => {
  await deleteSession()
  throw redirect({ href: '/', statusCode: 302 })
})

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Micro SNS' },
    ],
  }),
  beforeLoad: async () => {
    const user = await getCurrentUser()
    return { user }
  },
  component: RootComponent,
})

function RootComponent() {
  const { user } = Route.useRouteContext()

  return (
    <html lang="en">
      <head>
        <HeadContent />
        <style>{`
          * {
            box-sizing: border-box;
            margin: 0;
            padding: 0;
          }

          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #f5f5f5;
            color: #333;
            line-height: 1.6;
          }

          nav {
            background: #1a1a2e;
            color: white;
            padding: 0 1rem;
            display: flex;
            align-items: center;
            gap: 1rem;
            height: 56px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.2);
          }

          nav .brand {
            font-size: 1.2rem;
            font-weight: 700;
            color: #e0e0ff;
            text-decoration: none;
            margin-right: 1rem;
          }

          nav a {
            color: #b0b0d0;
            text-decoration: none;
            padding: 0.4rem 0.8rem;
            border-radius: 4px;
            transition: background 0.15s;
          }

          nav a:hover, nav a.active {
            background: rgba(255,255,255,0.1);
            color: white;
          }

          nav .spacer {
            flex: 1;
          }

          nav .user-info {
            display: flex;
            align-items: center;
            gap: 0.75rem;
            font-size: 0.9rem;
          }

          nav .display-name {
            color: #e0e0ff;
            font-weight: 500;
          }

          .btn {
            display: inline-block;
            padding: 0.4rem 1rem;
            border-radius: 4px;
            border: none;
            cursor: pointer;
            font-size: 0.9rem;
            font-weight: 500;
            text-decoration: none;
            transition: background 0.15s;
          }

          .btn-primary {
            background: #4a4af0;
            color: white;
          }

          .btn-primary:hover {
            background: #3a3ae0;
          }

          .btn-secondary {
            background: #555;
            color: white;
          }

          .btn-secondary:hover {
            background: #444;
          }

          .btn-danger {
            background: #d32f2f;
            color: white;
          }

          .btn-danger:hover {
            background: #b71c1c;
          }

          .container {
            max-width: 720px;
            margin: 2rem auto;
            padding: 0 1rem;
          }

          .card {
            background: white;
            border-radius: 8px;
            padding: 1.25rem;
            box-shadow: 0 1px 3px rgba(0,0,0,0.1);
            margin-bottom: 1rem;
          }

          .card h2, .card h3 {
            margin-bottom: 0.75rem;
            color: #1a1a2e;
          }

          .post-meta {
            font-size: 0.82rem;
            color: #666;
            margin-bottom: 0.4rem;
            display: flex;
            gap: 0.5rem;
            align-items: center;
          }

          .post-meta .author {
            font-weight: 600;
            color: #333;
          }

          .badge {
            display: inline-block;
            padding: 0.15rem 0.5rem;
            border-radius: 12px;
            font-size: 0.75rem;
            font-weight: 600;
          }

          .badge-private {
            background: #fff3e0;
            color: #e65100;
          }

          .post-content {
            color: #333;
            white-space: pre-wrap;
            word-break: break-word;
          }

          textarea, input[type="text"], input[type="email"] {
            width: 100%;
            padding: 0.6rem 0.8rem;
            border: 1px solid #ddd;
            border-radius: 4px;
            font-size: 0.95rem;
            font-family: inherit;
            transition: border-color 0.15s;
          }

          textarea:focus, input[type="text"]:focus, input[type="email"]:focus {
            outline: none;
            border-color: #4a4af0;
          }

          textarea {
            resize: vertical;
            min-height: 80px;
          }

          .form-group {
            margin-bottom: 0.75rem;
          }

          .form-group label {
            display: block;
            margin-bottom: 0.3rem;
            font-size: 0.9rem;
            font-weight: 500;
            color: #555;
          }

          .checkbox-row {
            display: flex;
            align-items: center;
            gap: 0.5rem;
            margin-bottom: 0.75rem;
          }

          .checkbox-row input[type="checkbox"] {
            width: 16px;
            height: 16px;
            cursor: pointer;
          }

          .checkbox-row label {
            font-size: 0.9rem;
            cursor: pointer;
          }

          .page-title {
            font-size: 1.4rem;
            font-weight: 700;
            color: #1a1a2e;
            margin-bottom: 1.25rem;
          }

          .empty-state {
            text-align: center;
            color: #888;
            padding: 2rem 1rem;
            font-size: 0.95rem;
          }

          .group-link {
            display: block;
            text-decoration: none;
            color: inherit;
          }

          .group-link:hover .card {
            box-shadow: 0 2px 8px rgba(74,74,240,0.15);
          }

          .message-bubble {
            margin-bottom: 0.75rem;
          }

          .message-bubble .meta {
            font-size: 0.8rem;
            color: #666;
            margin-bottom: 0.2rem;
          }

          .message-bubble .meta .author {
            font-weight: 600;
            color: #333;
          }

          .message-bubble .text {
            background: #f0f0f8;
            border-radius: 8px;
            padding: 0.6rem 0.9rem;
            display: inline-block;
            max-width: 100%;
            white-space: pre-wrap;
            word-break: break-word;
          }

          .member-list {
            display: flex;
            flex-wrap: wrap;
            gap: 0.5rem;
            margin-top: 0.5rem;
          }

          .member-chip {
            background: #e8e8f8;
            color: #333;
            padding: 0.2rem 0.6rem;
            border-radius: 12px;
            font-size: 0.82rem;
          }

          .alert {
            padding: 0.75rem 1rem;
            border-radius: 4px;
            margin-bottom: 1rem;
            font-size: 0.9rem;
          }

          .alert-error {
            background: #fdecea;
            color: #c62828;
            border: 1px solid #ffcdd2;
          }

          .alert-info {
            background: #e3f2fd;
            color: #1565c0;
            border: 1px solid #bbdefb;
          }

          .divider {
            border: none;
            border-top: 1px solid #eee;
            margin: 1rem 0;
          }
        `}</style>
      </head>
      <body>
        <nav>
          <Link to="/" className="brand">Micro SNS</Link>
          <Link to="/" activeProps={{ className: 'active' }}>Timeline</Link>
          <Link to="/groups" activeProps={{ className: 'active' }}>Groups</Link>
          <div className="spacer" />
          <div className="user-info">
            {user ? (
              <>
                <span className="display-name">{user.displayName}</span>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={async () => {
                    await logoutFn()
                    window.location.href = '/'
                  }}
                >
                  Logout
                </button>
              </>
            ) : (
              <a href="/api/auth/login" className="btn btn-primary">Login</a>
            )}
          </div>
        </nav>
        <Outlet />
        <Scripts />
      </body>
    </html>
  )
}
