import { fal } from "npm:@fal-ai/client@^1";

Deno.serve(async (req) => {
  if (req.method !== "POST") {
    return Response.json({ error: "Method not allowed" }, { status: 405 });
  }

  const body = await req.json();
  const { job_id, model_id } = body;

  if (!job_id || typeof job_id !== "string" || job_id.length > 200) {
    return Response.json({ error: "Invalid job_id" }, { status: 400 });
  }
  if (!model_id || typeof model_id !== "string") {
    return Response.json({ error: "Invalid model_id" }, { status: 400 });
  }

  fal.config({ credentials: (Deno.env.get("FAL_KEY") || "").trim() });

  try {
    const status = await fal.queue.status(model_id, {
      requestId: job_id,
      logs: false,
    });

    if (status.status === "COMPLETED") {
      const result = await fal.queue.result(model_id, { requestId: job_id });

      const videoUrl =
        result.data?.video?.url ||
        result.data?.video_url ||
        result.data?.output?.video_url ||
        null;

      const imageUrl =
        result.data?.images?.[0]?.url ||
        result.data?.image?.url ||
        null;

      return Response.json({
        status: "COMPLETED",
        video_url: videoUrl,
        image_url: imageUrl,
      });
    }

    if (status.status === "FAILED") {
      return Response.json({
        status: "FAILED",
        error: "Generation failed. Please try again.",
      });
    }

    return Response.json({
      status: status.status,
      queue_position: status.queue_position || null,
    });

  } catch (error) {
    console.error("Status check error:", error.message);
    return Response.json({ status: "ERROR", error: "Could not check status. Please try again." }, { status: 500 });
  }
});