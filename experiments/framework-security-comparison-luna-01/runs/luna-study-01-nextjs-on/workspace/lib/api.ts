import { NextRequest, NextResponse } from 'next/server'
import { requireUser } from './auth'
export async function guarded(req:NextRequest, fn:()=>Promise<unknown>, mutating=false){try{const origin=req.headers.get('origin');if(mutating?origin!==new URL(process.env.APP_URL!).origin:!!origin&&origin!==new URL(process.env.APP_URL!).origin)return NextResponse.json({error:'Invalid origin'},{status:403});await requireUser();return NextResponse.json(await fn())}catch(e){const msg=e instanceof Error?e.message:'Request failed';return NextResponse.json({error:msg==='UNAUTHORIZED'?'Sign in required':'Request failed'},{status:msg==='UNAUTHORIZED'?401:400})}}
export function body(req:NextRequest){return req.json() as Promise<Record<string,unknown>>}
