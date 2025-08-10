// lib/abbreviations.js

// === Catalog (familii) + aliasuri extinse ===
// Notă: Doar familiile care AU intrare "... Refresher" sunt tratate ca având varianta refresher disponibilă.
export const MAP = [
  // SMSTS
  {
    family: "SMSTS",
    aliases: [
      "smsts",
      "citb smsts",
      "site management safety training scheme",
      "site managers safety training scheme",
      "site manager safety training scheme",
      "site management safety",
      "smsts course",
    ],
  },
  {
    family: "SMSTS Refresher",
    aliases: [
      "smsts refresher",
      "smsts-r",
      "citb smsts refresher",
      "site management safety training scheme refresher",
      "site managers safety training scheme refresher",
      "smsts renewal",
      "smsts update",
      "smsts refresh",
    ],
  },

  // SSSTS
  {
    family: "SSSTS",
    aliases: [
      "sssts",
      "citb sssts",
      "site supervisors safety training scheme",
      "site supervisor safety training scheme",
      "site supervisors safety",
      "supervisors safety training scheme",
      "sssts course",
    ],
  },
  {
    family: "SSSTS Refresher",
    aliases: [
      "sssts refresher",
      "sssts-r",
      "citb sssts refresher",
      "site supervisors safety training scheme refresher",
      "sssts renewal",
      "sssts update",
      "sssts refresh",
    ],
  },

  // HSA (Health and Safety Awareness)
  {
    family: "HSA",
    aliases: [
      "hsa",
      "health and safety awareness",
      "health & safety awareness",
      "health and safety awareness courses",
      "health and safety",
      "health & safety",
      "h&s",
      "hsa course",
      "citb health and safety awareness",
      "citb hsa",
    ],
  },

  // TWC + TWC Refresher
  {
    family: "TWC",
    aliases: [
      "twc",
      "citb twc",
      "temporary works coordinator",
      "temporary works co ordinator",
      "temporary works co-ordinator",
      "temporary works coordinator course",
      "temporary works co ordinator course",
      "tw coordinator",
      "tw co-ordinator",
      "twc course",
    ],
  },
  {
    family: "TWC Refresher",
    aliases: [
      "twc refresher",
      "citb twc refresher",
      "temporary works coordinator refresher",
      "temporary works co-ordinator refresher",
      "twc renewal",
      "twc update",
      "twc refresh",
    ],
  },

  // TWS (doar standard)
  {
    family: "TWS",
    aliases: [
      "tws",
      "citb tws",
      "temporary works supervisor",
      "temporary work supervisor",
      "tw supervisor",
      "tws course",
    ],
  },

  // NEBOSH
  {
    family: "NEBOSH General",
    aliases: [
      "nebosh general",
      "nebosh ngc",
      "nebosh national general certificate",
      "nebosh certificate general",
      "nebosh health and safety",
      "nebosh h&s",
      "nebosh",
    ],
  },
  {
    family: "NEBOSH Construction",
    aliases: [
      "nebosh construction",
      "nebosh ncc",
      "nebosh national certificate in construction",
      "nebosh construction certificate",
      "nebosh construction safety",
    ],
  },

  // IOSH — despărțite
  {
    family: "IOSH Managing Safely",
    aliases: [
      "iosh managing safely",
      "managing safely",
      "iosh ms",
      "iosh manage safely",
      "iosh managing", // toleranță la formulări scurte
    ],
  },
  {
    family: "IOSH Working Safely",
    aliases: [
      "iosh working safely",
      "working safely",
      "iosh ws",
      "iosh working", // toleranță la formulări scurte
    ],
  },

  // IEMA (generic)
  {
    family: "IEMA",
    aliases: [
      "iema",
      "iema foundation",
      "iema environmental management",
      "iema sustainability",
      "iema course",
      "environmental",
      "environmental management",
      "foundation certificate in environmental management",
      "foundation in environmental management",
    ],
  },

  // MHFA
  {
    family: "MHFA",
    aliases: [
      "mhfa",
      "mental health first aid",
      "mental health first aid course",
      "mhfa course",
      "mhfa england",
      "mental health first aid 2 day",
      "mhfa 2 day",
      "mhfa two day",
      "first aid",
    ],
  },

  // SEATS (Site Environmental Awareness)
  {
    family: "SEATS",
    aliases: [
      "seats",
      "site environmental awareness training scheme",
      "site environmental awareness",
      "citb seats",
    ],
  },

  // EUSR Water Hygiene AM
  {
    family: "EUSR Water Hygiene AM",
    aliases: [
      "eusr water hygiene am",
      "water hygiene am session",
      "am water hygiene",
      "eusr am",
      "am session water hygiene",
      "water hygiene morning",
      "morning water hygiene",
    ],
  },
  // EUSR Water Hygiene PM
  {
    family: "EUSR Water Hygiene PM",
    aliases: [
      "eusr water hygiene pm",
      "water hygiene pm session",
      "pm water hygiene",
      "eusr pm",
      "pm session water hygiene",
      "water hygiene afternoon",
      "afternoon water hygiene",
    ],
  },
];

