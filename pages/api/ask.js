// pages/api/ask.js
import OpenAI from "openai";
import { normalizeDateWindow, parseLooseDate } from "../../lib/dates.js";
import {
  fetchProducts,
  // searchCoursesInMemory,  // evităm pentru cazurile cu Refresher, facem filtrarea corectă aici
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

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are a concise, proactive sales agent for construction training courses.
- Understand three inputs: course (incl. abbreviations), location/venue (city/online), date window (natural language like "next month", "next 2 weeks", "end of September").
- Do NOT reuse a previous location or date unless the user repeats or clearly confirms it in the latest message.
- When the user provides only ONE of the three, ask ONE guided follow-up to get a second parameter. With ≥2 parameters, return results.
- Never invent prices, dates, or availability: use tool results only.
- Prefer English. Keep answers compact, scannable (bullets).
- If a course can be Standard vs Refresher, confirm when ambiguous. For NEBOSH, ask "General or Construction?" when unclear.
- If there are no exact matches, relax constraints in this order: date window → nearby/online → refresher/standard, and explain what you relaxed.
- For each suggestion, show: Title, Dates (dates_list), Venue/Format, Price, Spaces, and [Book] link.
- Default ranking: soonest → lowest price. Do not list duplicates.
- Tone: friendly, efficient, solution-oriented.

Tool usage policy:
- When calling search_courses, always pass rawQuery with the user's latest message content to help the server detect nuances (e.g., "refresher").
`;

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
];

function safeJSONParse(str, fallback = {}) {
  try { return JSON.parse(str); } catch { return fallback; }
}

/* ---------- Helpers ---------- */

function cleanQuery(s = "") {
  return String(s)
    .replace(/\b(and|also|pls|please|hi|hello)\b/gi, " ")
    .replace(/[?!.;,/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function capitalize(s) { return s ? s.charAt(0).toUpperCase() + s.slice(1) : s; }

function makeCourseLabelFromQC(qc) {
  if (!qc) return "your requested course";
  if (qc.exists && qc.normalizedFamily) return qc.normalizedFamily; // e.g., "SSSTS Refresher"
  if (qc.recognizedFamily) return qc.refresherRequested ? `${qc.recognizedFamily} Refresher` : qc.recognizedFamily;
  return "your requested course";
}

/* ---------- Renderers ---------- */

function renderResultsText({ items, dateLabel, locationLabel }) {
  const loc = locationLabel ? ` in ${capitalize(locationLabel)}` : "";
  const when = dateLabel ? ` for ${dateLabel}` : "";
  const header = `Here ${items.length === 1 ? "is" : "are"} ${items.length} option${items.length === 1 ? "" : "s"}${loc}${when}:`;
  const lines = items.map((it, i) => {
    const title = String(it.title || "").replace(/\s+\|\s*/g, " | ");
    return `${i + 1}. **${title}**
- **Dates:** ${it.dates}
- **Venue/Format:** ${it.venueOrFormat}
- **Price:** £${it.price}
- **Spaces:** ${it.spaces}
- [Book](${it.link})`;
  });
  return `${header}\n\n${lines.join("\n\n")}`;
}

function renderZeroResultsText({ dateLabel, locationLabel, askedRefresher }) {
  const where = locationLabel ? ` in ${capitalize(locationLabel)}` : "";
  const when = dateLabel ? ` for ${dateLabel}` : " in the selected window";
  const altOnline = `\n\nYou can try:\n- expanding the date window,\n- considering **nearby locations**,`;
  const altVenue = `\n\nYou can try:\n- expanding the date window,\n- considering **online** options,`;
  const altRef = askedRefresher
    ? `\n- checking **Standard** (non-refresher) sessions.`
    : `\n- or checking **Refresher** versions if applicable.`;
  const alt = (locationLabel === "online" ? altOnline : altVenue) + altRef;
  return `I couldn't find matching courses${where}${when}.${alt}`;
}

function renderVariantNotOffered({ recognizedFamily, suggestions = [] }) {
  const sug = suggestions.slice(0, 3).map(s => `- ${s.label}`).join("\n")
    || "- SMSTS (Standard / Refresher)\n- SSSTS (Standard / Refresher)\n- HSA / TWC / TWS";
  return `The **${recognizedFamily} Refresher** course is not part of our catalogue.\n\nPerhaps you meant:\n${sug}`;
}

function renderMissingFamily({ suggestions = [] }) {
  const sug = suggestions.slice(0, 3).map(s => `- ${s.label}`).join("\n")
    || "- SMSTS / SSSTS (Standard or Refresher)\n- HSA / TWC / TWS";
  return `I couldn't identify a valid course from your message.\n\nYou could try:\n${sug}`;
}

