import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import type { ReactNode } from 'react'
import '../styles.css'
export const Route = createRootRoute({ head: () => ({ meta: [{ charSet: 'utf-8' }, { name: 'viewport', content: 'width=device-width, initial-scale=1' }, { title: 'mori — 小さな広場' }, { name: 'description', content: '気軽につながる、小さなSNS' }] }), component: () => <html lang="ja"><head><HeadContent /></head><body><Outlet /><Scripts /></body></html> })
