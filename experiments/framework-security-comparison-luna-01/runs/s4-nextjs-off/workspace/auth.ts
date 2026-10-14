import NextAuth from "next-auth"
import db from "@/lib/db"

// Map APP_URL → AUTH_URL so NextAuth can build the correct redirect URI
if (!process.env.AUTH_URL && process.env.APP_URL) {
  process.env.AUTH_URL = process.env.APP_URL
}

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    {
      id: "oidc",
      name: "ログイン",
      type: "oidc",
      issuer: process.env.OIDC_ISSUER!,
      clientId: process.env.OIDC_CLIENT_ID!,
      clientSecret: process.env.OIDC_CLIENT_SECRET!,
      checks: ["pkce", "state"],
    },
  ],

  pages: {
    signIn: "/login",
  },

  callbacks: {
    signIn({ profile }) {
      if (!profile?.sub) return false
      const displayName = String(
        profile.name ?? profile.preferred_username ?? profile.email ?? profile.sub
      )
      db.prepare(`
        INSERT INTO users (id, display_name) VALUES (?, ?)
        ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name
      `).run(profile.sub, displayName)
      return true
    },

    jwt({ token, profile }) {
      if (profile) {
        token.sub = profile.sub as string
        token.displayName = String(
          profile.name ?? profile.preferred_username ?? profile.email ?? profile.sub
        )
      }
      return token
    },

    session({ session, token }) {
      session.user.id = token.sub!
      session.user.name = (token.displayName ?? token.name) as string
      return session
    },
  },
})
