import { useState } from "react";
import {
  BrowserRouter,
  Routes,
  Route,
  useNavigate,
  useParams,
  Link,
} from "react-router-dom";
import { Search, Calendar, Moon, ArrowLeft, Play } from "lucide-react";

/* ---------------------------------------------------------------
   KROSS · Highlights  (react-router-dom v6)
   Routes:
     /                       -> Grid
     /:date&:time            -> Detail   e.g. /2026-07-20&9:00AM
   Note: date & time live in ONE path segment ("2026-07-20&9:00AM"),
   so we read it with a wildcard param and split on "&".
----------------------------------------------------------------*/

const LOCATIONS = [
  { id: "ONNUT", label: "ONNUT", color: "#22c55e" },
  { id: "SKY", label: "SKY", color: "#111111" },
  { id: "INDOOR", label: "INDOOR", color: "#3b5bdb" },
  { id: "ASOKE", label: "ASOKE", color: "#f97316" },
];

const BG =
  "https://images.unsplash.com/photo-1554068865-24cecd4e34b8?q=80&w=1920&auto=format&fit=crop";

const CLIPS = Array.from({ length: 5 }).map((_, i) => ({
  id: i,
  time: "09:30 AM",
  location: "ONNUT",
  thumb:
    i === 0
      ? "https://images.unsplash.com/photo-1626224583764-f87db24ac4ea?q=80&w=800&auto=format&fit=crop"
      : null,
}));

/* ---------- shared shell ---------- */
function Shell({ children }) {
  return (
    <div className="app">
      <style>{CSS}</style>
      <div className="bg" style={{ backgroundImage: `url(${BG})` }} />
      <div className="scrim" />
      <nav className="nav">
        <Link to="/" className="brand">
          <svg width="30" height="30" viewBox="0 0 32 32" fill="none">
            <path d="M4 4 L14 16 L4 28" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" />
            <path d="M16 4 L26 16 L16 28" stroke="#fff" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round" opacity=".6" />
          </svg>
          <span>KROSS</span>
        </Link>
        <button className="moon"><Moon size={18} /></button>
      </nav>
      {children}
    </div>
  );
}

/* ---------- detail view ---------- */
function Detail() {
  // route param is the whole segment: "2026-07-20&9:00AM"
  const { slug } = useParams();
  const [date, time] = decodeURIComponent(slug || "").split("&");

  return (
    <Shell>
      <main className="detail">
        <Link to="/" className="back">
          <ArrowLeft size={16} /> Back to highlights
        </Link>
        <div className="player">
          <div className="player-face">
            <button className="playbtn"><Play size={30} fill="#0b0f0d" /></button>
          </div>
        </div>
        <div className="meta">
          <div className="meta-time">{time}</div>
          <div className="meta-date">{date}</div>
        </div>
      </main>
    </Shell>
  );
}

