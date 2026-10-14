import type { ReactNode } from "react";
import "./globals.css";
import { getUser } from "@/lib/auth";
import { logout } from "./actions";

export const metadata = { title: "マイクロSNS" };
export const dynamic = "force-dynamic";

export default async function RootLayout({ children }: { children: ReactNode }) {
  const user = await getUser();
  return (
    <html lang="ja">
      <body>
        <header>
          <a href="/" className="brand">マイクロSNS</a>
          {user && (
            <nav>
              <a href="/">タイムライン</a>
              <a href="/groups">DMグループ</a>
              <span className="who">{user.displayName}</span>
              <form action={logout}><button className="link">ログアウト</button></form>
            </nav>
          )}
        </header>
        <main>{children}</main>
      </body>
    </html>
  );
}
