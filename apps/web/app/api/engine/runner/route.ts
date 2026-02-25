import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@infra";
import { parseJsonBody } from "../../_lib/parseBody";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

async function getOrCreateSettings() {
  return prisma.engineSettings.upsert({
    where: { id: "singleton" },
    update: {},
    create: { id: "singleton" },
  });
}

/**
 * GET /api/engine/runner
 * Returns current runner settings (autoExecute, manualApproval, cooldownMs)
 */
export async function GET() {
  try {
    const settings = await getOrCreateSettings();
    return NextResponse.json({
      autoExecute: settings.autoExecute,
      manualApproval: settings.manualApproval,
      cooldownMs: settings.cooldownMs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to fetch runner settings" },
      { status: 500 },
    );
  }
}

const RunnerUpdateSchema = z.object({
  autoExecute: z.boolean().optional(),
  manualApproval: z.boolean().optional(),
  cooldownMs: z.number().int().min(1000).max(600_000).optional(),
});

/**
 * POST /api/engine/runner
 * Update runner settings (autoExecute, cooldownMs)
 */
export async function POST(request: Request) {
  const parsed = await parseJsonBody(request, RunnerUpdateSchema);
  if ("error" in parsed) return parsed.error;

  const { autoExecute, manualApproval, cooldownMs } = parsed.data;

  if (autoExecute === undefined && manualApproval === undefined && cooldownMs === undefined) {
    return NextResponse.json(
      { error: "At least one of autoExecute, manualApproval, or cooldownMs must be provided" },
      { status: 400 },
    );
  }

  try {
    const data: Record<string, unknown> = {};
    if (autoExecute !== undefined) data.autoExecute = autoExecute;
    if (manualApproval !== undefined) data.manualApproval = manualApproval;
    if (cooldownMs !== undefined) data.cooldownMs = cooldownMs;

    const settings = await prisma.engineSettings.upsert({
      where: { id: "singleton" },
      update: data,
      create: { id: "singleton", ...data },
    });

    return NextResponse.json({
      autoExecute: settings.autoExecute,
      manualApproval: settings.manualApproval,
      cooldownMs: settings.cooldownMs,
    });
  } catch (error) {
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Failed to update runner settings" },
      { status: 500 },
    );
  }
}
