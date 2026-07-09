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

// Simple in-memory cache: key = `${place}::${section}`
const cache = new Map();

/* ============================== text utils ============================== */

const cleanText = (v) => String(v || "").replace(/\s+/g, " ").trim();

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

// Take the first n sentences, hard-capped at maxLen characters.
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

// Never throws: a single failed field should not break the whole section.
async function tavilySafe(query, opts) {
  try {
    return await tavily(query, opts);
  } catch (err) {
    console.error("tavilySafe failed:", query, "-", err.message);
    return { answer: "", results: [] };
  }
}

/* ============================ normalizers ============================ */

// Prefer the Tavily synthesized answer, then a result snippet, then a fallback.
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

async function buildOverview(place) {
  const [base, location, why, known, best, length, budget, facts] = await Promise.all([
    tavilySafe(`${place} travel guide overview what to expect for visitors`, {
      depth: "advanced",
      maxResults: 6,
    }),
    tavilySafe(`Where is ${place} located country and region`, { maxResults: 3 }),
    tavilySafe(`Why visit ${place} top reasons to go`, { maxResults: 4 }),
    tavilySafe(`What is ${place} best known and famous for`, { maxResults: 4 }),
    tavilySafe(`Best time of year to visit ${place} weather and seasons`, { maxResults: 4 }),
    tavilySafe(`How many days do you need in ${place} ideal trip length`, { maxResults: 4 }),
    tavilySafe(`${place} travel costs daily budget for tourists cheap or expensive`, {
      maxResults: 4,
    }),
    tavilySafe(`Interesting facts about ${place}`, { maxResults: 5 }),
  ]);

  const destination = titleCase(place);

  return {
    destination,
    location: fieldValue(location, "See sources for exact location.", {
      sentences: 1,
      maxLen: 90,
    }),
    overview: fieldValue(
      base,
      `Live research summary for ${destination}. Open the tabs above for stay, do, eat, and logistics details.`,
      { sentences: 3, maxLen: 440 }
    ),
    styleTags: deriveTags(`${known.answer} ${base.answer} ${why.answer}`),
    whyWorthVisiting: fieldValue(
      why,
      `${destination} rewards visitors with a strong mix of culture, food, and sights.`,
      { sentences: 2, maxLen: 300 }
    ),
    knownFor: fieldValue(
      known,
      `Its landmarks, local cuisine, and distinct neighborhood character.`,
      { sentences: 2, maxLen: 260 }
    ),
    bestTimeToVisit: fieldValue(
      best,
      `Spring and autumn usually bring mild weather and thinner crowds.`,
      { sentences: 2, maxLen: 240 }
    ),
    recommendedTripLength: fieldValue(
      length,
      `Around 3 to 4 days covers the main highlights at a comfortable pace.`,
      { sentences: 1, maxLen: 140 }
    ),
    budgetLevel: fieldValue(
      budget,
      `Mid-range overall; daily costs shift with season and travel style.`,
      { sentences: 2, maxLen: 220 }
    ),
    coolFacts: makeCoolFacts(facts, destination),
    lastChecked: today(),
    sources: collectSources(
      base.results,
      why.results,
      known.results,
      best.results,
      budget.results,
      length.results,
      facts.results,
      location.results
    ),
  };
}

/* ------------------------------- logistics ------------------------------- */

