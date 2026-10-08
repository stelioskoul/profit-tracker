export interface ShopifyDateRange {
  fromDate: string;
  toDate: string;
}

function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new Error("Choose a valid YYYY-MM-DD date range");
  }
  const timestamp = Date.parse(`${value}T00:00:00Z`);
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString().slice(0, 10) !== value) {
    throw new Error("Choose a valid YYYY-MM-DD date range");
  }
  return timestamp;
}

export function validateDateRange(range: ShopifyDateRange): void {
  if (dateValue(range.fromDate) > dateValue(range.toDate)) {
    throw new Error("The start date must not be after the end date");
  }
}

function addDay(day: string): string {
  return new Date(dateValue(day) + 86_400_000).toISOString().slice(0, 10);
}

function localParts(timestamp: number, timeZone: string): Record<string, number> {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23",
  });
  return Object.fromEntries(
    formatter.formatToParts(new Date(timestamp))
      .filter(part => ["year", "month", "day", "hour", "minute", "second"].includes(part.type))
      .map(part => [part.type, Number(part.value)])
  );
}

/** Legacy fallback offset; this reference cannot replace the IANA zone's DST rules. */
export function referenceUtcOffsetMinutes(
  timeZone: string,
  year = new Date().getUTCFullYear()
): number {
  const reference = Date.UTC(year, 0, 1, 12);
  const parts = localParts(reference, timeZone);
  const wallClock = Date.UTC(parts.year, parts.month - 1, parts.day,
    parts.hour, parts.minute, parts.second);
  const offset = (wallClock - reference) / 60_000;
  if (!Number.isFinite(offset) || Math.abs(offset) > 14 * 60) {
    throw new Error("Invalid store IANA timezone");
  }
  return offset;
}

/** Convert a store-local midnight to UTC; using the IANA zone handles DST changes. */
function localMidnightUtc(day: string, timeZone: string): number {
  const target = dateValue(day);
  let candidate = target;
  for (let attempt = 0; attempt < 4; attempt++) {
    const parts = localParts(candidate, timeZone);
    const wallTime = Date.UTC(parts.year, parts.month - 1, parts.day,
      parts.hour, parts.minute, parts.second);
    const delta = target - wallTime;
    candidate += delta;
    if (delta === 0) return candidate;
  }
  throw new Error(`Unable to determine midnight in store timezone ${timeZone}`);
}

/** Both bounds are UTC milliseconds; start inclusive, end exclusive. */
export function shopifyDateBounds(
  range: ShopifyDateRange,
  offsetMinutes = -300,
  timeZone?: string | null
): { start: number; end: number } {
  validateDateRange(range);
  if (timeZone) {
    return {
      start: localMidnightUtc(range.fromDate, timeZone),
      end: localMidnightUtc(addDay(range.toDate), timeZone),
    };
  }
  if (!Number.isFinite(offsetMinutes) || Math.abs(offsetMinutes) > 14 * 60) {
    throw new Error("Invalid store timezone offset");
  }
  return {
    start: dateValue(range.fromDate) - offsetMinutes * 60_000,
    end: dateValue(addDay(range.toDate)) - offsetMinutes * 60_000,
  };
}

export function isInShopifyDateRange(
  isoTime: string,
  range: ShopifyDateRange,
  offsetMinutes = -300,
  timeZone?: string | null
): boolean {
  const time = Date.parse(isoTime);
  if (!Number.isFinite(time)) throw new Error("Shopify returned an invalid transaction date");
  const { start, end } = shopifyDateBounds(range, offsetMinutes, timeZone);
  return time >= start && time < end;
}