// === Derivate & utilitare interne ===
const REFRESHER_AVAILABLE = new Set(
  MAP.filter(m => /refresher$/i.test(m.family)).map(m => m.family.replace(/\s+Refresher$/i, ""))
);

const FAMILIES = Array.from(new Set(MAP.map(m => m.family.replace(/\s+Refresher$/i, ""))));

const ALIAS_TO_FAMILY = (() => {
  const dict = {};
  for (const m of MAP) {
    const base = m.family.replace(/\s+Refresher$/i, "");
    for (const a of m.aliases) dict[norm(a)] = base;
  }
  return dict;
})();

function norm(s) {
  return String(s || "")
    .toLowerCase()
    .normalize("NFD").replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9+& ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function detectRefresher(text) {
  const t = norm(text);
  if (/\brefresher\b/.test(t) || /\brenewal\b/.test(t) || /\bupdate\b/.test(t) || /\brefresh\b/.test(t)) return true;
  if (/\bstandard\b/.test(t)) return false;
  return null;
}

// mic ajutor pentru sugestii
function levenshtein(a, b) {
  a = norm(a); b = norm(b);
  const m = a.length, n = b.length;
  if (!m) return n; if (!n) return m;
  const dp = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i-1][j] + 1, dp[i][j-1] + 1, dp[i-1][j-1] + cost);
    }
  }
  return dp[m][n];
}

function closestFamilies(term, limit = 3) {
  const q = norm(term);
  const scored = FAMILIES.map(f => {
    const acr = f.split(" ")[0];
    return { family: f, dist: Math.min(levenshtein(q, f), levenshtein(q, acr)) };
  }).sort((a,b) => a.dist - b.dist);
  return scored.filter(s => s.dist <= 3).slice(0, limit).map(s => s.family);
}

// === API exportate ===

