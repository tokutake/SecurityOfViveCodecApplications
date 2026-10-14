import { createFileRoute } from '@tanstack/react-router'
import { cookie,cookieHeader,db } from '../server'
import { createHash } from 'node:crypto'
export const Route=createFileRoute('/auth/logout')({server:{handlers:{GET:async({request})=>{const sid=cookie(request,'sid');if(sid)db.prepare('DELETE FROM sessions WHERE id=?').run(createHash('sha256').update(sid).digest('base64url'));return new Response(null,{status:302,headers:{location:'/', 'set-cookie':cookieHeader('sid','',0,process.env.APP_URL?.startsWith('https://')||false),'cache-control':'no-store'}})}}}})
