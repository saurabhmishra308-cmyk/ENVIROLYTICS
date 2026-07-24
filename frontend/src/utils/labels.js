/**
 * Device / instrument label helpers.
 *
 * Historically some devices were seeded with the suffix " Test" (e.g.
 * "Piezometer Test") for internal validation. We now strip that suffix at
 * render time so every screen — Reports, Graph Reports, Dashboard tiles,
 * LocationMap tooltips, Water Quality panels, CSV exports — shows the clean
 * name without touching the underlying database record.
 *
 * The rule is intentionally conservative: only a trailing " test" (with any
 * amount of preceding whitespace, case-insensitive) is removed. Labels like
 * "Aeration Test Line" or "Testing Station" are left untouched.
 */
export function cleanLabel(value) {
  if (value === null || value === undefined) return value;
  const s = String(value);
  return s.replace(/\s+test\s*$/i, '').trim() || s;
}

/** Convenience alias used at CSV export sites to make intent obvious. */
export const cleanDeviceName = cleanLabel;
