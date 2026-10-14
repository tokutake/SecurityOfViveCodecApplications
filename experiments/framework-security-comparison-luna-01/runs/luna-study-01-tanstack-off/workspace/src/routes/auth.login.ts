import { createFileRoute } from '@tanstack/react-router'
import { loginUrl } from '../server/auth'
export const Route = createFileRoute('/auth/login')({ server:{ handlers:{ GET: async ({request})=>Response.redirect(await loginUrl(request.url),302) } } })
