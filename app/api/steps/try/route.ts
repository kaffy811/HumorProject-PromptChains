import type { NextRequest } from "next/server";
import { failure, guard, json } from "@/lib/api";
import { tryStep } from "@/lib/try-step";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// "Test this step" in the step editor: one model call, nothing saved.
export async function POST(request: NextRequest) {
  const { me, response } = await guard(request);
  if (!me) return response;
  try {
    return json(await tryStep(await request.formData()));
  } catch (error) {
    return failure(error);
  }
}
