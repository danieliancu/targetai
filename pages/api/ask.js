// pages/api/ask.js
import OpenAI from "openai";
import fs from "fs/promises";
import path from "path";

import { normalizeDateWindow, parseLooseDate } from "../../lib/dates.js";
import {
  fetchProducts,
  detectUserLocationFromText,
  diagnoseSearch,
  withinRange,
  detectLocationFacet,
  toNumericPrice,
} from "../../lib/products.js";
import {
  validateCourseQuery,
  isCourseMatchByFamily,
  isRefresherMatch,
} from "../../lib/abbreviations.js";

/* =========================
   KB: course_kb.json support
   ========================= */
const COURSE_KB_PATH =
  process.env.COURSE_KB_PATH || path.join(process.cwd(), "data/course_kb.json");

let __COURSE_KB = null;
let __COURSE_KB_MTIME = 0;

async function loadCourseKB() {
  try {
    const stat = await fs.stat(COURSE_KB_PATH);
    if (!__COURSE_KB || stat.mtimeMs !== __COURSE_KB_MTIME) {
      const raw = await fs.readFile(COURSE_KB_PATH, "utf-8");
      __COURSE_KB = JSON.parse(raw);
      __COURSE_KB_MTIME = stat.mtimeMs;
      console.log("[ask] course_kb.json (re)loaded:", COURSE_KB_PATH);
    }
    return __COURSE_KB;
  } catch (err) {
    console.error("[ask] Failed to load course_kb.json:", err?.message || err);
    return { version: "0", courses: [] };
  }
}

function _norm(s = "") {
  return String(s).toLowerCase().replace(/\s+/g, " ").trim();
}

function kbMatchCourse(kb, termRaw) {
  const term = _norm(termRaw || "");
  if (!term) return null;
  for (const c of kb.courses || []) {
    const hay = [c.id, c.title, ...(Array.isArray(c.aliases) ? c.aliases : [])]
      .filter(Boolean)
      .map(_norm);
    if (hay.some((h) => h.includes(term) || term.includes(h))) return c;
  }
  return null;
}

function kbPickFields(course, fields = []) {
  if (!fields?.length) return course;
  const out = {};
  for (const f of fields) {
    if (f === "exam" && course?.assessment?.exam) out.exam = course.assessment.exam;
    else if (f === "pass_mark" && course?.assessment?.exam?.pass_mark_percent != null)
      out.pass_mark = course.assessment.exam.pass_mark_percent;
    else if (f === "attendance") out.attendance_required = course.attendance_required ?? null;
    else if (f in course) out[f] = course[f];
    else if (course.certificate && f in course.certificate) {
      out.certificate = { ...(out.certificate || {}), [f]: course.certificate[f] };
    }
  }
  return out;
}

/* =========================
   MODEL + PROMPT
   ========================= */
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are a concise, proactive sales agent for construction training courses.
- Understand three inputs: course (incl. abbreviations), location/venue (city/online), date window (natural language like "next month", "next 2 weeks", "end of September").
- Do NOT reuse a previous location or date unless the user repeats or clearly confirms it in the latest message.
- When the user provides only ONE of the three, ask ONE guided follow-up to get a second parameter. With ≥2 parameters, return results.
- Never invent prices, dates, or availability: use tool results only.
- Prefer English. Keep answers compact.
- If a course can be Standard vs Refresher, confirm when ambiguous. For NEBOSH, ask "General or Construction?" when unclear.
- If there are no exact matches, relax constraints in this order: date window → nearby/online → refresher/standard, and explain what you relaxed.
- For each suggestion, show: Title (course only, no pipes), Dates (dates_list), Venue/Format, Price, Spaces, and a BOOK NOW link.
- Default ranking: soonest → lowest price. Do not list duplicates.
- Tone: friendly, efficient, solution-oriented.

