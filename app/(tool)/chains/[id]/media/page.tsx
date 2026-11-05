import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { getChain, isMissingTable, signedUrls } from "@/lib/data";
import { RUN_BUCKET } from "@/lib/runs";
import { serviceClient } from "@/lib/supabase/service";
import { captionList, when } from "@/lib/format";
import { MigrationNotice } from "@/components/MigrationNotice";
export const metadata: Metadata = { title: "Media" };

type Run = { id: string; image_path: string; status: string; captions: unknown; final_output: string | null; direction: string | null; prompt_version: string; created_at: string };
type MemberRun = { id: string; image_id: string; image_path: string; caption_candidates: unknown; created_at: string };

// Everything this chain has produced: tool runs, plus member posts generated
// with its prompt version (by the member app).
export default async function Media({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const found = await getChain(id);
  if (!found) notFound();
  const db = serviceClient();
  const [runs, members] = await Promise.all([
    db.from("humor_chain_runs").select("id,image_path,status,captions,final_output,direction,prompt_version,created_at").eq("chain_id", id).order("created_at", { ascending: false }).limit(60),
    db.from("humor_generations").select("id,image_id,image_path,caption_candidates,created_at").eq("prompt_version", found.chain.prompt_version).eq("status", "completed").order("created_at", { ascending: false }).limit(24),
  ]);
  if (runs.error && !isMissingTable(runs.error)) throw new Error(runs.error.message);
  const runRows = (runs.data ?? []) as Run[];
  const memberRows = (members.data ?? []) as MemberRun[];
  const [runUrls, memberUrls, posts] = await Promise.all([
    signedUrls(db, RUN_BUCKET, runRows.map((r) => r.image_path)),
    signedUrls(db, "humor-images", memberRows.map((r) => r.image_path)),
    memberRows.length ? db.from("humor_captions").select("image_id,content,deleted_at").in("image_id", memberRows.map((r) => r.image_id)).eq("source", "ai") : { data: [] },
  ]);
  const published = new Map(((posts.data ?? []) as { image_id: string; content: string; deleted_at: string | null }[]).map((p) => [p.image_id, p]));
  return (
    <div className="stack">
      {runs.error && <MigrationNotice />}
      <section className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="section-title">Generated in this tool <span className="muted num">{runRows.length}</span></h2>
          <Link className="btn btn-primary btn-sm" href={`/chains/${id}/run`}>Generate</Link>
        </div>
        {runRows.length ? (
          <div className="gallery">
            {runRows.map((r) => {
              const caps = captionList(r.captions);
              return (
                <Link key={r.id} href={`/runs/${r.id}`} className="card flat gallery-item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                  {runUrls[r.image_path] ? <img src={runUrls[r.image_path]} alt="" className="gallery-image" /> : <span className="gallery-image" />}
                  <div className="row">
                    <span className={`badge ${r.status === "completed" ? "badge-good" : r.status === "failed" ? "badge-bad" : "badge-warn"}`}>{r.status}</span>
                    <span className="muted" style={{ fontSize: 12 }}>{when(r.created_at)}</span>
                  </div>
                  {caps.length ? <ol className="captions">{caps.slice(0, 5).map((c, i) => <li key={i}>{c.caption}</li>)}</ol>
                    : r.final_output ? <p className="clip" style={{ margin: 0, fontSize: 13 }}>{r.final_output}</p>
                    : <p className="muted" style={{ margin: 0, fontSize: 13 }}>{r.status === "failed" ? "Stopped at a failed step." : "Not finished."}</p>}
                  {r.direction && <span className="muted" style={{ fontSize: 12 }}>Direction: {r.direction}</span>}
                </Link>
              );
            })}
          </div>
        ) : <p className="card flat empty">Nothing generated with this chain yet. <Link href={`/chains/${id}/run`}>Run it on a photo →</Link></p>}
      </section>
      <section className="stack-sm">
        <h2 className="section-title">Member posts with <span className="mono">{found.chain.prompt_version}</span> <span className="muted num">{memberRows.length}</span></h2>
        <p className="muted" style={{ margin: 0 }}>Captions the member app generated with this chain&apos;s prompt version, and the one the member published.</p>
        {memberRows.length ? (
          <div className="gallery">
            {memberRows.map((r) => {
              const post = published.get(r.image_id);
              return (
                <div key={r.id} className="card flat gallery-item">
                  {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                  {memberUrls[r.image_path] ? <img src={memberUrls[r.image_path]} alt="" className="gallery-image" /> : <span className="gallery-image" />}
                  <div className="row">
                    {post ? <span className={`badge ${post.deleted_at ? "badge-bad" : "badge-good"}`}>{post.deleted_at ? "Deleted post" : "Published"}</span> : <span className="badge">Not published</span>}
                    <span className="muted" style={{ fontSize: 12 }}>{when(r.created_at)}</span>
                  </div>
                  {post && <b style={{ fontSize: 13 }}>{post.content}</b>}
                  <ol className="captions">{captionList(r.caption_candidates).map((c, i) => <li key={i}>{c.caption}</li>)}</ol>
                </div>
              );
            })}
          </div>
        ) : <p className="card flat empty">No member generations recorded with this prompt version.</p>}
      </section>
    </div>
  );
}
