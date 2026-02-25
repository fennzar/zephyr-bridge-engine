export function clampCalibrationPrice(
  value: number | null,
  initialAnchor: number | null,
  referenceAnchor: number | null,
): number | null {
  const normalizedValue = normalizeNumber(value);
  if (normalizedValue == null) return null;

  const initial = normalizeNumber(initialAnchor);
  const reference = normalizeNumber(referenceAnchor);
  if (initial == null || reference == null) {
    return normalizedValue;
  }

  const lower = Math.min(initial, reference);
  const upper = Math.max(initial, reference);
  if (normalizedValue < lower) return lower;
  if (normalizedValue > upper) return upper;
  return normalizedValue;
}

function normalizeNumber(value: number | null): number | null {
  if (value == null) return null;
  return Number.isFinite(value) ? value : null;
}
