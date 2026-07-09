import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

// Simple in-memory cache keyed by place + section + trip signature.
const cache = new Map();

/* ============================== text utils ============================== */

const cleanText = (v) => String(v || "").replace(/\s+/g, " ").trim();
const clamp = (n, lo, hi) => Math.max(lo, Math.min(hi, n));
const pick = (arr, i) => arr[((i % arr.length) + arr.length) % arr.length];

function titleCase(str) {
  return cleanText(str)
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

function splitSentences(text) {
  return cleanText(text)
    .split(/(?<=[.!?])\s+(?=[A-Z0-9"'(])/)
    .map((s) => s.trim())
    .filter(Boolean);
}

function firstSentences(text, n = 2, maxLen = 320) {
  const joined = splitSentences(text).slice(0, n).join(" ").trim();
  if (!joined) return "";
  return joined.length > maxLen ? joined.slice(0, maxLen).replace(/\s+\S*$/, "").trim() + "..." : joined;
}

function firstSentence(text, maxLen = 160) {
  return firstSentences(text, 1, maxLen);
}

const today = () =>
  new Date().toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

/* ============================ trip normalizer ============================ */

const BUDGET_WORDS = { budget: "budget", "mid-range": "mid-range", midrange: "mid-range", luxury: "luxury" };

function normalizeTrip(body = {}) {
  const t = body.trip || {};
  const days = clamp(parseInt(t.days, 10) || 3, 1, 10);
  const budget = BUDGET_WORDS[cleanText(t.budget).toLowerCase()] || "mid-range";
  const style = ["relaxed", "balanced", "packed"].includes(cleanText(t.style).toLowerCase())
    ? cleanText(t.style).toLowerCase()
    : "balanced";
  const interests = Array.isArray(t.interests)
    ? [...new Set(t.interests.map((x) => cleanText(x)).filter(Boolean))].slice(0, 8)
    : [];
  const season = cleanText(t.season);
  return { days, budget, style, interests, season };
}

const interestPhrase = (trip) => trip.interests.join(", ");
const wantsNightlife = (trip) => trip.interests.some((i) => /night|bar|club|party/i.test(i));

/* ============================== Tavily ============================== */

async function tavily(query, { depth = "basic", maxResults = 5, includeAnswer = true } = {}) {
  if (!TAVILY_API_KEY) {
    throw new Error(
      "Missing TAVILY_API_KEY. Add it to .env locally and to the Render environment variables online."
    );
  }

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: depth,
      include_answer: includeAnswer,
      include_raw_content: false,
      max_results: maxResults,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Tavily error:", response.status, text);
    throw new Error("Tavily request failed. Check your TAVILY_API_KEY or credits.");
  }

  const data = await response.json();
  const results = (data.results || []).map((r) => ({
    title: cleanText(r.title),
    url: r.url || "",
    content: cleanText(r.content || r.snippet || ""),
  }));

  return { answer: cleanText(data.answer || ""), results };
}

async function tavilySafe(query, opts) {
  try {
    return await tavily(query, opts);
  } catch (err) {
    console.error("tavilySafe failed:", query, "-", err.message);
    return { answer: "", results: [] };
  }
}

/* ============================ normalizers ============================ */

function fieldValue(res, fallback, { sentences = 2, maxLen = 320 } = {}) {
  const fromAnswer = firstSentences(res.answer, sentences, maxLen);
  if (fromAnswer) return fromAnswer;
  const snippet = (res.results.find((r) => r.content) || {}).content;
  const fromSnippet = firstSentences(snippet || "", sentences, maxLen);
  if (fromSnippet) return fromSnippet;
  return fallback;
}

function collectSources(...groups) {
  const seen = new Set();
  const out = [];
  for (const group of groups) {
    for (const r of group || []) {
      if (!r.url || seen.has(r.url)) continue;
      seen.add(r.url);
      out.push({ title: r.title || "Source", url: r.url });
      if (out.length >= 6) return out;
    }
  }
  return out;
}

const TAG_DICT = [
  ["Food & drink", /\b(food|cuisine|culinary|tapas|restaurant|gastronom|dish|wine|coffee)\b/i],
  ["History", /\b(history|historic|ancient|medieval|roman|heritage|ruins)\b/i],
  ["Art & museums", /\b(art|museum|gallery|painting|prado|louvre|exhibit)\b/i],
  ["Architecture", /\b(architect|cathedral|palace|castle|basilica|gothic)\b/i],
  ["Nightlife", /\b(nightlife|bars?|clubs?|party|night out)\b/i],
  ["Beaches", /\b(beach|coast|seaside|shore|sea)\b/i],
  ["Nature", /\b(nature|park|mountain|hiking|lake|forest|garden)\b/i],
  ["Shopping", /\b(shopping|market|boutique|shops?)\b/i],
];

function deriveTags(text) {
  const tags = [];
  for (const [tag, re] of TAG_DICT) {
    if (re.test(text) && !tags.includes(tag)) tags.push(tag);
    if (tags.length >= 4) break;
  }
  if (tags.length === 0) return ["City break", "Culture"];
  return tags;
}

function makeCoolFacts(res, place) {
  let facts = splitSentences(res.answer)
    .map((s) => s.replace(/^[-*\d.\)\s]+/, "").trim())
    .filter((s) => s.length > 20 && s.length < 220);

  if (facts.length < 3) {
    for (const r of res.results) {
      const s = firstSentence(r.content, 200);
      if (s && s.length > 20 && !facts.includes(s)) facts.push(s);
      if (facts.length >= 4) break;
    }
  }

  if (facts.length === 0) {
    return [
      `${place} has a distinct local character shaped by its history and geography.`,
      `Each neighborhood in ${place} tends to have its own atmosphere worth exploring.`,
      `Local food and daily rhythms are a big part of the experience in ${place}.`,
    ];
  }
  return facts.slice(0, 4);
}

/* -------------------------------- overview -------------------------------- */

async function buildOverview(place, trip) {
  const seasonBit = trip.season ? ` in ${trip.season}` : "";
  const [base, location, why, known, best, length, budget, facts] = await Promise.all([
    tavilySafe(`${place} travel guide overview what to expect for visitors`, { depth: "advanced", maxResults: 6 }),
    tavilySafe(`Where is ${place} located country and region`, { maxResults: 3 }),
    tavilySafe(`Why visit ${place} top reasons to go${trip.interests.length ? " for " + interestPhrase(trip) : ""}`, { maxResults: 4 }),
    tavilySafe(`What is ${place} best known and famous for`, { maxResults: 4 }),
    tavilySafe(`Best time of year to visit ${place} weather and seasons${seasonBit}`, { maxResults: 4 }),
    tavilySafe(`How many days do you need in ${place} ideal trip length`, { maxResults: 4 }),
    tavilySafe(`${place} travel costs daily ${trip.budget} budget for tourists`, { maxResults: 4 }),
    tavilySafe(`Interesting facts about ${place}`, { maxResults: 5 }),
  ]);

  const destination = titleCase(place);
  return {
    destination,
    location: fieldValue(location, "See sources for exact location.", { sentences: 1, maxLen: 90 }),
    overview: fieldValue(base, `Live research summary for ${destination}. Open the tabs above for stay, do, eat, and logistics details.`, { sentences: 3, maxLen: 440 }),
    styleTags: deriveTags(`${known.answer} ${base.answer} ${why.answer} ${trip.interests.join(" ")}`),
    whyWorthVisiting: fieldValue(why, `${destination} rewards visitors with a strong mix of culture, food, and sights.`, { sentences: 2, maxLen: 300 }),
    knownFor: fieldValue(known, `Its landmarks, local cuisine, and distinct neighborhood character.`, { sentences: 2, maxLen: 260 }),
    bestTimeToVisit: fieldValue(best, `Spring and autumn usually bring mild weather and thinner crowds.`, { sentences: 2, maxLen: 240 }),
    recommendedTripLength: `${trip.days} day${trip.days > 1 ? "s" : ""} is a good fit; ${fieldValue(length, "3 to 4 days covers the main highlights.", { sentences: 1, maxLen: 120 })}`,
    budgetLevel: fieldValue(budget, `Planned as a ${trip.budget} trip; daily costs shift with season and style.`, { sentences: 2, maxLen: 220 }),
    coolFacts: makeCoolFacts(facts, destination),
    lastChecked: today(),
    sources: collectSources(base.results, why.results, known.results, best.results, budget.results, length.results, facts.results, location.results),
  };
}

/* ------------------------------- logistics ------------------------------- */

async function buildLogistics(place, trip) {
  const [airport, local, walk, group, safety, traps] = await Promise.all([
    tavilySafe(`How to get from the airport to central ${place} train or transfer`, { maxResults: 4 }),
    tavilySafe(`Getting around ${place} public transport metro bus passes`, { maxResults: 4 }),
    tavilySafe(`Is ${place} walkable for tourists`, { maxResults: 3 }),
    tavilySafe(`Which neighborhoods and areas to group together when sightseeing in ${place}`, { maxResults: 4 }),
    tavilySafe(`${place} safety tips for tourists`, { maxResults: 4 }),
    tavilySafe(`Tourist traps and scams to avoid in ${place}`, { maxResults: 4 }),
  ]);

  return {
    airportTrain: fieldValue(airport, "Check the official airport site for current transfer options and prices.", { sentences: 2, maxLen: 260 }),
    localTransport: fieldValue(local, "A mix of metro, bus, and walking usually covers most visitor needs.", { sentences: 2, maxLen: 260 }),
    walkability: fieldValue(walk, "The central core is generally walkable; use transit for longer hops.", { sentences: 2, maxLen: 220 }),
    groupAreas: fieldValue(group, "Cluster sights by neighborhood to cut down on back-and-forth travel.", { sentences: 2, maxLen: 240 }),
    safetyTips: fieldValue(safety, "Generally safe with standard city precautions; watch for pickpockets in crowds.", { sentences: 2, maxLen: 240 }),
    touristTraps: fieldValue(traps, "Be cautious with overpriced spots right next to major landmarks.", { sentences: 2, maxLen: 240 }),
    lastChecked: today(),
    sources: collectSources(airport.results, local.results, walk.results, group.results, safety.results, traps.results),
  };
}

/* ------------------------- list extraction helper ------------------------- */

function titleCaseName(s) {
  const t = cleanText(s);
  if (!t) return "";
  return t.charAt(0).toUpperCase() + t.slice(1);
}

// Turn a Tavily answer + results into a set of named items.
function extractItems(res, count = 6) {
  const items = [];
  const seen = new Set();

  let answer = res.answer;
  const colon = answer.indexOf(":");
  if (colon > 0 && colon < 80) answer = answer.slice(colon + 1);

  const phrases = answer
    .split(/[\n;,]|\band\b|\d+\.\s|•|\u2022/gi)
    .map((p) => cleanText(p).replace(/^[-*\s]+/, "").replace(/[.]$/, ""))
    .filter((p) => p.length >= 3 && p.length <= 70);

  for (const p of phrases) {
    const key = p.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    const match = res.results.find(
      (r) => r.content.toLowerCase().includes(key) || r.title.toLowerCase().includes(key)
    );
    items.push({
      name: titleCaseName(p),
      description: match ? firstSentence(match.content, 180) : "",
      url: match ? match.url : "",
    });
    if (items.length >= count) break;
  }

  if (items.length < 3) {
    for (const r of res.results) {
      const name = titleCaseName(cleanText(r.title).replace(/\s*[-|:].*$/, "").slice(0, 60));
      const key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key);
      items.push({ name, description: firstSentence(r.content, 180), url: r.url });
      if (items.length >= count) break;
    }
  }

  // Drop descriptions that are really just the list of names repeated.
  const names = items.map((it) => it.name.toLowerCase());
  for (const it of items) {
    const desc = it.description.toLowerCase();
    if (names.filter((n) => n && desc.includes(n)).length >= 2) it.description = "";
  }

  return items;
}

/* ------------------------- varied fallback banks ------------------------- */

const STAY_BEST_FOR = [
  "First-time visitors who want to walk to the main sights",
  "Food lovers who want restaurants at their doorstep",
  "Travelers after a quieter, more local feel",
  "Night owls who want bars and venues close by",
  "Value seekers a short ride from the center",
  "Couples wanting charm and character",
];
const STAY_PROS = [
  "Central, with major sights within walking distance.",
  "Excellent cafe and restaurant density.",
  "Calmer streets and a residential feel.",
  "Lively after dark with plenty to do nearby.",
  "Better value than the tourist core.",
  "Photogenic streets and strong local character.",
];
const STAY_CONS = [
  "Busier and pricier during peak season.",
  "Can get loud on weekend nights.",
  "A little farther from the top landmarks.",
  "Books up fast, so reserve early.",
  "Fewer marquee sights right on the doorstep.",
  "Narrow streets and limited parking.",
];
const DO_TIME = ["About 1 to 2 hours", "Give it half a day", "Roughly 2 to 3 hours", "A quick 45 to 60 minutes", "Easily a full morning"];
const EAT_ORDER = [
  "Ask about the house specialty.",
  "Go for a local classic you can't get at home.",
  "Share a few small plates to try more.",
  "Pair it with a regional drink.",
  "Save room for dessert here.",
];

/* ------------------------- list-style sections ------------------------- */

async function buildStay(place, trip) {
  const res = await tavilySafe(`Best neighborhoods and areas to stay in ${place} for ${trip.budget} travelers`, { depth: "advanced", maxResults: 8 });
  const items = extractItems(res, 6);
  const areas = items.map((it, i) => ({
    area: it.name,
    bestFor: it.description || pick(STAY_BEST_FOR, i),
    pros: pick(STAY_PROS, i),
    cons: pick(STAY_CONS, i),
    budget: titleCase(trip.budget),
    safety: "Generally safe with standard city precautions.",
  }));
  return {
    areas: areas.length ? areas : [{ area: `Central ${titleCase(place)}`, bestFor: STAY_BEST_FOR[0], pros: STAY_PROS[0], cons: STAY_CONS[0], budget: titleCase(trip.budget), safety: "Generally safe with standard city precautions." }],
    lastChecked: today(),
    sources: collectSources(res.results),
  };
}

const DO_TYPES = [
  ["Museum", /\b(museum|gallery|art)\b/i],
  ["Park", /\b(park|garden|retiro)\b/i],
  ["Landmark", /\b(palace|cathedral|basilica|castle|plaza|square|tower|monument)\b/i],
  ["Neighborhood", /\b(neighborhood|barrio|district|quarter)\b/i],
  ["Tour", /\b(tour|walk|trip|cruise)\b/i],
];
const guessType = (text, fallback = "Attraction") => (DO_TYPES.find(([, re]) => re.test(text)) || [fallback])[0];

async function buildDo(place, trip) {
  const focus = trip.interests.length ? ` for ${interestPhrase(trip)}` : "";
  const res = await tavilySafe(`Top things to do and must-see attractions in ${place}${focus}`, { depth: "advanced", maxResults: 8 });
  const items = extractItems(res, 6).map((it, i) => ({
    name: it.name,
    type: guessType(`${it.name} ${it.description}`),
    description: it.description || `A popular stop for visitors to ${titleCase(place)}.`,
    timeNeeded: pick(DO_TIME, i),
    booking: "Check the official site for hours and tickets.",
  }));
  return { items, lastChecked: today(), sources: collectSources(res.results) };
}

async function buildEat(place, trip) {
  const focus = trip.interests.length ? ` ${interestPhrase(trip)}` : "";
  const res = await tavilySafe(`Best ${trip.budget} restaurants, local food, and dishes to try in ${place}${focus}`, { depth: "advanced", maxResults: 8 });
  const items = extractItems(res, 6).map((it, i) => ({
    name: it.name,
    type: /\b(cafe|coffee|bakery|market|bar|tapas|street)\b/i.test(`${it.name} ${it.description}`) ? "Casual" : "Restaurant",
    whatToOrder: it.description || pick(EAT_ORDER, i),
    price: trip.budget === "budget" ? "Wallet-friendly" : trip.budget === "luxury" ? "Higher-end" : "Mid-range",
    reservation: "Recommended on weekends and evenings.",
  }));
  return { items, lastChecked: today(), sources: collectSources(res.results) };
}

async function buildLocal(place, trip) {
  const res = await tavilySafe(`Local specialties, hidden gems, and cultural tips in ${place}`, { depth: "advanced", maxResults: 8 });
  const items = extractItems(res, 6).map((it) => ({
    name: it.name,
    category: "Local highlight",
    why: it.description || "A local favorite that gives a more authentic feel for the place.",
    where: "Widely found across the city; ask locals for the best spot.",
  }));
  return { items, lastChecked: today(), sources: collectSources(res.results) };
}

/* ============================== itinerary ============================== */

const SLOT_FALLBACKS = {
  Morning: [
    { name: "Old town on foot", detail: "Start in the historic core before the crowds build." },
    { name: "Signature landmark", detail: "See one of the city's must-visit sights early." },
    { name: "Local market", detail: "Browse a market and grab breakfast like a local." },
    { name: "Viewpoint walk", detail: "Catch a skyline view while the light is good." },
  ],
  Afternoon: [
    { name: "Museum or gallery", detail: "Duck inside for a couple of hours of culture." },
    { name: "Neighborhood wander", detail: "Explore a district known for its character." },
    { name: "Park downtime", detail: "Slow the pace with a green space and a coffee." },
    { name: "Shopping street", detail: "Browse local shops and independent stores." },
  ],
  Evening: [
    { name: "Relaxed dinner nearby", detail: "Keep it easy close to where you're staying." },
    { name: "Sunset spot", detail: "Find a rooftop or terrace for the golden hour." },
    { name: "Evening stroll", detail: "Walk a lively square and people-watch." },
    { name: "Local bar", detail: "Try a regional drink where locals go." },
  ],
  Food: [
    { name: "Local lunch spot", detail: "Refuel with a regional dish mid-day." },
    { name: "Tapas or small plates", detail: "Graze a few local bites between sights." },
    { name: "Market food hall", detail: "Sample several vendors in one stop." },
    { name: "Neighborhood favorite", detail: "Eat where the locals actually line up." },
  ],
};

function slotFrom(label, item, dayIndex, fallbackDetail) {
  if (item && item.name) {
    return { slot: label, name: item.name, detail: item.description || fallbackDetail };
  }
  const fb = pick(SLOT_FALLBACKS[label] || [{ name: label, detail: "" }], dayIndex);
  return { slot: label, name: fb.name, detail: fb.detail || fallbackDetail };
}

const THEME_RULES = [
  ["Art & museums", /museum|gallery|art/i],
  ["Old town & landmarks", /old town|cathedral|palace|castle|plaza|square|historic|landmark/i],
  ["Parks & outdoors", /park|garden|hike|beach|mountain|lake|view/i],
  ["Food & markets", /market|food|tapas|restaurant|lunch|eat/i],
  ["Nightlife & bars", /night|bar|club/i],
  ["Neighborhood wander", /neighborhood|barrio|district|quarter|wander|shopping/i],
];

function themeFor(slots) {
  const text = slots.map((s) => `${s.name} ${s.detail}`).join(" ");
  for (const [label, re] of THEME_RULES) if (re.test(text)) return label;
  return "Highlights & hidden gems";
}

function daySummary(day, total, trip, place) {
  if (day === 1) return `Arrival day — ease in and get your bearings around ${place}.`;
  if (day === total && total > 1) return `Final day — revisit a favorite or fit in anything you missed.`;
  const focus = trip.interests.slice(0, 2).join(" and ") || "sights and food";
  return `A ${trip.style} day built around ${focus}.`;
}

async function buildItinerary(place, trip) {
  const nice = titleCase(place);
  const focus = trip.interests.length ? ` for ${interestPhrase(trip)}` : "";

  const [doRes, eatRes, hoodRes, nightRes] = await Promise.all([
    tavilySafe(`Top things to do and must-see attractions in ${place}${focus}`, { depth: "advanced", maxResults: 10 }),
    tavilySafe(`Best ${trip.budget} places to eat and local dishes in ${place}`, { depth: "advanced", maxResults: 8 }),
    tavilySafe(`Best neighborhoods and areas to explore in ${place}`, { maxResults: 6 }),
    wantsNightlife(trip)
      ? tavilySafe(`Best nightlife bars and evening spots in ${place}`, { maxResults: 6 })
      : Promise.resolve({ answer: "", results: [] }),
  ]);

  const activities = extractItems(doRes, trip.days * 3 + 4);
  const foods = extractItems(eatRes, trip.days + 4);
  const hoods = extractItems(hoodRes, 6);
  const nights = extractItems(nightRes, trip.days + 2);

  const extraAfternoon = trip.style === "packed";
  const lightDay = trip.style === "relaxed";

  let ai = 0, fi = 0, ni = 0;
  const itinerary = [];

  for (let d = 1; d <= trip.days; d++) {
    const slots = [];
    slots.push(slotFrom("Morning", activities[ai++], d, "Start with a signature sight before the crowds build."));
    if (!lightDay || d === 1) {
      slots.push(slotFrom("Afternoon", activities[ai++], d, "Keep exploring nearby so you're not criss-crossing the city."));
    } else {
      slots.push(slotFrom("Afternoon", activities[ai++], d, "Take it slow with one relaxed stop this afternoon."));
    }
    if (extraAfternoon && activities[ai]) {
      slots.push(slotFrom("Afternoon", activities[ai++], d + 1, "Squeeze in one more stop while you're in the area."));
    }
    slots.push(
      slotFrom("Food", foods[fi++], d, trip.budget === "budget" ? "Eat where locals do, away from the main squares." : "Sit down for a proper meal and pace yourself.")
    );
    if (wantsNightlife(trip) && nights[ni]) {
      slots.push(slotFrom("Evening", nights[ni++], d, "Head out and enjoy the city after dark."));
    } else {
      slots.push(slotFrom("Evening", null, d, "Keep the evening relaxed near where you're staying."));
    }

    itinerary.push({
      day: d,
      title: themeFor(slots),
      summary: daySummary(d, trip.days, trip, nice),
      slots,
    });
  }

  const savedSuggestions = [
    ...activities.slice(0, 2).map((a) => ({ name: a.name, category: "Activity", why: a.description || "A standout thing to do here." })),
    ...foods.slice(0, 2).map((f) => ({ name: f.name, category: "Food", why: f.description || "Worth a meal or a snack stop." })),
    ...hoods.slice(0, 1).map((h) => ({ name: h.name, category: "Stay", why: h.description || "A solid base for your stay." })),
  ].filter((s) => s.name);

  return {
    destination: nice,
    tripLength: `${trip.days} day${trip.days > 1 ? "s" : ""}`,
    budgetLevel: trip.budget,
    travelStyle: trip.style,
    interests: trip.interests,
    season: trip.season,
    itinerary,
    savedSuggestions,
    lastChecked: today(),
    sources: collectSources(doRes.results, eatRes.results, hoodRes.results, nightRes.results),
  };
}

/* ============================== routing ============================== */

async function buildSection(place, section, trip) {
  switch (section) {
    case "overview": return buildOverview(place, trip);
    case "logistics": return buildLogistics(place, trip);
    case "stay": return buildStay(place, trip);
    case "do": return buildDo(place, trip);
    case "eat": return buildEat(place, trip);
    case "local": return buildLocal(place, trip);
    case "itinerary": return buildItinerary(place, trip);
    default: return buildOverview(place, trip);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, provider: "tavily-only", hasKey: Boolean(TAVILY_API_KEY), mode: process.env.NODE_ENV || "development" });
});

app.post("/api/research", async (req, res) => {
  try {
    const place = cleanText(req.body.place);
    const section = cleanText(req.body.section || "overview").toLowerCase();
    const trip = normalizeTrip(req.body);

    if (!place) return res.status(400).json({ error: "Missing destination." });

    const tripSig = `${trip.days}|${trip.budget}|${trip.style}|${trip.interests.join(",")}|${trip.season}`;
    const cacheKey = `${place.toLowerCase()}::${section}::${tripSig}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const output = await buildSection(place, section, trip);
    cache.set(cacheKey, output);
    res.json(output);
  } catch (err) {
    console.error("Research error:", err);
    res.status(500).json({ error: err.message || "Research failed." });
  }
});

/* ===================== serve built frontend (Render) ===================== */

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const distPath = path.join(__dirname, "../dist");

if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Using Tavily-only live-hostable mode.");
});
