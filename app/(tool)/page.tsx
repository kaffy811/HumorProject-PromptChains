import type { Metadata } from "next";
import Link from "next/link";
import { requireSuperadmin } from "@/lib/auth";
import { chainProblems } from "@/lib/chain-rules";
import { dashboardData, isMissingTable } from "@/lib/data";
import { captionList, seconds, when } from "@/lib/format";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { runStats } from "@/lib/stats";
import { ChainCard } from "@/components/ChainCard";
import { MigrationNotice } from "@/components/MigrationNotice";
export const metadata: Metadata = { title: "Dashboard" };

export default async function Dashboard() {
  const me = await requireSuperadmin();
  const data = await dashboardData();
  if (data.error && !isMissingTable(data.error)) throw new Error(data.error.message);
  const stats = runStats(data.runs, data.steps);
  const peak = Math.max(1, ...stats.days.map((d) => d.runs));
  const change = stats.runsWeek - stats.runsLastWeek;
  const ready = data.chains.filter((c) => !chainProblems(c.steps, SUPPORTED_PROVIDERS).some((p) => p.blocking)).length;
  const members = data.chains.find((c) => c.share === 100);
  return (
    <div className="stack">
      <header className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <span className="eyebrow">Dashboard</span>
          <h1>{`Hi${me.name ? `, ${me.name.split(" ")[0]}` : ""}.`}</h1>
          <p>Build a chain of LLM steps (look at the photo, find the joke, write the captions), run it on real photos and compare what comes out.</p>
        </div>
        <Link className="btn btn-primary" href="/chains?new=1">+ New prompt chain</Link>
      </header>
      {!data.runsReady && <MigrationNotice />}
      <section className="stat-grid" aria-label="Last 7 days">
        <Stat label="Prompt chains" value={String(data.chains.length)} note={`${ready} ready to run`} />
        <Stat label="Runs, last 7 days" value={String(stats.runsWeek)} note={change === 0 ? "same as the week before" : `${change > 0 ? "+" : ""}${change} vs the week before`} />
        <Stat label="Success rate" value={stats.successRate === null ? "—" : `${Math.round(stats.successRate * 100)}%`} note="finished runs, last 7 days" />
        <Stat label="Tokens, last 7 days" value={stats.tokensWeek.toLocaleString("en-US")} note={`median run ${seconds(stats.medianMs)}`} />
      </section>
      <section className="grid grid-2">
        <div className="card">
          <h2>Runs per day</h2>
          <p className="sub">Last 7 days; failed runs in dark.</p>
          <div className="day-bars" role="img" aria-label={stats.days.map((d) => `${d.date}: ${d.runs} runs, ${d.failed} failed`).join("; ")}>
            {stats.days.map((d) => (
              <div key={d.date} className="day-bar" title={`${d.date}: ${d.runs} runs, ${d.failed} failed`}>
                <div className="day-bar-track">
                  <div className="day-bar-fill" style={{ height: `${(d.runs / peak) * 100}%` }}>
                    {d.failed > 0 && <div className="day-bar-failed" style={{ height: `${(d.failed / d.runs) * 100}%` }} />}
                  </div>
                </div>
                <span className="num">{d.runs}</span>
                <span className="muted">{new Date(`${d.date}T12:00:00Z`).toLocaleDateString("en-US", { weekday: "short" })}</span>
              </div>
            ))}
          </div>
        </div>
        <div className="card">
          <h2>For members</h2>
          <p className="sub">The chain the member app uses (chosen in Humor Admin).</p>
          {members ? (
            <div className="stack-sm">
              <Link href={`/chains/${members.id}`} className="chain-card-title">{members.name}</Link>
              <span className="mono muted">{members.prompt_version}</span>
              <span className="muted" style={{ fontSize: 13 }}>{members.steps.map((s) => s.modelLabel ?? "no model").join(" → ")}</span>
            </div>
          ) : <p className="empty">No single chain is set for members; they get the built-in Gemini prompt.</p>}
        </div>
      </section>
      <section className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="section-title">Recent runs</h2>
          {data.recent.length > 0 && <span className="muted" style={{ fontSize: 13 }}>Latest {data.recent.length}</span>}
        </div>
        {data.recent.length ? (
          <div className="recent-runs">
            {data.recent.map((r) => (
              <Link key={r.id} href={`/runs/${r.id}`} className="card flat recent-run">
                {/* eslint-disable-next-line @next/next/no-img-element -- signed private URL */}
                {data.thumbs[r.image_path] ? <img src={data.thumbs[r.image_path]} alt="" className="gallery-image" /> : <span className="gallery-image" />}
                <span className="row"><span className={`badge ${r.status === "completed" ? "badge-good" : r.status === "failed" ? "badge-bad" : "badge-warn"}`}>{r.status}</span></span>
                <b className="clip" style={{ fontSize: 13 }}>{captionList(r.captions)[0]?.caption ?? r.chain_name}</b>
                <span className="muted" style={{ fontSize: 12 }}>{r.chain_name} · {when(r.created_at)}</span>
              </Link>
            ))}
          </div>
        ) : <p className="card flat empty">No runs yet. Open a chain and press Generate.</p>}
      </section>
      <section className="stack-sm">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 className="section-title">Prompt chains</h2>
          <Link href="/chains" className="muted">All {data.chains.length} →</Link>
        </div>
        <div className="chain-grid">
          {data.chains.slice(0, 4).map((c) => <ChainCard key={c.id} chain={c} blocking={chainProblems(c.steps, SUPPORTED_PROVIDERS).filter((p) => p.blocking).length} />)}
        </div>
        {!data.chains.length && <p className="card flat empty">No prompt chains yet. <Link href="/chains?new=1">Create one →</Link></p>}
      </section>
    </div>
  );
}

function Stat({ label, value, note }: { label: string; value: string; note: string }) {
  return (
    <div className="card stat">
      <span className="eyebrow">{label}</span>
      <span className="stat-value num">{value}</span>
      <span className="muted" style={{ fontSize: 12 }}>{note}</span>
    </div>
  );
}
