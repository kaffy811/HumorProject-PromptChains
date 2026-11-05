import Link from "next/link";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { UUID } from "@/lib/chain-rules";
import { getChain } from "@/lib/data";
import { ChainTabs } from "@/components/ChainTabs";
export default async function ChainLayout({ children, params }: { children: React.ReactNode; params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  if (!UUID.test(id)) notFound();
  const found = await getChain(id);
  if (!found) notFound();
  const { chain, steps } = found;
  return (
    <div>
      <Link href="/" className="back">← All prompt chains</Link>
      <header className="page-head" style={{ marginBottom: 16 }}>
        <div>
          <span className="eyebrow">Prompt chain · <span className="mono">{chain.prompt_version}</span> · {steps.length} step{steps.length === 1 ? "" : "s"}</span>
          <h1>{chain.name}</h1>
          {chain.description && <p>{chain.description}</p>}
        </div>
        {chain.share === 100 && <span className="badge badge-brand">Members use this chain</span>}
      </header>
      <ChainTabs id={id} />
      {children}
    </div>
  );
}
