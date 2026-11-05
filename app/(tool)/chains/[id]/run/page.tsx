import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { requireSuperadmin } from "@/lib/auth";
import { chainProblems } from "@/lib/chain-rules";
import { getChain, signedUrls } from "@/lib/data";
import { SUPPORTED_PROVIDERS } from "@/lib/llm";
import { serviceClient } from "@/lib/supabase/service";
import { RunPanel } from "@/components/RunPanel";
export const metadata: Metadata = { title: "Generate" };

export default async function Run({ params }: { params: Promise<{ id: string }> }) {
  await requireSuperadmin();
  const { id } = await params;
  const found = await getChain(id);
  if (!found) notFound();
  const db = serviceClient();
  // Recent live member posts whose photo can be reused for a run.
  const { data } = await db.from("humor_captions").select("id,content,humor_images!inner(storage_path,status)")
    .is("deleted_at", null).eq("humor_images.status", "ready").order("created_at", { ascending: false }).limit(12);
  const rows = (data ?? []) as unknown as { id: string; content: string; humor_images: { storage_path: string | null } }[];
  const urls = await signedUrls(db, "humor-images", rows.map((r) => r.humor_images.storage_path));
  const blocked = chainProblems(found.steps, SUPPORTED_PROVIDERS).filter((p) => p.blocking).map((p) => (p.position ? `Step ${p.position}: ${p.message}` : p.message));
  return <RunPanel chainId={id} blocked={blocked} posts={rows.map((r) => ({ id: r.id, content: r.content, url: r.humor_images.storage_path ? urls[r.humor_images.storage_path] ?? null : null }))} />;
}
