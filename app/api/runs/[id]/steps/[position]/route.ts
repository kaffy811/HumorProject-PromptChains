import type { NextRequest } from "next/server";
import { failure, guard, json } from "@/lib/api";
import { runStep } from "@/lib/runs";
export const dynamic = "force-dynamic";
// One model call per request, so a long chain never hits the function time limit.
export const maxDuration = 60;

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string; position: string }> }) {
  const { me, response } = await guard(request);
  if (!me) return response;
  try {
    const { id, position } = await params;
    return json(await runStep(me.id, id, Number(position)));
  } catch (error) {
    return failure(error);
  }
}
