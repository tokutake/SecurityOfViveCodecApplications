import { NextRequest,NextResponse } from 'next/server'
import { completeLogin } from '@/lib/auth'
export const runtime='nodejs'
export async function GET(req:NextRequest){try{await completeLogin(new URL(req.url));return NextResponse.redirect(new URL('/',process.env.APP_URL))}catch{return NextResponse.redirect(new URL('/?auth_error=1',process.env.APP_URL))}}
