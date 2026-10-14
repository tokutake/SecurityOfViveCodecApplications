import type { Metadata } from 'next';
import './style.css';
export const metadata: Metadata = { title: '小さなSNS', description: '公開投稿とプライベートな会話' };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) { return <html lang="ja"><body>{children}</body></html>; }
