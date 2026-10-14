import { NextResponse } from 'next/server'
import { loginUrl } from '@/lib/auth'
export const runtime='nodejs'
export async function GET(){try{return NextResponse.redirect(await loginUrl())}catch{return NextResponse.json({error:'OIDC login is not configured correctly'},{status:503})}}
