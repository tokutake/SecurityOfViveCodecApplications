import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"
import { upsertUser } from "@/lib/db"

export const { handlers, signIn, signOut, auth } = NextAuth({
  ...authConfig,
  callbacks: {
    ...authConfig.callbacks,
    async jwt({ token, account, profile }) {
      if (account && profile) {
        const sub = profile.sub
        if (!sub) throw new Error("OIDC profile missing sub claim")
        const displayName =
          (profile as Record<string, unknown>).name as string ||
          (profile as Record<string, unknown>).preferred_username as string ||
          (profile as Record<string, unknown>).email as string ||
          "User"
        token.sub = sub
        token.displayName = displayName
        upsertUser(sub, displayName)
      }
      return token
    },
    async session({ session, token }) {
      session.user.id = token.sub!
      session.user.name =
        (token.displayName as string | undefined) ?? session.user.name
      return session
    },
  },
})
