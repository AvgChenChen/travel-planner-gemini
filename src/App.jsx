import React, { useState, useEffect, useCallback } from "react";
import {
  Search, MapPin, Bookmark, BookmarkCheck, Trash2, Calendar,
  Utensils, Bed, Compass, Sparkles, Info, Bus, X, ExternalLink,
  Globe, Gift, ClipboardList, AlertCircle, RefreshCw, Clock, Menu,
  Copy, Check, Sunrise, Sun, Moon, Wallet, Users, Pencil, Loader2,
} from "lucide-react";

/* ----------------------------- config ----------------------------- */

const SAVED_KEY = "travel_saved_v1";
const TRIP_KEY = "travel_trip_v2";

const TABS = [
  { id: "overview", label: "Overview", icon: Info, needsPlace: true },
  { id: "itinerary", label: "Itinerary", icon: Calendar, needsPlace: true },
  { id: "stay", label: "Stay", icon: Bed, needsPlace: true },
  { id: "do", label: "Do", icon: Compass, needsPlace: true },
  { id: "eat", label: "Eat", icon: Utensils, needsPlace: true },
  { id: "local", label: "Local", icon: Gift, needsPlace: true },
  { id: "logistics", label: "Logistics", icon: Bus, needsPlace: true },
  { id: "trip", label: "Trip List", icon: ClipboardList, needsPlace: false },
];

const PRIO = {
  must: { label: "Must-go", cls: "bg-amber-100 text-amber-800 border-amber-200", dot: "bg-amber-500" },
  nice: { label: "Nice-to-have", cls: "bg-teal-100 text-teal-800 border-teal-200", dot: "bg-teal-500" },
  skip: { label: "Skip", cls: "bg-slate-100 text-slate-500 border-slate-200", dot: "bg-slate-400" },
};

const BUDGETS = [
  { id: "budget", label: "Budget" },
  { id: "mid-range", label: "Mid-range" },
  { id: "luxury", label: "Luxury" },
];
const STYLES = [
  { id: "relaxed", label: "Relaxed" },
  { id: "balanced", label: "Balanced" },
  { id: "packed", label: "Packed" },
];
const INTERESTS = ["Food", "Nightlife", "History", "Art & museums", "Nature", "Shopping", "Beaches", "Architecture"];
const SEASONS = ["", "Spring", "Summer", "Fall", "Winter"];

const SLOT_ICON = { Morning: Sunrise, Afternoon: Sun, Evening: Moon, Food: Utensils };

const EXAMPLES = [
  "Madrid, 4 days, mid-budget, food and nightlife",
  "Lisbon, 3 days, budget, history",
  "Rome, 5 days, art and food",
  "Kyoto, 6 days, relaxed, nature",
];

/* --------------------------- data helpers -------------------------- */

const uid = () => Math.random().toString(36).slice(2, 9);
const val = (x) => (x && String(x).trim() ? x : "To be confirmed");

function loadLS(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveLS(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* ignore */
  }
}

function defaultTrip(destination = "") {
  return { destination, days: 3, budget: "mid-range", style: "balanced", interests: [], season: "" };
}

function tripKey(t) {
  if (!t || !t.destination) return "";
  return [t.destination.toLowerCase().trim(), t.days, t.budget, t.style, (t.interests || []).join(","), t.season].join("|");
}

// Parse a natural-language search like:
// "Madrid, 4 days, mid-budget, food and nightlife"
function parseTripQuery(raw) {
  const text = cleanStr(raw);
  if (!text) return null;
  const lower = text.toLowerCase();
  const parts = text.split(",").map((s) => s.trim()).filter(Boolean);
  const trip = defaultTrip(parts[0] || text);

  const dayMatch = lower.match(/(\d+)\s*(?:day|days|d)\b/);
  if (dayMatch) trip.days = Math.min(10, Math.max(1, parseInt(dayMatch[1], 10)));

  if (/\b(luxury|high[- ]?end|splurge|five[- ]?star)\b/.test(lower)) trip.budget = "luxury";
  else if (/\b(mid|moderate|mid[- ]?range|mid[- ]?budget)\b/.test(lower)) trip.budget = "mid-range";
  else if (/\b(budget|cheap|backpack|low[- ]?cost)\b/.test(lower)) trip.budget = "budget";

  if (/\b(relaxed|slow|chill|easy)\b/.test(lower)) trip.style = "relaxed";
  else if (/\b(packed|busy|fast|intense)\b/.test(lower)) trip.style = "packed";

  const interestMap = [
    ["Food", /food|eat|restaurant|culinary|foodie|cuisine|tapas/],
    ["Nightlife", /night|bar|club|party/],
    ["History", /history|historic|ancient|ruins/],
    ["Art & museums", /art|museum|gallery/],
    ["Nature", /nature|park|hike|outdoor|mountain|lake/],
    ["Shopping", /shop|market|boutique/],
    ["Beaches", /beach|coast|sea/],
    ["Architecture", /architect|cathedral|palace/],
  ];
  trip.interests = interestMap.filter(([, re]) => re.test(lower)).map(([tag]) => tag);
  return trip;
}

function cleanStr(x) {
  return String(x || "").replace(/\s+/g, " ").trim();
}