/* ---------- grid view ---------- */
function Grid() {
  const navigate = useNavigate();
  const [date, setDate] = useState("20/07/2026");
  const [time, setTime] = useState("09:00AM");
  const [loc, setLoc] = useState("ONNUT");
  const [query, setQuery] = useState("");
  const [openLoc, setOpenLoc] = useState(false);

  const active = LOCATIONS.find((l) => l.id === loc);
  const clips = CLIPS.filter((c) =>
    query ? c.time.toLowerCase().includes(query.toLowerCase()) : true
  );

  const iso = date.split("/").reverse().join("-"); // 20/07/2026 -> 2026-07-20

  const openClip = (clipTime) => {
    // one path segment: 2026-07-20&9:00AM  (& encoded so it stays one segment)
    navigate(`/${iso}${encodeURIComponent("&" + clipTime)}`);
  };

  return (
    <Shell>
      <main className="grid-view">
        <h1 className="title">HIGHLIGHT</h1>

        <div className="panel">
          <div className="field">
            <input value={date} onChange={(e) => setDate(e.target.value)} />
            <Calendar size={15} className="field-ic" />
          </div>

          <div className="field">
            <input value={time} onChange={(e) => setTime(e.target.value)} />
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

        <div className="clips">
          {clips.map((c) => (
            <button key={c.id} className="clip" onClick={() => openClip(c.time)}>
              <div className="thumb" style={c.thumb ? { backgroundImage: `url(${c.thumb})` } : {}}>
                {c.thumb && <span className="thumb-play"><Play size={20} fill="#fff" /></span>}
              </div>
              <div className="clip-time">{c.time}</div>
            </button>
          ))}
        </div>
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
  .app { position: relative; min-height: 100vh; overflow-x: hidden;
    font-family: system-ui, -apple-system, sans-serif; color: #fff; }
  .bg { position: fixed; inset: 0; background-size: cover; background-position: center; z-index: 0; }
  .scrim { position: fixed; inset: 0; z-index: 1;
    background: linear-gradient(180deg, rgba(8,12,10,.55), rgba(8,12,10,.75)); }

  .nav { position: relative; z-index: 3; display: flex; align-items: center;
    justify-content: space-between; padding: 22px 34px; }
  .brand { display: flex; align-items: center; gap: 12px; font-size: 22px;
    font-weight: 700; letter-spacing: .04em; }
  .moon { width: 52px; height: 30px; border-radius: 999px; border: 1px solid rgba(255,255,255,.25);
    background: rgba(255,255,255,.08); color: #fff; display: flex; align-items: center;
    justify-content: flex-end; padding-right: 7px; cursor: pointer; }

  /* ---- grid ---- */
  .grid-view { position: relative; z-index: 3; max-width: 1000px; margin: 0 auto;
    padding: 30px 24px 80px; }
  .title { text-align: center; font-size: 40px; font-weight: 700; letter-spacing: .12em;
    margin-bottom: 40px; text-shadow: 0 2px 24px rgba(0,0,0,.4); }

  .panel { display: flex; align-items: center; gap: 14px; flex-wrap: wrap;
    justify-content: center; padding: 18px 22px; border-radius: 20px;
    background: rgba(255,255,255,.08); backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,.12); margin-bottom: 46px; }

  .field { position: relative; display: flex; align-items: center; }
  .field input { background: rgba(255,255,255,.1); border: 1px solid rgba(255,255,255,.16);
    color: #fff; border-radius: 999px; padding: 9px 16px; font-size: 14px; width: 120px;
    outline: none; }
  .field.search input { padding-left: 34px; width: 150px; }
  .field-ic { position: absolute; right: 12px; opacity: .7; pointer-events: none; }
  .field.search .field-ic { left: 12px; right: auto; }
  input::placeholder { color: rgba(255,255,255,.55); }

  .loc-wrap { position: relative; }
  .pill { display: flex; align-items: center; gap: 9px; background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.16); color: #fff; border-radius: 999px;
    padding: 9px 18px; font-size: 14px; cursor: pointer; }
  .dot { width: 9px; height: 9px; border-radius: 50%; flex: none; }
  .menu { position: absolute; top: calc(100% + 8px); left: 0; z-index: 10;
    background: rgba(20,26,22,.95); backdrop-filter: blur(18px);
    border: 1px solid rgba(255,255,255,.14); border-radius: 14px; padding: 6px;
    min-width: 150px; box-shadow: 0 16px 40px rgba(0,0,0,.5); }
  .menu-item { display: flex; align-items: center; gap: 10px; width: 100%;
    background: none; border: none; color: #fff; padding: 9px 12px; font-size: 14px;
    border-radius: 9px; cursor: pointer; text-align: left; }
  .menu-item:hover { background: rgba(255,255,255,.1); }

  .clips { display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px 26px; }
  .clip { background: none; border: none; cursor: pointer; padding: 0; }
  .thumb { aspect-ratio: 16 / 10; border-radius: 12px; background: rgba(230,230,230,.92);
    background-size: cover; background-position: center; position: relative;
    display: flex; align-items: center; justify-content: center; transition: .25s;
    box-shadow: 0 8px 30px rgba(0,0,0,.25); }
  .clip:hover .thumb { transform: translateY(-4px); box-shadow: 0 14px 40px rgba(0,0,0,.4); }
  .thumb-play { width: 46px; height: 46px; border-radius: 50%;
    background: rgba(0,0,0,.45); backdrop-filter: blur(4px); display: flex;
    align-items: center; justify-content: center; opacity: 0; transition: .25s; }
  .clip:hover .thumb-play { opacity: 1; }
  .clip-time { text-align: center; margin-top: 12px; font-size: 14px; letter-spacing: .02em; }

  /* ---- detail ---- */
  .detail { position: relative; z-index: 3; max-width: 900px; margin: 0 auto;
    padding: 20px 24px 80px; }
  .back { display: inline-flex; align-items: center; gap: 8px; background: rgba(255,255,255,.1);
    border: 1px solid rgba(255,255,255,.16); color: #fff; border-radius: 999px;
    padding: 9px 18px; font-size: 14px; cursor: pointer; margin-bottom: 26px; }
  .back:hover { background: rgba(255,255,255,.18); }
  .player { border-radius: 20px; overflow: hidden; border: 1px solid rgba(255,255,255,.14);
    box-shadow: 0 20px 60px rgba(0,0,0,.45); }
  .player-face { aspect-ratio: 16 / 9; background:
    linear-gradient(135deg, rgba(30,36,32,.9), rgba(10,14,12,.9));
    display: flex; align-items: center; justify-content: center; }
  .playbtn { width: 76px; height: 76px; border-radius: 50%; border: none; cursor: pointer;
    background: #fff; display: flex; align-items: center; justify-content: center;
    padding-left: 5px; transition: .2s; }
  .playbtn:hover { transform: scale(1.08); }
  .meta { margin-top: 26px; text-align: center; }
  .meta-time { font-size: 30px; font-weight: 700; letter-spacing: .04em; }
  .meta-date { margin-top: 6px; opacity: .7; font-size: 15px; }

  @media (max-width: 720px) {
    .clips { grid-template-columns: repeat(2, 1fr); }
    .panel { padding: 16px; }
    .title { font-size: 32px; }
  }
  @media (max-width: 460px) {
    .clips { grid-template-columns: 1fr; }
  }
`;
