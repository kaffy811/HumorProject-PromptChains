import Link from "next/link";
export default function NotFound() {
  return (
    <main className="login">
      <div className="card login-card">
        <h1 style={{ margin: 0, fontSize: 22 }}>Not found</h1>
        <p className="muted" style={{ margin: 0 }}>That prompt chain or run does not exist.</p>
        <Link className="btn" href="/chains">All prompt chains</Link>
      </div>
    </main>
  );
}
