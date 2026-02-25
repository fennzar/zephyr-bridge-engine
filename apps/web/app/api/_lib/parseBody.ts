import { NextResponse } from "next/server";
import { z } from "zod";

export async function parseJsonBody<T>(
  request: Request,
  schema: z.ZodType<T, z.ZodTypeDef, unknown>
): Promise<{ data: T } | { error: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return { error: NextResponse.json({ error: "Invalid JSON payload" }, { status: 400 }) };
  }

  const result = schema.safeParse(raw);
  if (!result.success) {
    return {
      error: NextResponse.json(
        { error: "Validation failed", details: result.error.flatten().fieldErrors },
        { status: 400 }
      ),
    };
  }

  return { data: result.data };
}