Tool usage policy:
- When calling search_courses, always pass rawQuery with the user's latest message content to help the server detect nuances (e.g., "refresher").
- Do not format course suggestions yourself. Always call "search_courses"; the server will render results as cards.
- Never answer course facts (duration, exam, pass marks, certificate, delivery, prerequisites, attendance) from your own knowledge. Always call "course_info" and use only the tool result.
`;

/* =========================
   TOOLS
   ========================= */
const TOOLS = [
  {
    type: "function",
    function: {
      name: "normalize_dates",
      description: "Parse a natural language time window into start & end dates.",
      parameters: {
        type: "object",
        properties: { text: { type: "string" } },
        required: ["text"],
      },
    },
  },
  {
    type: "function",
    function: {
      name: "search_courses",
      description: "Search Target Zero products by course, location, and date window. Always include rawQuery.",
      parameters: {
        type: "object",
        properties: {
          courseTerm: { type: "string", nullable: true },
          location: { type: "string", nullable: true },
          dateText: { type: "string", nullable: true },
          includeRefresher: { type: "boolean", nullable: true },
          rawQuery: { type: "string", nullable: true }
        },
        required: [],
      },
    },
  },
  // NEW: KB tool for course content Q&A
  {
    type: "function",
    function: {
      name: "course_info",
      description:
        "Return structured facts about a course (content, duration, assessment/exam, pass mark, certificate validity, prerequisites, delivery).",
      parameters: {
        type: "object",
        properties: {
          courseTerm: { type: "string", description: "User's course name or abbreviation (e.g., SMSTS, SSSTS Refresher)." },
          fields: {
            type: "array",
            description: "Optional list of specific fields to return.",
            items: {
              type: "string",
              enum: [
                "duration_days",
                "overview",
                "topics",
                "certificate",
                "assessment",
                "exam",
                "pass_mark",
                "delivery",
                "prerequisites",
                "attendance",
                "booking_notes",
              ],
            },
          },
        },
        required: ["courseTerm"],
      },
    },
  },
];

function safeJSONParse(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/* =========================
   Helpers (existing + minor)
   ========================= */
function cleanQuery(s = "") {
  return String(s)
    .replace(/\b(and|also|pls|please|hi|hello)\b/gi, " ")
    .replace(/[?!.;,/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }
function baseCourseTitle(full) {
  if (!full) return "";
  return String(full).split("|")[0].trim();
}

function isBookingIntent(t = "") {
  const s = String(t).toLowerCase();
  return /\b(book|booking|cheapest|price|cost|availability|spaces|options|next week|next month|dates|schedule|when|where|location|venue)\b/.test(s);
}
function isCourseInfoIntent(t = "") {
  const s = String(t).toLowerCase();
  return /\b(pass mark|passing score|exam|assessment|duration|certificate|valid|validity|prerequisite|attendance|topics|content|open[- ]?book|delivery)\b/.test(s);
}

/* ---------- HTML renderers (card UI) ---------- */
function escapeHtml(s = "") {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function normalizeDatesText(s = "") {
  return String(s)
    .replace(/\\n/g, "<br>")
    .replace(/\n/g, "<br>");
}

function renderCardsHTML(items) {
  const cards = items.map(it => {
    const titleOnly = baseCourseTitle(it.title || "");
    const title = escapeHtml(titleOnly);
    const dates = normalizeDatesText(it.dates || "");
    const venue = escapeHtml(it.venueOrFormat || "Venue TBC");
    const price = escapeHtml(`£${it.price ?? ""}`);
    const spaces = escapeHtml(String(it.spaces ?? "")); 
    const link = String(it.link || "#");

    return `
      <div class="course-card">
        <h3 class="course-title">${title}</h3>
        <div class="course-meta">
          <div><strong>Dates:</strong><br> ${dates}</div>
          <div><strong>Venue:</strong> ${venue}</div>
          <div><strong>Price:</strong> ${price}</div>
          <div><strong>Spaces:</strong> ${spaces}</div>
        </div>
        <a href="${link}" target="_blank" rel="noopener" class="book-btn">BOOK NOW</a>
      </div>
    `;
  }).join("");

  return `<div class="cards-grid">${cards}</div>`;
}

function renderHeaderHTML({ items, dateLabel, locationLabel }) {
  const loc = locationLabel ? ` in ${escapeHtml(capitalize(locationLabel))}` : "";
  const when = dateLabel ? ` for ${escapeHtml(dateLabel)}` : "";
  return `<p class="result-header">Here ${items.length === 1 ? "is" : "are"} ${items.length} option${items.length === 1 ? "" : "s"}${loc}${when}:</p>`;
}

function renderResultsHTML({ items, dateLabel, locationLabel }) {
  return `${renderHeaderHTML({ items, dateLabel, locationLabel })}${renderCardsHTML(items)}`;
}

function renderZeroResultsHTML({ dateLabel, locationLabel, askedRefresher }) {
  const where = locationLabel ? ` in ${escapeHtml(capitalize(locationLabel))}` : "";
  const when = dateLabel ? ` for ${escapeHtml(dateLabel)}` : " in the selected window";
  const altOnline = `<ul class="tips"><li>Try expanding the date window</li><li>Consider <strong>nearby locations</strong></li>${askedRefresher ? "<li>Check <strong>Standard</strong> (non-refresher) sessions</li>" : "<li>Check <strong>Refresher</strong> versions if applicable</li>"}</ul>`;
  const altVenue  = `<ul class="tips"><li>Try expanding the date window</li><li>Consider <strong>online</strong> options</li>${askedRefresher ? "<li>Check <strong>Standard</strong> (non-refresher) sessions</li>" : "<li>Check <strong>Refresher</strong> versions if applicable</li>"}</ul>`;
  const alt = (locationLabel === "online") ? altOnline : altVenue;
  return `<p>I couldn't find matching courses${where}${when}.</p>${alt}`;
}

