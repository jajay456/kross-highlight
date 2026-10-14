import { useState, useEffect, useRef } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
  useParams,
  useSearchParams,
  Link,
} from "react-router-dom";
import {
  Search, Moon, Sun, ArrowLeft, Play, Calendar, Clock, X, RotateCcw,
  ChevronDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";
import bgCourt from "./assets/bg-court.jpg";

const CLIPS_COLLECTION = "kross_highlight";

/* ---------------------------------------------------------------
   KROSS · Highlights  (react-router-dom v6)
   Routes:
     /                       -> Grid
     /:date&:time            -> Detail   e.g. /2026-07-20&9:00AM
   Note: date & time live in ONE path segment ("2026-07-20&9:00AM"),
   so we read it with a wildcard param and split on "&".
----------------------------------------------------------------*/

const LOCATIONS = [
  { id: "all", label: "ALL CLUBS", color: "#9ca3af" },
  { id: "onnut", label: "ONNUT", color: "#22c55e" },
  { id: "sky", label: "SKY", color: "#111111" },
  { id: "indoor", label: "INDOOR", color: "#3b5bdb" },
  { id: "asoke", label: "ASOKE", color: "#f97316" },
];

const BG = bgCourt;

// clips live in Firestore, collection `kross_highlight`:
// { date: "2026-07-20", time: "09:00", club: "onnut", videoUrl, createdAt }
function useClips() {
  const [clips, setClips] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  useEffect(() => {
    console.log(`[firestore] subscribing to collection "${CLIPS_COLLECTION}"…`);
    const q = query(collection(db, CLIPS_COLLECTION), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(
      q,
      (snap) => {
        const docs = snap.docs.map((d) => ({ id: d.id, ...d.data() }));
        console.log(`[firestore] snapshot ok — ${docs.length} doc(s):`, docs);
        setClips(docs);
        setLoading(false);
      },
      (err) => {
        console.error(`[firestore] onSnapshot error — code: ${err.code}, message: ${err.message}`);
        setError(err);
        setLoading(false);
      }
    );
    return unsubscribe;
  }, []);

  return { clips, loading, error };
}

/* ---------- time helpers ---------- */
// "2026-07-20" -> "Mon, 20 Jul 2026" (parsed as local date so it never shifts a day)
function formatDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric" });
}

// clip.time is 24h "HH:MM" (as stored in Firestore, matches <input type="time">)
function hourOf(hhmm) {
  return parseInt(String(hhmm).split(":")[0], 10);
}

// bucket label for the hour a clip falls in, e.g. "09:41" -> "9:00AM"
function hourBucketLabel(hhmm) {
  const hour = hourOf(hhmm);
  if (Number.isNaN(hour)) return hhmm;
  let hour12 = hour % 12;
  if (hour12 === 0) hour12 = 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${hour12}:00${ampm}`;
}

// nice display for an exact clip time, e.g. "09:05" -> "9:05 AM"
function formatTime12(hhmm) {
  const m = String(hhmm).match(/^(\d{1,2}):(\d{2})$/);
  if (!m) return hhmm;
  const hour = parseInt(m[1], 10);
  let hour12 = hour % 12;
  if (hour12 === 0) hour12 = 12;
  const ampm = hour < 12 ? "AM" : "PM";
  return `${hour12}:${m[2]} ${ampm}`;
}

// group clips by date + hour bucket + club, sorted chronologically
// (grouped by club too, not just date/hour, so clips from different clubs in the
// same hour don't get merged into one link — each club gets its own detail page)
function groupByHour(list) {
  const map = new Map();
  list.forEach((c) => {
    const label = hourBucketLabel(c.time);
    const key = `${c.date}__${label}__${c.club}`;
    if (!map.has(key)) {
      map.set(key, { date: c.date, label, hour24: hourOf(c.time), club: c.club, items: [] });
    }
    map.get(key).items.push(c);
  });
  return Array.from(map.values()).sort((a, b) =>
    a.date === b.date
  ? b.hour24 - a.hour24
  : a.date < b.date
    ? 1
    : -1
  );
}

function getInitialTheme() {
  const saved = localStorage.getItem("kross-theme");
  if (saved === "light" || saved === "dark") return saved;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

/* ---------- shared shell ---------- */
function Shell({ children }) {
  const [theme, setTheme] = useState(getInitialTheme);

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("kross-theme", next);
      return next;
    });
  };

  return (
    <div className="app" data-theme={theme}>
      <style>{CSS}</style>
      <div className="bg" style={{ backgroundImage: `url(${BG})` }} />
      <div className="scrim" />
      <nav className="nav">
        <Link to="/" className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
            <path d="M4 4 L14 16 L4 28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 4 L26 16 L16 28" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
          </svg>
          <span>KROSS</span>
        </Link>
        <button
          className={`moon${theme === "light" ? " is-light" : ""}`}
          onClick={toggleTheme}
          aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
        >
          {theme === "dark" ? <Moon size={14} /> : <Sun size={14} />}
        </button>
      </nav>
      {children}
    </div>
  );
}

/* ---------- detail view ---------- */
function Detail() {
  // route param is the whole segment: "2026-07-20&9:00AM" (9:00AM = hour bucket)
  const { slug } = useParams();
  const [searchParams] = useSearchParams();
  const [date, time] = decodeURIComponent(slug || "").split("&");
  const loc = searchParams.get("loc");
  const { clips, loading, error } = useClips();

  // every clip matching this date + club that falls inside this hour, e.g. 9:00AM -> 9:00-9:59
  const matches = clips.filter(
    (c) => c.date === date && (!loc || c.club === loc) && hourBucketLabel(c.time) === time
  );
  const [activeId, setActiveId] = useState(null);
  const active = matches.find((c) => c.id === activeId) || matches[0];
  const rangeEnd = time.replace(":00", ":59");

  return (
    <Shell>
      <main className="detail">
        <Link to="/" className="back">
          <ArrowLeft size={16} /> Back to highlights
        </Link>
        <div className="player">
          {active ? (
            <video
              key={active.id}
              className="player-video"
              src={active.videoUrl}
              controls
              playsInline
            />
          ) : (
            <div className="player-face">
              <span style={{ opacity: 0.6 }}>
                {error ? "Couldn't load video" : loading ? "Loading…" : "No video found"}
              </span>
            </div>
          )}
        </div>
        <div className="meta">
          <div className="meta-time">{active ? formatTime12(active.time) : time}</div>
          <div className="meta-date">{date}{active ? ` · ${active.club.toUpperCase()}` : ""}</div>
        </div>

        {matches.length > 1 && (
          <div className="hour-list">
            <div className="hour-list-title">
              {matches.length} videos · {time} – {rangeEnd}
            </div>
            <div className="hour-clips">
              {matches.map((c) => (
                <button
                  key={c.id}
                  className={`hour-clip${c.id === active?.id ? " active" : ""}`}
                  onClick={() => setActiveId(c.id)}
                >
                  <div className="hour-thumb">
                    <Play size={14} fill="#fff" />
                  </div>
                  <span>{formatTime12(c.time)}</span>
                  <span className="hour-clip-club">{c.club.toUpperCase()}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </main>
    </Shell>
  );
}

/* ---------- custom pickers ---------- */
// native <input type="date|time"> popups can't be styled, so the filters use these instead

function usePopover() {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return { open, setOpen, ref };
}

const WEEKDAYS = ["S", "M", "T", "W", "T", "F", "S"];

function toISO(y, m, d) {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

// marked = Set of ISO dates that have clips (shown with a dot)
function DatePicker({ value, onChange, marked }) {
  const { open, setOpen, ref } = usePopover();
  const now = new Date();
  const todayISO = toISO(now.getFullYear(), now.getMonth(), now.getDate());
  const base = value ? new Date(`${value}T00:00:00`) : now;
  const [view, setView] = useState({ y: base.getFullYear(), m: base.getMonth() });

  const toggle = () => {
    // jump back to the selected (or current) month every time it opens
    if (!open) setView({ y: base.getFullYear(), m: base.getMonth() });
    setOpen((o) => !o);
  };
  const shift = (n) =>
    setView(({ y, m }) => {
      const d = new Date(y, m + n, 1);
      return { y: d.getFullYear(), m: d.getMonth() };
    });
  const pick = (iso) => {
    onChange(iso);
    setOpen(false);
  };

  const firstWeekday = new Date(view.y, view.m, 1).getDay();
  const daysInMonth = new Date(view.y, view.m + 1, 0).getDate();
  const monthLabel = new Date(view.y, view.m, 1).toLocaleDateString("en-GB", {
    month: "long",
    year: "numeric",
  });

  return (
    <div className="picker" ref={ref}>
      <button
        className={`picker-btn${value ? " has-value" : ""}${open ? " open" : ""}`}
        onClick={toggle}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Calendar size={15} className="picker-ic" />
        <span className="picker-text">{value ? formatDate(value) : "Any date"}</span>
        {!value && <ChevronDown size={14} className="picker-caret" />}
      </button>
      {value && (
        <button className="field-clear" onClick={() => onChange("")} aria-label="Clear date">
          <X size={12} />
        </button>
      )}

      {open && (
        <div className="pop pop-cal" role="dialog" aria-label="Choose a date">
          <div className="cal-head">
            <button className="cal-nav" onClick={() => shift(-1)} aria-label="Previous month">
              <ChevronLeft size={16} />
            </button>
            <span>{monthLabel}</span>
            <button className="cal-nav" onClick={() => shift(1)} aria-label="Next month">
              <ChevronRight size={16} />
            </button>
          </div>
          <div className="cal-grid">
            {WEEKDAYS.map((w, i) => (
              <span key={i} className="cal-wd">{w}</span>
            ))}
            {Array.from({ length: firstWeekday }, (_, i) => (
              <span key={`blank-${i}`} />
            ))}
            {Array.from({ length: daysInMonth }, (_, i) => {
              const iso = toISO(view.y, view.m, i + 1);
              const cls = [
                "cell",
                iso === value && "selected",
                iso === todayISO && "today",
                marked.has(iso) && "has-clips",
              ].filter(Boolean).join(" ");
              return (
                <button key={iso} className={cls} onClick={() => pick(iso)}>
                  {i + 1}
                </button>
              );
            })}
          </div>
          <div className="pop-foot">
            <button className="pop-link" onClick={() => pick("")}>Any date</button>
            <button className="pop-link" onClick={() => pick(todayISO)}>Today</button>
          </div>
        </div>
      )}
    </div>
  );
}

// value is 24h "HH:MM"; the grid only filters by hour, so it picks whole hours.
// marked = Set of hours (0-23) that have clips
function HourPicker({ value, onChange, marked }) {
  const { open, setOpen, ref } = usePopover();
  const selected = value ? hourOf(value) : null;

  const pick = (h) => {
    onChange(h === null ? "" : `${String(h).padStart(2, "0")}:00`);
    setOpen(false);
  };
  const label = (h) => `${h % 12 || 12}:00`;
  const rangeLabel = (h) => `${h % 12 || 12}:00 – ${h % 12 || 12}:59 ${h < 12 ? "AM" : "PM"}`;
  const section = (title, start) => (
    <>
      <div className="pop-label">{title}</div>
      <div className="hour-grid">
        {Array.from({ length: 12 }, (_, i) => {
          const h = start + i;
          const cls = ["cell", h === selected && "selected", marked.has(h) && "has-clips"]
            .filter(Boolean)
            .join(" ");
          return (
            <button key={h} className={cls} onClick={() => pick(h)}>
              {label(h)}
            </button>
          );
        })}
      </div>
    </>
  );

  return (
    <div className="picker" ref={ref}>
      <button
        className={`picker-btn${value ? " has-value" : ""}${open ? " open" : ""}`}
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <Clock size={15} className="picker-ic" />
        <span className="picker-text">{selected !== null ? rangeLabel(selected) : "Any time"}</span>
        {!value && <ChevronDown size={14} className="picker-caret" />}
      </button>
      {value && (
        <button className="field-clear" onClick={() => onChange("")} aria-label="Clear time">
          <X size={12} />
        </button>
      )}

      {open && (
        <div className="pop pop-hours align-right" role="dialog" aria-label="Choose an hour">
          {section("AM", 0)}
          {section("PM", 12)}
          <div className="pop-foot">
            <button className="pop-link" onClick={() => pick(null)}>Any time</button>
          </div>
        </div>
      )}
    </div>
  );
}

/* ---------- grid view ---------- */
function Grid() {
  const navigate = useNavigate();
  const { clips: allClips, loading, error } = useClips();
  // empty date/time = no filter (show every date/hour); "all" club = every club.
  // defaults are wide open so all videos are findable without knowing exact date/time/club up front.
  const [date, setDate] = useState(""); // ISO, from <input type="date">
  const [time, setTime] = useState(""); // 24h "HH:MM", from <input type="time">
  const [loc, setLoc] = useState("all");
  const [query, setQuery] = useState("");
  const timeLabel = time ? hourBucketLabel(time) : null;
  const clips = allClips.filter((c) => {
    if (date && c.date !== date) return false;
    if (loc !== "all" && c.club !== loc) return false;
    if (timeLabel && hourBucketLabel(c.time) !== timeLabel) return false;
    if (query) {
      const q = query.toLowerCase();
      if (!c.time.toLowerCase().includes(q) && !c.club.toLowerCase().includes(q)) return false;
    }
    return true;
  });
  const buckets = groupByHour(clips);
  // what the pickers mark as "has clips", given the other active filters
  const inClub = (c) => loc === "all" || c.club === loc;
  const clipDates = new Set(allClips.filter(inClub).map((c) => c.date));
  const clipHours = new Set(
    allClips.filter((c) => inClub(c) && (!date || c.date === date)).map((c) => hourOf(c.time))
  );
  const hasFilters = date || time || loc !== "all" || query;

  const resetFilters = () => {
    setDate("");
    setTime("");
    setLoc("all");
    setQuery("");
  };

  const openClip = (bucket) => {
    // one path segment: 2026-07-20&9:00AM (& encoded so it stays one segment)
    // club always goes in the query string so links from different clubs stay distinct
    navigate(`/${bucket.date}${encodeURIComponent("&" + bucket.label)}?loc=${bucket.club}`);
  };

  return (
    <Shell>
      <main className="grid-view">
        <header className="hero">
          <div className="eyebrow">KROSS · MATCH REPLAYS</div>
          <h1 className="title">HIGHLIGHT</h1>
          <p className="subtitle">Find your game by date, time and club</p>
        </header>

        <div className="panel">
          <div className="panel-row">
            <DatePicker value={date} onChange={setDate} marked={clipDates} />
            <HourPicker value={time} onChange={setTime} marked={clipHours} />

            <div className="field search">
              <Search size={15} className="field-ic" />
              <input
                placeholder="Search time or club"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              {query && (
                <button className="field-clear" onClick={() => setQuery("")} aria-label="Clear search">
                  <X size={12} />
                </button>
              )}
            </div>
          </div>

          <div className="chips" role="group" aria-label="Club">
            {LOCATIONS.map((l) => (
              <button
                key={l.id}
                className={`chip${loc === l.id ? " active" : ""}`}
                onClick={() => setLoc(l.id)}
                aria-pressed={loc === l.id}
              >
                <span className="dot" style={{ background: l.color }} />
                {l.label}
              </button>
            ))}
          </div>

          <div className="panel-foot">
            <span>
              {loading ? "Loading…" : `${clips.length} video${clips.length === 1 ? "" : "s"}`}
            </span>
            {hasFilters && (
              <button className="reset" onClick={resetFilters}>
                <RotateCcw size={12} /> Reset filters
              </button>
            )}
          </div>
        </div>

        {error ? (
          <div className="empty">Couldn't load highlights: {error.message}</div>
        ) : loading ? (
          <div className="clips">
            {[0, 1, 2].map((i) => (
              <div key={i} className="clip skeleton">
                <div className="thumb" />
                <div className="clip-body" />
              </div>
            ))}
          </div>
        ) : buckets.length === 0 ? (
          <div className="empty">
            No highlights found for these filters.
            {hasFilters && (
              <button className="reset" onClick={resetFilters}>
                <RotateCcw size={12} /> Reset filters
              </button>
            )}
          </div>
        ) : (
          <div className="clips">
            {buckets.map((b) => {
              const club = LOCATIONS.find((l) => l.id === b.club);
              return (
                <button
                  key={`${b.date}__${b.label}__${b.club}`}
                  className="clip"
                  onClick={() => openClip(b)}
                  style={{ "--club": club?.color || "#9ca3af" }}
                >
                  <div className="thumb" style={{ "--thumb-img": `url(${BG})` }}>
                    <span className="badge">
                      <span className="dot" style={{ background: club?.color }} />
                      {(club?.label || b.club).toUpperCase()}
                    </span>
                    <span className="thumb-play"><Play size={20} fill="#fff" /></span>
                    {b.items.length > 1 && <span className="clip-count">{b.items.length} videos</span>}
                  </div>
                  <div className="clip-body">
                    <div className="clip-time">{b.label}</div>
                    <div className="clip-date">{formatDate(b.date)}</div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </main>
    </Shell>
  );
}

/* ---------- router ---------- */
export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Grid />} />
        {/* whole "date&time" is one segment, captured with a splat */}
        <Route path="/:slug" element={<Detail />} />
      </Routes>
    </BrowserRouter>
  );
}

/* ---------- styles ---------- */
const CSS = `
  * { box-sizing: border-box; margin: 0; }
  a { text-decoration: none; color: inherit; }

  .app {
    --scrim-1: rgba(6,10,8,.55);
    --scrim-2: rgba(6,10,8,.88);
    --fg: #fff;
    --fg-inv: #14181a;
    --accent: #4ade80;
    --accent-ring: rgba(74,222,128,.25);
    --on-accent: #052e14;
    --pop-hover: rgba(255,255,255,.08);
    --pop-active: rgba(255,255,255,.16);
    --placeholder: rgba(255,255,255,.55);
    --surface: rgba(255,255,255,.08);
    --surface-strong: rgba(255,255,255,.1);
    --surface-hover: rgba(255,255,255,.18);
    --border: rgba(255,255,255,.16);
    --border-soft: rgba(255,255,255,.12);
    --menu-bg: rgba(20,26,22,.95);
    --shadow-strong: rgba(0,0,0,.4);
    --knob-bg: #fff;
    --knob-fg: #14181a;
    --cs: dark;
  }
  .app[data-theme="light"] {
    --scrim-1: rgba(246,248,247,.62);
    --scrim-2: rgba(246,248,247,.9);
    --fg: #14181a;
    --fg-inv: #fff;
    --accent: #16a34a;
    --accent-ring: rgba(22,163,74,.2);
    --on-accent: #fff;
    --pop-hover: rgba(20,24,22,.06);
    --pop-active: rgba(20,24,22,.12);
    --placeholder: rgba(20,24,22,.45);
    --surface: rgba(255,255,255,.55);
    --surface-strong: rgba(255,255,255,.75);
    --surface-hover: rgba(255,255,255,.92);
    --border: rgba(20,24,22,.16);
    --border-soft: rgba(20,24,22,.12);
    --menu-bg: rgba(255,255,255,.97);
    --shadow-strong: rgba(20,24,22,.18);
    --knob-bg: #14181a;
    --knob-fg: #fff;
    --cs: light;
  }

  .app { position: relative; min-height: 100vh; overflow-x: hidden;
    font-family: system-ui, -apple-system, sans-serif; color: var(--fg); transition: color .2s; }
  .bg { position: fixed; inset: -20px; background-size: cover; background-position: center; z-index: 0;
    filter: blur(3px) saturate(1.1); }
  .scrim { position: fixed; inset: 0; z-index: 1;
    background: linear-gradient(180deg, var(--scrim-1), var(--scrim-2)); transition: background .2s; }

  .nav { position: relative; z-index: 3; display: flex; align-items: center;
    justify-content: space-between; padding: 22px 34px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px;
    font-weight: 700; letter-spacing: .04em; }
  .moon { width: 52px; height: 30px; border-radius: 999px; border: 1px solid var(--border);
    background: var(--surface-strong); position: relative; padding: 0; cursor: pointer; }
  .moon > * { position: absolute; top: 3px; left: 3px; width: 24px; height: 24px; border-radius: 50%;
    background: var(--knob-bg); color: var(--knob-fg); display: flex; align-items: center;
    justify-content: center; transition: transform .25s ease, background .25s ease, color .25s ease; }
  .moon.is-light > * { transform: translateX(22px); }

  /* ---- grid ---- */
  .grid-view { position: relative; z-index: 3; max-width: 1040px; margin: 0 auto;
    padding: 24px 24px 80px; }
  .hero { text-align: center; margin-bottom: 34px; }
  .eyebrow { display: inline-block; font-size: 11px; font-weight: 600; letter-spacing: .22em;
    padding: 6px 14px; border-radius: 999px; background: var(--surface);
    border: 1px solid var(--border-soft); backdrop-filter: blur(12px); margin-bottom: 16px; }
  .title { font-size: 56px; font-weight: 800; color: var(--fg); letter-spacing: .14em; line-height: 1;
    text-shadow: 0 4px 30px var(--shadow-strong); }
  .subtitle { margin-top: 12px; font-size: 15px; opacity: .75; }

  .panel { position: relative; z-index: 2; display: flex; flex-direction: column; gap: 16px;
    padding: 20px; border-radius: 24px; background: var(--surface); backdrop-filter: blur(22px) saturate(1.3);
    -webkit-backdrop-filter: blur(22px) saturate(1.3);
    border: 1px solid var(--border-soft); box-shadow: 0 20px 50px var(--shadow-strong); margin-bottom: 40px; }
  .panel-row { display: grid; grid-template-columns: 1fr 1fr 1.6fr; gap: 12px; }

  .field { position: relative; display: flex; align-items: center; min-width: 0; }
  .field input { width: 100%; min-width: 0; height: 44px; background: var(--surface-strong);
    border: 1px solid var(--border); color: var(--fg); border-radius: 14px;
    padding: 0 34px 0 40px; font-size: 14px; font-family: inherit; outline: none; color-scheme: var(--cs);
    transition: border-color .2s, background .2s, box-shadow .2s; }
  .field input:hover { background: var(--surface-hover); }
  .field input:focus { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
  .field-ic { position: absolute; left: 14px; opacity: .65; pointer-events: none; }
  .field-clear { position: absolute; right: 10px; width: 20px; height: 20px; border-radius: 50%;
    border: none; background: var(--surface-hover); color: var(--fg); display: flex;
    align-items: center; justify-content: center; cursor: pointer; padding: 0; }

  .picker { position: relative; display: flex; align-items: center; min-width: 0; }
  .picker-btn { width: 100%; height: 44px; display: flex; align-items: center; gap: 10px;
    padding: 0 14px; background: var(--surface-strong); border: 1px solid var(--border);
    border-radius: 14px; color: var(--fg); font-family: inherit; font-size: 14px; cursor: pointer;
    text-align: left; transition: border-color .2s, background .2s, box-shadow .2s; }
  .picker-btn:hover { background: var(--surface-hover); }
  .picker-btn.open { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
  .picker-btn.has-value { padding-right: 38px; }
  .picker-ic { flex: none; opacity: .65; }
  .picker-text { flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
    color: var(--placeholder); }
  .has-value .picker-text { color: var(--fg); font-weight: 600; }
  .picker-caret { flex: none; opacity: .5; transition: transform .2s; }
  .open .picker-caret { transform: rotate(180deg); }

  .pop { position: absolute; top: calc(100% + 8px); left: 0; z-index: 20;
    width: min(300px, calc(100vw - 32px)); padding: 14px; border-radius: 18px; text-align: left;
    background: var(--menu-bg); border: 1px solid var(--border);
    backdrop-filter: blur(24px); -webkit-backdrop-filter: blur(24px);
    box-shadow: 0 24px 60px var(--shadow-strong); animation: pop-in .16s ease-out; }
  .pop.align-right { left: auto; right: 0; }
  @keyframes pop-in { from { opacity: 0; transform: translateY(-6px) scale(.98); } }

  .cal-head { display: flex; align-items: center; justify-content: space-between;
    font-size: 15px; font-weight: 700; margin-bottom: 10px; }
  .cal-nav { width: 32px; height: 32px; border-radius: 10px; border: none; background: var(--pop-hover);
    color: var(--fg); display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .cal-nav:hover { background: var(--pop-active); }
  .cal-grid { display: grid; grid-template-columns: repeat(7, 1fr); gap: 4px; }
  .cal-wd { text-align: center; font-size: 11px; font-weight: 600; opacity: .5; padding: 4px 0; }
  .cal-grid .cell { aspect-ratio: 1; }

  .pop-label { font-size: 11px; font-weight: 700; letter-spacing: .12em; opacity: .5; margin: 2px 2px 8px; }
  .hour-grid { display: grid; grid-template-columns: repeat(4, 1fr); gap: 6px; }
  .hour-grid + .pop-label { margin-top: 12px; }
  .hour-grid .cell { height: 38px; }

  .cell { position: relative; border: none; border-radius: 10px; background: none; color: var(--fg);
    font-family: inherit; font-size: 13px; cursor: pointer; transition: background .15s; }
  .cell:hover { background: var(--pop-hover); }
  .cell.today { box-shadow: inset 0 0 0 1px var(--border); font-weight: 700; }
  .cell.has-clips::after { content: ""; position: absolute; bottom: 4px; left: 50%; width: 4px; height: 4px;
    border-radius: 50%; background: var(--accent); transform: translateX(-50%); }
  .cell.selected { background: var(--accent); color: var(--on-accent); font-weight: 700; }
  .cell.selected::after { background: currentColor; }

  .pop-foot { display: flex; justify-content: space-between; margin-top: 12px; padding-top: 10px;
    border-top: 1px solid var(--border-soft); }
  .pop-link { background: none; border: none; color: var(--accent); font-family: inherit; font-size: 13px;
    font-weight: 600; cursor: pointer; padding: 6px 8px; border-radius: 8px; }
  .pop-link:hover { background: var(--pop-hover); }
  input::placeholder { color: var(--placeholder); }

  .chips { display: flex; gap: 8px; flex-wrap: wrap; }
  .chip { display: inline-flex; align-items: center; gap: 8px; height: 36px; padding: 0 16px;
    border-radius: 999px; border: 1px solid var(--border); background: var(--surface-strong);
    color: var(--fg); font-size: 13px; font-weight: 600; letter-spacing: .04em; cursor: pointer;
    font-family: inherit; transition: background .2s, color .2s, border-color .2s, transform .15s; }
  .chip:hover { background: var(--surface-hover); }
  .chip:active { transform: scale(.97); }
  .chip.active { background: var(--fg); color: var(--fg-inv); border-color: var(--fg); }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none;
    box-shadow: 0 0 0 2px rgba(255,255,255,.35); }

  .panel-foot { display: flex; align-items: center; justify-content: space-between; gap: 12px;
    padding-top: 14px; border-top: 1px solid var(--border-soft); font-size: 13px; opacity: .85; min-height: 30px; }
  .reset { display: inline-flex; align-items: center; gap: 6px; background: none;
    border: 1px solid var(--border); color: var(--fg); border-radius: 999px; padding: 6px 12px;
    font-size: 12px; font-family: inherit; cursor: pointer; }
  .reset:hover { background: var(--surface-hover); }

  .empty { display: flex; flex-direction: column; align-items: center; gap: 14px;
    text-align: center; padding: 60px 20px; font-size: 15px; border-radius: 20px;
    background: var(--surface); border: 1px dashed var(--border); backdrop-filter: blur(12px); }

  .clips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px; }
  .clip { background: var(--surface); border: 1px solid var(--border-soft); border-radius: 18px;
    cursor: pointer; padding: 8px; color: var(--fg); text-align: left; font-family: inherit;
    backdrop-filter: blur(14px); -webkit-backdrop-filter: blur(14px);
    transition: transform .25s, box-shadow .25s, border-color .25s; }
  .clip:hover { transform: translateY(-4px); border-color: var(--club, var(--border));
    box-shadow: 0 18px 40px var(--shadow-strong); }
  .thumb { aspect-ratio: 16 / 10; border-radius: 12px; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center; background-color: #0e1411;
    background-image: linear-gradient(160deg, color-mix(in srgb, var(--club, #000) 45%, transparent),
      rgba(0,0,0,.7)), var(--thumb-img, none);
    background-size: cover; background-position: center; }
  .thumb-play { width: 50px; height: 50px; border-radius: 50%; background: rgba(255,255,255,.18);
    border: 1px solid rgba(255,255,255,.35); backdrop-filter: blur(6px); display: flex;
    align-items: center; justify-content: center; transition: transform .25s, background .25s; }
  .clip:hover .thumb-play { transform: scale(1.1); background: rgba(255,255,255,.3); }
  .badge { position: absolute; top: 10px; left: 10px; display: inline-flex; align-items: center; gap: 6px;
    background: rgba(0,0,0,.5); color: #fff; font-size: 10px; font-weight: 700; letter-spacing: .08em;
    padding: 5px 10px; border-radius: 999px; backdrop-filter: blur(6px); }
  .clip-count { position: absolute; bottom: 10px; right: 10px; background: rgba(0,0,0,.6);
    color: #fff; font-size: 11px; padding: 4px 10px; border-radius: 999px; backdrop-filter: blur(4px); }
  .clip-body { padding: 12px 6px 6px; min-height: 52px; }
  .clip-time { font-size: 17px; font-weight: 700; letter-spacing: .02em; }
  .clip-date { margin-top: 3px; font-size: 12px; opacity: .65; }

  .skeleton { cursor: default; pointer-events: none; }
  .skeleton .thumb, .skeleton .clip-body { background: var(--surface-strong);
    animation: pulse 1.4s ease-in-out infinite; }
  .skeleton .clip-body { margin-top: 8px; border-radius: 10px; }
  @keyframes pulse { 50% { opacity: .45; } }

  /* ---- hour list (detail) ---- */
  .hour-list { margin-top: 40px; }
  .hour-list-title { font-size: 14px; opacity: .75; margin-bottom: 14px; text-align: center; }
  .hour-clips { display: flex; gap: 14px; flex-wrap: wrap; justify-content: center; }
  .hour-clip { display: flex; flex-direction: column; align-items: center; gap: 8px;
    background: none; border: none; cursor: pointer; padding: 0; color: var(--fg); }
  .hour-thumb { width: 96px; aspect-ratio: 16 / 10; border-radius: 10px;
    background: var(--surface-strong);
    display: flex; align-items: center; justify-content: center; border: 2px solid transparent;
    transition: .2s; }
  .hour-clip.active .hour-thumb { border-color: var(--fg); }
  .hour-clip:hover .hour-thumb { transform: translateY(-3px); }
  .hour-clip span { font-size: 12px; opacity: .85; }
  .hour-clip-club { font-size: 10px; opacity: .55; letter-spacing: .04em; }

  /* ---- detail ---- */
  .detail { position: relative; z-index: 3; max-width: 900px; margin: 0 auto;
    padding: 20px 24px 80px; }
  .back { display: inline-flex; align-items: center; gap: 8px; background: var(--surface-strong);
    border: 1px solid var(--border); color: var(--fg); border-radius: 999px;
    padding: 9px 18px; font-size: 14px; cursor: pointer; margin-bottom: 26px; }
  .back:hover { background: var(--surface-hover); }
  .player { border-radius: 20px; overflow: hidden; border: 1px solid var(--border);
    box-shadow: 0 20px 60px var(--shadow-strong); }
  .player-video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
  .player-face { aspect-ratio: 16 / 9; background:
    linear-gradient(135deg, rgba(30,36,32,.9), rgba(10,14,12,.9));
    display: flex; align-items: center; justify-content: center; }
  .meta { margin-top: 26px; text-align: center; }
  .meta-time { font-size: 30px; font-weight: 700; letter-spacing: .04em; }
  .meta-date { margin-top: 6px; opacity: .7; font-size: 15px; }

  @media (max-width: 720px) {
    .clips { grid-template-columns: repeat(2, 1fr); gap: 16px; }
    .panel { padding: 16px; }
    .panel-row { grid-template-columns: 1fr 1fr; }
    .panel-row .search { grid-column: 1 / -1; }
    .title { font-size: 40px; }
  }
  @media (max-width: 480px) {
    .nav { padding: 16px 18px; }
    .brand { font-size: 18px; gap: 8px; }
    .grid-view, .detail { padding: 20px 16px 60px; }
    .title { font-size: 34px; }
    .subtitle { font-size: 13px; }
    .hero { margin-bottom: 24px; }
    .panel { gap: 12px; padding: 14px; border-radius: 20px; }
    .panel-row { gap: 10px; }
    .field input { font-size: 13px; }
    .chips { flex-wrap: nowrap; overflow-x: auto; margin: 0 -14px; padding: 0 14px 2px;
      scrollbar-width: none; }
    .chip { flex: none; }
    .clips { grid-template-columns: 1fr; gap: 16px; }
    .back { padding: 8px 14px; font-size: 13px; margin-bottom: 18px; }
    .meta-time { font-size: 24px; }
    .hour-thumb { width: 76px; }
  }
`;
