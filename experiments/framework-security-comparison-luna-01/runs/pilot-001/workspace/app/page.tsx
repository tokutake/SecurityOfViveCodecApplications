import { getUser } from "@/lib/auth";
import { MAX_BODY, listTimeline } from "@/lib/data";
import { postAction } from "./actions";
import { EntryCard } from "./entry";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getUser();
  if (!user) {
    return (
      <div className="center">
        <h1>マイクロSNS</h1>
        <p><a href="/auth/login"><button>OIDC でログイン</button></a></p>
      </div>
    );
  }
  const posts = listTimeline(user.sub);
  return (
    <>
      <form action={postAction} className="card">
        <textarea name="body" rows={3} maxLength={MAX_BODY} required placeholder="いまどうしてる？" />
        <div className="row">
          <label><input type="checkbox" name="private" /> 非公開（自分だけ）</label>
          <button>投稿</button>
        </div>
      </form>
      {posts.map((p) => <EntryCard key={p.id} e={p} />)}
      {posts.length === 0 && <p>まだ投稿がありません。</p>}
    </>
  );
}