function renderVariantNotOfferedHTML({ recognizedFamily, suggestions = [] }) {
  const sug = suggestions.slice(0, 3).map(s => `<li>${escapeHtml(s.label)}</li>`).join("")
    || `<li>SMSTS (Standard / Refresher)</li><li>SSSTS (Standard / Refresher)</li><li>HSA / TWC / TWS</li>`;
  return `
    <p>The <strong>${escapeHtml(recognizedFamily)} Refresher</strong> course is not part of our catalogue.</p>
    <p>Perhaps you meant:</p>
    <ul class="tips">${sug}</ul>
  `;
}

function renderMissingFamilyHTML({ suggestions = [] }) {
  const sug = suggestions.slice(0, 3).map(s => `<li>${escapeHtml(s.label)}</li>`).join("")
    || `<li>SMSTS / SSSTS (Standard or Refresher)</li><li>HSA / TWC / TWS</li>`;
  return `
    <p>I couldn't identify a valid course from your message.</p>
    <p>You could try:</p>
    <ul class="tips">${sug}</ul>
  `;
}

function renderDiagnosticsZeroHTML({ courseTerm, dateLabel, locationLabel, diag }) {
  const loc = locationLabel ? ` in ${escapeHtml(capitalize(locationLabel))}` : "";
  const when = dateLabel ? ` for ${escapeHtml(dateLabel)}` : "";

  let display = courseTerm || "your requested course";
  const hasRef = /\brefresher\b/i.test(display);
  if (diag?.refresher === true && !hasRef) display += " Refresher";
  if (diag?.refresher === false && hasRef) display = display.replace(/\s*refresher\b/i, "").trim();

  const altOnline = `<p>Would you like to expand your date window or consider <strong>nearby locations</strong>?</p>`;
  const altVenue  = `<p>Would you like to expand your date window or consider <strong>online</strong> options?</p>`;
  const altTail = (locationLabel === "online") ? altOnline : altVenue;

  if (diag && diag.hasAnyFamilyRef === false) {
    return `<p>I couldn't find <strong>${escapeHtml(display)}</strong> sessions anywhere at the moment.</p>${altTail}`;
  }
  if (diag && diag.hasInDateAnyLoc === false) {
    const best = (diag.nearestInLocation?.[0] || diag.nearestAnywhere?.[0]);
    if (best) {
      const cards = renderCardsHTML([best]);
      return `<p>No <strong>${escapeHtml(display)}</strong> sessions${when}${loc}. The next available is:</p>${cards}${altTail}`;
    }
    return `<p>No <strong>${escapeHtml(display)}</strong> sessions${when}${loc}.</p>${altTail}`;
  }
  if (diag && diag.hasInLocAnyDate === false) {
    const best = diag.nearestAnywhere?.[0];
    if (best) {
      const cards = renderCardsHTML([best]);
      return `<p>No <strong>${escapeHtml(display)}</strong> sessions${when} in ${escapeHtml(capitalize(locationLabel))}. The closest match elsewhere is:</p>${cards}${altTail}`;
    }
    return `<p>No <strong>${escapeHtml(display)}</strong> sessions${when} in ${escapeHtml(capitalize(locationLabel))}.</p>${altTail}`;
  }
  return `<p>No matching results${when}${loc}.</p>${altTail}`;
}