export function expandKeywords(term) {
  if (!term) return { family: null, refresher: null, tokens: [] };
  const q = norm(term);

  let family = null;

  // 1) alias direct
  for (const [alias, fam] of Object.entries(ALIAS_TO_FAMILY)) {
    if (q.includes(alias)) { family = fam; break; }
  }

  // 2) heuristici simple fără alias complet:
  if (!family) {
    // acronime / scurtături
    const acrHits = ["smsts","sssts","twc","tws","seats","eusr","hsa","nebosh","iema","mhfa","iosh"];
    const hit = acrHits.find(a => q.includes(a));
    if (hit) {
      const mapAcr = {
        smsts:"SMSTS",
        sssts:"SSSTS",
        twc:"TWC",
        tws:"TWS",
        seats:"SEATS",
        eusr:"EUSR",        // generic -> vom cere AM/PM mai jos
        hsa:"HSA",
        nebosh:"NEBOSH",
        iema:"IEMA",
        mhfa:"MHFA",
        iosh:"IOSH",        // generic -> vom cere Managing/Working mai jos
      };
      family = mapAcr[hit];
    }

    // IOSH fără "iosh" scris, dar frazele cheie
    if (!family) {
      if (/\bmanaging safely\b/.test(q) || /\biosh managing\b/.test(q)) family = "IOSH Managing Safely";
      else if (/\bworking safely\b/.test(q) || /\biosh working\b/.test(q)) family = "IOSH Working Safely";
    }

    // EUSR: detectare AM/PM din text, chiar dacă nu s-a prins aliasul
    if (!family && /\bwater hygiene\b/.test(q)) {
      if (/\b(am|morning)\b/.test(q)) family = "EUSR Water Hygiene AM";
      else if (/\b(pm|afternoon)\b/.test(q)) family = "EUSR Water Hygiene PM";
      else family = "EUSR"; // generic -> cere AM/PM
    }
  }

  // HSA fallback dacă apare 'health and safety' dar nu 'nebosh'/'iosh'
  if (!family) {
    if (/\bhealth(?:\s*&|\s*and)?\s*safety\b/.test(q) && !(/\bnebosh\b/.test(q) || /\biosh\b/.test(q))) {
      family = "HSA";
    }
  }

  // NEBOSH ambiguu -> "NEBOSH"
  if (family === "NEBOSH General" && q.includes("construction")) family = "NEBOSH Construction";
  if (family && family.startsWith("NEBOSH") && !q.includes("general") && !q.includes("construction")) {
    family = "NEBOSH";
  }

  // Specializare IOSH generic -> variantă
  if (family === "IOSH") {
    if (/\bmanaging safely\b/.test(q) || /\biosh managing\b/.test(q)) family = "IOSH Managing Safely";
    else if (/\bworking safely\b/.test(q) || /\biosh working\b/.test(q)) family = "IOSH Working Safely";
  }

  // Specializare EUSR generic -> AM/PM
  if (family === "EUSR") {
    if (/\b(am|morning)\b/.test(q)) family = "EUSR Water Hygiene AM";
    else if (/\b(pm|afternoon)\b/.test(q)) family = "EUSR Water Hygiene PM";
  }

  return { family, refresher: detectRefresher(q), tokens: [q] };
}

export function inferFamilyLabel(term) {
  const { family, refresher } = expandKeywords(term || "");
  if (!family) return null;

  // IOSH/EUSR generice – nu le normalizăm; cerem clarificare în validateCourseQuery
  if (family === "IOSH" || family === "EUSR") return family;

  if (/\brefresher\b/i.test(family)) return family;
  if (refresher === true && REFRESHER_AVAILABLE.has(family)) return `${family} Refresher`;
  if (refresher === false) return family;
  return family;
}

export function isCourseMatchByFamily(name, family) {
  if (!family) return true;
  const n = (name || "").toLowerCase();

  const hasTWC = () =>
    n.includes("temporary works coordinator") ||
    n.includes("temporary works co-ordinator") ||
    n.includes("temporary works co ordinator");
  const hasTWS = () => n.includes("temporary works supervisor");

  const checks = {
    "SMSTS": () => n.includes("site management safety training scheme") && !n.includes("refresher"),
    "SMSTS Refresher": () => n.includes("site management safety training scheme") && n.includes("refresher"),

    "SSSTS": () => n.includes("site supervisors safety training scheme") && !n.includes("refresher"),
    "SSSTS Refresher": () => n.includes("site supervisors safety training scheme") && n.includes("refresher"),

    // HSA permisiv (awareness opțional)
    "HSA": () => /\bhealth(?:\s*&|\s*and)?\s*safety(?:\s*awareness)?\b/.test(n),

    "TWC": () => hasTWC() && !n.includes("refresher"),
    "TWC Refresher": () => hasTWC() && n.includes("refresher"),

    "TWS": () => hasTWS() && !n.includes("refresher"),

    "NEBOSH General": () => n.includes("nebosh") && !n.includes("construction"),
    "NEBOSH Construction": () => n.includes("nebosh") && n.includes("construction"),
    "NEBOSH": () => n.includes("nebosh"),

    // IOSH separate
    "IOSH Managing Safely": () =>
      n.includes("iosh managing safely") || /\bmanaging safely\b/.test(n) || /\biosh managing\b/.test(n),
    "IOSH Working Safely": () =>
      n.includes("iosh working safely") || /\bworking safely\b/.test(n) || /\biosh working\b/.test(n),

    // IEMA: menținut permisiv
    "IEMA": () =>
      n.includes("iema") ||
      /\bfoundation certificate in environmental management\b/.test(n) ||
      /\benvironmental\b.*\bmanagement\b/.test(n),

    "MHFA": () => n.includes("mental health first aid") || n.includes("mhfa"),

    // SEATS
    "SEATS": () =>
      n.includes("site environmental awareness training scheme") ||
      /\bsite environmental awareness\b/.test(n) ||
      /\bseats\b/.test(n),

    // EUSR split
    "EUSR Water Hygiene AM": () =>
      /\bwater hygiene\b/.test(n) && (/\b(am|morning)\b/.test(n) || /\bam session\b/.test(n)),
    "EUSR Water Hygiene PM": () =>
      /\bwater hygiene\b/.test(n) && (/\b(pm|afternoon)\b/.test(n) || /\bpm session\b/.test(n)),
  };

  // Pentru familii generice (IOSH/EUSR) preferăm să nu facem match până nu se clarifică varianta
  if (family === "IOSH" || family === "EUSR") return false;

  return (checks[family]?.() ?? true);
}

