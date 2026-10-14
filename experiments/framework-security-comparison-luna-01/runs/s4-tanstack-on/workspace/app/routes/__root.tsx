import {
  createRootRoute,
  Link,
  Outlet,
  ScrollRestoration,
} from '@tanstack/react-router'
import { Meta, Scripts } from '@tanstack/start'
import { createServerFn } from '@tanstack/start'
import { getSession } from '../lib/session'

const getSessionInfo = createServerFn({ method: 'GET' }).handler(() => {
  const s = getSession()
  return { userId: s.userId ?? null, displayName: s.displayName ?? null }
})

export const Route = createRootRoute({
  loader: () => getSessionInfo(),
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Micro SNS' },
    ],
  }),
  component: RootComponent,
})

function RootComponent() {
  const { userId, displayName } = Route.useLoaderData()

  return (
    <html lang="ja">
      <head>
        <Meta />
        <style>{css}</style>
      </head>
      <body>
        <nav className="nav">
          <div className="nav-inner">
            <Link to="/" className="nav-title">Micro SNS</Link>
            <div className="nav-links">
              {userId ? (
                <>
                  <Link to="/" activeProps={{ style: { fontWeight: 700 } }}>タイムライン</Link>
                  <Link to="/groups" activeProps={{ style: { fontWeight: 700 } }}>DMグループ</Link>
                  <span className="nav-user">@{displayName}</span>
                  <a href="/api/auth/logout" className="btn btn-secondary btn-sm">ログアウト</a>
                </>
              ) : (
                <a href="/api/auth/login" className="btn btn-primary btn-sm">ログイン</a>
              )}
            </div>
          </div>
        </nav>
        <Outlet />
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  )
}

const css = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f5f5f5; color: #333; line-height: 1.5; }
a { color: #4f46e5; text-decoration: none; }
a:hover { text-decoration: underline; }

.nav { background: #fff; border-bottom: 1px solid #e5e7eb; position: sticky; top: 0; z-index: 10; }
.nav-inner { display: flex; align-items: center; justify-content: space-between; padding: 0.75rem 1rem; max-width: 720px; margin: 0 auto; gap: 1rem; }
.nav-title { font-weight: 700; font-size: 1.1rem; color: #4f46e5; }
.nav-links { display: flex; align-items: center; gap: 0.75rem; font-size: 0.875rem; flex-wrap: wrap; }
.nav-user { color: #6b7280; font-size: 0.85rem; }

.btn { display: inline-block; padding: 0.4rem 0.9rem; border-radius: 6px; border: none; cursor: pointer; font-size: 0.875rem; font-weight: 500; transition: background 0.1s; }
.btn-primary { background: #4f46e5; color: #fff; }
.btn-primary:hover { background: #4338ca; text-decoration: none; }
.btn-secondary { background: #e5e7eb; color: #374151; }
.btn-secondary:hover { background: #d1d5db; text-decoration: none; }
.btn-danger { background: #fee2e2; color: #dc2626; }
.btn-danger:hover { background: #fecaca; text-decoration: none; }
.btn-sm { padding: 0.3rem 0.7rem; font-size: 0.8rem; }
button.btn { font-family: inherit; }

.container { max-width: 720px; margin: 0 auto; padding: 1.5rem 1rem; }
.page-title { font-size: 1.25rem; font-weight: 700; margin-bottom: 1rem; }

.card { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 1rem; margin-bottom: 0.75rem; }
.post-header { display: flex; align-items: center; gap: 0.5rem; margin-bottom: 0.4rem; flex-wrap: wrap; }
.post-author { font-weight: 600; font-size: 0.875rem; }
.post-time { font-size: 0.78rem; color: #9ca3af; margin-left: auto; }
.post-content { font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; }
.badge { font-size: 0.72rem; padding: 0.1rem 0.4rem; border-radius: 4px; background: #f3f4f6; color: #6b7280; }
.badge-private { background: #fef3c7; color: #92400e; }

.form-box { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 1rem; margin-bottom: 1rem; }
textarea, input[type="text"], input[type="checkbox"] { font-family: inherit; }
textarea, input[type="text"] { width: 100%; padding: 0.5rem 0.75rem; border: 1px solid #d1d5db; border-radius: 6px; font-size: 0.9rem; resize: vertical; }
textarea:focus, input[type="text"]:focus { outline: none; border-color: #4f46e5; box-shadow: 0 0 0 2px rgba(79,70,229,0.15); }
.form-row { display: flex; align-items: center; gap: 0.75rem; margin-top: 0.5rem; flex-wrap: wrap; }
label.check { display: flex; align-items: center; gap: 0.35rem; font-size: 0.875rem; cursor: pointer; }
.char-count { font-size: 0.78rem; color: #9ca3af; margin-left: auto; }
.msg-error { color: #dc2626; font-size: 0.83rem; margin-top: 0.4rem; }
.msg-ok { color: #16a34a; font-size: 0.83rem; margin-top: 0.4rem; }

.empty { text-align: center; color: #9ca3af; padding: 3rem 0; font-size: 0.9rem; }

.group-item { background: #fff; border-radius: 8px; border: 1px solid #e5e7eb; padding: 0.9rem 1rem; margin-bottom: 0.5rem; display: flex; justify-content: space-between; align-items: center; }
.group-name { font-weight: 600; }
.group-meta { font-size: 0.8rem; color: #9ca3af; margin-top: 0.15rem; }

.msg-item { padding: 0.5rem 0.4rem; border-radius: 6px; }
.msg-item:hover { background: #f9fafb; }
.msg-author { font-weight: 600; font-size: 0.83rem; color: #374151; }
.msg-time { font-size: 0.75rem; color: #9ca3af; margin-left: 0.4rem; }
.msg-body { font-size: 0.9rem; white-space: pre-wrap; word-break: break-word; margin-top: 0.15rem; }

.scroll-anchor { height: 0; }

.user-picker { border: 1px solid #d1d5db; border-radius: 6px; max-height: 160px; overflow-y: auto; padding: 0.35rem 0.5rem; }
.user-pick-item { display: flex; align-items: center; gap: 0.4rem; padding: 0.25rem 0.1rem; font-size: 0.875rem; cursor: pointer; }
`
