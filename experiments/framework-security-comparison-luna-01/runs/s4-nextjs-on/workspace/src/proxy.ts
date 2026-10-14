import NextAuth from "next-auth"
import { authConfig } from "@/auth.config"

// Use Edge-compatible config (no Node.js imports via db.ts)
export default NextAuth(authConfig).auth

export const config = {
  matcher: ["/((?!api/auth|_next/static|_next/image|favicon\\.ico).*)"],
}
