import type { NextRequest } from "next/server";
import { failure, guard, json } from "@/lib/api";
import { startRun } from "@/lib/runs";
export const dynamic = "force-dynamic";

// Starts a run: multipart form with chain_id, direction and either image or caption_id.
export async function POST(request: NextRequest) {
  const { me, response } = await guard(request);
  if (!me) return response;
  try {
    const form = await request.formData();
    const upload = form.get("image");
    const result = await startRun(me.id, {
      chainId: String(form.get("chain_id") ?? ""),
      direction: String(form.get("direction") ?? ""),
      upload: upload instanceof File && upload.size ? upload : null,
      captionId: String(form.get("caption_id") ?? "") || null,
      modelOverride: String(form.get("model_override") ?? "") || null,
    });
    return json(result, 201);
  } catch (error) {
    return failure(error);
  }
}