export function isRefresherMatch(name, refresher) {
  if (refresher === null) return true;
  const n = (name || "").toLowerCase();
  const hasRefresher =
    /\brefresher\b/.test(n) || /\brenewal\b/.test(n) || /\bupdate\b/.test(n) || /\brefresh\b/.test(n);
  return refresher ? hasRefresher : !hasRefresher;
}

export function extractFormatOrVenue(name) {
  const raw = String(name || "");
  const n = raw.toLowerCase();
  if (n.includes("online")) return "Online (Instructor-led)";
  const parts = raw.split("|").map(s => s.trim());
  if (parts.length >= 3 && parts[1]) return parts[1];
  return "Venue TBC";
}

/** Validare curs cerut vs catalog (MAP conceptual, nu feed-ul) */
export function validateCourseQuery(term) {
  const { family, refresher } = expandKeywords(term);
  const suggestions = [];

  // Lipsă familie – oferim sugestii apropiate
  if (!family) {
    for (const f of closestFamilies(term)) {
      suggestions.push({ label: `${f}` });
      if (REFRESHER_AVAILABLE.has(f)) suggestions.push({ label: `${f} Refresher` });
    }
    return {
      recognizedFamily: null,
      refresherRequested: refresher,
      exists: false,
      normalizedFamily: null,
      reason: "missing_family",
      suggestions,
    };
  }

  // Familii generice care cer clarificare
  if (family === "IOSH") {
    return {
      recognizedFamily: "IOSH",
      refresherRequested: refresher,
      exists: false,
      normalizedFamily: null,
      reason: "needs_variant",
      suggestions: [{ label: "IOSH Managing Safely" }, { label: "IOSH Working Safely" }],
    };
  }
  if (family === "EUSR") {
    return {
      recognizedFamily: "EUSR",
      refresherRequested: refresher,
      exists: false,
      normalizedFamily: null,
      reason: "needs_variant",
      suggestions: [{ label: "EUSR Water Hygiene AM" }, { label: "EUSR Water Hygiene PM" }],
    };
  }

  // Refresher cerut dar familia nu oferă variantă
  if (refresher === true && !REFRESHER_AVAILABLE.has(family)) {
    suggestions.push({ label: `${family} (Standard)` });
    const near = Array.from(REFRESHER_AVAILABLE)
      .map(f => ({ f, d: levenshtein(f, family) }))
      .sort((a,b) => a.d - b.d)
      .slice(0,2)
      .map(x => ({ label: `${x.f} Refresher` }));
    suggestions.push(...near);
    return {
      recognizedFamily: family,
      refresherRequested: true,
      exists: false,
      normalizedFamily: null,
      reason: "variant_not_offered",
      suggestions,
    };
  }

  const normalizedFamily = refresher === true ? `${family} Refresher` : family;
  return {
    recognizedFamily: family,
    refresherRequested: refresher,
    exists: true,
    normalizedFamily,
    reason: "ok",
    suggestions: [],
  };
}
