import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { restoreVersion } from "@/lib/actions";
import { getChain, modelOptions } from "@/lib/data";
import { listVersions } from "@/lib/versions";
import { diffSnapshots, snapshotSummary, type FieldChange } from "@/lib/version-diff";
import { when } from "@/lib/format";
import { ActionForm } from "@/components/ActionForm";
export const metadata: Metadata = { title: "History" };

// Every saved change to the chain, what changed between two versions, and restore.
export default async function History({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ a?: string; b?: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const query = await searchParams;
  const [found, models, { ready, versions }] = await Promise.all([getChain(id), modelOptions(), listVersions(id)]);
  if (!found) notFound();
  if (!ready) return (
    <div className="notice notice-warn" role="status">
      Version history needs <span className="mono">supabase/migrations/202611060002_prompt_chain_versions.sql</span> from kaffy811/HumorProject. Run it in the Supabase SQL editor, then reload.
    </div>
  );
  const labels = new Map(models.map((m) => [m.id, m.label]));
  const modelName = (mid: string | null) => (mid ? labels.get(mid) ?? "deleted model" : "no model");
  const latest = versions[0];
  // Default comparison: the latest version against the one before it.
  const pick = (v: string | undefined, fallback: number | undefined) => versions.find((x) => x.version === Number(v)) ?? versions.find((x) => x.version === fallback);
  const after = pick(query.b, latest?.version);
  const before = pick(query.a, after ? versions.find((x) => x.version < after.version)?.version : undefined);
  const diff = before && after ? diffSnapshots(before.snapshot, after.snapshot, modelName) : null;
  return (
    <div className="stack">
      <section className="card">
        <h2>{diff && before && after ? `Version ${before.version} → ${after.version}` : "Changes"}</h2>
        {!versions.length ? <p className="empty">No versions yet. Every save in Edit steps adds one.</p>
          : !diff ? <p className="sub">Only one version so far: version {latest.version}, {latest.label.toLowerCase()}. The next change adds version {latest.version + 1}.</p>
          : diff.same ? <p className="sub">These two versions are identical.</p> : (
            <div className="stack-sm">
              {diff.chain.length > 0 && <div className="diff-block"><h3>Chain details</h3>{diff.chain.map((c) => <Change key={c.field} change={c} />)}</div>}
              {diff.steps.map((s) => (
                <div key={`${s.kind}-${s.position}`} className="diff-block">
                  <h3>Step {s.position} · {s.name} {s.kind !== "changed" && <span className={`badge ${s.kind === "added" ? "badge-good" : "badge-bad"}`}>{s.kind}</span>}</h3>
                  {s.kind === "changed" && s.fields.map((c) => <Change key={c.field} change={c} />)}
                </div>
              ))}
            </div>
          )}
      </section>
      <section className="card">
        <h2>Versions</h2>
        <p className="sub">A version is saved after every change in this tool. Restore puts the name, description and steps back (the prompt version stays, since posts and runs are linked to it); the state before the restore is kept as a version too.</p>
        <div className="table-wrap">
          <table>
            <thead><tr><th>Version</th><th>Change</th><th>Steps</th><th>By</th><th>When</th><th></th></tr></thead>
            <tbody>
              {versions.map((v, i) => {
                const prev = versions[i + 1];
                const current = i === 0;
                return (
                  <tr key={v.id} aria-current={after?.id === v.id ? "true" : undefined}>
                    <td className="mono">v{v.version}{current && <span className="badge badge-brand" style={{ marginLeft: 6 }}>current</span>}</td>
                    <td>{v.label}</td>
                    <td className="muted">{snapshotSummary(v.snapshot, modelName)}</td>
                    <td className="muted">{v.author ?? "migration"}</td>
                    <td className="muted">{when(v.created_at)}</td>
                    <td>
                      <div className="row">
                        {prev && <Link className="btn btn-sm" href={`?a=${prev.version}&b=${v.version}`}>Changes</Link>}
                        {!current && <Link className="btn btn-sm" href={`?a=${v.version}&b=${latest.version}`}>vs current</Link>}
                        {!current && (
                          <ActionForm action={restoreVersion} submit="Restore" pendingLabel="Restoring…" className="inline-form" confirm={`Restore version ${v.version}? The current steps are replaced; the current state is kept as a version.`}>
                            <input type="hidden" name="chain_id" value={id} />
                            <input type="hidden" name="version_id" value={v.id} />
                          </ActionForm>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

function Change({ change }: { change: FieldChange }) {
  return (
    <div className="diff-field">
      <span className="label">{change.field}</span>
      {change.lines ? (
        <pre className="prompt diff">{change.lines.map((l, i) => <span key={i} className={`diff-${l.kind}`}>{l.kind === "added" ? "+ " : l.kind === "removed" ? "− " : "  "}{l.text}{"\n"}</span>)}</pre>
      ) : (
        <p className="diff-inline"><del>{change.before || "(empty)"}</del> → <ins>{change.after || "(empty)"}</ins></p>
      )}
    </div>
  );
}
