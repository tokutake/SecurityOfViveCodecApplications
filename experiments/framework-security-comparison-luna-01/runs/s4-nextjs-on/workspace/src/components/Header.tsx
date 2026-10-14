import Link from "next/link"
import { auth, signOut } from "@/auth"

export default async function Header() {
  const session = await auth()

  return (
    <header>
      <div className="header-inner">
        <Link href="/" className="header-logo">
          MicroSNS
        </Link>
        {session?.user && (
          <nav>
            <Link href="/">タイムライン</Link>
            <Link href="/groups">DM グループ</Link>
          </nav>
        )}
        <div className="header-user">
          {session?.user ? (
            <>
              <span>{session.user.name}</span>
              <form
                action={async () => {
                  "use server"
                  await signOut({ redirectTo: "/login" })
                }}
              >
                <button type="submit" className="btn btn-secondary btn-sm">
                  ログアウト
                </button>
              </form>
            </>
          ) : (
            <Link href="/login" className="btn btn-primary btn-sm">
              ログイン
            </Link>
          )}
        </div>
      </div>
    </header>
  )
}
