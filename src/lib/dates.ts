/** Today's date in the device's time zone, as YYYY-MM-DD. */
export function localToday(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** "2026-11-20" (a calendar date) or a full timestamp, shown in the device's time zone. */
export function formatDate(iso: string | null): string {
  if (!iso) return "";
  const opts: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
  if (iso.length > 10) return new Date(iso).toLocaleDateString(undefined, opts); // timestamp: convert from UTC
  const [y, m, d] = iso.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString(undefined, opts);
}
