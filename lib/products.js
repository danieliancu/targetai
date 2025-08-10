// lib/products.js
import { expandKeywords, isCourseMatchByFamily, isRefresherMatch, extractFormatOrVenue } from "./abbreviations.js";
import { parseLooseDate } from "./dates.js";

/* ---------------- Fetch ---------------- */

export async function fetchProducts(endpoint) {
  const res = await fetch(endpoint, { headers: { accept: "application/json" }, cache: "no-store" });
  const ct = res.headers.get("content-type") || "";
  const body = await res.text();
  if (!res.ok) throw new Error(`Products fetch failed: ${res.status}\n${body.slice(0, 500)}`);
  if (!ct.includes("application/json")) throw new Error(`Products responded non-JSON (CT=${ct}): ${body.slice(0, 200)}`);
  try { return JSON.parse(body); } catch (e) {
    throw new Error(`Failed to parse products JSON: ${e.message}\n${body.slice(0, 200)}`);
  }
}

/* ---------------- Utils ---------------- */

function toUTC00(d) { const x = new Date(d); x.setUTCHours(0,0,0,0); return x; }
function todayUTC() { return toUTC00(new Date()); }

export function toNumericPrice(p) {
  const n = Number(String(p ?? "").replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

export function withinRange(dateStr, [start, end]) {
  if (!start && !end) return true;
  const d = parseLooseDate(dateStr);
  if (!d) return false;
  const s = start ? toUTC00(start) : null;
  const e = end ? toUTC00(end) : null;
  if (s && d < s) return false;
  if (e && d > e) return false;
  return true;
}

/* ---------------- Location ---------------- */

function norm(s) {
  if (!s) return "";
  return String(s).toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[(),]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export const CITY_ALIASES = {
  "online": ["online", "virtual", "instructor led", "instructor-led"],
  "chelmsford": ["chelmsford"],
  "peterborough": ["peterborough"],
  "sheffield": ["sheffield"],
  "crawley": ["crawley"],
  "stratford": ["stratford"],
};

export function detectUserLocationFromText(rawText) {
  const q = norm(rawText || "");
  if (!q) return null;

  // treat as no location filter
  if (/\b(anywhere|anyplace|any\s*place|any)\b/.test(q)) return null;

  if (/\bonline\b/.test(q)) return "online";
  for (const city in CITY_ALIASES) {
    if (city === "online") continue;
    if (CITY_ALIASES[city].some(a => q.includes(norm(a)))) return city;
  }
  return null;
}


export function detectLocationFacet(name) {
  const raw = String(name || "");
  const n = norm(raw);
  if (/\bonline\b/.test(n)) return "online";

  const parts = raw.split("|").map(s => s.trim()).filter(Boolean);
  if (parts.length >= 3) {
    const middle = parts[1];
    if (norm(middle) && norm(middle) !== "venue tbc") return middle;
  }

  for (const city in CITY_ALIASES) {
    if (CITY_ALIASES[city].some(a => n.includes(norm(a)))) return city === "online" ? "online" : city;
  }
  return null;
}

function matchLocation(userLocation, productName) {
  if (!userLocation) return true;
  const ul = norm(userLocation);
  if (!ul || ul === "any" || ul === "anywhere") return true;
  const facet = detectLocationFacet(productName);
  if (!facet) return false;
  const f = norm(facet);
  if (ul === "online") return f === "online";
  const aliases = CITY_ALIASES[ul] || [];
  if (f.includes(ul) || ul.includes(f)) return true;
  if (aliases.some(a => f.includes(norm(a)))) return true;
  if (aliases.length === 0 && f === ul) return true;
  return false;
}

/* ---------------- Mapping ---------------- */

function mapItem(r) {
  return {
    id: r.id,
    title: r.name,
    dates: r.dates_list || `${r.start_date || ""}${r.end_date ? ` - ${r.end_date}` : ""}`,
    price: r.price,
    spaces: r.available_spaces,
    link: r.link,
    venueOrFormat: extractFormatOrVenue(r.name),
    startTS: parseLooseDate(r.start_date)?.toISOString() ?? null,
  };
}

/* ---------------- Search ---------------- */

export function searchCoursesInMemory(products, params) {
  const { courseTerm, location, dateRange, includeRefresher = null } = params || {};
  const { family, refresher } = expandKeywords(courseTerm || "");
  const effectiveRefresher = includeRefresher ?? refresher;

  let results = (products || []).filter(p => {
    const name = p?.name || "";
    if (!isCourseMatchByFamily(name, family)) return false;
    if (!isRefresherMatch(name, effectiveRefresher)) return false;
    if (dateRange && (dateRange.start || dateRange.end)) {
      if (!withinRange(p.start_date, [dateRange.start, dateRange.end])) return false;
    }
    if (!matchLocation(location, name)) return false;
    return true;
  });

  results.sort((a, b) => {
    const da = parseLooseDate(a.start_date)?.getTime() ?? Infinity;
    const db = parseLooseDate(b.start_date)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return toNumericPrice(a.price) - toNumericPrice(b.price);
  });

  const seen = new Set();
  results = results.filter(r => {
    const key = `${r.name}::${r.start_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return results.map(mapItem);
}

/* ---------------- Diagnostics (fixed) ---------------- */

export function diagnoseSearch(products, params) {
  const { courseTerm, location, dateRange, includeRefresher = null } = params || {};
  const { family, refresher } = expandKeywords(courseTerm || "");
  const effectiveRefresher = includeRefresher ?? refresher;

  const all = products || [];
  const today = todayUTC();

  const matchesFamilyAndRef = all.filter(p => {
    const name = p?.name || "";
    return isCourseMatchByFamily(name, family) && isRefresherMatch(name, effectiveRefresher);
  });

  const hasAnyFamilyRef = matchesFamilyAndRef.length > 0;

  const inAnyLocThisDate = matchesFamilyAndRef.filter(p =>
    !dateRange || withinRange(p.start_date, [dateRange.start, dateRange.end])
  );
  const hasInDateAnyLoc = inAnyLocThisDate.length > 0;

  const inAnyDateThisLoc = matchesFamilyAndRef.filter(p => matchLocation(location, p.name));
  const hasInLocAnyDate = inAnyDateThisLoc.length > 0;

  // compute nearest FUTURE sessions first in requested location, then anywhere
  const future = matchesFamilyAndRef.filter(p => {
    const d = parseLooseDate(p.start_date);
    return d && d >= today;
  });

  const nearestInLocation = future
    .filter(p => matchLocation(location, p.name))
    .sort((a,b) => (parseLooseDate(a.start_date) - parseLooseDate(b.start_date)))
    .slice(0,3)
    .map(mapItem);

  const nearestAnywhere = future
    .sort((a,b) => (parseLooseDate(a.start_date) - parseLooseDate(b.start_date)))
    .slice(0,3)
    .map(mapItem);

  // also compute standard alternative inside the same filters/date
  const altRef = effectiveRefresher == null ? null : !effectiveRefresher;
  const standardAlt = all.filter(p => {
    const name = p?.name || "";
    return isCourseMatchByFamily(name, family) && isRefresherMatch(name, altRef) &&
      (!dateRange || withinRange(p.start_date, [dateRange.start, dateRange.end])) &&
      matchLocation(location, name);
  }).sort((a, b) => parseLooseDate(a.start_date) - parseLooseDate(b.start_date))
    .slice(0,3)
    .map(mapItem);

  return {
    family, refresher: effectiveRefresher,
    hasAnyFamilyRef,
    hasInDateAnyLoc,
    hasInLocAnyDate,
    nearestInLocation,
    nearestAnywhere,
    standardAlt,
  };
}
