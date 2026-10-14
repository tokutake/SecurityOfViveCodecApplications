import { createFileRoute } from '@tanstack/react-router'
import { handleCallback } from '../server/auth'
import { db } from '../server/db'
export const Route = createFileRoute('/auth/callback')({ server:{ handlers:{ GET: async ({request})=>{ try { const user=await handleCallback(request); db.prepare('INSERT INTO users(sub,name) VALUES(?,?) ON CONFLICT(sub) DO UPDATE SET name=excluded.name').run(user.sub,user.name); return Response.redirect(new URL('/',request.url),302) } catch(e) { return new Response(`Login failed: ${e instanceof Error?e.message:'unknown error'}`,{status:400}) } } } } })
