import { NextResponse } from "next/server";

export type JsonSafe = string | number | boolean | null | JsonSafe[] | { [key: string]: JsonSafe };

export function jsonResponse(data: unknown, init?: ResponseInit) {
  return NextResponse.json(toJsonSafe(data), init);
}

export function toJsonSafe(value: unknown): JsonSafe {
  if (value == null) return null;
  if (typeof value === "bigint") return value.toString();
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item) => toJsonSafe(item));
  if (typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).map(([key, val]) => [key, toJsonSafe(val)]);
    return Object.fromEntries(entries);
  }
  return null;
}
