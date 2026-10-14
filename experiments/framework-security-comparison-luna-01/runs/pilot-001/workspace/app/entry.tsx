import type { Entry } from "@/lib/data";

const fmt = new Intl.DateTimeFormat("ja-JP", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Tokyo",
});

export function EntryCard({ e }: { e: Entry }) {
  return (
    <article className="card">
      <div className="meta">
        <strong>{e.authorName}</strong>
        <time dateTime={new Date(e.createdAt).toISOString()}>{fmt.format(e.createdAt)}</time>
        {e.isPrivate && <span className="badge">非公開</span>}
      </div>
      <div className="body">{e.body}</div>
    </article>
  );
}
