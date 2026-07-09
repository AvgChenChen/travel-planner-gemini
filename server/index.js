import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";

dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const TAVILY_API_KEY = process.env.TAVILY_API_KEY;

app.use(cors());
app.use(express.json({ limit: "1mb" }));

const cache = new Map();

const SECTION_QUERIES = {
  overview: "best travel overview, neighborhoods, vibe, highlights",
  stay: "best areas to stay, hotels, neighborhoods, accommodation tips",
  do: "best things to do, attractions, museums, activities",
  eat: "best restaurants, cafes, local food, food markets",
  local: "local tips, hidden gems, culture, safety, scams, etiquette",
  logistics: "transportation, airport transfer, transit, getting around, costs",
  itinerary: "sample itinerary, 1 day 2 day 3 day travel plan",
};

function cleanText(value) {
  return String(value || "").replace(/\s+/g, " ").trim();
}

function pickResults(results = []) {
  return results.slice(0, 6).map((item) => ({
    title: cleanText(item.title),
    url: item.url || "",
    content: cleanText(item.content || item.snippet || ""),
  }));
}

function makeBullets(results) {
  const bullets = [];

  for (const result of results) {
    const text = cleanText(result.content);
    if (!text) continue;

    const short = text.length > 210 ? text.slice(0, 210).trim() + "..." : text;
    bullets.push(short);
  }

  return bullets.slice(0, 5);
}

function makeItinerary(place, results) {
  const sourceIdeas = makeBullets(results);

  return [
    {
      day: "Day 1",
      title: `First look at ${place}`,
      items: [
        "Start with the main central area and get a feel for the city.",
        sourceIdeas[0] || "Visit one major landmark, then keep the evening relaxed.",
        "End with dinner somewhere close to where you are staying.",
      ],
    },
    {
      day: "Day 2",
      title: "Culture, food, and neighborhoods",
      items: [
        sourceIdeas[1] || "Explore a well-known neighborhood or cultural district.",
        sourceIdeas[2] || "Add one museum, viewpoint, market, or walking route.",
        "Leave time for cafés, photos, and wandering instead of overpacking the day.",
      ],
    },
    {
      day: "Day 3",
      title: "Local gems and flexible time",
      items: [
        sourceIdeas[3] || "Use this day for local recommendations or a slower area.",
        sourceIdeas[4] || "Revisit the area you liked most or add a short side trip.",
        "Keep the final evening simple and close to transit.",
      ],
    },
  ];
}

function buildResponse(place, section, results) {
  const bullets = makeBullets(results);
  const sources = results.map((result) => ({
    title: result.title,
    url: result.url,
  }));

  const base = {
    place,
    section,
    title: `${place} ${section}`,
    summary:
      bullets[0] ||
      `Here is a live research summary for ${place}. Try another tab for more specific travel ideas.`,
    bullets,
    highlights: bullets,
    sources,
    updatedAt: new Date().toISOString(),
  };

  if (section === "itinerary") {
    base.itinerary = makeItinerary(place, results);
  }

  return base;
}

async function searchTavily(place, section) {
  if (!TAVILY_API_KEY) {
    throw new Error("Missing TAVILY_API_KEY. Add it to .env locally and to Render environment variables online.");
  }

  const sectionQuery = SECTION_QUERIES[section] || SECTION_QUERIES.overview;
  const query = `${place} ${sectionQuery}`;

  const response = await fetch("https://api.tavily.com/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${TAVILY_API_KEY}`,
    },
    body: JSON.stringify({
      query,
      search_depth: "advanced",
      include_answer: true,
      include_raw_content: false,
      max_results: 8,
    }),
  });

  if (!response.ok) {
    const text = await response.text();
    console.error("Tavily error:", response.status, text);
    throw new Error("Tavily request failed. Check your TAVILY_API_KEY.");
  }

  const data = await response.json();

  const results = pickResults(data.results || []);

  if (data.answer) {
    results.unshift({
      title: "Tavily summary",
      url: "",
      content: data.answer,
    });
  }

  return results;
}

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    provider: "tavily-only",
    mode: process.env.NODE_ENV || "development",
  });
});

app.post("/api/research", async (req, res) => {
  try {
    const place = cleanText(req.body.place);
    const section = cleanText(req.body.section || "overview").toLowerCase();

    if (!place) {
      return res.status(400).json({ error: "Missing place." });
    }

    const cacheKey = `${place.toLowerCase()}::${section}`;

    if (cache.has(cacheKey)) {
      return res.json(cache.get(cacheKey));
    }

    const results = await searchTavily(place, section);
    const output = buildResponse(place, section, results);

    cache.set(cacheKey, output);
    res.json(output);
  } catch (err) {
    console.error("Research error:", err);
    res.status(500).json({
      error: err.message || "Research failed.",
    });
  }
});

// Serve the built React app in production.
if (process.env.NODE_ENV === "production") {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = path.dirname(__filename);
  const distPath = path.join(__dirname, "../dist");

  app.use(express.static(distPath));

  app.get("*", (_req, res) => {
    res.sendFile(path.join(distPath, "index.html"));
  });
}

app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
  console.log("Using Tavily-only live-hostable mode.");
});
