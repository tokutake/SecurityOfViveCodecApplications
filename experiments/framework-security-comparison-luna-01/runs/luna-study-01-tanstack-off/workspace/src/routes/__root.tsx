import { createRootRoute, HeadContent, Outlet, Scripts } from '@tanstack/react-router'
import '../style.css'
export const Route = createRootRoute({ head:()=>({meta:[{charSet:'utf-8'},{name:'viewport',content:'width=device-width, initial-scale=1'},{title:'こえ — 小さなSNS'}]}), component:()=> <Root/> })
function Root(){return <html lang="ja"><head><HeadContent/></head><body><Outlet/><Scripts/></body></html>}
