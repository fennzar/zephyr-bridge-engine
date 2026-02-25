import { env } from "@shared";

export type DbStatus =
  | { state: "ok"; latencyMs: number }
  | { state: "missing"; reason: string }
  | { state: "error"; reason: string };

export async function getDatabaseStatus(): Promise<DbStatus> {
  const url = env.DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) {
    return { state: "missing", reason: "DATABASE_URL not configured" };
  }

  try {
    const start = Date.now();
    const { prisma } = await import("@infra");
    await prisma.$queryRaw`SELECT 1`;
    return { state: "ok", latencyMs: Date.now() - start };
  } catch (error) {
    const reason = error instanceof Error ? error.message : "Unknown error";
    return { state: "error", reason };
  }
}

export function DbStatusIndicator({ status }: { status: DbStatus }) {
  let color = "#f7ad4c";
  let label = "Not Configured";
  let detail = "";

  if (status.state === "ok") {
    color = "#16c784";
    label = "DB Connected";
    detail = `Latency ~${Math.max(status.latencyMs, 1).toFixed(0)} ms`;
  } else if (status.state === "error") {
    color = "#f45b69";
    label = "DB Error";
    detail = status.reason;
  } else {
    color = "#f7ad4c";
    detail = status.reason;
  }

  return (
    <div
      style={{ display: "flex", alignItems: "center", gap: 10, fontSize: 13 }}
    >
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: "50%",
          background: color,
          boxShadow: `0 0 6px ${color}88`,
        }}
      />
      <span style={{ fontWeight: 600 }}>{label}</span>
      {detail && <span style={{ opacity: 0.7, fontSize: 12 }}>{detail}</span>}
    </div>
  );
}
