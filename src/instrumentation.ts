// Runs once when the server starts (Next.js instrumentation hook). Tracing
// of AI calls is registered on the Node.js runtime only, and only when
// AI_TRACING is on (src/lib/ai/tracing.ts).
export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerTracing } = await import("./lib/ai/tracing");
  await registerTracing();
}
