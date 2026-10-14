import NextAuth from "next-auth"
import type { NextAuthConfig } from "next-auth"

// Minimal Edge-compatible config — only verifies the session JWT.
// No DB imports here. Full config (with DB callbacks) lives in auth.ts.
const proxyConfig: NextAuthConfig = {
  providers: [],
  pages: { signIn: "/login" },
  callbacks: {
    authorized({ auth }) {
      return !!auth?.user
    },
  },
}

export const { auth: middleware } = NextAuth(proxyConfig)
export default middleware

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon\\.ico|login).*)"],
}
