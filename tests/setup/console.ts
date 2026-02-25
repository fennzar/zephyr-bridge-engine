import { afterAll, afterEach, beforeAll, vi } from "vitest";

let warnSpy: ReturnType<typeof vi.spyOn> | null = null;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

beforeAll(() => {
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  warnSpy?.mockClear();
  errorSpy?.mockClear();
});

afterAll(() => {
  warnSpy?.mockRestore();
  errorSpy?.mockRestore();
});
