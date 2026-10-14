import { createFileRoute } from '@tanstack/react-router'
import { beginLogin,cookieHeader } from '../server'
export const Route=createFileRoute('/auth/login')({server:{handlers:{GET:async()=>{try{const {url,stateCookie}=await beginLogin();return new Response(null,{status:302,headers:{location:url,'set-cookie':cookieHeader('oidc_tx',stateCookie,600,process.env.APP_URL?.startsWith('https://')||false),'cache-control':'no-store'}})}catch{return new Response('OIDC login could not be started. Check server configuration.',{status:500})}}}}})
