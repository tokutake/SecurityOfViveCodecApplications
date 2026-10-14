import Link from "next/link"
import { signOut } from "@/auth"

interface Props {
  user: { name?: string | null; id: string }
}

export function Header({ user }: Props) {
  return (
    <header className="bg-white border-b border-gray-200 sticky top-0 z-10">
      <div className="max-w-2xl mx-auto px-4 h-14 flex items-center justify-between">
        <nav className="flex items-center gap-1">
          <Link
            href="/"
            className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-gray-100 transition-colors"
          >
            タイムライン
          </Link>
          <Link
            href="/private"
            className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-gray-100 transition-colors"
          >
            非公開
          </Link>
          <Link
            href="/groups"
            className="px-3 py-1.5 text-sm font-medium rounded-md hover:bg-gray-100 transition-colors"
          >
            DM グループ
          </Link>
        </nav>

        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-600 max-w-[140px] truncate">
            {user.name || user.id}
          </span>
          <form
            action={async () => {
              "use server"
              await signOut({ redirectTo: "/login" })
            }}
          >
            <button
              type="submit"
              className="text-sm text-gray-500 hover:text-gray-900 transition-colors"
            >
              ログアウト
            </button>
          </form>
        </div>
      </div>
    </header>
  )
}