async function buildLogistics(place) {
  const [airport, local, walk, group, safety, traps] = await Promise.all([
    tavilySafe(`How to get from the airport to central ${place} train or transfer`, { maxResults: 4 }),
    tavilySafe(`Getting around ${place} public transport metro bus passes`, { maxResults: 4 }),
    tavilySafe(`Is ${place} walkable for tourists`, { maxResults: 3 }),
    tavilySafe(`Which neighborhoods and areas to group together when sightseeing in ${place}`, {
      maxResults: 4,
    }),
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

/* ------------------------- list-style sections ------------------------- */

// Turn a Tavily answer + results into a set of named items.
function extractItems(res, count = 5) {
  const items = [];
  const seen = new Set();

  // 1) Try to pull a list out of the synthesized answer.
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
    // Find a supporting result for a description + link.
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

  // 2) Backfill from raw results if the answer was thin.
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

  // 3) If a description is really just the list of item names repeated
  //    (common when Tavily returns "Top spots: A, B, C"), drop it so the
  //    caller's cleaner per-item fallback text is used instead.
  const names = items.map((it) => it.name.toLowerCase());
  for (const it of items) {
    const desc = it.description.toLowerCase();
    const hits = names.filter((n) => n && desc.includes(n)).length;
    if (hits >= 2) it.description = "";
  }

  return items;
}

function titleCaseName(s) {
  const t = cleanText(s);
  if (!t) return "";
  // Keep it readable; don't force-caps if it's already a proper phrase.
  return t.charAt(0).toUpperCase() + t.slice(1);
}

const DO_TYPES = [
  ["Museum", /\b(museum|gallery|art)\b/i],
  ["Park", /\b(park|garden|retiro)\b/i],
  ["Landmark", /\b(palace|cathedral|basilica|castle|plaza|square|tower|monument)\b/i],
  ["Neighborhood", /\b(neighborhood|barrio|district|quarter)\b/i],
  ["Tour", /\b(tour|walk|trip|cruise)\b/i],
];
const guessType = (text, fallback = "Attraction") =>
  (DO_TYPES.find(([, re]) => re.test(text)) || [fallback])[0];

async function buildStay(place) {
  const res = await tavilySafe(`Best areas and neighborhoods to stay in ${place} for tourists`, {
    depth: "advanced",
    maxResults: 8,
  });
  const items = extractItems(res, 6);
  const areas = items.map((it) => ({
    area: it.name,
    bestFor: it.description || "First-time visitors who want to be central.",
    pros: "Well located with good access to sights and transit.",
    cons: "Popular, so book early during peak season.",
    budget: "Mid-range",
    safety: "Generally safe with standard city precautions.",
  }));
  return {
    areas: areas.length ? areas : fallbackStay(place),
    lastChecked: today(),
    sources: collectSources(res.results),
  };
}

function fallbackStay(place) {
  return [
    {
      area: `Central ${titleCase(place)}`,
      bestFor: "First-time visitors who want to walk to major sights.",
      pros: "Close to landmarks, restaurants, and transit.",
      cons: "Busier and pricier than outer areas.",
      budget: "Mid-range",
      safety: "Generally safe with standard city precautions.",
    },
  ];
}

async function buildDo(place) {
  const res = await tavilySafe(`Top things to do and must-see attractions in ${place}`, {
    depth: "advanced",
    maxResults: 8,
  });
  const items = extractItems(res, 6).map((it) => ({
    name: it.name,
    type: guessType(`${it.name} ${it.description}`),
    description: it.description || `A popular stop for visitors to ${titleCase(place)}.`,
    timeNeeded: "Roughly 1 to 3 hours",
    booking: "Check the official site for hours and tickets.",
  }));
  return {
    items: items.length ? items : [],
    lastChecked: today(),
    sources: collectSources(res.results),
  };
}

async function buildEat(place) {
  const res = await tavilySafe(`Best restaurants, local food, and dishes to try in ${place}`, {
    depth: "advanced",
    maxResults: 8,
  });
  const items = extractItems(res, 6).map((it) => ({
    name: it.name,
    type: /\b(cafe|coffee|bakery|market|bar|tapas)\b/i.test(`${it.name} ${it.description}`)
      ? "Casual"
      : "Restaurant",
    whatToOrder: it.description || "Ask about the house specialty or a local classic.",
    price: "Varies by menu",
    reservation: "Recommended on weekends and evenings.",
  }));
  return {
    items: items.length ? items : [],
    lastChecked: today(),
    sources: collectSources(res.results),
  };
}

async function buildLocal(place) {
  const res = await tavilySafe(`Local specialties, hidden gems, and cultural tips in ${place}`, {
    depth: "advanced",
    maxResults: 8,
  });
  const items = extractItems(res, 6).map((it) => ({
    name: it.name,
    category: "Local highlight",
    why: it.description || "A local favorite that gives a more authentic feel for the place.",
    where: "Widely found across the city; ask locals for the best spot.",
  }));
  return {
    items: items.length ? items : [],
    lastChecked: today(),
    sources: collectSources(res.results),
  };
}

/* ============================== routing ============================== */

async function buildSection(place, section) {
  switch (section) {
    case "overview":
      return buildOverview(place);
    case "logistics":
      return buildLogistics(place);
    case "stay":
      return buildStay(place);
    case "do":
      return buildDo(place);
    case "eat":
      return buildEat(place);
    case "local":
      return buildLocal(place);
    default:
      return buildOverview(place);
  }
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "tavily-only",
    hasKey: Boolean(TAVILY_API_KEY),
    mode: process.env.NODE_ENV || "development",
  });
});

app.post("/api/research", async (req, res) => {
  try {
    const place = cleanText(req.body.place);
    const section = cleanText(req.body.section || "overview").toLowerCase();

    if (!place) return res.status(400).json({ error: "Missing place." });

    const cacheKey = `${place.toLowerCase()}::${section}`;
    if (cache.has(cacheKey)) return res.json(cache.get(cacheKey));

    const output = await buildSection(place, section);
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

// Serve the built React app whenever a build exists (works on Render even if
// NODE_ENV is not explicitly set to "production").
if (fs.existsSync(distPath)) {
  app.use(express.static(distPath));
  app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Using Tavily-only live-hostable mode.");
});
