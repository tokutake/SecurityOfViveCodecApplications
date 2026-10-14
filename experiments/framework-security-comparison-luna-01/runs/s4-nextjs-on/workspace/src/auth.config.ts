import type { NextAuthConfig } from "next-auth"

// Edge-compatible config (no Node.js-only imports)
export const authConfig: NextAuthConfig = {
  providers: [
    {
      id: "oidc",
      name: "Login",
      type: "oidc",
      issuer: process.env.OIDC_ISSUER!,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      checks: ["pkce", "state"],
    },
  ],
  secret: process.env.AUTH_SECRET,
  session: { strategy: "jwt" },
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  callbacks: {
    authorized({ auth, request: { nextUrl } }) {
      const isLoggedIn = !!auth?.user
      const isProtected = nextUrl.pathname.startsWith("/groups")
      if (isProtected && !isLoggedIn) return false
      return true
    },
  },
}
