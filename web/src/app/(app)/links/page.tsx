import { asc } from "drizzle-orm";
import { db, t } from "@/db";
import { addLink, deleteLink } from "@/lib/actions";
import { Empty, PageHeader } from "@/components/ui";

export default async function Links() {
  const rows = await db.select().from(t.links).orderBy(asc(t.links.category), asc(t.links.title));
  const groups = Object.groupBy(rows, (r) => r.category);

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader title="Useful links" sub="Scholarship portals, application pages, visa info, anything worth keeping." />
      <form action={addLink} className="card mb-6 grid gap-2 p-3 md:grid-cols-5">
        <input name="title" required placeholder="Title" className="input md:col-span-1" />
        <input name="url" required type="url" placeholder="https://…" className="input md:col-span-2" />
        <input name="category" placeholder="Category (e.g. Scholarships)" className="input" />
        <button className="btn">Add link</button>
        <input name="notes" placeholder="Notes (optional)" className="input md:col-span-5" />
      </form>
      {rows.length === 0 ? (
        <div className="card"><Empty>No links yet.</Empty></div>
      ) : (
        Object.entries(groups).map(([cat, items]) => (
          <section key={cat} className="card mb-4">
            <h2 className="border-b border-line px-4 py-3 font-medium">{cat}</h2>
            <ul className="divide-y divide-line">
              {items!.map((l) => (
                <li key={l.id} className="flex items-start gap-3 px-4 py-3 text-sm">
                  <div className="min-w-0 flex-1">
                    <a href={l.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">{l.title}</a>
                    {l.notes && <p className="text-xs text-muted">{l.notes}</p>}
                  </div>
                  <form action={deleteLink.bind(null, l.id)}>
                    <button className="text-xs text-muted hover:text-critical">Remove</button>
                  </form>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  );
}
