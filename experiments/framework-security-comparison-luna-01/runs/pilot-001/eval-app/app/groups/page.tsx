import { requireUser } from "@/lib/auth";
import { MAX_GROUP_NAME, listGroups, listOtherUsers } from "@/lib/data";
import { createGroupAction } from "../actions";

export const dynamic = "force-dynamic";

export default async function Groups() {
  const user = await requireUser();
  const groups = listGroups(user.sub);
  const others = listOtherUsers(user.sub);
  return (
    <>
      <h2>DMグループ</h2>
      <form action={createGroupAction} className="card">
        <input type="text" name="name" maxLength={MAX_GROUP_NAME} required placeholder="グループ名" />
        <fieldset>
          <legend>メンバー（一度ログインしたユーザー）</legend>
          {others.map((u) => (
            <label key={u.sub} style={{ display: "block" }}>
              <input type="checkbox" name="members" value={u.sub} /> {u.displayName}
            </label>
          ))}
          {others.length === 0 && <span>他のユーザーはまだいません。</span>}
        </fieldset>
        <button>グループを作成</button>
      </form>
      {groups.map((g) => (
        <div key={g.id} className="card"><a href={`/groups/${g.id}`}>{g.name}</a></div>
      ))}
    </>
  );
}
