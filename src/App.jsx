import { useState, useEffect } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
  useParams,
  useSearchParams,
  Link,
} from "react-router-dom";
import { Search, Moon, Sun, ArrowLeft, Play } from "lucide-react";
import { collection, query, orderBy, onSnapshot } from "firebase/firestore";
import { db } from "./firebase";

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

const BG =
  "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?q=80&w=1920&auto=format&fit=crop";

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

// group clips by date + hour bucket, sorted chronologically
// (grouped by date too, not just hour, since "all clubs / all dates" browsing can mix dates)
function groupByHour(list) {
  const map = new Map();
  list.forEach((c) => {
    const label = hourBucketLabel(c.time);
    const key = `${c.date}__${label}`;
    if (!map.has(key)) map.set(key, { date: c.date, label, hour24: hourOf(c.time), items: [] });
    map.get(key).items.push(c);
  });
  return Array.from(map.values()).sort((a, b) =>
    a.date === b.date ? a.hour24 - b.hour24 : a.date < b.date ? -1 : 1
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
  const [openLoc, setOpenLoc] = useState(false);

  const active = LOCATIONS.find((l) => l.id === loc);
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

  const openClip = (bucket) => {
    // one path segment: 2026-07-20&9:00AM (& encoded so it stays one segment)
    // club only goes in the query string when a specific club is selected
    const params = loc !== "all" ? `?loc=${loc}` : "";
    navigate(`/${bucket.date}${encodeURIComponent("&" + bucket.label)}${params}`);
  };

  return (
    <Shell>
      <main className="grid-view">
        <h1 className="title">HIGHLIGHT</h1>

        <div className="panel">
          <div className="field">
            <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>

          <div className="field">
            <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
          </div>

          <div className="loc-wrap">
            <button className="pill" onClick={() => setOpenLoc((o) => !o)}>
              <span className="dot" style={{ background: active.color }} />
              {active.label}
            </button>
            {openLoc && (
              <div className="menu">
                {LOCATIONS.map((l) => (
                  <button
                    key={l.id}
                    className="menu-item"
                    onClick={() => { setLoc(l.id); setOpenLoc(false); }}
                  >
                    <span className="dot" style={{ background: l.color }} />
                    {l.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="field search">
            <Search size={15} className="field-ic" />
            <input
              placeholder="Search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        </div>

        {error ? (
          <div className="empty">Couldn't load highlights: {error.message}</div>
        ) : loading ? (
          <div className="empty">Loading highlights…</div>
        ) : buckets.length === 0 ? (
          <div className="empty">No highlights found for these filters. Try clearing the date, time, or club.</div>
        ) : (
          <div className="clips">
            {buckets.map((b) => (
              <button key={`${b.date}__${b.label}`} className="clip" onClick={() => openClip(b)}>
                <div className="thumb">
                  <span className="thumb-play"><Play size={20} fill="#fff" /></span>
                  {b.items.length > 1 && <span className="clip-count">{b.items.length} videos</span>}
                </div>
                <div className="clip-time">{b.label}</div>
                <div className="clip-date">{b.date}</div>
              </button>
            ))}
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
    --scrim-1: rgba(8,12,10,.55);
    --scrim-2: rgba(8,12,10,.75);
    --fg: #fff;
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
    --scrim-1: rgba(255,255,255,.42);
    --scrim-2: rgba(255,255,255,.66);
    --fg: #14181a;
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
  .bg { position: fixed; inset: 0; background-size: cover; background-position: center; z-index: 0; }
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
  .grid-view { position: relative; z-index: 3; max-width: 1000px; margin: 0 auto;
    padding: 30px 24px 80px; }
  .title { text-align: center; font-size: 40px; font-weight: 700; color: var(--fg); letter-spacing: .12em;
    margin-bottom: 40px; text-shadow: 0 2px 24px var(--shadow-strong); }

  .panel { position: relative; z-index: 2; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    justify-content: center; padding: 18px 22px; border-radius: 20px;
    background: var(--surface); backdrop-filter: blur(18px);
    border: 1px solid var(--border-soft); margin-bottom: 46px; }

  .field { position: relative; display: flex; align-items: center; }
  .field input { background: var(--surface-strong); border: 1px solid var(--border);
    color: var(--fg); border-radius: 999px; padding: 9px 16px; font-size: 14px; width: 150px;
    outline: none; color-scheme: var(--cs); }
  .field.search input { padding-left: 34px; width: 150px; }
  .field-ic { position: absolute; right: 12px; opacity: .7; pointer-events: none; }
  .field.search .field-ic { left: 12px; right: auto; }
  input::placeholder { color: var(--placeholder); }

  .empty { text-align: center; opacity: .75; padding: 60px 20px; font-size: 15px; }

  .loc-wrap { position: relative; }
  .pill { display: flex; align-items: center; gap: 9px; background: var(--surface-strong);
    border: 1px solid var(--border); color: var(--fg); border-radius: 999px;
    padding: 9px 18px; font-size: 14px; cursor: pointer; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .menu { position: absolute; top: calc(100% + 8px); left: 0; z-index: 10;
    background: var(--menu-bg); backdrop-filter: blur(18px);
    border: 1px solid var(--border); border-radius: 14px; padding: 6px;
    min-width: 150px; box-shadow: 0 16px 40px var(--shadow-strong); }
  .menu-item { display: flex; align-items: center; gap: 10px; width: 100%;
    background: none; border: none; color: var(--fg); padding: 9px 12px; font-size: 14px;
    border-radius: 9px; cursor: pointer; text-align: left; }
  .menu-item:hover { background: var(--surface-hover); }

  .clips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px 26px; }
  .clip { background: none; border: none; cursor: pointer; padding: 0; color: var(--fg); }
  .thumb { aspect-ratio: 16 / 10; border-radius: 12px; background: rgba(230,230,230,.92);
    background-size: cover; background-position: center; position: relative;
    display: flex; align-items: center; justify-content: center; transition: .25s;
    box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .clip:hover .thumb { transform: translateY(-4px); box-shadow: 0 14px 40px rgba(0,0,0,.4); }
  .thumb-play { width: 46px; height: 46px; border-radius: 50%;
    background: rgba(0,0,0,.45); backdrop-filter: blur(4px); display: flex;
    align-items: center; justify-content: center; transition: .25s; }
  .clip-time { text-align: center; margin-top: 12px; font-size: 14px; letter-spacing: .02em; }
  .clip-date { text-align: center; margin-top: 3px; font-size: 12px; opacity: .6; }
  .clip-count { position: absolute; bottom: 8px; right: 8px; background: rgba(0,0,0,.6);
    color: #fff; font-size: 11px; padding: 3px 9px; border-radius: 999px;
    backdrop-filter: blur(4px); }

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
    .clips { grid-template-columns: repeat(2, 1fr); }
    .panel { padding: 16px; }
    .title { font-size: 32px; }
  }
  @media (max-width: 480px) {
    .nav { padding: 16px 18px; }
    .brand { font-size: 18px; gap: 8px; }
    .grid-view, .detail { padding: 20px 16px 60px; }
    .title { font-size: 26px; margin-bottom: 26px; }
    .panel { gap: 10px; padding: 14px; border-radius: 16px; }
    .field input { width: 128px; font-size: 13px; padding: 8px 12px; }
    .field.search input { width: 118px; }
    .clips { grid-template-columns: 1fr; gap: 18px; }
    .back { padding: 8px 14px; font-size: 13px; margin-bottom: 18px; }
    .meta-time { font-size: 24px; }
    .hour-thumb { width: 76px; }
  }
`;