// Calls our own backend, which talks to Tavily server-side (keys never reach the browser).
async function researchSection(trip, section) {
  const res = await fetch("/api/research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      place: trip.destination,
      section,
      trip: {
        days: trip.days,
        budget: trip.budget,
        style: trip.style,
        interests: trip.interests,
        season: trip.season,
      },
    }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || "Request failed");
  }
  return res.json();
}

/* --------------------------- ui atoms ------------------------------ */

function Badge({ children, cls = "bg-slate-100 text-slate-600 border-slate-200" }) {
  return (
    <span className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${cls}`}>
      {children}
    </span>
  );
}

function Card({ children, className = "" }) {
  return <div className={`rounded-xl border border-slate-200 bg-white shadow-sm ${className}`}>{children}</div>;
}

function Field({ label, children }) {
  return (
    <div>
      <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{label}</div>
      <div className="mt-1 text-sm text-slate-700">{children}</div>
    </div>
  );
}

function Skeleton() {
  return (
    <div className="animate-pulse space-y-4">
      <div className="h-8 w-1/2 rounded bg-slate-200" />
      <div className="h-4 w-3/4 rounded bg-slate-200" />
      <div className="grid gap-3 sm:grid-cols-2">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-24 rounded-xl bg-slate-200" />
        ))}
      </div>
    </div>
  );
}

function ItinerarySkeleton({ label = "Building your day-by-day plan..." }) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        <Loader2 className="h-4 w-4 animate-spin text-teal-700" /> {label}
      </div>
      <div className="animate-pulse space-y-4">
        {[0, 1, 2].map((d) => (
          <div key={d} className="rounded-xl border border-slate-200 bg-white p-4">
            <div className="mb-3 flex items-center gap-3">
              <div className="h-9 w-9 rounded-lg bg-slate-200" />
              <div className="h-4 w-40 rounded bg-slate-200" />
            </div>
            <div className="space-y-2">
              {[0, 1, 2, 3].map((s) => (
                <div key={s} className="h-10 rounded-lg bg-slate-100" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ErrorBox({ msg, onRetry }) {
  return (
    <Card className="p-6">
      <div className="flex items-start gap-3">
        <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-amber-500" />
        <div>
          <p className="text-sm font-medium text-slate-800">{msg}</p>
          <p className="mt-1 text-sm text-slate-500">Live research uses web search and can occasionally miss. Try again.</p>
          {onRetry && (
            <button onClick={onRetry} className="mt-3 inline-flex items-center gap-2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
              <RefreshCw className="h-4 w-4" /> Retry
            </button>
          )}
        </div>
      </div>
    </Card>
  );
}

function EmptyState({ icon: Icon = Compass, title, hint, onRetry }) {
  return (
    <Card className="p-8 text-center">
      <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-slate-100 text-slate-400">
        <Icon className="h-6 w-6" />
      </div>
      <p className="mt-3 text-sm font-medium text-slate-700">{title}</p>
      {hint && <p className="mx-auto mt-1 max-w-sm text-sm text-slate-500">{hint}</p>}
      {onRetry && (
        <button onClick={onRetry} className="mt-4 inline-flex items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700">
          <RefreshCw className="h-4 w-4" /> Try again
        </button>
      )}
    </Card>
  );
}

function LastChecked({ data }) {
  if (!data) return null;
  return (
    <div className="mt-6 flex flex-col gap-2 border-t border-slate-100 pt-4 text-xs text-slate-400">
      <div className="flex items-center gap-1.5">
        <Clock className="h-3.5 w-3.5" /> Last checked: {val(data.lastChecked)}
      </div>
      {Array.isArray(data.sources) && data.sources.length > 0 && (
        <div className="flex flex-wrap gap-x-4 gap-y-1">
          {data.sources.map((s, i) => (
            <a key={i} href={s.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-teal-700 hover:underline">
              <ExternalLink className="h-3 w-3" /> {s.title || "Source"}
            </a>
          ))}
        </div>
      )}
    </div>
  );
}

function SaveButton({ isSaved, onClick, label = "Save" }) {
  return (
    <button
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-medium transition ${
        isSaved
          ? "border-teal-200 bg-teal-50 text-teal-700"
          : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700"
      }`}
    >
      {isSaved ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
      {isSaved ? "Saved" : label}
    </button>
  );
}