function renderDiagnosticsZero({ courseTerm, dateLabel, locationLabel, diag }) {
  const loc = locationLabel ? ` in ${capitalize(locationLabel)}` : "";
  const when = dateLabel ? ` for ${dateLabel}` : "";

  // normalize label to avoid "Refresher Refresher"
  let display = courseTerm || "your requested course";
  const hasRef = /\brefresher\b/i.test(display);
  if (diag?.refresher === true && !hasRef) display += " Refresher";
  if (diag?.refresher === false && hasRef) display = display.replace(/\s*refresher\b/i, "").trim();

  const altOnline = `\n\nWould you like to expand your date window or consider **nearby locations**?`;
  const altVenue  = `\n\nWould you like to expand your date window or consider **online** options?`;
  const altTail = (locationLabel === "online") ? altOnline : altVenue;

  if (diag && diag.hasAnyFamilyRef === false) {
    return `I couldn't find **${display}** sessions anywhere at the moment.${altTail}`;
  }
  if (diag && diag.hasInDateAnyLoc === false) {
    const best = (diag.nearestInLocation?.[0] || diag.nearestAnywhere?.[0]);
    if (best) {
      return `No **${display}** sessions${when}${loc}. The next available is:
- **${best.title}**
  - **Dates:** ${best.dates}
  - **Venue/Format:** ${best.venueOrFormat}
  - **Price:** £${best.price}
  - **Spaces:** ${best.spaces}
  - [Book](${best.link})${altTail}`;
    }
    return `No **${display}** sessions${when}${loc}.${altTail}`;
  }
  if (diag && diag.hasInLocAnyDate === false) {
    const best = diag.nearestAnywhere?.[0];
    if (best) {
      return `No **${display}** sessions${when} in ${capitalize(locationLabel)}. The closest match elsewhere is:
- **${best.title}**
  - **Dates:** ${best.dates}
  - **Venue/Format:** ${best.venueOrFormat}
  - **Price:** £${best.price}
  - **Spaces:** ${best.spaces}
  - [Book](${best.link})${altTail}`;
    }
    return `No **${display}** sessions${when} in ${capitalize(locationLabel)}.${altTail}`;
  }
  return `No matching results${when}${loc}.${altTail}`;
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
    // family match uses normalizedFamily literal (e.g., "SSSTS Refresher")
    if (!isCourseMatchByFamily(name, normalizedFamily)) return false;
    // refresher flag respected strictly if requested explicitly; if null -> allow both
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

/* ---------- Tool router ---------- */

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

    // 4) If QC is valid and has normalized family → do precise in-file search (fixes Refresher bugs)
    let items = searchPrecisely(products, {
      normalizedFamily: qc.normalizedFamily || qc.recognizedFamily || null,
      refresherRequested: qc.refresherRequested, // true/false/null
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

  throw new Error(`Unknown tool: ${call.name}`);
}

/* ---------- API handler ---------- */

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
        return res.status(200).json({ reply: assistantMsg.content || "I couldn't generate a reply.", toolResults });
      }

      for (const tc of toolCalls) {
        const result = await toolRouter(tc);
        toolResults[tc.function.name] = result;
        msgs.push({ role: "tool", tool_call_id: tc.id, name: tc.function.name, content: JSON.stringify(result) });
      }

      const lastSearch = toolResults["search_courses"];
      if (lastSearch) {
        // derive labels from latest user message
        let latestUser = "";
        for (let i = msgs.length - 1; i >= 0; i--) {
          if (msgs[i].role === "user" && typeof msgs[i].content === "string") { latestUser = msgs[i].content; break; }
        }
        const locationLabel = detectUserLocationFromText(cleanQuery(latestUser) || "") || "";
        const dateLabel = (lastSearch.dateLabel || "");
        const items = lastSearch.items || [];
        const qc = lastSearch.qc || null;

        // invalid variant / missing family
        if (qc && qc.exists === false) {
          const reply = (qc.reason === "variant_not_offered")
            ? renderVariantNotOffered({ recognizedFamily: qc.recognizedFamily, suggestions: qc.suggestions })
            : renderMissingFamily({ suggestions: qc.suggestions });
          return res.status(200).json({ reply, toolResults });
        }

        // results
        if (items.length > 0) {
          const reply = renderResultsText({ items, dateLabel, locationLabel });
          return res.status(200).json({ reply, toolResults });
        }

        // zero results
        const label = makeCourseLabelFromQC(qc);
        if (lastSearch.diagnostics) {
          const reply = renderDiagnosticsZero({
            courseTerm: label,
            dateLabel,
            locationLabel,
            diag: lastSearch.diagnostics,
          });
          return res.status(200).json({ reply, toolResults });
        } else {
          const askedRefresher = /\brefresher\b/i.test(cleanQuery(latestUser));
          const reply = renderZeroResultsText({ dateLabel, locationLabel, askedRefresher });
          return res.status(200).json({ reply, toolResults });
        }
      }
    }

    return res.status(200).json({ reply: "I reached the tool-call limit. Please refine your query.", toolResults });
  } catch (err) {
    console.error("[/api/ask] Error:", err);
    return res.status(500).json({ error: String(err.message || err) });
  }
}
