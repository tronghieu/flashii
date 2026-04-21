// Pure progress/streak math. No I/O. Exercised from `get_progress`.

// Compute current + longest review streak from a sorted, unique list of
// UTC calendar days (YYYY-MM-DD). `current=0` if today is not in the list.
// Otherwise walk backward from today while consecutive days are present.
// `longest` scans the whole list for the longest contiguous run.
export function computeStreak(
  sortedUniqueDaysAsc: string[],
  todayYmd: string,
): { current: number; longest: number } {
  const set = new Set(sortedUniqueDaysAsc);

  let current = 0;
  if (set.has(todayYmd)) {
    current = 1;
    let cursor = addDays(todayYmd, -1);
    while (set.has(cursor)) {
      current++;
      cursor = addDays(cursor, -1);
    }
  }

  let longest = 0;
  let run = 0;
  let prev: string | null = null;
  for (const day of sortedUniqueDaysAsc) {
    if (prev !== null && addDays(prev, 1) === day) {
      run++;
    } else {
      run = 1;
    }
    if (run > longest) longest = run;
    prev = day;
  }

  return { current, longest };
}

// YYYY-MM-DD ± n days. Pure string math via UTC epoch; avoids TZ drift.
function addDays(ymd: string, delta: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1) + delta * 86400000;
  const dt = new Date(t);
  const yyyy = dt.getUTCFullYear().toString().padStart(4, '0');
  const mm = (dt.getUTCMonth() + 1).toString().padStart(2, '0');
  const dd = dt.getUTCDate().toString().padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

export function daysLeft(deadlineIso: string | null, now: Date): number | null {
  if (deadlineIso == null) return null;
  const ms = Date.parse(deadlineIso);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.ceil((ms - now.getTime()) / 86400000));
}

export function targetPerDay(
  chunks: number | null,
  created: number,
  daysLeftValue: number | null,
): number | null {
  if (chunks == null || daysLeftValue == null || daysLeftValue <= 0) return null;
  return Math.max(0, Math.ceil((chunks - created) / daysLeftValue));
}