/* ---------- Precise in-file search when QC is valid ---------- */
function matchLocation(userLocation, productName) {
  if (!userLocation) return true;
  const facet = detectLocationFacet(productName);
  if (!facet) return false;
  const facLow = String(facet).toLowerCase();
  if (userLocation === "online") return facLow === "online";
  return facLow.includes(String(userLocation).toLowerCase());
}

function mapItem(r) {
  return {
    id: r.id,
    title: r.name,
    dates: r.dates_list || `${r.start_date || ""}${r.end_date ? ` - ${r.end_date}` : ""}`,
    price: r.price,
    spaces: r.available_spaces,
    link: r.link,
    venueOrFormat: detectLocationFacet(r.name) || "Venue TBC",
    startTS: parseLooseDate(r.start_date)?.toISOString() ?? null,
  };
}

function searchPrecisely(products, { normalizedFamily, refresherRequested, location, dateRange }) {
  let filtered = (products || []).filter(p => {
    const name = p?.name || "";
    if (!isCourseMatchByFamily(name, normalizedFamily)) return false;
    if (!isRefresherMatch(name, refresherRequested)) return false;
    if (dateRange && (dateRange.start || dateRange.end)) {
      if (!withinRange(p.start_date, [dateRange.start, dateRange.end])) return false;
    }
    if (!matchLocation(location, name)) return false;
    return true;
  });

  filtered.sort((a, b) => {
    const da = parseLooseDate(a.start_date)?.getTime() ?? Infinity;
    const db = parseLooseDate(b.start_date)?.getTime() ?? Infinity;
    if (da !== db) return da - db;
    return toNumericPrice(a.price) - toNumericPrice(b.price);
  });

  const seen = new Set();
  filtered = filtered.filter(r => {
    const key = `${r.name}::${r.start_date}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return filtered.map(mapItem);
}

/* =========================
   Tool router (extended)
   ========================= */
async function toolRouter(tc) {
  const call = tc.function;

  if (call.name === "normalize_dates") {
    const { text } = safeJSONParse(call.arguments, { text: "" });
    const win = normalizeDateWindow(text || "");
    return { start: win.start.toISOString(), end: win.end.toISOString(), label: win.label };
  }

  if (call.name === "search_courses") {
    const args = safeJSONParse(call.arguments || "{}", {});
    const endpoint = process.env.PRODUCTS_ENDPOINT;
    if (!endpoint) throw new Error("Missing PRODUCTS_ENDPOINT");

    const products = await fetchProducts(endpoint);

    // 1) Clean & validate
    const rq = cleanQuery(args.rawQuery || "");
    const mergedForQC = `${rq} ${args.courseTerm || ""}`.trim();
    const qc = validateCourseQuery(mergedForQC);

    // 2) Invalid variant (e.g., TWS Refresher) → stop early
    if (qc.exists === false) {
      return { count: 0, dateLabel: null, items: [], qc };
    }

    // 3) Date window & location derived strictly from current message
    const dateRange = normalizeDateWindow(args.dateText || rq || "");
    const derivedLoc = detectUserLocationFromText(rq || "");
    const effectiveLocation = (derivedLoc !== null) ? derivedLoc : null;

    // 4) Precise search using QC-normalized family / refresher flag
    const items = searchPrecisely(products, {
      normalizedFamily: qc.normalizedFamily || qc.recognizedFamily || null,
      refresherRequested: qc.refresherRequested,
      location: effectiveLocation,
      dateRange,
    });

    // 5) Diagnostics only when 0 results
    let diagnostics = null;
    if (items.length === 0) {
      diagnostics = diagnoseSearch(products, {
        courseTerm: qc.normalizedFamily || mergedForQC,
        location: effectiveLocation,
        dateRange,
        includeRefresher:
          typeof args.includeRefresher === "boolean" ? args.includeRefresher : qc.refresherRequested
      });
    }

    return {
      count: items.length,
      dateLabel: dateRange.label,
      items: items.slice(0, 8),
      qc,
      diagnostics
    };
  }

  // NEW: KB Q&A
  if (call.name === "course_info") {
    const { courseTerm, fields = [] } = safeJSONParse(call.arguments || "{}", {});
    const kb = await loadCourseKB();
    const found = kbMatchCourse(kb, courseTerm);
    if (!found) {
      return { found: false, error: `No course matched "${courseTerm}".` };
    }
    const payload = kbPickFields(found, fields);
    return { found: true, id: found.id, title: found.title, course: payload };
  }

  throw new Error(`Unknown tool: ${call.name}`);
}

/* =========================
   Fallbacks server-side
   ========================= */
function renderCourseInfoHTML({ id, title, course }) {
  const lines = [];

  const hdr = `<h3 class="course-title">${escapeHtml(title || id)}</h3>`;
  lines.push(hdr);

  const bullets = [];

  if (course.duration_days != null) bullets.push(`<li><strong>Duration:</strong> ${course.duration_days} day(s)</li>`);
  if (Array.isArray(course.delivery) && course.delivery.length)
    bullets.push(`<li><strong>Delivery:</strong> ${escapeHtml(course.delivery.join(", "))}</li>`);
  if (course.attendance_required != null)
    bullets.push(`<li><strong>Attendance:</strong> ${course.attendance_required ? "Required" : "Not required"}</li>`);
  if (Array.isArray(course.prerequisites) && course.prerequisites.length)
    bullets.push(`<li><strong>Prerequisites:</strong> ${escapeHtml(course.prerequisites.join("; "))}</li>`);
  if (course.overview) bullets.push(`<li><strong>Overview:</strong> ${escapeHtml(course.overview)}</li>`);

  const ex = course.exam || course.assessment?.exam;
  if (ex) {
    const examBits = [];
    if (ex.duration_minutes != null) examBits.push(`${ex.duration_minutes} min`);
    if (ex.questions) {
      const parts = [];
      if (ex.questions.multiple_choice != null) parts.push(`${ex.questions.multiple_choice} MCQ`);
      if (ex.questions.short_answer != null) parts.push(`${ex.questions.short_answer} short-answer`);
      if (ex.questions.free_text != null) parts.push(`${ex.questions.free_text} free-text`);
      if (!parts.length && ex.questions.total != null) parts.push(`${ex.questions.total} questions`);
      examBits.push(parts.join(", "));
    }
    if (ex.open_book === true || ex.open_book === false || ex.open_book?.allowed_last_minutes != null) {
      const ob = ex.open_book?.allowed_last_minutes != null
        ? `open-book in the last ${ex.open_book.allowed_last_minutes} min${ex.open_book.materials ? ` (allowed: ${escapeHtml(ex.open_book.materials.join(", "))})` : ""}`
        : (ex.open_book ? "open-book" : "closed-book");
      examBits.push(ob);
    }
    if (ex.pass_mark_percent != null) examBits.push(`pass mark ${ex.pass_mark_percent}%`);
    bullets.push(`<li><strong>Assessment:</strong> ${escapeHtml(examBits.join(" • "))}</li>`);
  }

  if (course.certificate) {
    const certBits = [];
    if (course.certificate.valid_years != null) certBits.push(`valid ${course.certificate.valid_years} years`);
    if (course.certificate.renewal_course) certBits.push(`renewal via ${escapeHtml(course.certificate.renewal_course)}`);
    if (course.certificate.issue_time_weeks) certBits.push(`issued in ${escapeHtml(course.certificate.issue_time_weeks)} weeks`);
    if (certBits.length) bullets.push(`<li><strong>Certificate:</strong> ${certBits.join(" • ")}</li>`);
  }

  if (Array.isArray(course.topics) && course.topics.length)
    bullets.push(`<li><strong>Topics:</strong> ${escapeHtml(course.topics.join(", "))}</li>`);
  if (Array.isArray(course.booking_notes) && course.booking_notes.length)
    bullets.push(`<li><strong>Notes:</strong> ${escapeHtml(course.booking_notes.join("; "))}</li>`);

  if (bullets.length) {
    lines.push(`<ul class="course-facts">${bullets.join("")}</ul>`);
  } else {
    lines.push(`<p>No additional details found for this course.</p>`);
  }

  return `<div class="course-info">${lines.join("")}</div>`;
}

async function forceCourseInfoIfNeeded(message, toolResults) {
  if (toolResults["course_info"]) return null;        // deja avem
  if (!isCourseInfoIntent(message)) return null;      // nu e întrebare de conținut

  const kb = await loadCourseKB();
  const found = kbMatchCourse(kb, message);
  if (!found) return { reply: "I couldn't identify the course in your question. Which course do you mean?" };

  // Dacă e întrebare de tip pass mark, extragem strict acele câmpuri; altfel, returnăm un rezumat util
  const wantsPassMark = /\b(pass mark|passing score)\b/i.test(message);
  const payload = wantsPassMark
    ? kbPickFields(found, ["pass_mark", "exam"])
    : kbPickFields(found, ["duration_days","delivery","attendance","prerequisites","overview","exam","certificate","topics","booking_notes"]);

  // Mic răspuns scurt dacă e doar pass mark
  const pm = payload.pass_mark ?? payload.exam?.pass_mark_percent;
  if (wantsPassMark && pm != null) {
    const reply = `**${found.title}** pass mark: **${pm}%**.`;
    return { reply, format: "cards", toolResults: { ...toolResults, course_info: { found: true, id: found.id } } };
  }

  const html = renderCourseInfoHTML({ id: found.id, title: found.title, course: payload });
  return { reply: html, format: "cards", toolResults: { ...toolResults, course_info: { found: true, id: found.id } } };
}

async function forceSearchIfNeeded(message, toolResults) {
  if (toolResults["search_courses"]) return null;
  if (!isBookingIntent(message)) return null;

  const endpoint = process.env.PRODUCTS_ENDPOINT;
  if (!endpoint) return null;

  const products = await fetchProducts(endpoint);

  const rq = cleanQuery(message || "");
  const qc = validateCourseQuery(rq);
  if (qc.exists === false) return null;

  const dateRange = normalizeDateWindow(rq || "");
  const derivedLoc = detectUserLocationFromText(rq || "");
  const effectiveLocation = (derivedLoc !== null) ? derivedLoc : null;

  const items = searchPrecisely(products, {
    normalizedFamily: qc.normalizedFamily || qc.recognizedFamily || null,
    refresherRequested: qc.refresherRequested,
    location: effectiveLocation,
    dateRange,
  });

  if (!items.length) return null;

  const locationLabel = derivedLoc || "";
  const dateLabel = dateRange.label || "";
  const reply = renderResultsHTML({ items, dateLabel, locationLabel });
  return { reply, format: "cards", toolResults: { ...toolResults, search_courses: { count: items.length } } };
}

/* =========================
   API handler
   ========================= */
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

  const { message, context } = req.body || {};
  if (!message) return res.status(400).json({ error: "Missing 'message'" });

  const cleanContext = Array.isArray(context)
    ? context.filter(m => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string")
              .slice(-6)
              .map(m => ({ role: m.role, content: m.content }))
    : [];

  const msgs = [
    { role: "system", content: SYSTEM_PROMPT },
    ...cleanContext,
    { role: "user", content: String(message) },
  ];

  try {
    let toolResults = {};
    let loopGuard = 0;

    while (loopGuard++ < 4) {
      const response = await openai.chat.completions.create({
        model: "gpt-4o-mini",
        messages: msgs,
        tools: TOOLS,
        tool_choice: "auto",
        temperature: 0.2,
      });

      const assistantMsg = response.choices?.[0]?.message;
      if (!assistantMsg) throw new Error("No assistant message returned");
      msgs.push(assistantMsg);

      const toolCalls = assistantMsg.tool_calls || [];
      if (toolCalls.length === 0) {
        // Fallback 1: forțează course_info dacă e întrebare de conținut
        const forcedInfo = await forceCourseInfoIfNeeded(message, toolResults);
        if (forcedInfo) {
          return res.status(200).json(forcedInfo);
        }
        // Fallback 2: forțează search dacă pare intenție de booking/listing
        const forcedSearch = await forceSearchIfNeeded(message, toolResults);
        if (forcedSearch) {
          return res.status(200).json(forcedSearch);
        }

        // Altfel, returnăm conținutul „așa cum e”
        return res.status(200).json({ reply: assistantMsg.content || "I couldn't generate a reply.", toolResults });
      }

      for (const tc of toolCalls) {
        const result = await toolRouter(tc);
        toolResults[tc.function.name] = result;
        msgs.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(result) });
      }

      // Prefer rendering search results (existing behavior)
      const lastSearch = toolResults["search_courses"];
      if (lastSearch) {
        let latestUser = "";
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === "user" && typeof msgs[i].content === "string") { latestUser = msgs[i].content; break; }
        }
        const locationLabel = detectUserLocationFromText(cleanQuery(latestUser) || "") || "";
        const dateLabel = (lastSearch.dateLabel || "");
        const items = lastSearch.items || [];
        const qc = lastSearch.qc || null;

        if (qc && qc.exists === false) {
          const reply = (qc.reason === "variant_not_offered")
            ? renderVariantNotOfferedHTML({ recognizedFamily: qc.recognizedFamily, suggestions: qc.suggestions })
            : renderMissingFamilyHTML({ suggestions: qc.suggestions });
          return res.status(200).json({ reply, format: "cards", toolResults });
        }

        if (items.length > 0) {
          const reply = renderResultsHTML({ items, dateLabel, locationLabel });
          return res.status(200).json({ reply, format: "cards", toolResults });
        }

        const label = (qc && (qc.normalizedFamily || qc.recognizedFamily)) || "your requested course";
        if (lastSearch.diagnostics) {
          const reply = renderDiagnosticsZeroHTML({
            courseTerm: label,
            dateLabel,
            locationLabel,
            diag: lastSearch.diagnostics,
          });
          return res.status(200).json({ reply, format: "cards", toolResults });
        } else {
          const askedRefresher = /\brefresher\b/i.test(cleanQuery(latestUser));
          const reply = renderZeroResultsHTML({ dateLabel, locationLabel, askedRefresher });
          return res.status(200).json({ reply, format: "cards", toolResults });
        }
      }

      // Dacă nu s-a chemat search_courses dar avem course_info → afișăm KB info
      const kbInfo = toolResults["course_info"];
      if (kbInfo && kbInfo.found) {
        const reply = renderCourseInfoHTML({ id: kbInfo.id, title: kbInfo.title, course: kbInfo.course });
        return res.status(200).json({ reply, format: "cards", toolResults });
      }

      // Otherwise, continue the loop for another round of tool calls
    }

    return res.status(200).json({ reply: "I reached the tool-call limit. Please refine your query.", toolResults });
  } catch (err) {
    console.error("[/api/ask] Error:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
