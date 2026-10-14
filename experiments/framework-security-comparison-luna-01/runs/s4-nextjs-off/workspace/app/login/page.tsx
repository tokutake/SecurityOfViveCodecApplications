import { signIn } from "@/auth"
import { auth } from "@/auth"
import { redirect } from "next/navigation"

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect("/")

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="bg-white rounded-2xl border border-gray-200 shadow-sm p-10 w-full max-w-sm flex flex-col items-center gap-6">
        <div className="text-center">
          <h1 className="text-2xl font-bold tracking-tight">マイクロSNS</h1>
          <p className="mt-1 text-sm text-gray-500">実験用の小さな SNS です</p>
        </div>
        <form
          action={async () => {
            "use server"
            await signIn("oidc", { redirectTo: "/" })
          }}
          className="w-full"
        >
          <button
            type="submit"
            className="w-full py-2.5 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
          >
            ログイン
          </button>
        </form>
      </div>
    </div>
  )
}