function Segmented({ options, value, onChange }) {
  return (
    <div className="inline-flex rounded-lg border border-slate-200 bg-slate-50 p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          onClick={() => onChange(o.id)}
          className={`rounded-md px-3 py-1.5 text-sm font-medium transition ${
            value === o.id ? "bg-white text-teal-700 shadow-sm" : "text-slate-500 hover:text-slate-700"
          }`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

/* ------------------------------ app -------------------------------- */

export default function App() {
  const [trip, setTrip] = useState(() => loadLS(TRIP_KEY, null));
  const [query, setQuery] = useState("");
  const [cache, setCache] = useState({}); // { tripKey: { section: data } }
  const [loading, setLoading] = useState({});
  const [errors, setErrors] = useState({});
  const [tab, setTab] = useState("overview");
  const [saved, setSaved] = useState(() => loadLS(SAVED_KEY, []));
  const [drawer, setDrawer] = useState(false);
  const [prioFilter, setPrioFilter] = useState("all");
  const [showForm, setShowForm] = useState(false);

  useEffect(() => saveLS(SAVED_KEY, saved), [saved]);
  useEffect(() => { if (trip) saveLS(TRIP_KEY, trip); }, [trip]);

  const place = trip?.destination || null;
  const dataKey = trip ? tripKey(trip) : "";
  const placeData = dataKey ? cache[dataKey] || {} : {};

  const ensureSection = useCallback(
    async (section) => {
      if (!trip) return;
      const k = tripKey(trip);
      if (cache[k] && cache[k][section]) return;
      setLoading((l) => ({ ...l, [section]: true }));
      setErrors((e) => ({ ...e, [section]: null }));
      try {
        const data = await researchSection(trip, section);
        setCache((c) => ({ ...c, [k]: { ...(c[k] || {}), [section]: data } }));
      } catch (err) {
        setErrors((e) => ({ ...e, [section]: err.message || "Could not load this section." }));
      } finally {
        setLoading((l) => ({ ...l, [section]: false }));
      }
    },
    [trip, cache]
  );

  useEffect(() => {
    const t = TABS.find((x) => x.id === tab);
    if (trip && t && t.needsPlace) ensureSection(tab);
  }, [tab, trip, ensureSection]);

  function startTrip(nextTrip) {
    if (!nextTrip || !nextTrip.destination) return;
    setTrip(nextTrip);
    setQuery(nextTrip.destination);
    setTab("overview");
    setShowForm(false);
    setDrawer(false);
  }

  function runSearch(q) {
    const parsed = parseTripQuery(q ?? query);
    if (!parsed) return;
    startTrip(parsed);
  }

  function addSaved(item) {
    setSaved((s) => {
      if (s.some((x) => x.name === item.name && x.category === item.category)) return s;
      return [...s, { id: uid(), priority: "nice", notes: "", ...item }];
    });
  }
  const isSaved = (name, category) => saved.some((x) => x.name === name && x.category === category);
  const updateSaved = (id, patch) => setSaved((s) => s.map((x) => (x.id === id ? { ...x, ...patch } : x)));
  const removeSaved = (id) => setSaved((s) => s.filter((x) => x.id !== id));

  const overview = placeData.overview;
  const filteredSaved = saved.filter((s) => prioFilter === "all" || s.priority === prioFilter);

  /* ---------------------------- renderers -------------------------- */

  function renderOverview() {
    if (loading.overview) return <Skeleton />;
    if (errors.overview) return <ErrorBox msg={errors.overview} onRetry={() => ensureSection("overview")} />;
    if (!overview) return null;
    const savedHere = isSaved(val(overview.destination), "Destination");
    const savedItem = saved.find((x) => x.name === val(overview.destination) && x.category === "Destination");
    return (
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="font-serif text-3xl font-semibold text-slate-900">{val(overview.destination)}</h1>
            <p className="mt-1 flex items-center gap-1.5 text-sm text-slate-500">
              <MapPin className="h-4 w-4" /> {val(overview.location)}
            </p>
          </div>
          <SaveButton
            isSaved={savedHere}
            label="Save place"
            onClick={() => addSaved({ name: val(overview.destination), category: "Destination", location: val(overview.location), whyGo: val(overview.whyWorthVisiting), area: "" })}
          />
        </div>

        <p className="mt-4 text-slate-700">{val(overview.overview)}</p>

        {Array.isArray(overview.styleTags) && (
          <div className="mt-4 flex flex-wrap gap-2">
            {overview.styleTags.map((t, i) => (
              <Badge key={i} cls="bg-teal-50 text-teal-700 border-teal-100">{t}</Badge>
            ))}
          </div>
        )}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Card className="p-4"><Field label="Why it is worth visiting">{val(overview.whyWorthVisiting)}</Field></Card>
          <Card className="p-4"><Field label="Known for">{val(overview.knownFor)}</Field></Card>
          <Card className="p-4"><Field label="Best time to visit">{val(overview.bestTimeToVisit)}</Field></Card>
          <Card className="p-4"><Field label="Recommended trip length">{val(overview.recommendedTripLength)}</Field></Card>
          <Card className="p-4"><Field label="Budget level">{val(overview.budgetLevel)}</Field></Card>
        </div>

        <div className="mt-8">
          <h3 className="flex items-center gap-2 text-lg font-semibold text-slate-800">
            <Sparkles className="h-5 w-5 text-amber-500" /> Cool facts
          </h3>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            {(overview.coolFacts || []).map((f, i) => (
              <div key={i} className="flex gap-2 rounded-lg bg-slate-50 p-3 text-sm text-slate-700">
                <span className="font-mono text-xs text-slate-400">{String(i + 1).padStart(2, "0")}</span>
                {f}
              </div>
            ))}
          </div>
        </div>

        <div className="mt-8">
          <button onClick={() => setTab("itinerary")} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2 text-sm font-medium text-white hover:bg-teal-800">
            <Calendar className="h-4 w-4" /> See your day-by-day itinerary
          </button>
        </div>

        {savedHere && savedItem && (
          <div className="mt-8">
            <h3 className="text-lg font-semibold text-slate-800">Save to trip</h3>
            <Card className="mt-3 p-4">
              <SavedControls item={savedItem} onUpdate={updateSaved} onRemove={removeSaved} />
            </Card>
          </div>
        )}

        <LastChecked data={overview} />
      </div>
    );
  }

  function renderItinerary() {
    const d = placeData.itinerary;
    if (loading.itinerary) return <ItinerarySkeleton />;
    if (errors.itinerary) return <ErrorBox msg={errors.itinerary} onRetry={() => ensureSection("itinerary")} />;
    if (!d) return <EmptyState icon={Calendar} title="No itinerary yet" hint="Search a destination to generate a day-by-day plan." />;
    const plan = d.itinerary || [];
    if (plan.length === 0)
      return <EmptyState icon={Calendar} title="Couldn't build a plan this time" hint="This can happen on very obscure places or during a rate limit. Try again." onRetry={() => ensureSection("itinerary")} />;

    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={Calendar} title={`Your ${val(d.tripLength)} in ${val(d.destination)}`} />
          <CopyItineraryButton data={d} />
        </div>
        <p className="mt-2 text-sm text-slate-500">
          A day-by-day plan built from live results, tuned to your {d.budgetLevel} budget and {d.travelStyle} pace
          {Array.isArray(d.interests) && d.interests.length > 0 ? ` with a focus on ${d.interests.join(", ").toLowerCase()}` : ""}.
        </p>

        {Array.isArray(d.savedSuggestions) && d.savedSuggestions.length > 0 && (
          <Card className="mt-5 p-4">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Suggested saves</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {d.savedSuggestions.map((s, i) => {
                const on = isSaved(val(s.name), s.category);
                return (
                  <button
                    key={i}
                    onClick={() => addSaved({ name: val(s.name), category: s.category, location: place, whyGo: s.why, area: "" })}
                    className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm transition ${
                      on ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300 hover:text-teal-700"
                    }`}
                    title={s.why}
                  >
                    {on ? <BookmarkCheck className="h-3.5 w-3.5" /> : <Bookmark className="h-3.5 w-3.5" />}
                    {s.name}
                  </button>
                );
              })}
            </div>
          </Card>
        )}

        <div className="mt-6 space-y-5">
          {plan.map((day) => (
            <Card key={day.day} className="overflow-hidden">
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-4 py-3">
                <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-sm font-semibold text-white">{day.day}</div>
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-teal-700">Day {day.day}</div>
                  <div className="truncate font-semibold text-slate-900">{val(day.title)}</div>
                </div>
              </div>
              {day.summary && <p className="px-4 pt-3 text-sm text-slate-500">{day.summary}</p>}
              <div className="divide-y divide-slate-100 px-4 py-1">
                {(day.slots || []).map((s, i) => {
                  const Icon = SLOT_ICON[s.slot] || Clock;
                  const on = isSaved(val(s.name), "Activity");
                  return (
                    <div key={i} className="flex items-start gap-3 py-3">
                      <div className="mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">
                        <Icon className="h-4 w-4" />
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">{s.slot}</div>
                        <div className="font-medium text-slate-800">{val(s.name)}</div>
                        {s.detail && <div className="mt-0.5 text-sm text-slate-500">{s.detail}</div>}
                      </div>
                      <button
                        onClick={() => addSaved({ name: val(s.name), category: "Activity", location: place, whyGo: s.slot, area: "" })}
                        className={`shrink-0 rounded-md border p-1.5 transition ${
                          on ? "border-teal-200 bg-teal-50 text-teal-700" : "border-slate-200 text-slate-400 hover:border-teal-300 hover:text-teal-700"
                        }`}
                        title={on ? "Saved" : "Save to trip"}
                      >
                        {on ? <BookmarkCheck className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
                      </button>
                    </div>
                  );
                })}
              </div>
            </Card>
          ))}
        </div>

        <LastChecked data={d} />
      </div>
    );
  }

  function renderStay() {
    const d = placeData.stay;
    if (loading.stay) return <Skeleton />;
    if (errors.stay) return <ErrorBox msg={errors.stay} onRetry={() => ensureSection("stay")} />;
    if (!d) return null;
    if (!(d.areas || []).length) return <EmptyState icon={Bed} title="No neighborhoods found" hint="Try again in a moment; live search occasionally returns thin results." onRetry={() => ensureSection("stay")} />;
    return (
      <div>
        <SectionTitle icon={Bed} title="Where to stay" />
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {d.areas.map((a, i) => (
            <Card key={i} className="flex flex-col p-4">
              <div className="flex items-start justify-between gap-2">
                <h4 className="font-semibold text-slate-900">{val(a.area)}</h4>
                <SaveButton isSaved={isSaved(val(a.area), "Stay")} onClick={() => addSaved({ name: val(a.area), category: "Stay", location: place, whyGo: val(a.bestFor), area: val(a.area) })} />
              </div>
              <p className="mt-2 text-sm text-slate-600"><span className="font-medium text-slate-700">Best for:</span> {val(a.bestFor)}</p>
              <div className="mt-3 grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-xs font-semibold text-emerald-600">Pros</span><p className="text-slate-600">{val(a.pros)}</p></div>
                <div><span className="text-xs font-semibold text-rose-500">Cons</span><p className="text-slate-600">{val(a.cons)}</p></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge>{val(a.budget)}</Badge>
                <span className="text-xs text-slate-500">{val(a.safety)}</span>
              </div>
            </Card>
          ))}
        </div>
        <LastChecked data={d} />
      </div>
    );
  }

  function renderDo() {
    const d = placeData.do;
    if (loading.do) return <Skeleton />;
    if (errors.do) return <ErrorBox msg={errors.do} onRetry={() => ensureSection("do")} />;
    if (!d) return null;
    if (!(d.items || []).length) return <EmptyState icon={Compass} title="No activities found" hint="Live search came back thin. Give it another try." onRetry={() => ensureSection("do")} />;
    return (
      <div>
        <SectionTitle icon={Compass} title="Things to do" />
        <div className="mt-4 space-y-3">
          {d.items.map((it, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{val(it.name)}</h4>
                    <Badge cls="bg-indigo-50 text-indigo-700 border-indigo-100">{val(it.type)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600">{val(it.description)}</p>
                  <div className="mt-2 flex flex-wrap gap-3 text-xs text-slate-500">
                    <span className="inline-flex items-center gap-1"><Clock className="h-3.5 w-3.5" /> {val(it.timeNeeded)}</span>
                    <span>Booking: {val(it.booking)}</span>
                  </div>
                </div>
                <SaveButton isSaved={isSaved(val(it.name), "Activity")} onClick={() => addSaved({ name: val(it.name), category: "Activity", location: place, whyGo: val(it.type), area: "" })} />
              </div>
            </Card>
          ))}
        </div>
        <LastChecked data={d} />
      </div>
    );
  }

  function renderEat() {
    const d = placeData.eat;
    if (loading.eat) return <Skeleton />;
    if (errors.eat) return <ErrorBox msg={errors.eat} onRetry={() => ensureSection("eat")} />;
    if (!d) return null;
    if (!(d.items || []).length) return <EmptyState icon={Utensils} title="No food spots found" hint="Live search came back thin. Give it another try." onRetry={() => ensureSection("eat")} />;
    return (
      <div>
        <SectionTitle icon={Utensils} title="Where to eat" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {d.items.map((it, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <h4 className="font-semibold text-slate-900">{val(it.name)}</h4>
                    <Badge cls="bg-orange-50 text-orange-700 border-orange-100">{val(it.type)}</Badge>
                  </div>
                  <p className="mt-1 text-sm text-slate-600"><span className="font-medium text-slate-700">Order:</span> {val(it.whatToOrder)}</p>
                  <div className="mt-2 flex gap-3 text-xs text-slate-500">
                    <span>{val(it.price)}</span>
                    <span>Reservation: {val(it.reservation)}</span>
                  </div>
                </div>
                <SaveButton isSaved={isSaved(val(it.name), "Food")} onClick={() => addSaved({ name: val(it.name), category: "Food", location: place, whyGo: val(it.whatToOrder), area: "" })} />
              </div>
            </Card>
          ))}
        </div>
        <LastChecked data={d} />
      </div>
    );
  }

  function renderLocal() {
    const d = placeData.local;
    if (loading.local) return <Skeleton />;
    if (errors.local) return <ErrorBox msg={errors.local} onRetry={() => ensureSection("local")} />;
    if (!d) return null;
    if (!(d.items || []).length) return <EmptyState icon={Gift} title="No local tips found" hint="Live search came back thin. Give it another try." onRetry={() => ensureSection("local")} />;
    return (
      <div>
        <SectionTitle icon={Gift} title="Local tips & specialties" />
        <div className="mt-4 grid gap-3 md:grid-cols-2">
          {d.items.map((it, i) => (
            <Card key={i} className="p-4">
              <div className="flex items-center gap-2">
                <h4 className="font-semibold text-slate-900">{val(it.name)}</h4>
                <Badge>{val(it.category)}</Badge>
              </div>
              <p className="mt-1 text-sm text-slate-600"><span className="font-medium text-slate-700">Why it matters:</span> {val(it.why)}</p>
              <p className="mt-1 text-sm text-slate-500"><span className="font-medium">Where:</span> {val(it.where)}</p>
            </Card>
          ))}
        </div>
        <LastChecked data={d} />
      </div>
    );
  }

  function renderLogistics() {
    const d = placeData.logistics;
    if (loading.logistics) return <Skeleton />;
    if (errors.logistics) return <ErrorBox msg={errors.logistics} onRetry={() => ensureSection("logistics")} />;
    if (!d) return null;
    const rows = [
      ["Airport / train access", d.airportTrain],
      ["Local transportation", d.localTransport],
      ["Walkability", d.walkability],
      ["Areas to group together", d.groupAreas],
      ["Safety tips", d.safetyTips],
      ["Tourist traps to avoid", d.touristTraps],
    ];
    return (
      <div>
        <SectionTitle icon={Bus} title="Logistics" />
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          {rows.map(([label, v], i) => (
            <Card key={i} className="p-4"><Field label={label}>{val(v)}</Field></Card>
          ))}
        </div>
        <LastChecked data={d} />
      </div>
    );
  }

  function renderTrip() {
    const list = filteredSaved;
    return (
      <div>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <SectionTitle icon={ClipboardList} title="Final trip list" />
          <CopyListButton saved={saved} />
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <span className="text-xs font-semibold uppercase tracking-wide text-slate-400">Filter</span>
          {["all", "must", "nice", "skip"].map((p) => (
            <button
              key={p}
              onClick={() => setPrioFilter(p)}
              className={`rounded-full border px-3 py-1 text-xs font-medium ${
                prioFilter === p ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-500 hover:border-slate-300"
              }`}
            >
              {p === "all" ? "All" : PRIO[p].label}
            </button>
          ))}
        </div>

        {list.length === 0 ? (
          <EmptyState icon={Bookmark} title="No saved places yet" hint="Search a destination, open the itinerary, and tap the bookmark on anything you want to keep." />
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[720px] border-collapse text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
                  <th className="py-2 pr-3 font-semibold">Place</th>
                  <th className="py-2 pr-3 font-semibold">Category</th>
                  <th className="py-2 pr-3 font-semibold">Priority</th>
                  <th className="py-2 pr-3 font-semibold">Why go</th>
                  <th className="py-2 pr-3 font-semibold">Area</th>
                  <th className="py-2 pr-3 font-semibold">Notes</th>
                  <th className="py-2 font-semibold" />
                </tr>
              </thead>
              <tbody>
                {list.map((s) => (
                  <tr key={s.id} className="border-b border-slate-100 align-top">
                    <td className="py-3 pr-3 font-medium text-slate-800">{s.name}</td>
                    <td className="py-3 pr-3"><Badge>{s.category}</Badge></td>
                    <td className="py-3 pr-3">
                      <select value={s.priority} onChange={(e) => updateSaved(s.id, { priority: e.target.value })} className="rounded-md border border-slate-200 bg-white px-2 py-1 text-xs text-slate-600">
                        <option value="must">Must-go</option>
                        <option value="nice">Nice-to-have</option>
                        <option value="skip">Skip</option>
                      </select>
                    </td>
                    <td className="py-3 pr-3 text-slate-600">{s.whyGo}</td>
                    <td className="py-3 pr-3 text-slate-600">{s.area || "-"}</td>
                    <td className="py-3 pr-3">
                      <input value={s.notes} onChange={(e) => updateSaved(s.id, { notes: e.target.value })} placeholder="Add a note..." className="w-40 rounded-md border border-slate-200 px-2 py-1 text-xs text-slate-700 focus:border-teal-400 focus:outline-none" />
                    </td>
                    <td className="py-3">
                      <button onClick={() => removeSaved(s.id)} className="rounded-md p-1.5 text-slate-400 hover:bg-rose-50 hover:text-rose-500">
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    );
  }

  const activeTab = TABS.find((t) => t.id === tab);
  const showWelcome = !trip && activeTab?.needsPlace;

  /* ------------------------------ shell ---------------------------- */

  return (
    <div className="flex h-full w-full flex-col bg-slate-50 text-slate-900" style={{ fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
      <header className="z-20 border-b border-slate-200 bg-white">
        <div className="flex items-center gap-3 px-4 py-3 sm:px-6">
          <button onClick={() => setDrawer((v) => !v)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 lg:hidden">
            <Menu className="h-5 w-5" />
          </button>
          <div className="flex items-center gap-2">
            <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-teal-700 text-white">
              <Globe className="h-5 w-5" />
            </div>
            <div className="leading-tight">
              <div className="font-serif text-lg font-semibold text-slate-900">Atlas</div>
              <div className="hidden text-xs text-slate-400 sm:block">trip planner</div>
            </div>
          </div>

          <div className="relative ml-auto w-full max-w-xl">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && runSearch()}
              placeholder="Try: Madrid, 4 days, mid-budget, food and nightlife"
              className="w-full rounded-xl border border-slate-200 bg-slate-50 py-2.5 pl-9 pr-24 text-sm text-slate-800 placeholder-slate-400 focus:border-teal-400 focus:bg-white focus:outline-none"
            />
            <button onClick={() => runSearch()} className="absolute right-1.5 top-1/2 -translate-y-1/2 rounded-lg bg-teal-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-teal-800">
              Plan
            </button>
          </div>
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <Sidebar open={drawer} onClose={() => setDrawer(false)} saved={saved} onRemove={removeSaved} onOpenPlace={(name) => runSearch(name)} />

        <main className="min-w-0 flex-1 overflow-y-auto">
          <div className="sticky top-0 z-10 border-b border-slate-200 bg-white/90 backdrop-blur">
            <div className="flex gap-1 overflow-x-auto px-4 sm:px-6">
              {TABS.map((t) => {
                const Icon = t.icon;
                const active = tab === t.id;
                return (
                  <button
                    key={t.id}
                    onClick={() => setTab(t.id)}
                    className={`flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-3 text-sm font-medium transition ${
                      active ? "border-teal-700 text-teal-700" : "border-transparent text-slate-500 hover:text-slate-700"
                    }`}
                  >
                    <Icon className="h-4 w-4" /> {t.label}
                  </button>
                );
              })}
            </div>
          </div>

          <div className="mx-auto max-w-4xl px-4 py-6 sm:px-6 sm:py-8">
            {showForm ? (
              <TripForm initial={trip} onSubmit={startTrip} onCancel={() => setShowForm(false)} />
            ) : showWelcome ? (
              <WelcomeState onStart={startTrip} onQuick={(q) => runSearch(q)} />
            ) : (
              <>
                {trip && (
                  <>
                    <TripSummaryBar trip={trip} onEdit={() => setShowForm(true)} />
                    <p className="mb-5 flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-800">
                      <Info className="h-3.5 w-3.5 shrink-0" />
                      AI-researched with live web search. Double-check hours, prices, and bookings before you go.
                    </p>
                  </>
                )}
                {tab === "overview" && renderOverview()}
                {tab === "itinerary" && renderItinerary()}
                {tab === "stay" && renderStay()}
                {tab === "do" && renderDo()}
                {tab === "eat" && renderEat()}
                {tab === "local" && renderLocal()}
                {tab === "logistics" && renderLogistics()}
                {tab === "trip" && renderTrip()}
              </>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}

/* --------------------------- sub-views ----------------------------- */

function SectionTitle({ icon: Icon, title }) {
  return (
    <h2 className="flex items-center gap-2 font-serif text-2xl font-semibold text-slate-900">
      <Icon className="h-6 w-6 text-teal-700" /> {title}
    </h2>
  );
}

function TripForm({ initial, onSubmit, onCancel }) {
  const [destination, setDestination] = useState(initial?.destination || "");
  const [days, setDays] = useState(initial?.days || 3);
  const [budget, setBudget] = useState(initial?.budget || "mid-range");
  const [style, setStyle] = useState(initial?.style || "balanced");
  const [interests, setInterests] = useState(initial?.interests || []);
  const [season, setSeason] = useState(initial?.season || "");

  const toggle = (t) => setInterests((xs) => (xs.includes(t) ? xs.filter((x) => x !== t) : [...xs, t]));
  const submit = () => {
    if (!destination.trim()) return;
    onSubmit({ destination: destination.trim(), days: Math.min(10, Math.max(1, Number(days) || 3)), budget, style, interests, season });
  };

  return (
    <Card className="p-5 sm:p-6">
      <h2 className="font-serif text-2xl font-semibold text-slate-900">Plan a trip</h2>
      <p className="mt-1 text-sm text-slate-500">Give Atlas the basics and get a full plan with a day-by-day itinerary.</p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Destination</label>
          <input
            value={destination}
            onChange={(e) => setDestination(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder="City, region, or country"
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Trip length (days)</label>
          <input
            type="number" min={1} max={10} value={days}
            onChange={(e) => setDays(e.target.value)}
            className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2.5 text-sm text-slate-800 focus:border-teal-400 focus:outline-none"
          />
        </div>

        <div>
          <label className="text-xs font-semibold uppercase tracking-wide text-slate-400">Season (optional)</label>
          <select value={season} onChange={(e) => setSeason(e.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 bg-white px-3 py-2.5 text-sm text-slate-800 focus:border-teal-400 focus:outline-none">
            {SEASONS.map((s) => (
              <option key={s || "any"} value={s}>{s || "Any / not sure"}</option>
            ))}
          </select>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Budget</div>
          <div className="mt-1"><Segmented options={BUDGETS} value={budget} onChange={setBudget} /></div>
        </div>

        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Pace</div>
          <div className="mt-1"><Segmented options={STYLES} value={style} onChange={setStyle} /></div>
        </div>
      </div>

      <div className="mt-5">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Interests</div>
        <div className="mt-2 flex flex-wrap gap-2">
          {INTERESTS.map((t) => {
            const on = interests.includes(t);
            return (
              <button
                key={t}
                type="button"
                onClick={() => toggle(t)}
                className={`rounded-full border px-3 py-1.5 text-sm transition ${
                  on ? "border-teal-300 bg-teal-50 text-teal-700" : "border-slate-200 bg-white text-slate-600 hover:border-teal-300"
                }`}
              >
                {t}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-6 flex flex-wrap gap-2">
        <button onClick={submit} disabled={!destination.trim()} className="inline-flex items-center gap-2 rounded-lg bg-teal-700 px-4 py-2.5 text-sm font-medium text-white hover:bg-teal-800 disabled:opacity-40">
          <Calendar className="h-4 w-4" /> Build my plan
        </button>
        {onCancel && (
          <button onClick={onCancel} className="rounded-lg border border-slate-200 bg-white px-4 py-2.5 text-sm font-medium text-slate-600 hover:border-slate-300">Cancel</button>
        )}
      </div>
    </Card>
  );
}

function TripSummaryBar({ trip, onEdit }) {
  const chips = [
    { icon: Calendar, text: `${trip.days} day${trip.days > 1 ? "s" : ""}` },
    { icon: Wallet, text: BUDGETS.find((b) => b.id === trip.budget)?.label || trip.budget },
    { icon: Users, text: STYLES.find((s) => s.id === trip.style)?.label || trip.style },
    ...(trip.season ? [{ icon: Sun, text: trip.season }] : []),
  ];
  return (
    <div className="mb-5 flex flex-wrap items-center gap-2 rounded-xl border border-slate-200 bg-white p-3">
      <span className="flex items-center gap-1.5 font-serif text-lg font-semibold text-slate-900">
        <MapPin className="h-4 w-4 text-teal-700" /> {trip.destination}
      </span>
      <div className="flex flex-wrap gap-1.5">
        {chips.map((c, i) => {
          const Icon = c.icon;
          return (
            <span key={i} className="inline-flex items-center gap-1 rounded-full border border-slate-200 bg-slate-50 px-2.5 py-0.5 text-xs font-medium text-slate-600">
              <Icon className="h-3 w-3" /> {c.text}
            </span>
          );
        })}
        {(trip.interests || []).map((t) => (
          <Badge key={t} cls="bg-teal-50 text-teal-700 border-teal-100">{t}</Badge>
        ))}
      </div>
      <button onClick={onEdit} className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700">
        <Pencil className="h-3.5 w-3.5" /> Edit trip
      </button>
    </div>
  );
}

function WelcomeState({ onStart, onQuick }) {
  return (
    <div>
      <div className="py-2 text-center">
        <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-2xl bg-teal-50 text-teal-700">
          <Compass className="h-7 w-7" />
        </div>
        <h2 className="mt-4 font-serif text-2xl font-semibold text-slate-900">Plan a real trip, not just a search</h2>
        <p className="mx-auto mt-2 max-w-md text-sm text-slate-500">
          Tell Atlas where you're going and what you're into. It pulls live, sourced info and builds a day-by-day itinerary.
        </p>
      </div>

      <div className="mt-6"><TripForm initial={null} onSubmit={onStart} /></div>

      <div className="mt-6 text-center">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Or type it in one line</div>
        <div className="mx-auto mt-3 flex max-w-2xl flex-wrap justify-center gap-2">
          {EXAMPLES.map((e) => (
            <button key={e} onClick={() => onQuick(e)} className="rounded-full border border-slate-200 bg-white px-3.5 py-1.5 text-sm text-slate-600 transition hover:border-teal-300 hover:text-teal-700">
              {e}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

function Sidebar({ open, onClose, saved, onRemove, onOpenPlace }) {
  const grouped = saved.reduce((acc, s) => {
    (acc[s.category] = acc[s.category] || []).push(s);
    return acc;
  }, {});
  const content = (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3">
        <div className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Bookmark className="h-4 w-4 text-teal-700" /> Saved places
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{saved.length}</span>
        </div>
        <button onClick={onClose} className="rounded-md p-1 text-slate-400 hover:bg-slate-100 lg:hidden">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {saved.length === 0 ? (
          <p className="px-1 py-4 text-xs text-slate-400">Nothing saved yet. Build a plan and tap the bookmark on anything you like.</p>
        ) : (
          Object.entries(grouped).map(([cat, items]) => (
            <div key={cat} className="mb-4">
              <div className="mb-1 px-1 text-xs font-semibold uppercase tracking-wide text-slate-400">{cat}</div>
              <div className="space-y-1">
                {items.map((s) => (
                  <div key={s.id} className="group flex items-center gap-2 rounded-lg px-2 py-1.5 hover:bg-slate-50">
                    <span className={`h-2 w-2 shrink-0 rounded-full ${(PRIO[s.priority] || PRIO.nice).dot}`} />
                    <button
                      onClick={() => cat === "Destination" && onOpenPlace(s.name)}
                      className={`min-w-0 flex-1 truncate text-left text-sm text-slate-700 ${cat === "Destination" ? "hover:text-teal-700" : "cursor-default"}`}
                      title={s.name}
                    >
                      {s.name}
                    </button>
                    <button onClick={() => onRemove(s.id)} className="shrink-0 rounded p-1 text-slate-300 hover:bg-rose-50 hover:text-rose-500">
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
          ))
        )}
      </div>
    </div>
  );

  return (
    <>
      <aside className="hidden w-64 shrink-0 border-r border-slate-200 bg-white lg:block">{content}</aside>
      {open && (
        <div className="fixed inset-0 z-30 lg:hidden">
          <div className="absolute inset-0 bg-slate-900/30" onClick={onClose} />
          <aside className="absolute left-0 top-0 h-full w-72 bg-white shadow-xl">{content}</aside>
        </div>
      )}
    </>
  );
}

function SavedControls({ item, onUpdate, onRemove }) {
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Priority</div>
          <select value={item.priority} onChange={(e) => onUpdate(item.id, { priority: e.target.value })} className="mt-1 rounded-md border border-slate-200 bg-white px-2 py-1 text-sm text-slate-700">
            <option value="must">Must-go</option>
            <option value="nice">Nice-to-have</option>
            <option value="skip">Skip</option>
          </select>
        </div>
      </div>
      <div>
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-400">Personal notes</div>
        <textarea value={item.notes} onChange={(e) => onUpdate(item.id, { notes: e.target.value })} rows={2} placeholder="Anything you want to remember..." className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 focus:border-teal-400 focus:outline-none" />
      </div>
      <button onClick={() => onRemove(item.id)} className="inline-flex items-center gap-1.5 text-xs font-medium text-rose-500 hover:text-rose-600">
        <Trash2 className="h-3.5 w-3.5" /> Remove from trip
      </button>
    </div>
  );
}

function CopyListButton({ saved }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const text = saved.map((s) => `${s.name} | ${s.category} | ${(PRIO[s.priority] || PRIO.nice).label}${s.notes ? " | " + s.notes : ""}`).join("\n");
    try {
      navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <button onClick={copy} disabled={saved.length === 0} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700 disabled:opacity-40">
      {copied ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy list"}
    </button>
  );
}

function CopyItineraryButton({ data }) {
  const [copied, setCopied] = useState(false);
  function copy() {
    const lines = [`${data.destination} — ${data.tripLength}`, ""];
    (data.itinerary || []).forEach((day) => {
      lines.push(`Day ${day.day}: ${day.title}`);
      (day.slots || []).forEach((s) => lines.push(`  ${s.slot}: ${s.name}${s.detail ? " — " + s.detail : ""}`));
      lines.push("");
    });
    try {
      navigator.clipboard.writeText(lines.join("\n"));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* ignore */
    }
  }
  return (
    <button onClick={copy} className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-sm font-medium text-slate-600 hover:border-teal-300 hover:text-teal-700">
      {copied ? <Check className="h-4 w-4 text-teal-600" /> : <Copy className="h-4 w-4" />}
      {copied ? "Copied" : "Copy plan"}
    </button>
  );
}
