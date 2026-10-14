import { notFound } from "next/navigation";
import { requireUser } from "@/lib/auth";
import { MAX_BODY, getGroupForMember } from "@/lib/data";
import { sendMessageAction } from "../../actions";
import { EntryCard } from "../../entry";

export const dynamic = "force-dynamic";

export default async function GroupPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  if (!/^\d+$/.test(id)) notFound();
  const group = getGroupForMember(Number(id), user.sub);
  if (!group) notFound();
  return (
    <>
      <h2>{group.name}</h2>
      <p className="meta">メンバー: {group.members.join("、")}</p>
      <form action={sendMessageAction.bind(null, group.id)} className="card">
        <textarea name="body" rows={2} maxLength={MAX_BODY} required placeholder="メッセージ" />
        <div className="row"><span /><button>送信</button></div>
      </form>
      {[...group.messages].reverse().map((m) => <EntryCard key={m.id} e={m} />)}
      {group.messages.length === 0 && <p>まだメッセージがありません。</p>}
    </>
  );
}
