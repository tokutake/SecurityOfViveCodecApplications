import { createFileRoute } from '@tanstack/react-router'
import { logout } from '../server/auth'
export const Route = createFileRoute('/auth/logout')({ server:{ handlers:{ POST: async ({request})=>{ logout(); return Response.redirect(new URL('/',request.url),303) } } } })
