import './style.css'
import type { ReactNode } from 'react'
export const metadata={title:'Quietline — 小さなSNS',description:'公開投稿とプライベートな会話をひとつに。'}
export default function Layout({children}:{children:ReactNode}){return <html lang="ja"><body>{children}</body></html>}
