import { auth, signIn } from "@/auth"
import { redirect } from "next/navigation"

export default async function LoginPage() {
  const session = await auth()
  if (session?.user) redirect("/")

  return (
    <div className="login-page">
      <h1>MicroSNS</h1>
      <p>ログインして投稿やグループを利用できます。</p>
      <form
        action={async () => {
          "use server"
          await signIn("oidc", { redirectTo: "/" })
        }}
      >
        <button type="submit" className="btn btn-primary">
          ログイン
        </button>
      </form>
    </div>
  )
}
