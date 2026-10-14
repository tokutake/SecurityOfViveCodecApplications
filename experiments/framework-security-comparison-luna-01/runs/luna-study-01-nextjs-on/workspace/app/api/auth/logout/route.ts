import { NextRequest,NextResponse } from 'next/server'
import { logout } from '@/lib/auth'
export async function POST(req:NextRequest){if(req.headers.get('origin')!==new URL(process.env.APP_URL!).origin)return NextResponse.json({error:'Invalid origin'},{status:403});await logout();return NextResponse.json({ok:true})}
