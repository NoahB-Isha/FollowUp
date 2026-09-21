/** Date + text helpers. All dates are handled as local 'YYYY-MM-DD' strings. */

export function today() {
  return toISODate(new Date());
}

export function toISODate(d) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

/** Monday that starts the ISO week containing dateStr. */
export function weekStart(dateStr) {
  const d = parseDate(dateStr);
  const dow = (d.getDay() + 6) % 7; // Mon=0 … Sun=6
  d.setDate(d.getDate() - dow);
  return toISODate(d);
}

export function addDays(dateStr, n) {
  const d = parseDate(dateStr);
  d.setDate(d.getDate() + n);
  return toISODate(d);
}

export function daysBetween(a, b) {
  return Math.round((parseDate(b) - parseDate(a)) / 86400000);
}

export function parseDate(dateStr) {
  const [y, m, d] = dateStr.slice(0, 10).split('-').map(Number);
  return new Date(y, m - 1, d);
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function fmtDate(dateStr) {
  if (!dateStr) return '—';
  const d = parseDate(dateStr);
  return `${MONTHS[d.getMonth()]} ${d.getDate()}`;
}

export function fmtWeek(mondayStr) {
  return `${fmtDate(mondayStr)}–${fmtDate(addDays(mondayStr, 6))}`;
}

export function median(nums) {
  if (!nums.length) return 0;
  const s = [...nums].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'of', 'in', 'on', 'for', 'is', 'are', 'be',
  'it', 'its', 'this', 'that', 'with', 'from', 'at', 'by', 'all', 'has', 'have',
  'was', 'were', 'should', 'would', 'can', 'there', 'their', 'them', 'they',
]);

/** Normalized token set used for issue dedupe across walkthroughs. */
export function tokens(text) {
  return new Set(
    (text || '')
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 1 && !STOPWORDS.has(t))
  );
}

export function jaccard(aSet, bSet) {
  if (!aSet.size || !bSet.size) return 0;
  let inter = 0;
  for (const t of aSet) if (bSet.has(t)) inter++;
  return inter / (aSet.size + bSet.size - inter);
}

export function normKey(text) {
  return [...tokens(text)].sort().join(' ');
}
