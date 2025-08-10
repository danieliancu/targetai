// lib/dates.js
const MONTHS = {
  january: 0, february: 1, march: 2, april: 3, may: 4, june: 5,
  july: 6, august: 7, september: 8, october: 9, november: 10, december: 11,
};

function utcDate(y, m, d) { return new Date(Date.UTC(y, m, d, 0, 0, 0)); }
function monthStartUTC(y, m) { return utcDate(y, m, 1); }
function monthEndUTC(y, m) { return utcDate(y, m + 1, 0); }

function stripOrdinals(s) {
  return String(s || "").replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, "$1");
}

/** Parse "Wed 20 August 2025" or "20 August 2025" → UTC midnight Date */
export function parseLooseDate(englishDateStr) {
  if (!englishDateStr) return null;
  const clean = stripOrdinals(englishDateStr).replace(/,/g, "").trim();
  const parts = clean.split(" ").filter(Boolean);

  let day, month, year;
  if (parts.length >= 4 && isNaN(parseInt(parts[0], 10))) {
    day = parseInt(parts[1], 10);
    month = MONTHS[parts[2]?.toLowerCase()];
    year = parseInt(parts[3], 10);
  } else {
    day = parseInt(parts[0], 10);
    month = MONTHS[parts[1]?.toLowerCase()];
    year = parseInt(parts[2], 10);
  }
  if ([day, month, year].some(v => Number.isNaN(v) || v == null)) return null;
  return utcDate(year, month, day);
}

function toUTC00(d) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }

/** Natural-language window → {start, end, label} (all at UTC midnight) */
export function normalizeDateWindow(nlText, now = new Date()) {
  const NOW = toUTC00(now);

  if (!nlText) {
    const s = NOW;
    const e = utcDate(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + 56);
    return { start: s, end: e, label: "next 8 weeks" };
  }

  const q = String(nlText).toLowerCase().trim();

  // anytime / whenever
  if (/\bany\s*time\b|\banytime\b|\bwhenever\b/.test(q)) {
    const s = NOW;
    const e = utcDate(s.getUTCFullYear()+1, s.getUTCMonth(), s.getUTCDate());
    return { start: s, end: e, label: "anytime (next 12 months)" };
  }

  // this month
  if (/\bthis month\b/.test(q)) {
    const y = NOW.getUTCFullYear(), m = NOW.getUTCMonth();
    return { start: monthStartUTC(y,m), end: monthEndUTC(y,m), label: "this month" };
  }

  // next month
  if (/\bnext month\b/.test(q)) {
    const y0 = NOW.getUTCFullYear(), m0 = NOW.getUTCMonth();
    const m = (m0 + 1) % 12;
    const y = y0 + (m0 === 11 ? 1 : 0);
    return { start: monthStartUTC(y,m), end: monthEndUTC(y,m), label: "next month" };
  }

  // next week (Mon–Sun)
  if (/next\s*week/.test(q)) {
    // Find next Monday from NOW
    const dow = NOW.getUTCDay(); // 0..6 (Sun..Sat)
    // compute delta to Monday (1)
    let delta = (8 - (dow || 7)) % 7; // map Sun(0)→7
    if (delta === 0) delta = 7;
    const s = utcDate(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + delta);
    const e = utcDate(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + 6);
    return { start: s, end: e, label: "next week" };
  }

  // in N weeks → 7-day window starting N*7 days from NOW
  const inWeeks = q.match(/in\s*(\d+)\s*weeks?/);
  if (inWeeks) {
    const n = parseInt(inWeeks[1], 10);
    const s = utcDate(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + n*7);
    const e = utcDate(s.getUTCFullYear(), s.getUTCMonth(), s.getUTCDate() + 6);
    return { start: s, end: e, label: `in ${n} week(s)` };
  }

  // next N weeks → NOW..NOW+N*7
  const nextWeeks = q.match(/next\s*(\d+)\s*weeks?/);
  if (nextWeeks) {
    const n = parseInt(nextWeeks[1], 10);
    const s = NOW;
    const e = utcDate(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + n*7);
    return { start: s, end: e, label: `next ${n} week(s)` };
  }

  // after / later than / from {DD} {month}
  const dayMonthRe = /\b(after|later than|from)\s+(\d{1,2})(st|nd|rd|th)?\s+(january|february|march|april|may|june|july|august|september|october|november|december)\b/;
  const mDM = q.match(dayMonthRe);
  if (mDM) {
    const [, rel, dayStr, _o, monthStr] = mDM;
    const day = parseInt(dayStr, 10);
    const month = MONTHS[monthStr];
    const year = NOW.getUTCFullYear() + (month < NOW.getUTCMonth() ? 1 : 0);
    const baseDay = (rel === "from") ? day : day + 1; // from=inclusive, after/later than=exclusive
    const s = utcDate(year, month, baseDay);
    const e = monthEndUTC(year, month);
    return { start: s, end: e, label: `${rel} ${day} ${monthStr}` };
  }

  // end of {month}
  const endOf = q.match(/end of (\w+)/);
  if (endOf) {
    const mKey = endOf[1]; const mVal = MONTHS[mKey];
    if (mVal != null) {
      const y = NOW.getUTCFullYear() + (mVal < NOW.getUTCMonth() ? 1 : 0);
      const s = utcDate(y, mVal, 25);
      const e = monthEndUTC(y, mVal);
      return { start: s, end: e, label: `end of ${mKey}` };
    }
  }

  // explicit month name
  const mKey = Object.keys(MONTHS).find(m => q.includes(m));
  if (mKey) {
    const mVal = MONTHS[mKey];
    const y = NOW.getUTCFullYear() + (mVal < NOW.getUTCMonth() ? 1 : 0);
    return { start: monthStartUTC(y, mVal), end: monthEndUTC(y, mVal), label: mKey };
  }

  // fallback: next 8 weeks
  const e = utcDate(NOW.getUTCFullYear(), NOW.getUTCMonth(), NOW.getUTCDate() + 56);
  return { start: NOW, end: e, label: "next 8 weeks" };
}
