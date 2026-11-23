import { useState, useEffect, useRef, createContext, useContext } from "react";
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
  ChevronDown, ChevronLeft, ChevronRight, Download, LoaderCircle,
  House, LayoutGrid, Heart, MessageCircle, Send, Trash2, LogOut, UserRound,
} from "lucide-react";
import {
  collection, query, orderBy, onSnapshot, limit, doc, setDoc, deleteDoc, addDoc, serverTimestamp,
} from "firebase/firestore";
import { onAuthStateChanged, signInWithPopup, signInWithRedirect, signOut } from "firebase/auth";
import { db, auth, googleProvider } from "./firebase";
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

const COURTS = ["1", "2", "3"];

// durationSeconds is stored as a string, e.g. "40" -> "0:40"
const formatDuration = (sec) => {
  const n = Math.round(Number(sec));
  return n > 0 ? `${Math.floor(n / 60)}:${String(n % 60).padStart(2, "0")}` : null;
};
// Firestore stores court as "court_1"; also accept 1 / "1" -> normalised to "1"
const courtOf = (clip) => String(clip.court ?? "").match(/\d+/)?.[0] ?? null;

const clubOf = (id) =>
  LOCATIONS.find((l) => l.id === id) || { id, label: String(id || "").toUpperCase(), color: "#9ca3af" };

// still image for a clip: a thumbnail field from Firestore if the uploader wrote one,
// else a Cloudinary-generated frame. null = no image -> <Thumb> paints a frame of the video.
function thumbOf(clip) {
  if (!clip) return null;
  const direct = clip.thumbnailUrl || clip.thumbnail || clip.thumbUrl || clip.posterUrl || clip.poster;
  if (direct) return direct;
  const m = String(clip.videoUrl || "").match(/^(https:\/\/res\.cloudinary\.com\/[^/]+\/video\/upload\/)(.+)\.\w+$/);
  return m ? `${m[1]}so_1,w_720,c_limit/${m[2]}.jpg` : null;
}

// lazy thumbnail: nothing loads until it scrolls near the viewport, so a long grid
// doesn't open dozens of video connections at once
function ThumbInner({ clip, className = "" }) {
  const ref = useRef(null);
  const [visible, setVisible] = useState(false);
  const [imgFailed, setImgFailed] = useState(false);
  const img = thumbOf(clip);

  useEffect(() => {
    const el = ref.current;
    if (!el || visible) return;
    if (!("IntersectionObserver" in window)) {
      setVisible(true);
      return;
    }
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setVisible(true);
          io.disconnect();
        }
      },
      { rootMargin: "300px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [visible]);

  return (
    <span ref={ref} className={`thumb-media ${className}`}>
      {visible && clip &&
        (img && !imgFailed ? (
          <img src={img} alt="" onError={() => setImgFailed(true)} />
        ) : (
          // #t=1 makes the browser paint a real frame instead of a black first frame
          <video src={`${clip.videoUrl}#t=1`} preload="metadata" muted playsInline tabIndex={-1} />
        ))}
    </span>
  );
}
const Thumb = (props) => <ThumbInner key={props.clip?.id} {...props} />;

// clips live in Firestore, collection `kross_highlight`:
// { date: "2026-07-20", time: "09:00", club: "onnut", court: "court_1", videoUrl, createdAt }
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
  return "dark"; // dark by default; light only when the user picked it
}

/* ---------- shared shell ---------- */
// theme lives in Shell; pages that draw their own chrome (home) reach it through context
const ThemeCtx = createContext({ theme: "dark", toggleTheme: () => {} });

function ThemeButton({ className = "icon-btn", label = false }) {
  const { theme, toggleTheme } = useContext(ThemeCtx);
  return (
    <button
      className={className}
      onClick={toggleTheme}
      aria-label={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
    >
      {theme === "dark" ? <Moon size={label ? 20 : 17} /> : <Sun size={label ? 20 : 17} />}
      {label && <span className="tab-label">Theme</span>}
    </button>
  );
}

// true while the media query matches (e.g. phone width)
function useMedia(query) {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

function Brand() {
  return (
    <Link to="/" className="brand">
      <svg width="20" height="20" viewBox="22 22 256 255" fill="currentColor" aria-hidden="true">
        <path d="M23 22 H104 L278 277 H197 Z" />
        <path d="M196 22 H277 L237 82 Z" />
        <path d="M22 277 H104 L63 217 Z" />
      </svg>
      <span>KROSS</span>
      <span className="brand-sub">HIGHLIGHT</span>
    </Link>
  );
}

// bare = the page draws its own header (home); otherwise a simple top nav (detail)
function Shell({ children, bare = false }) {
  const [theme, setTheme] = useState(getInitialTheme);

  const toggleTheme = () => {
    setTheme((t) => {
      const next = t === "dark" ? "light" : "dark";
      localStorage.setItem("kross-theme", next);
      return next;
    });
  };

  return (
    <ThemeCtx.Provider value={{ theme, toggleTheme }}>
      <div className="app" data-theme={theme}>
        <style>{CSS}</style>
        <div className="bg" style={{ backgroundImage: `url(${BG})` }} />
        <div className="scrim" />
        {!bare && (
          <header className="nav">
            <Brand />
            <ThemeButton className="nav-icon" />
          </header>
        )}
        {children}
      </div>
    </ThemeCtx.Provider>
  );
}

/* ---------- likes & comments ---------- */
// stored per clip in Firestore subcollections (see firestore.rules):
//   kross_highlight/{clipId}/likes/{uid}        { createdAt }
//   kross_highlight/{clipId}/comments/{auto}    { uid, name, photo, text, createdAt }
const COMMENT_MAX = 500;

function useAuthUser() {
  const [user, setUser] = useState(() => auth.currentUser);
  useEffect(() => onAuthStateChanged(auth, setUser), []);
  return user;
}

// popup first; browsers that block popups (some in-app browsers) fall back to a full-page redirect
async function signInWithGoogle() {
  try {
    const res = await signInWithPopup(auth, googleProvider);
    return res.user;
  } catch (err) {
    if (err.code === "auth/popup-blocked" || err.code === "auth/operation-not-supported-in-this-environment") {
      await signInWithRedirect(auth, googleProvider);
      return null;
    }
    if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") return null;
    throw err;
  }
}

function useClipSocial(clipId) {
  const [likeIds, setLikeIds] = useState([]);
  const [comments, setComments] = useState([]);
  const [unavailable, setUnavailable] = useState(false);

  useEffect(() => {
    if (!clipId) return;
    setLikeIds([]);
    setComments([]);
    setUnavailable(false);
    // permission-denied here usually means firestore.rules hasn't been deployed yet
    const onErr = (err) => {
      console.warn("[social]", err.code, err.message);
      setUnavailable(true);
    };
    const offLikes = onSnapshot(
      collection(db, CLIPS_COLLECTION, clipId, "likes"),
      (snap) => setLikeIds(snap.docs.map((d) => d.id)),
      onErr
    );
    const offComments = onSnapshot(
      query(collection(db, CLIPS_COLLECTION, clipId, "comments"), orderBy("createdAt", "desc"), limit(100)),
      (snap) =>
        setComments(
          snap.docs.map((d) => ({ id: d.id, ...d.data({ serverTimestamps: "estimate" }) }))
        ),
      onErr
    );
    return () => {
      offLikes();
      offComments();
    };
  }, [clipId]);

  return { likeIds, comments, unavailable };
}

// "just now" / "5m" / "3h" / "2d" / "21 Nov"
function timeAgo(ts) {
  const date = ts?.toDate ? ts.toDate() : null;
  if (!date) return "just now";
  const s = (Date.now() - date.getTime()) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m`;
  if (s < 86400) return `${Math.floor(s / 3600)}h`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d`;
  return date.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}

function Avatar({ name, photo, size = 34 }) {
  const [broken, setBroken] = useState(false);
  const initial = (name || "?").trim().charAt(0).toUpperCase();
  return photo && !broken ? (
    <img
      className="avatar"
      src={photo}
      alt=""
      width={size}
      height={size}
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
    />
  ) : (
    <span className="avatar avatar-initial" style={{ width: size, height: size }}>{initial}</span>
  );
}

function Comments({ clipId, comments, user, unavailable, onSignIn }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState(null);

  const send = async (e) => {
    e.preventDefault();
    const body = text.trim();
    if (!body || !user || sending) return;
    setSending(true);
    setErr(null);
    try {
      await addDoc(collection(db, CLIPS_COLLECTION, clipId, "comments"), {
        uid: user.uid,
        name: user.displayName || "Player",
        photo: user.photoURL || "",
        text: body.slice(0, COMMENT_MAX),
        createdAt: serverTimestamp(),
      });
      setText("");
    } catch (error) {
      console.warn("[comment]", error);
      setErr("Couldn't post your comment. Please try again.");
    } finally {
      setSending(false);
    }
  };

  const remove = async (id) => {
    try {
      await deleteDoc(doc(db, CLIPS_COLLECTION, clipId, "comments", id));
    } catch (error) {
      console.warn("[comment delete]", error);
    }
  };

  return (
    <section className="comments" id="comments">
      <h2 className="comments-title">
        Comments <span className="comments-count">{comments.length}</span>
      </h2>

      {unavailable ? (
        <p className="comments-note">Comments aren't available right now.</p>
      ) : user ? (
        <form className="comment-form" onSubmit={send}>
          <Avatar name={user.displayName} photo={user.photoURL} />
          <div className="comment-box">
            <textarea
              rows={1}
              maxLength={COMMENT_MAX}
              placeholder="Add a comment…"
              value={text}
              onChange={(e) => setText(e.target.value)}
              onKeyDown={(e) => {
                // Enter sends, Shift+Enter adds a line
                if (e.key === "Enter" && !e.shiftKey) send(e);
              }}
            />
            <button className="comment-send" type="submit" disabled={!text.trim() || sending} aria-label="Post comment">
              {sending ? <LoaderCircle size={16} className="spin" /> : <Send size={16} />}
            </button>
          </div>
        </form>
      ) : (
        <button className="signin-btn" onClick={onSignIn}>
          <GoogleMark /> Sign in with Google to comment
        </button>
      )}
      {err && <p className="comments-error">{err}</p>}
      {user && !unavailable && (
        <p className="comments-who">
          Signed in as {user.displayName || user.email} ·{" "}
          <button className="link-btn" onClick={() => signOut(auth)}>Sign out</button>
        </p>
      )}

      {comments.length === 0 && !unavailable ? (
        <div className="comments-empty">
          <MessageCircle size={22} />
          <span>No comments yet</span>
          <small>Be the first to say something about this rally.</small>
        </div>
      ) : (
        <ul className="comment-list">
          {comments.map((c) => (
            <li key={c.id} className="comment">
              <Avatar name={c.name} photo={c.photo} />
              <div className="comment-body">
                <div className="comment-head">
                  <span className="comment-name">{c.name}</span>
                  <span className="comment-time">{timeAgo(c.createdAt)}</span>
                  {user?.uid === c.uid && (
                    <button className="comment-del" onClick={() => remove(c.id)} aria-label="Delete comment">
                      <Trash2 size={13} />
                    </button>
                  )}
                </div>
                <p className="comment-text">{c.text}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function GoogleMark() {
  return (
    <svg width="16" height="16" viewBox="0 0 48 48" aria-hidden="true">
      <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.3 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z" />
      <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.8 1.2 7.9 3.1l5.7-5.7C34 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z" />
      <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.3 0-9.7-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z" />
      <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z" />
    </svg>
  );
}

/* ---------- detail view ---------- */
// phones: a plain download lands in Chrome/Files, not the gallery. The share sheet
// offers "Save Video" (iOS) / Google Photos (Android), so phones go through that.
// iPadOS reports itself as a Mac, hence the touch-point check.
const IS_MOBILE =
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent) ||
  (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);

// <a download> is ignored for cross-origin URLs (Cloudinary / R2), so fetch the file first.
// Throws if CORS blocks the fetch.
async function fetchClipFile(clip) {
  const ext = clip.videoUrl.split("?")[0].match(/\.(\w+)$/)?.[1] || "mp4";
  const name = `kross-${clip.club}-${clip.date}-${clip.time.replace(":", "")}.${ext}`;
  const res = await fetch(clip.videoUrl);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const blob = await res.blob();
  return new File([blob], name, { type: blob.type || "video/mp4" });
}

function saveFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement("a");
  a.href = url;
  a.download = file.name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

const canShareFile = (file) => IS_MOBILE && navigator.canShare?.({ files: [file] });

function Detail() {
  // route param is the whole segment: "2026-07-20&9:00AM" (9:00AM = hour bucket)
  const { slug } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const [date, time] = decodeURIComponent(slug || "").split("&");
  const loc = searchParams.get("loc");
  const court = searchParams.get("court"); // null = all courts
  const { clips, loading, error } = useClips();

  // every clip matching this date + club that falls inside this hour, e.g. 9:00AM -> 9:00-9:59
  const hourClips = clips.filter(
    (c) => c.date === date && (!loc || c.club === loc) && hourBucketLabel(c.time) === time
  );
  const matches = hourClips.filter((c) => !court || courtOf(c) === court);
  const courtCount = (id) => hourClips.filter((c) => courtOf(c) === id).length;
  const selectCourt = (id) => {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("court", id);
    else next.delete("court");
    setSearchParams(next, { replace: true });
  };
  const [activeId, setActiveId] = useState(null);
  const [downloading, setDownloading] = useState(false);
  // file fetched but the share sheet couldn't open (the tap "expired" during a slow
  // download, which Safari is strict about) -> a second tap opens it
  const [pending, setPending] = useState(null);
  const active = matches.find((c) => c.id === activeId) || matches[0];
  const pendingFile = pending && pending.id === active?.id ? pending.file : null;

  const share = async (file) => {
    try {
      await navigator.share({ files: [file] });
      setPending(null);
    } catch (err) {
      if (err.name === "AbortError") setPending(null); // user closed the sheet
      else if (err.name === "NotAllowedError") setPending({ id: active.id, file });
      else saveFile(file);
    }
  };

  const onDownload = async () => {
    if (pendingFile) return share(pendingFile);
    setDownloading(true);
    try {
      const file = await fetchClipFile(active);
      if (canShareFile(file)) await share(file);
      else saveFile(file);
    } catch (err) {
      console.warn("[download] fetch failed, opening in new tab", err);
      window.open(active.videoUrl, "_blank", "noopener");
    } finally {
      setDownloading(false);
    }
  };
  const user = useAuthUser();
  const { likeIds, comments, unavailable } = useClipSocial(active?.id);
  const liked = !!user && likeIds.includes(user.uid);
  const [authErr, setAuthErr] = useState(null);

  const signIn = async () => {
    setAuthErr(null);
    try {
      return await signInWithGoogle();
    } catch (err) {
      console.warn("[auth]", err);
      setAuthErr("Sign-in didn't work. Please try again.");
      return null;
    }
  };

  const toggleLike = async () => {
    if (!active) return;
    const u = user || (await signIn());
    if (!u) return;
    const ref = doc(db, CLIPS_COLLECTION, active.id, "likes", u.uid);
    try {
      if (likeIds.includes(u.uid)) await deleteDoc(ref);
      else await setDoc(ref, { createdAt: serverTimestamp() });
    } catch (err) {
      console.warn("[like]", err);
    }
  };

  const rangeEnd = time.replace(":00", ":59");
  const club = active ? clubOf(active.club) : loc ? clubOf(loc) : null;
  const [timeMain, ampm] = active ? splitLabel(formatTime12(active.time).replace(" ", "")) : splitLabel(time || "");
  const dur = active ? formatDuration(active.durationSeconds) : null;
  const meta = [
    date && formatDate(date),
    active && courtOf(active) && `Court ${courtOf(active)}`,
    dur,
  ].filter(Boolean);

  return (
    <Shell bare>
      <div className="watch">
        <header className="watch-bar">
          <Link to="/" className="watch-icon" aria-label="Back to highlights">
            <ArrowLeft size={18} />
          </Link>
          <Brand />
          <ThemeButton className="watch-icon" />
        </header>

        <div className="watch-grid">
          {/* ---- player + details ---- */}
            <div className="player">
              {active ? (
                <video
                  key={active.id}
                  className="player-video"
                  src={active.videoUrl}
                  poster={thumbOf(active) || undefined}
                  controls
                  playsInline
                />
              ) : (
                <div className="player-face">
                  <span>{error ? "Couldn't load video" : loading ? "Loading…" : "No video found"}</span>
                </div>
              )}
            </div>

            <div className="watch-info" key={active?.id || "none"}>
              <div className="wi-text">
                {club && (
                  <span className="watch-eyebrow">
                    <span className="dot" style={{ background: club.color }} />
                    {club.label}
                    {date && ` · ${dayLabel(date)}`}
                  </span>
                )}
                <h1 className="watch-title">
                  {timeMain}
                  {ampm && <small>{ampm}</small>}
                </h1>
                {meta.length > 0 && (
                  <div className="watch-meta">
                    {meta.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </div>
                )}
              </div>

              {active && (
                <div className="wi-actions">
                  {!unavailable && (
                    <>
                      <button
                        className={`act-btn${liked ? " liked" : ""}`}
                        onClick={toggleLike}
                        aria-pressed={liked}
                        aria-label={liked ? "Unlike" : "Like"}
                      >
                        <Heart size={18} fill={liked ? "currentColor" : "none"} />
                        <span key={likeIds.length} className="bump">{likeIds.length}</span>
                      </button>
                      <button
                        className="act-btn"
                        onClick={() => document.getElementById("comments")?.scrollIntoView({ behavior: "smooth", block: "start" })}
                        aria-label="Comments"
                      >
                        <MessageCircle size={18} />
                        <span key={comments.length} className="bump">{comments.length}</span>
                      </button>
                    </>
                  )}
                  <button className="watch-download" onClick={onDownload} disabled={downloading}>
                    {downloading ? <LoaderCircle size={17} className="spin" /> : <Download size={17} />}
                    {downloading ? "Downloading…" : pendingFile ? "Save to phone" : "Download"}
                  </button>
                </div>
              )}
              {active && IS_MOBILE && (
                <p className="watch-hint">Tap Download, then choose “Save Video” to keep it in your gallery.</p>
              )}
              {authErr && <p className="comments-error">{authErr}</p>}
            </div>

            {active && (
              <Comments
                clipId={active.id}
                comments={comments}
                user={user}
                unavailable={unavailable}
                onSignIn={signIn}
              />
            )}

          {/* ---- court tabs + clips from this hour ---- */}
          <aside className="watch-side">
            <div className="watch-tabs" role="group" aria-label="Court">
              <button className={`wtab${!court ? " active" : ""}`} onClick={() => selectCourt(null)}>
                All <span className="wtab-count">{hourClips.length}</span>
              </button>
              {COURTS.map((id) => {
                const n = courtCount(id);
                return (
                  <button
                    key={id}
                    className={`wtab${court === id ? " active" : ""}${n === 0 ? " is-empty" : ""}`}
                    onClick={() => selectCourt(id)}
                  >
                    Court {id} <span className="wtab-count">{n}</span>
                  </button>
                );
              })}
            </div>

            <div className="ep-head">
              <span className="ep-title">
                <strong>{plural(matches.length, "video")}</strong> this hour
              </span>
              <span className="ep-range">{time} – {rangeEnd}</span>
            </div>

            {matches.length === 0 ? (
              <div className="ep-empty">{loading ? "Loading…" : "No videos on this court in this hour."}</div>
            ) : (
              <div className="ep-list">
                {matches.map((c) => {
                  const isActive = c.id === active?.id;
                  const d = formatDuration(c.durationSeconds);
                  // club only matters when the list mixes clubs (no ?loc filter)
                  const sub = [!loc && c.club.toUpperCase(), courtOf(c) && `Court ${courtOf(c)}`]
                    .filter(Boolean).join(" · ");
                  return (
                    <button
                      key={c.id}
                      className={`ep${isActive ? " active" : ""}`}
                      onClick={() => {
                        setActiveId(c.id);
                        window.scrollTo({ top: 0, behavior: "smooth" });
                      }}
                    >
                      <span className="ep-thumb">
                        <Thumb clip={c} />
                        {isActive ? (
                          <span className="ep-now">NOW PLAYING</span>
                        ) : (
                          d && <span className="ep-dur">{d}</span>
                        )}
                        {!isActive && (
                          <span className="ep-play"><Play size={12} fill="currentColor" /></span>
                        )}
                      </span>
                      <span className="ep-info">
                        <span className="ep-time">{formatTime12(c.time)}</span>
                        {sub && <span className="ep-sub">{sub}</span>}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </aside>
        </div>
      </div>
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
// one icon in the sidebar rail; its name shows as a tooltip on hover
function RailBtn({ label, active = false, dim = false, className = "", onClick, children }) {
  return (
    <button
      className={`rail-btn ${className}${active ? " active" : ""}${dim ? " dim" : ""}`}
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
    >
      {children}
    </button>
  );
}

// home page paging: sessions shown per day before "View all", days shown per step
const PER_DAY = 4;
const DAYS_STEP = 3;

function Grid() {
  const navigate = useNavigate();
  const { clips: allClips, loading, error } = useClips();
  // empty date/time = no filter (show every date/hour); "all" club = every club.
  // defaults are wide open so all videos are findable without knowing exact date/time/club up front.
  const [date, setDate] = useState(""); // ISO, from <input type="date">
  const [time, setTime] = useState(""); // 24h "HH:MM", from <input type="time">
  const [loc, setLoc] = useState("all");
  const [query, setQuery] = useState("");
  // keep the page short: one row per day and a few days, "View all" / "Show earlier days" for the rest
  const [openDays, setOpenDays] = useState(() => new Set());
  const [dayLimit, setDayLimit] = useState(DAYS_STEP);
  const toggleDay = (iso) =>
    setOpenDays((prev) => {
      const next = new Set(prev);
      if (next.has(iso)) next.delete(iso);
      else next.add(iso);
      return next;
    });
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

  // banner / featured carousel always show the newest sessions, whatever the filters say
  const latest = groupByHour(loc === "all" ? allClips : allClips.filter((c) => c.club === loc)).slice(0, 6);
  // phones scroll each day sideways, so they show every session; larger screens page with "View all"
  const isPhone = useMedia("(max-width: 720px)");
  // buckets are already newest-first, so consecutive runs share a date
  const days = [];
  buckets.forEach((b) => {
    const last = days[days.length - 1];
    if (last && last.date === b.date) last.buckets.push(b);
    else days.push({ date: b.date, buckets: [b] });
  });
  // a club label on every card is noise when everything is from one club
  const mixedClubs = new Set(clips.map((c) => c.club)).size > 1;
  const clubCount = (id) => (id === "all" ? allClips.length : allClips.filter((c) => c.club === id).length);
  // only clubs that actually have clips; the club picker appears once there are 2+ of them
  const activeClubs = LOCATIONS.filter((l) => l.id !== "all" && clubCount(l.id) > 0);
  const clubOptions = activeClubs.length > 1 ? [LOCATIONS[0], ...activeClubs] : [];

  const user = useAuthUser();
  const [tab, setTab] = useState(0);
  const tabLock = useRef(0); // ignore scroll-driven updates while a tap's own scroll is running
  const pickTab = (i, action) => {
    tabLock.current = Date.now() + 1000;
    setTab(i);
    action?.();
  };
  useEffect(() => {
    const onScroll = () => {
      if (Date.now() < tabLock.current) return;
      const all = document.getElementById("all");
      setTab(all && all.getBoundingClientRect().top < window.innerHeight * 0.5 ? 2 : 0);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const scrollTo = (id) => document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });
  const toTop = () => window.scrollTo({ top: 0, behavior: "smooth" });
  const focusSearch = () => {
    const q = document.getElementById("q");
    q?.scrollIntoView({ behavior: "smooth", block: "center" });
    // focus after the smooth scroll has started, so mobile keyboards don't jump the page
    setTimeout(() => q?.focus({ preventScroll: true }), 300);
  };

  return (
    <Shell bare>
      <div className="studio">
        {/* ---- sidebar (desktop): floating glass icon rail ---- */}
        <aside className="sidebar">
          <div className="rail">
            <Link to="/" className="rail-logo" aria-label="KROSS Highlight home">
              <svg width="24" height="24" viewBox="22 22 256 255" fill="currentColor" aria-hidden="true">
                <path d="M23 22 H104 L278 277 H197 Z" />
                <path d="M196 22 H277 L237 82 Z" />
                <path d="M22 277 H104 L63 217 Z" />
              </svg>
            </Link>
            <span className="rail-sep" />

            <nav className="rail-group" aria-label="Sections">
              <RailBtn label="Home" active={tab === 0} onClick={() => pickTab(0, toTop)}>
                <House size={20} />
              </RailBtn>
              <RailBtn label="Search" active={tab === 1} onClick={() => pickTab(1, focusSearch)}>
                <Search size={20} />
              </RailBtn>
              <RailBtn label="All highlights" active={tab === 2} onClick={() => pickTab(2, () => scrollTo("all"))}>
                <LayoutGrid size={20} />
              </RailBtn>
            </nav>
            <span className="rail-sep" />

            {clubOptions.length > 0 && (
              <>
            <div className="rail-group" role="group" aria-label="Club">
              {clubOptions.map((l) => {
                const n = clubCount(l.id);
                const name = l.id === "all" ? "All clubs" : l.label.charAt(0) + l.label.slice(1).toLowerCase();
                return (
                  <RailBtn
                    key={l.id}
                    label={`${name} · ${n}`}
                    active={loc === l.id}
                    dim={n === 0}
                    className="rail-club"
                    onClick={() => setLoc(l.id)}
                  >
                    {l.id === "all" ? (
                      // "All": a tiny 2×2 cluster of every club's colour instead of one dot
                      <span className="rail-dots" aria-hidden="true">
                        {activeClubs.map((c) => (
                          <i key={c.id} style={{ background: c.color }} />
                        ))}
                      </span>
                    ) : (
                      <span className="rail-dot" style={{ "--c": l.color }} />
                    )}
                    <span className="rail-name">{l.id === "all" ? "All" : name}</span>
                  </RailBtn>
                );
              })}
            </div>
            <span className="rail-sep" />
              </>
            )}

            <div className="rail-group">
              <ThemeButton className="rail-btn" />
              {user && (
                <RailBtn label="Sign out" onClick={() => signOut(auth)}>
                  <LogOut size={19} />
                </RailBtn>
              )}
            </div>

            <div className="rail-foot">
              <span className="rail-sep" />
              <button
                className="rail-btn rail-avatar"
                aria-label={user ? `Signed in as ${user.displayName || user.email}` : "Sign in with Google"}
                onClick={user ? undefined : () => signInWithGoogle().catch(() => {})}
              >
                {user ? <Avatar name={user.displayName} photo={user.photoURL} size={40} /> : <UserRound size={20} />}
              </button>
            </div>
          </div>
        </aside>

        {/* ---- main column ---- */}
        <div className="main">
          <header className="mainbar">
            <div className="field search">
              <Search size={16} className="field-ic" />
              <input
                id="q"
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
          </header>

          {error ? (
            <div className="empty">Couldn't load highlights: {error.message}</div>
          ) : (
            <>
              <Banner buckets={latest.slice(0, 4)} loading={loading} onOpen={openClip} />
              <section className="feature-wrap">
                <MobileHero
                  buckets={latest}
                  loading={loading}
                  onOpen={openClip}
                  top={
                    <>
                      <div className="mtop-row">
                        <Brand />
                        <button className="mtop-icon" onClick={focusSearch} aria-label="Search">
                          <Search size={20} />
                        </button>
                      </div>
                      {clubOptions.length > 0 && (
                      <div className="mtabs" role="group" aria-label="Club">
                        {clubOptions.map((l) => (
                          <button
                            key={l.id}
                            className={`mtab${loc === l.id ? " active" : ""}`}
                            onClick={() => setLoc(l.id)}
                            aria-pressed={loc === l.id}
                          >
                            {l.id === "all" ? "All" : l.label.charAt(0) + l.label.slice(1).toLowerCase()}
                          </button>
                        ))}
                      </div>
                      )}
                    </>
                  }
                />
              </section>
            </>
          )}

          <div className="toolbar" id="filters">
            <div className="toolbar-pickers">
              <DatePicker value={date} onChange={setDate} marked={clipDates} />
              <HourPicker value={time} onChange={setTime} marked={clipHours} />
              {hasFilters && (
                <button className="icon-btn reset-btn" onClick={resetFilters} aria-label="Reset filters" title="Reset filters">
                  <RotateCcw size={15} />
                </button>
              )}
            </div>
            {/* phones / tablets: the sidebar's club list is hidden, so clubs live here */}
            {clubOptions.length > 0 && (
            <div className="chips" role="group" aria-label="Club">
              {clubOptions.map((l) => (
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
            )}
          </div>

          {!error && !loading && buckets.length === 0 ? (
            <div className="empty">
              No highlights found for these filters.
              {hasFilters && (
                <button className="reset" onClick={resetFilters}>
                  <RotateCcw size={12} /> Reset filters
                </button>
              )}
            </div>
          ) : (
            <section id="all" className="shelves" key={`${date}|${time}|${loc}|${query}`}>
              {loading ? (
                <div className="shelf">
                  <div className="shelf-grid">
                    {[0, 1, 2, 3].map((i) => (
                      <div key={i} className="card skeleton">
                        <span className="card-thumb" />
                      </div>
                    ))}
                  </div>
                </div>
              ) : (
                <>
                {days.slice(0, dayLimit).map((d) => {
                  const open = openDays.has(d.date);
                  const more = !isPhone && d.buckets.length > PER_DAY;
                  const shown = open || !more ? d.buckets : d.buckets.slice(0, PER_DAY);
                  return (
                  <div key={d.date} className="shelf">
                    <div className="shelf-head">
                      <h2 className="sec-title">
                        <strong>{dayLabel(d.date)}</strong> games
                      </h2>
                      {more ? (
                        <button className="view-all" onClick={() => toggleDay(d.date)} aria-expanded={open}>
                          {open ? "Show less" : `View all ${d.buckets.length}`}
                          <ChevronRight size={14} className={open ? "chev-up" : ""} />
                        </button>
                      ) : (
                        <span className="shelf-count">{plural(d.buckets.length, "session")}</span>
                      )}
                    </div>
                    <div className="shelf-grid">
                      {shown.map((b) => (
                        <SessionCard
                          key={`${b.date}__${b.label}__${b.club}`}
                          bucket={b}
                          showClub={mixedClubs}
                          onOpen={openClip}
                        />
                      ))}
                    </div>
                  </div>
                  );
                })}
                {days.length > dayLimit && (
                  <button className="more-days" onClick={() => setDayLimit((n) => n + DAYS_STEP)}>
                    Show earlier days
                    <span className="more-days-count">{plural(days.length - dayLimit, "more day")}</span>
                  </button>
                )}
                </>
              )}
            </section>
          )}
        </div>
      </div>

      {/* ---- bottom tab bar (phones) ---- */}
      <nav className="tabbar" aria-label="Sections">
        <div className="tabs-track" style={{ "--i": tab }}>
          <span className="tab-ind" aria-hidden="true" />
          <button className={`tab${tab === 0 ? " active" : ""}`} onClick={() => pickTab(0, toTop)} aria-label="Home">
            <House size={22} />
          </button>
          <button className={`tab${tab === 1 ? " active" : ""}`} onClick={() => pickTab(1, focusSearch)} aria-label="Search">
            <Search size={22} />
          </button>
          <button
            className={`tab${tab === 2 ? " active" : ""}`}
            onClick={() => pickTab(2, () => scrollTo("all"))}
            aria-label="All highlights"
          >
            <LayoutGrid size={22} />
          </button>
          {/* theme just toggles; it never takes the bubble */}
          <ThemeButton className="tab" />
        </div>
      </nav>
    </Shell>
  );
}

// "Today" / "Yesterday" / "Sat, 21 Nov 2026"
function dayLabel(iso) {
  const d = new Date();
  const local = (x) => toISO(x.getFullYear(), x.getMonth(), x.getDate());
  if (iso === local(d)) return "Today";
  d.setDate(d.getDate() - 1);
  if (iso === local(d)) return "Yesterday";
  return formatDate(iso);
}

const courtsLabel = (items) => {
  const courts = [...new Set(items.map(courtOf).filter(Boolean))].sort();
  return courts.length ? `Court ${courts.join(", ")}` : null;
};

// "9:00PM" -> ["9:00", "PM"]
const splitLabel = (label) => {
  const m = String(label).match(/^(.*?)(AM|PM)$/);
  return m ? [m[1], m[2]] : [label, ""];
};

// "9:00PM" -> "9:00–9:59 PM"
const hourRange = (label) => {
  const [t, ampm] = splitLabel(label);
  return ampm ? `${t}–${t.replace(":00", ":59")} ${ampm}` : null;
};

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

/* ---------- session card ---------- */
// desktop: title sits over the thumbnail; phones: thumbnail left, text right (ticket row)
function SessionCard({ bucket, onOpen, showClub }) {
  const club = clubOf(bucket.club);
  const n = bucket.items.length;
  const courts = courtsLabel(bucket.items);
  return (
    <button className="card" onClick={() => onOpen(bucket)}>
      <span className="card-thumb">
        <Thumb clip={bucket.items[0]} />
        <span className="card-play"><Play size={14} fill="currentColor" /></span>
      </span>
      <span className="card-info">
        <span className="card-title">{bucket.label}</span>
        <span className="card-meta">
          {showClub && <span className="dot" style={{ background: club.color }} />}
          {[showClub && club.label, courts].filter(Boolean).join(" · ") || club.label}
        </span>
        {/* phones only: the ticket row has room for one more line */}
        <span className="card-extra">
          <span className="dot" style={{ background: club.color }} />
          {[club.label, hourRange(bucket.label)].filter(Boolean).join("  ·  ")}
        </span>
      </span>
      {n > 1 && <span className="card-badge">{plural(n, "clip")}</span>}
    </button>
  );
}

/* ---------- desktop banner ---------- */
// newest session as a wide cover; the small thumbnails bottom-right switch between the latest few
function Banner({ buckets, loading, onOpen }) {
  const [idx, setIdx] = useState(0);
  const n = buckets.length;
  const cur = n ? buckets[Math.min(idx, n - 1)] : null;

  if (!cur) {
    return (
      <section className={`banner banner-empty${loading ? " skeleton" : ""}`}>
        {!loading && <span>No highlights yet. Check back after your next game.</span>}
      </section>
    );
  }

  const club = clubOf(cur.club);
  const [timeMain, ampm] = splitLabel(cur.label);
  const courts = courtsLabel(cur.items);

  return (
    <section className="banner">
      <div className="banner-bg" key={cur.items[0].id}>
        <Thumb clip={cur.items[0]} />
      </div>
      <div className="banner-shade" />
      <div className="banner-copy" key={cur.items[0].id}>
        <span className="banner-eyebrow">
          <span className="dot" style={{ background: club.color }} />
          {club.label} · {cur === buckets[0] ? "Latest game" : dayLabel(cur.date)}
        </span>
        <h1 className="banner-title">
          {timeMain}
          {ampm && <span className="banner-ampm">{ampm}</span>}
        </h1>
        <span className="banner-meta">
          {[dayLabel(cur.date), plural(cur.items.length, "clip"), courts].filter(Boolean).join("  ·  ")}
        </span>
        <button className="btn-watch" onClick={() => onOpen(cur)}>
          <Play size={15} fill="currentColor" /> Watch
        </button>
      </div>
      {n > 1 && (
        <div className="banner-picks">
          {buckets.map((b, k) => (
            <button
              key={`${b.date}__${b.label}__${b.club}`}
              className={`pick${b === cur ? " active" : ""}`}
              onClick={() => setIdx(k)}
              aria-label={`Show ${b.label}, ${dayLabel(b.date)}`}
            >
              <Thumb clip={b.items[0]} />
            </button>
          ))}
        </div>
      )}
    </section>
  );
}

/* ---------- phone hero ---------- */
// full-bleed swipeable cover like a streaming app: one slide per recent session, dots below.
// `top` (brand, search, club tabs) floats over the picture.
function MobileHero({ buckets, loading, onOpen, top }) {
  const railRef = useRef(null);
  const [center, setCenter] = useState(0);
  const n = buckets.length;

  useEffect(() => {
    const rail = railRef.current;
    if (!rail || !("IntersectionObserver" in window)) return;
    const io = new IntersectionObserver(
      (entries) => {
        entries.forEach((e) => {
          if (e.isIntersecting) setCenter(Number(e.target.dataset.i));
        });
      },
      { root: rail, threshold: 0.6 }
    );
    Array.from(rail.children).forEach((c) => io.observe(c));
    return () => io.disconnect();
  }, [n, loading]);

  // a new club tab means a new set of slides: start from the first one
  const firstKey = n ? `${buckets[0].date}${buckets[0].label}${buckets[0].club}` : "";
  useEffect(() => {
    setCenter(0);
    railRef.current?.scrollTo({ left: 0 });
  }, [firstKey]);

  const goTo = (k) => {
    const rail = railRef.current;
    if (rail) rail.scrollTo({ left: rail.clientWidth * k, behavior: "smooth" });
  };

  return (
    <section className="mhero">
      <div className="mhero-top">{top}</div>
      {loading || n === 0 ? (
        <div className={`mslide mslide-empty${loading ? " skeleton" : ""}`}>
          {!loading && <span>No highlights for this club yet</span>}
        </div>
      ) : (
        <div className="mhero-rail" ref={railRef}>
          {buckets.map((b, k) => {
            const club = clubOf(b.club);
            const [timeMain, ampm] = splitLabel(b.label);
            const meta = [club.label, dayLabel(b.date), courtsLabel(b.items), plural(b.items.length, "clip")]
              .filter(Boolean);
            return (
              <div key={`${b.date}__${b.label}__${b.club}`} className="mslide" data-i={k} onClick={() => onOpen(b)}>
                <Thumb clip={b.items[0]} />
                <span className="mslide-shade" />
                <div className="mslide-copy">
                  <span className="mslide-title">
                    {timeMain}
                    {ampm && <small>{ampm}</small>}
                  </span>
                  <span className="mslide-meta">
                    {meta.map((t) => (
                      <span key={t}>{t}</span>
                    ))}
                  </span>
                  <button
                    className="mslide-watch"
                    onClick={(e) => {
                      e.stopPropagation();
                      onOpen(b);
                    }}
                  >
                    <Play size={15} fill="currentColor" /> Watch
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}
      {n > 1 && !loading && (
        <div className="mhero-dots">
          {buckets.map((b, k) => (
            <button
              key={`${b.date}__${b.label}__${b.club}`}
              className={k === center ? "on" : ""}
              onClick={() => goTo(k)}
              aria-label={`Slide ${k + 1}`}
            />
          ))}
        </div>
      )}
    </section>
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
    --scrim-1: rgba(3,16,10,.5);
    --scrim-2: rgba(3,16,10,.8);
    --fg: #fff;
    --fg-inv: #14181a;
    --accent: #5fe39a;
    --accent-ring: rgba(95,227,154,.25);
    --accent-soft: rgba(95,227,154,.16);
    --on-accent: #03240f;
    --glass: rgba(8,30,20,.5);
    --lg-fill: rgba(150,255,195,.07);
    --tabbar-bg: linear-gradient(180deg, rgba(4,16,10,.94) 0%, rgba(7,26,17,.88) 100%);
    --rail-bg: linear-gradient(180deg, rgba(2,10,6,.92) 0%, rgba(5,20,13,.78) 38%, rgba(95,227,154,.12) 100%);
    --lg-lens: rgba(255,255,255,.12);
    --lg-edge: rgba(255,255,255,.16);
    --lg-hi: rgba(255,255,255,.38);
    --glass-edge: rgba(255,255,255,.16);
    --glass-hi: rgba(255,255,255,.12);
    --tile: rgba(190,255,215,.06);
    --tile-hover: rgba(190,255,215,.11);
    --pop-hover: rgba(255,255,255,.08);
    --pop-active: rgba(255,255,255,.16);
    --placeholder: rgba(255,255,255,.55);
    --surface: rgba(255,255,255,.08);
    --surface-strong: rgba(255,255,255,.1);
    --surface-hover: rgba(255,255,255,.18);
    --border: rgba(255,255,255,.16);
    --border-soft: rgba(255,255,255,.12);
    --menu-bg: rgba(9,30,20,.96);
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
    --accent: #15803d;
    --accent-ring: rgba(21,128,61,.2);
    --accent-soft: rgba(21,128,61,.12);
    --on-accent: #fff;
    --glass: rgba(255,255,255,.52);
    --lg-fill: rgba(255,255,255,.45);
    --tabbar-bg: linear-gradient(180deg, rgba(255,255,255,.96) 0%, rgba(240,248,243,.92) 100%);
    --rail-bg: linear-gradient(180deg, rgba(255,255,255,.95) 0%, rgba(255,255,255,.7) 40%, rgba(21,128,61,.14) 100%);
    --lg-lens: rgba(255,255,255,.75);
    --lg-edge: rgba(255,255,255,.8);
    --lg-hi: rgba(255,255,255,.95);
    --glass-edge: rgba(255,255,255,.75);
    --glass-hi: rgba(255,255,255,.9);
    --tile: rgba(255,255,255,.5);
    --tile-hover: rgba(255,255,255,.8);
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

  /* overflow-x: clip (not hidden) so position: sticky on the sidebar still works */
  .app { position: relative; min-height: 100vh; overflow-x: clip;
    font-family: system-ui, -apple-system, sans-serif; color: var(--fg); transition: color .2s; }
  .bg { position: fixed; inset: 0; background-size: cover; background-position: center; z-index: 0;
    filter: saturate(1.1); }
  .scrim { position: fixed; inset: 0; z-index: 1;
    background: linear-gradient(180deg, var(--scrim-1), var(--scrim-2)); transition: background .2s; }

  .app { background: #06110c; }
  .app[data-theme="light"] { background: #eef1f0; }
  .bg { filter: saturate(1.1) blur(2px); transform: scale(1.02); }

  /* ---- simple nav (detail page) ---- */
  .nav { position: relative; z-index: 5; display: flex; align-items: center; justify-content: space-between;
    gap: 16px; padding: 20px clamp(16px, 4vw, 40px); }
  .brand { display: flex; align-items: center; gap: 10px; font-size: 18px; font-weight: 800;
    letter-spacing: .14em; white-space: nowrap; }
  .brand-sub { font-size: 10px; font-weight: 600; letter-spacing: .26em; opacity: .55; margin-top: 2px; }
  .nav-icon { width: 38px; height: 38px; border-radius: 50%; border: 1px solid var(--border-soft);
    background: var(--tile); color: var(--fg); display: flex; align-items: center; justify-content: center;
    cursor: pointer; transition: background .2s; }
  .nav-icon:hover { background: var(--tile-hover); }

  /* ---- studio: one floating glass window (desktop) ---- */
  /* full screen: the glass fills the whole viewport, no floating window frame */
  .studio { position: relative; z-index: 3; display: grid; grid-template-columns: 90px minmax(0, 1fr);
    min-height: 100vh; margin: 0; overflow: clip;
    background: var(--glass);
    backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); }

  /* sidebar = floating glass icon rail, dark at the top fading into green glass */
  /* z-index: the rail's hover tooltips must float above the banner and cards */
  .sidebar { position: sticky; top: 0; z-index: 10; align-self: start; height: 100vh; max-height: 980px; padding: 14px 0 14px 14px; }
  .rail { position: relative; height: 100%; display: flex; flex-direction: column; align-items: center; gap: 4px;
    padding: 18px 10px 14px; border-radius: 30px; border: 1px solid var(--glass-edge);
    background: var(--rail-bg);
    backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5);
    box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(255,255,255,.05), 0 20px 50px rgba(0,0,0,.35); }
  .rail-logo { width: 48px; height: 48px; border-radius: 16px; display: flex; align-items: center;
    justify-content: center; background: var(--fg); color: var(--fg-inv); margin-bottom: 4px;
    box-shadow: 0 8px 20px rgba(0,0,0,.35); transition: transform .3s cubic-bezier(.34,1.56,.64,1); }
  .rail-logo:hover { transform: rotate(-8deg) scale(1.06); }
  .rail-sep { flex: none; width: 36px; height: 1px; margin: 10px 0;
    background: linear-gradient(90deg, transparent, rgba(255,255,255,.35), transparent); }
  .rail-group { display: flex; flex-direction: column; align-items: center; gap: 4px; }
  .rail-foot { margin-top: auto; display: flex; flex-direction: column; align-items: center; }
  .rail-btn { position: relative; width: 48px; height: 46px; border: 0; border-radius: 14px; background: none;
    color: var(--fg); opacity: .72; display: flex; align-items: center; justify-content: center; padding: 0;
    cursor: pointer; transition: background .2s, opacity .2s, transform .2s; }
  .rail-btn:hover { opacity: 1; background: var(--tile); }
  .rail-btn:active { transform: scale(.92); }
  .rail-btn.dim:not(.active) { opacity: .32; }
  .rail-btn.active { opacity: 1; background: rgba(255,255,255,.08); }
  /* active marker: glowing bar on the rail's left edge */
  .rail-btn.active::before { content: ""; position: absolute; left: -11px; top: 50%; width: 4px; height: 24px;
    margin-top: -12px; border-radius: 0 4px 4px 0; background: var(--accent);
    box-shadow: 0 0 12px var(--accent); animation: marker .35s cubic-bezier(.34,1.56,.64,1) both; }
  @keyframes marker { from { transform: scaleY(0); } }
  /* name tooltip */
  .rail-btn::after { content: attr(aria-label); position: absolute; left: calc(100% + 16px); top: 50%; z-index: 20;
    padding: 7px 11px; border-radius: 10px; white-space: nowrap; pointer-events: none;
    font-size: 12px; font-weight: 600; color: var(--fg); background: var(--menu-bg); border: 1px solid var(--border-soft);
    box-shadow: 0 10px 24px rgba(0,0,0,.35); opacity: 0; transform: translate(-6px, -50%);
    transition: opacity .18s, transform .18s; }
  .rail-btn:hover::after, .rail-btn:focus-visible::after { opacity: 1; transform: translate(0, -50%); }
  /* club items: colour dot + name, stacked to fit the narrow rail */
  .rail-btn.rail-club { width: 66px; height: 48px; flex-direction: column; gap: 5px; }
  .rail-dot { width: 9px; height: 9px; border-radius: 50%; background: var(--c);
    box-shadow: 0 0 0 2px rgba(255,255,255,.14); transition: transform .25s cubic-bezier(.34,1.56,.64,1), box-shadow .25s; }
  .rail-dots { display: grid; grid-template-columns: repeat(2, 5px); gap: 2px; transition: transform .25s cubic-bezier(.34,1.56,.64,1), gap .25s; }
  .rail-dots > i { width: 5px; height: 5px; border-radius: 50%; box-shadow: 0 0 0 1px rgba(255,255,255,.18); }
  .rail-btn.active .rail-dots { transform: scale(1.15); gap: 3px; }
  .rail-name { font-size: 10.5px; font-weight: 600; letter-spacing: .02em; line-height: 1; white-space: nowrap; }
  .rail-btn.active .rail-dot { transform: scale(1.25); box-shadow: 0 0 0 2px var(--accent), 0 0 10px var(--c); }
  .rail-btn.active .rail-name { font-weight: 800; }
  /* the name is already visible, so club tooltips only add the count */
  .rail-btn.rail-club::after { content: attr(aria-label); }
  .rail-avatar { width: 48px; height: 48px; border-radius: 50%; opacity: 1; margin-top: 2px; }
  .rail-avatar .avatar { box-shadow: 0 0 0 2px var(--glass-edge); }

  .main { min-width: 0; padding: 26px clamp(24px, 3vw, 48px) 40px 18px; }
  .mainbar { display: grid; grid-template-columns: minmax(0, 420px); justify-content: start;
    align-items: center; gap: 18px; margin-bottom: 24px; }
  .mainbar .field input { height: 44px; border-radius: 999px; background: var(--tile);
    border-color: var(--border-soft); padding-left: 44px; }
  .mainbar .field-ic { left: 16px; }

  .sec-title { font-size: 19px; font-weight: 400; letter-spacing: -.01em; }
  .sec-title strong { font-weight: 800; }

  /* ---- banner (desktop / tablet) ---- */
  .banner { position: relative; isolation: isolate; display: flex; align-items: flex-end;
    min-height: 340px; max-height: 560px; aspect-ratio: 16 / 6.2; border-radius: 24px; overflow: hidden; color: #fff;
    background: #0a1a13; margin-bottom: 26px; box-shadow: 0 20px 50px rgba(0,0,0,.3); }
  .banner-empty { align-items: center; justify-content: center; font-size: 15px; opacity: .8; }
  .banner.skeleton { background: var(--tile); animation: pulse 1.4s ease-in-out infinite; }
  .banner-bg { position: absolute; inset: 0; z-index: -2; animation: fade-in .6s ease; }
  .banner-bg > .thumb-media { position: absolute; inset: 0; }
  @keyframes fade-in { from { opacity: 0; } }
  .banner-shade { position: absolute; inset: 0; z-index: -1; pointer-events: none;
    background: linear-gradient(90deg, rgba(3,14,9,.85) 0%, rgba(3,14,9,.45) 42%, rgba(3,14,9,0) 72%),
      linear-gradient(0deg, rgba(3,14,9,.6) 0%, rgba(3,14,9,0) 50%); }
  .banner-copy { display: flex; flex-direction: column; align-items: flex-start; gap: 8px;
    padding: 34px 36px; max-width: 520px; }
  .banner-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; opacity: .9; }
  .banner-title { display: flex; align-items: flex-start; gap: .06em; font-size: clamp(56px, 7vw, 92px);
    font-weight: 800; line-height: .95; letter-spacing: -.03em; text-shadow: 0 6px 30px rgba(0,0,0,.35); }
  .banner-ampm { font-size: .36em; margin-top: .14em; letter-spacing: 0; opacity: .85; }
  .banner-meta { font-size: 14px; opacity: .78; }
  .btn-watch { display: inline-flex; align-items: center; gap: 8px; height: 42px; margin-top: 12px;
    padding: 0 24px; border: 0; border-radius: 999px; background: var(--accent); color: var(--on-accent);
    font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
    box-shadow: 0 10px 28px rgba(95,227,154,.3); transition: transform .2s; }
  .btn-watch:hover { transform: translateY(-1px) scale(1.03); }
  .banner-picks { position: absolute; right: 22px; bottom: 22px; display: flex; gap: 10px; }
  .pick { position: relative; width: 96px; aspect-ratio: 16 / 10; border-radius: 12px; overflow: hidden;
    border: 2px solid rgba(255,255,255,.25); padding: 0; background: #0a1a13; cursor: pointer;
    opacity: .7; transition: opacity .2s, border-color .2s, transform .2s; }
  .pick > .thumb-media { position: absolute; inset: 0; }
  .pick:hover { opacity: 1; transform: translateY(-2px); }
  .pick.active { opacity: 1; border-color: var(--accent); }

  /* ---- featured carousel (phones only) ---- */
  .feature-wrap { display: none; }

  /* ---- shelves of session cards ---- */
  .shelves { scroll-margin-top: 20px; }
  .shelf + .shelf { margin-top: 30px; }
  .shelf-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px;
    margin: 0 2px 14px; }
  .shelf-count { font-size: 12px; opacity: .5; }
  /* fixed 4 columns so PER_DAY (4) cards fill exactly one row, no orphan card */
  .shelf-grid { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 16px; }
  .view-all { display: inline-flex; align-items: center; gap: 2px; border: 0; cursor: pointer;
    font-family: inherit; font-size: 12px; font-weight: 700; padding: 7px 10px 7px 14px; border-radius: 999px;
    background: var(--accent-soft); color: var(--accent); white-space: nowrap; transition: background .2s; }
  .view-all:hover { background: var(--accent-ring); }
  .view-all svg { transition: transform .2s; }
  .view-all .chev-up { transform: rotate(-90deg); }
  .more-days { display: flex; align-items: center; justify-content: center; gap: 10px; width: 100%;
    margin-top: 30px; height: 48px; border-radius: 16px; border: 1px dashed var(--border);
    background: none; color: var(--fg); font-family: inherit; font-size: 14px; font-weight: 700;
    cursor: pointer; transition: background .2s; }
  .more-days:hover { background: var(--tile); }
  .more-days-count { font-size: 12px; font-weight: 500; opacity: .5; }

  .card { position: relative; display: block; min-width: 0; padding: 0; border: 0; border-radius: 16px;
    overflow: hidden; background: #0a1a13; color: #fff; text-align: left; font-family: inherit;
    cursor: pointer; box-shadow: 0 0 0 1px var(--border-soft); transition: transform .25s, box-shadow .25s;
    -webkit-tap-highlight-color: transparent; }
  .card:hover { transform: translateY(-3px); box-shadow: 0 0 0 1px var(--border), 0 18px 36px var(--shadow-strong); }
  .card:focus { outline: none; }
  .card:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .card-thumb { position: relative; display: block; aspect-ratio: 16 / 10; }
  .card-thumb > .thumb-media { position: absolute; inset: 0; }
  .card-thumb::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(0deg, rgba(0,0,0,.8) 0%, rgba(0,0,0,.15) 45%, rgba(0,0,0,0) 70%); }
  .card-play { position: absolute; top: 50%; left: 50%; z-index: 1; width: 40px; height: 40px;
    margin: -20px 0 0 -20px; border-radius: 50%; display: flex; align-items: center; justify-content: center;
    background: rgba(255,255,255,.2); border: 1px solid rgba(255,255,255,.4); backdrop-filter: blur(6px);
    opacity: 0; transform: scale(.9); transition: opacity .2s, transform .2s; }
  .card:hover .card-play { opacity: 1; transform: scale(1); }
  .card-info { position: absolute; left: 14px; right: 14px; bottom: 12px; z-index: 1; display: flex;
    flex-direction: column; gap: 2px; min-width: 0; }
  .card-title { font-size: 16px; font-weight: 800; letter-spacing: -.01em; }
  .card-meta { display: inline-flex; align-items: center; gap: 6px; font-size: 11px; opacity: .75;
    white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .card-meta .dot { width: 6px; height: 6px; box-shadow: none; }
  .card-extra { display: none; }
  .card-badge { position: absolute; top: 10px; right: 10px; z-index: 1; padding: 3px 9px; border-radius: 999px;
    background: var(--accent); color: var(--on-accent); font-size: 11px; font-weight: 800; }
  .card.skeleton { box-shadow: none; background: var(--tile); animation: pulse 1.4s ease-in-out infinite; }

  /* ---- bottom tab bar (phones only) ---- */
  .tabbar { display: none; }
  .tab-label { display: none; }

  .icon-btn { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-soft);
    background: var(--tile); color: var(--fg); display: flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; transition: background .2s; }
  .icon-btn:hover { background: var(--tile-hover); }
  .toolbar .chips { display: none; }
  /* shared thumbnail fill (image or paused video frame) */
  .thumb-media { display: block; width: 100%; height: 100%;
    background: linear-gradient(135deg, #12281e, #0a1a13); }
  .thumb-media > img, .thumb-media > video { display: block; width: 100%; height: 100%;
    object-fit: cover; pointer-events: none; }

  /* filters: one light row, no boxed panel */
  .toolbar { position: relative; z-index: 2; display: flex; align-items: center; gap: 12px;
    flex-wrap: wrap; margin: 6px 0 30px; scroll-margin-top: 24px; }
  .toolbar-pickers { display: flex; align-items: center; gap: 8px; }
  .toolbar-pickers .picker { width: 190px; }
  .toolbar-pickers .picker:nth-child(2) { width: 200px; }
  .reset-btn { flex: none; }
  .toolbar .chips { margin-left: auto; }
  .all { scroll-margin-top: 24px; }
  .day + .day { margin-top: 30px; }
  .day-head { font-size: 13px; font-weight: 600; letter-spacing: .02em; opacity: .6; margin: 0 2px 12px; }

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
  .picker-btn { width: 100%; height: 40px; display: flex; align-items: center; gap: 9px;
    padding: 0 14px; background: var(--tile); border: 1px solid var(--border-soft);
    border-radius: 999px; color: var(--fg); font-family: inherit; font-size: 13px; cursor: pointer;
    text-align: left; transition: border-color .2s, background .2s, box-shadow .2s; }
  .picker-btn:hover { background: var(--tile-hover); }
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

  /* club filter: segmented pill, dot only on the selected club */
  .chips { display: flex; gap: 2px; padding: 3px; border-radius: 999px; background: var(--tile);
    border: 1px solid var(--border-soft); }
  .chip { display: inline-flex; align-items: center; gap: 7px; height: 32px; padding: 0 14px;
    border-radius: 999px; border: 0; background: none; white-space: nowrap;
    color: var(--fg); opacity: .7; font-size: 12px; font-weight: 600; letter-spacing: .05em; cursor: pointer;
    font-family: inherit; transition: background .2s, color .2s, opacity .2s; }
  .chip:hover { opacity: 1; }
  .chip .dot { display: none; }
  .chip.active { opacity: 1; background: var(--fg); color: var(--fg-inv); }
  .chip.active .dot { display: block; }
  .dot { width: 8px; height: 8px; border-radius: 50%; flex: none;
    box-shadow: 0 0 0 2px rgba(255,255,255,.3); }

  .reset { display: inline-flex; align-items: center; gap: 6px; background: none;
    border: 1px solid var(--border); color: var(--fg); border-radius: 999px; padding: 6px 12px;
    font-size: 12px; font-family: inherit; cursor: pointer; }
  .reset:hover { background: var(--surface-hover); }

  .empty { display: flex; flex-direction: column; align-items: center; gap: 14px;
    text-align: center; padding: 60px 20px; font-size: 15px; border-radius: 20px;
    background: var(--tile); border: 1px dashed var(--border); margin-bottom: 26px; }

  /* cards: just the picture and one line of text, no box around them */
  .clips { display: grid; grid-template-columns: repeat(auto-fill, minmax(210px, 1fr)); gap: 22px 16px; }
  .clip { display: flex; flex-direction: column; gap: 10px; min-width: 0; background: none; border: 0;
    padding: 0; cursor: pointer; color: var(--fg); text-align: left; font-family: inherit;
    -webkit-tap-highlight-color: transparent; }
  .clip:focus { outline: none; }
  .clip:focus-visible .thumb { outline: 2px solid var(--accent); outline-offset: 3px; }
  .thumb { aspect-ratio: 16 / 10; border-radius: 16px; position: relative; overflow: hidden;
    display: flex; align-items: center; justify-content: center; background: #0a1a13;
    box-shadow: 0 0 0 1px var(--border-soft); transition: transform .25s, box-shadow .25s; }
  .clip:hover .thumb { transform: translateY(-3px); box-shadow: 0 0 0 1px var(--border), 0 16px 36px var(--shadow-strong); }
  .thumb > .thumb-media { position: absolute; inset: 0; }
  .thumb > .thumb-play, .thumb > .clip-count { z-index: 1; }
  .thumb-play { position: relative; width: 42px; height: 42px; border-radius: 50%; color: #fff;
    background: rgba(0,0,0,.4); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(6px);
    display: flex; align-items: center; justify-content: center; opacity: 0; transform: scale(.9);
    transition: opacity .2s, transform .2s; }
  .clip:hover .thumb-play { opacity: 1; transform: scale(1); }
  .clip-count { position: absolute; top: 8px; right: 8px; background: rgba(0,0,0,.55); color: #fff;
    font-size: 11px; font-weight: 600; padding: 3px 8px; border-radius: 999px; backdrop-filter: blur(4px); }
  .clip-body { display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
    padding: 0 2px; min-width: 0; }
  .clip-time { font-size: 15px; font-weight: 700; white-space: nowrap; }
  .clip-meta { display: inline-flex; align-items: center; gap: 6px; min-width: 0; font-size: 12px;
    opacity: .55; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .clip-meta .dot { width: 6px; height: 6px; box-shadow: none; }

  .skeleton { cursor: default; pointer-events: none; }
  @keyframes pulse { 50% { opacity: .45; } }

  /* ---- watch page (detail) ---- */
  .watch { position: relative; z-index: 3; min-height: 100vh; margin: 0; padding: 22px clamp(20px, 3vw, 48px) 40px;
    background: var(--glass);
    backdrop-filter: blur(14px) saturate(1.3); -webkit-backdrop-filter: blur(14px) saturate(1.3); }
  .watch-bar, .watch-grid { max-width: 1440px; margin-left: auto; margin-right: auto; }
  .watch-bar { display: grid; grid-template-columns: 40px 1fr 40px; align-items: center; gap: 12px;
    margin-bottom: 22px; }
  .watch-bar .brand { justify-self: center; }
  .watch-icon { width: 40px; height: 40px; border-radius: 50%; border: 1px solid var(--border-soft);
    background: var(--tile); color: var(--fg); display: flex; align-items: center; justify-content: center;
    cursor: pointer; padding: 0; transition: background .2s; }
  .watch-icon:hover { background: var(--tile-hover); }

  .watch-grid { display: grid; grid-template-columns: minmax(0, 1fr) 360px; column-gap: 28px; align-items: start;
    grid-template-areas: "player side" "info side" "comments side"; grid-template-rows: auto auto 1fr; }
  .watch-grid > .player { grid-area: player; }
  .watch-grid > .watch-info { grid-area: info; }
  .watch-grid > .comments { grid-area: comments; }
  .watch-grid > .watch-side { grid-area: side; }

  /* ---- like / comment ---- */
  .act-btn { display: inline-flex; align-items: center; gap: 7px; height: 44px; padding: 0 16px;
    border-radius: 999px; border: 1px solid var(--border-soft); background: var(--tile); color: var(--fg);
    font-family: inherit; font-size: 14px; font-weight: 700; cursor: pointer;
    -webkit-tap-highlight-color: transparent; transition: background .2s, color .2s, transform .15s; }
  .act-btn:hover { background: var(--tile-hover); }
  .act-btn:active { transform: scale(.95); }
  .act-btn.liked { color: #ff5a79; border-color: rgba(255,90,121,.35); background: rgba(255,90,121,.12); }
  .act-btn.liked svg { animation: pop .3s ease; }
  @keyframes pop { 50% { transform: scale(1.3); } }

  .comments { margin-top: 28px; padding: 22px 22px 24px; border-radius: 22px; background: var(--tile);
    border: 1px solid var(--border-soft); scroll-margin-top: 20px; }
  .comments-empty { display: flex; flex-direction: column; align-items: center; gap: 4px; padding: 26px 12px 8px;
    text-align: center; }
  .comments-empty svg { opacity: .35; margin-bottom: 6px; }
  .comments-empty span { font-size: 14px; font-weight: 700; opacity: .8; }
  .comments-empty small { font-size: 13px; opacity: .5; }
  .comments-title { font-size: 17px; font-weight: 800; margin-bottom: 16px; }
  .comments-count { font-weight: 500; opacity: .5; margin-left: 4px; }
  .comments-note { font-size: 13px; opacity: .55; margin: 14px 0 0; }
  .comments-error { font-size: 13px; color: #ff7b8f; margin-top: 8px; }
  .comments-who { font-size: 12px; opacity: .55; margin: 8px 0 0 48px; }
  .link-btn { border: 0; background: none; padding: 0; color: var(--accent); font: inherit; cursor: pointer; }
  .signin-btn { display: inline-flex; align-items: center; gap: 10px; height: 44px; padding: 0 18px;
    border-radius: 12px; border: 1px solid var(--border); background: var(--tile); color: var(--fg);
    font-family: inherit; font-size: 14px; font-weight: 600; cursor: pointer; transition: background .2s; }
  .signin-btn:hover { background: var(--tile-hover); }
  .avatar { flex: none; border-radius: 50%; object-fit: cover; background: var(--tile-hover); }
  .avatar-initial { display: inline-flex; align-items: center; justify-content: center; font-size: 14px;
    font-weight: 800; color: var(--on-accent); background: var(--accent); }
  .comment-form { display: flex; align-items: flex-start; gap: 12px; }
  .comment-box { flex: 1; min-width: 0; display: flex; align-items: flex-end; gap: 8px; padding: 5px 5px 5px 16px;
    border-radius: 22px; border: 1px solid var(--border-soft); background: rgba(0,0,0,.18);
    transition: border-color .2s, box-shadow .2s; }
  .app[data-theme="light"] .comment-box { background: rgba(255,255,255,.75); }
  .comment-box:focus-within { border-color: var(--accent); box-shadow: 0 0 0 3px var(--accent-ring); }
  .comment-box textarea { flex: 1; min-width: 0; min-height: 30px; max-height: 140px; padding: 6px 0;
    border: 0; outline: none; resize: none; background: none; color: var(--fg); font-family: inherit;
    font-size: 14px; line-height: 1.4; field-sizing: content; }
  .comment-box textarea::placeholder { color: var(--placeholder); }
  .comment-send { flex: none; width: 34px; height: 34px; border-radius: 50%; border: 0; background: var(--accent);
    color: var(--on-accent); display: flex; align-items: center; justify-content: center; cursor: pointer;
    transition: opacity .2s; }
  .comment-send:disabled { opacity: .35; cursor: default; }
  .comment-list { list-style: none; padding: 18px 0 0; margin: 18px 0 0; border-top: 1px solid var(--border-soft); display: flex; flex-direction: column; gap: 18px; }
  .comment { display: flex; gap: 12px; }
  .comment-body { min-width: 0; flex: 1; }
  .comment-head { display: flex; align-items: center; gap: 8px; }
  .comment-name { font-size: 13px; font-weight: 700; }
  .comment-time { font-size: 12px; opacity: .45; }
  .comment-del { margin-left: auto; width: 26px; height: 26px; border-radius: 50%; border: 0; background: none;
    color: var(--fg); opacity: .4; display: flex; align-items: center; justify-content: center; cursor: pointer; }
  .comment-del:hover { opacity: .9; background: var(--tile); }
  .comment-text { margin-top: 3px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; overflow-wrap: anywhere; }
  .player { border-radius: 20px; overflow: hidden; background: #000; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
  .player-video { display: block; width: 100%; aspect-ratio: 16 / 9; background: #000; }
  .player-face { aspect-ratio: 16 / 9; display: flex; align-items: center; justify-content: center;
    color: rgba(255,255,255,.6); background: linear-gradient(135deg, #12281e, #0a1a13); }

  /* details header: text left, actions right */
  .watch-info { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: end; column-gap: 24px;
    row-gap: 10px; padding: 24px 4px 0; }
  .wi-text { display: flex; flex-direction: column; align-items: flex-start; gap: 8px; min-width: 0; }
  .wi-actions { display: flex; align-items: center; gap: 8px; }
  .watch-hint, .watch-info .comments-error { grid-column: 1 / -1; }
  .watch-eyebrow { display: inline-flex; align-items: center; gap: 8px; font-size: 12px; font-weight: 700;
    letter-spacing: .12em; text-transform: uppercase; opacity: .8; }
  .watch-eyebrow .dot { width: 7px; height: 7px; }
  .watch-title { display: flex; align-items: flex-start; gap: 4px; font-size: 52px; font-weight: 800;
    line-height: 1; letter-spacing: -.03em; }
  .watch-title small { font-size: 18px; margin-top: 6px; letter-spacing: 0; opacity: .75; }
  .watch-meta { display: flex; flex-wrap: wrap; font-size: 14px; opacity: .65; }
  .watch-meta > span + span::before { content: "•"; margin: 0 9px; opacity: .6; }
  .watch-download { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
    height: 44px; padding: 0 22px; border: 0; border-radius: 999px; background: var(--accent);
    color: var(--on-accent); font-family: inherit; font-size: 15px; font-weight: 700; cursor: pointer;
    box-shadow: 0 10px 28px rgba(95,227,154,.25); transition: transform .2s, opacity .2s; }
  .watch-download:hover:not(:disabled) { transform: translateY(-1px); }
  .watch-download:disabled { opacity: .65; cursor: wait; }
  .watch-hint { font-size: 12px; opacity: .5; }
  .spin { animation: spin 1s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }

  .watch-side { min-width: 0; }
  .watch-tabs { display: flex; gap: 20px; overflow-x: auto; scrollbar-width: none;
    border-bottom: 1px solid var(--border-soft); margin-bottom: 16px; }
  .watch-tabs::-webkit-scrollbar { display: none; }
  .wtab { position: relative; flex: none; display: inline-flex; align-items: center; gap: 6px; border: 0;
    background: none; color: var(--fg); opacity: .6; padding: 10px 0 12px; font-family: inherit; font-size: 14px;
    font-weight: 600; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: opacity .2s; }
  .wtab:hover { opacity: .9; }
  .wtab.is-empty:not(.active) { opacity: .3; }
  .wtab.active { opacity: 1; }
  .wtab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: -1px; height: 2px;
    border-radius: 2px; background: var(--accent); }
  .wtab-count { font-size: 11px; font-weight: 500; opacity: .6; }
  .wtab:focus { outline: none; }
  .wtab:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; border-radius: 4px; }

  .ep-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 12px; }
  .ep-title { font-size: 15px; }
  .ep-title strong { font-weight: 800; }
  .ep-range { font-size: 12px; opacity: .5; }
  .ep-empty { padding: 28px 12px; text-align: center; font-size: 13px; opacity: .6; border-radius: 14px;
    border: 1px dashed var(--border); }
  .ep-list { display: flex; flex-direction: column; gap: 8px; }
  .ep { display: grid; grid-template-columns: 132px minmax(0, 1fr); align-items: center; gap: 14px;
    padding: 6px; border: 0; border-radius: 14px; background: none; color: var(--fg); text-align: left;
    font-family: inherit; cursor: pointer; -webkit-tap-highlight-color: transparent; transition: background .2s; }
  .ep:hover { background: var(--tile); }
  .ep.active { background: var(--tile-hover); }
  .ep:focus { outline: none; }
  .ep:focus-visible { box-shadow: 0 0 0 2px var(--accent); }
  .ep-thumb { position: relative; aspect-ratio: 16 / 9; border-radius: 10px; overflow: hidden; background: #0a1a13; }
  .ep-thumb > .thumb-media { position: absolute; inset: 0; }
  .ep.active .ep-thumb { box-shadow: 0 0 0 2px var(--accent); }
  .ep-play { position: absolute; top: 50%; left: 50%; width: 28px; height: 28px; margin: -14px 0 0 -14px;
    border-radius: 50%; display: flex; align-items: center; justify-content: center; color: #fff;
    background: rgba(0,0,0,.45); border: 1px solid rgba(255,255,255,.3); backdrop-filter: blur(6px); }
  .ep-dur, .ep-now { position: absolute; bottom: 5px; font-size: 10px; font-weight: 700; letter-spacing: .03em;
    padding: 2px 6px; border-radius: 5px; color: #fff; background: rgba(0,0,0,.7); }
  .ep-dur { right: 5px; }
  .ep-now { left: 5px; background: var(--accent); color: var(--on-accent); }
  .ep-info { display: flex; flex-direction: column; gap: 3px; min-width: 0; }
  .ep-time { font-size: 15px; font-weight: 700; }
  .ep-sub { font-size: 12px; opacity: .55; }

  @media (max-width: 1360px) {
  }
  @media (max-width: 960px) {
    .watch-grid { grid-template-columns: minmax(0, 1fr); grid-template-rows: none;
      grid-template-areas: "player" "info" "side" "comments"; }
    .watch-side { margin-top: 26px; }
  }
  /* phones: full-bleed player, full-width download, app-style list */
  @media (max-width: 720px) {
    .watch { margin: 0; padding: 0 0 40px; border-radius: 0; border: 0; box-shadow: none; min-height: 100vh;
      background: rgba(7,22,16,.84); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .app[data-theme="light"] .watch { background: #f4f6f6; }
    .watch-bar { position: sticky; top: 0; z-index: 10; margin: 0; padding: max(10px, env(safe-area-inset-top)) 12px 10px;
      background: inherit; }
    .watch-bar .brand { font-size: 15px; }
    .watch-bar .brand-sub { display: none; }
    .watch-icon { border: 0; background: none; }
    .watch-grid { gap: 0; }
    .player { border-radius: 0; box-shadow: none; }
    .watch-info { padding: 18px 16px 0; }
    .watch-title { font-size: 42px; }
    .watch-meta { font-size: 13px; }
    .watch-info { grid-template-columns: minmax(0, 1fr); }
    .wi-actions { margin-top: 6px; }
    .watch-download { flex: 1; height: 46px; }
    .act-btn { height: 46px; }
    .watch-hint { align-self: center; }
    .watch-side { margin-top: 22px; padding: 0 16px; }
    .ep { grid-template-columns: 128px minmax(0, 1fr); padding: 4px; }
    .comments { margin: 26px 16px 0; padding: 18px 16px 20px; border-radius: 18px; }
    .comment-box textarea { font-size: 16px; } /* 16px: no iOS zoom on focus */
  }

  @media (max-width: 1360px) {
  }
  /* tablets: drop the sidebar, clubs move into the filter row, tab bar appears */
  @media (max-width: 960px) {
    .shelf-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); }
    .studio { grid-template-columns: minmax(0, 1fr); }
    .sidebar { display: none; }
    .main { padding: 22px 22px 110px; }
    .mainbar-theme { display: none; }
    .toolbar .chips { display: flex; margin-left: 0; }
    /* ---- tab bar: same look as the desktop rail — dark green glass, soft tile + glowing edge marker ---- */
    .tabbar { position: fixed; left: 16px; right: 16px; bottom: max(14px, env(safe-area-inset-bottom));
      z-index: 30; display: block; max-width: 420px; margin: 0 auto; height: 66px; padding: 8px;
      border-radius: 26px; border: 1px solid var(--glass-edge); background: var(--tabbar-bg);
      backdrop-filter: blur(24px) saturate(1.5); -webkit-backdrop-filter: blur(24px) saturate(1.5);
      box-shadow: inset 0 1px 0 rgba(255,255,255,.14), inset 0 -1px 0 rgba(255,255,255,.05),
        0 18px 44px rgba(0,0,0,.45); }
    .tabs-track { position: relative; display: flex; height: 100%; }
    /* active tile slides between tabs; its ::after is the glowing marker on the bar's bottom edge */
    .tab-ind { position: absolute; top: 0; bottom: 0; left: calc(25% * var(--i) + 6px); width: calc(25% - 12px);
      z-index: 0; border-radius: 16px; background: rgba(255,255,255,.08); pointer-events: none;
      transition: left .45s cubic-bezier(.34,1.4,.64,1); }
    .app[data-theme="light"] .tab-ind { background: rgba(20,24,22,.07); }
    .tab-ind::after { content: ""; position: absolute; left: 50%; bottom: -9px; width: 26px; height: 4px;
      margin-left: -13px; border-radius: 4px 4px 0 0; background: var(--accent); box-shadow: 0 0 12px var(--accent); }
    .tab { position: relative; z-index: 1; flex: 1; height: 100%; border: 0; background: none; padding: 0;
      color: var(--fg); opacity: .6; display: flex; align-items: center; justify-content: center;
      cursor: pointer; -webkit-tap-highlight-color: transparent; transition: opacity .25s; }
    .tab svg { transition: transform .35s cubic-bezier(.34,1.56,.64,1); }
    .tab:hover { opacity: .9; }
    .tab.active { opacity: 1; }
    .tab.active svg { transform: scale(1.08); }
    .tab:active svg { transform: scale(.86); transition-duration: .12s; }
  }
  /* phones: streaming-app layout — full-bleed hero, club tabs, sideways rows, bottom tab bar */
  @media (max-width: 720px) {
    .studio { margin: 0; border-radius: 0; border: 0; box-shadow: none; min-height: 100vh;
      background: rgba(7,22,16,.84); backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); }
    .app[data-theme="light"] .studio { background: #f4f6f6; }
    .main { display: flex; flex-direction: column; padding: 0 0 96px; }
    .main > * { margin-left: 16px; margin-right: 16px; }
    .main > .feature-wrap { margin: 0 0 18px; order: -1; }

    /* search + filters sit under the hero */
    .mainbar { grid-template-columns: minmax(0, 1fr); margin-bottom: 12px; }
    .toolbar { flex-direction: column; align-items: stretch; gap: 10px; margin-bottom: 22px; }
    .toolbar .chips { display: none; }
    .toolbar-pickers .picker, .toolbar-pickers .picker:nth-child(2) { flex: 1; width: auto; }

    /* ---- hero ---- */
    .banner { display: none; }
    .feature-wrap { display: block; }
    .mhero { position: relative; color: #fff; }
    .mhero-top { position: absolute; top: 0; left: 0; right: 0; z-index: 3;
      padding: max(14px, env(safe-area-inset-top)) 16px 14px;
      /* strong dark-green fade so white text stays readable over bright courts */
      background: linear-gradient(180deg, rgba(3,14,9,.92) 0%, rgba(3,14,9,.7) 55%, rgba(3,14,9,0) 100%);
      text-shadow: 0 1px 8px rgba(0,0,0,.6); }
    .mtop-row .brand-sub { opacity: .75; }
    .mtop-row { display: flex; align-items: center; justify-content: space-between; height: 44px; }
    .mtop-row .brand { font-size: 16px; color: #fff; }
    .mtop-icon { width: 40px; height: 40px; margin-right: -8px; border: 0; background: none; color: #fff;
      display: flex; align-items: center; justify-content: center; cursor: pointer; }
    .mtabs { display: flex; gap: 22px; overflow-x: auto; scrollbar-width: none; padding: 6px 0 10px; }
    .mtabs::-webkit-scrollbar { display: none; }
    .mtab { position: relative; flex: none; border: 0; background: none; color: #fff; opacity: .78;
      padding: 6px 0; font-family: inherit; font-size: 15px; font-weight: 600; cursor: pointer;
      -webkit-tap-highlight-color: transparent; transition: opacity .2s; }
    .mtab.active { opacity: 1; }
    .mtab.active { font-weight: 800; }
    .mtab.active::after { content: ""; position: absolute; left: 0; right: 0; bottom: 0; height: 3px;
      border-radius: 2px; background: var(--accent); box-shadow: 0 0 10px rgba(95,227,154,.5); }

    .mhero-rail { display: flex; overflow-x: auto; scroll-snap-type: x mandatory; scrollbar-width: none; }
    .mhero-rail::-webkit-scrollbar { display: none; }
    .mslide { position: relative; flex: none; width: 100%; height: min(78svh, 600px); min-height: 460px;
      scroll-snap-align: start; overflow: hidden; background: #0a1a13; cursor: pointer; }
    .mslide > .thumb-media { position: absolute; inset: 0; }
    .mslide-empty { display: flex; align-items: center; justify-content: center; font-size: 14px; opacity: .8; }
    .mslide.skeleton { background: #0d2219; animation: pulse 1.4s ease-in-out infinite; }
    .mslide-shade { position: absolute; inset: 0;
      background: linear-gradient(0deg, #071610 0%, rgba(7,22,16,.85) 22%, rgba(7,22,16,0) 55%); }
    .app[data-theme="light"] .mslide-shade {
      background: linear-gradient(0deg, rgba(7,22,16,.95) 0%, rgba(7,22,16,.75) 24%, rgba(7,22,16,0) 55%); }
    .mslide-copy { position: absolute; left: 16px; right: 16px; bottom: 22px; display: flex;
      flex-direction: column; align-items: center; gap: 10px; text-align: center; }
    .mslide-title { display: flex; align-items: flex-start; gap: 4px; font-size: 64px; font-weight: 800;
      line-height: 1; letter-spacing: -.03em; text-shadow: 0 6px 30px rgba(0,0,0,.5); }
    .mslide-title small { font-size: 22px; margin-top: 6px; letter-spacing: 0; opacity: .85; }
    .mslide-meta { display: flex; flex-wrap: wrap; justify-content: center; gap: 4px 0; font-size: 12px;
      font-weight: 500; opacity: .85; }
    .mslide-meta > span + span::before { content: "•"; margin: 0 8px; opacity: .5; }
    .mslide-watch { display: inline-flex; align-items: center; justify-content: center; gap: 8px;
      width: min(240px, 70%); height: 44px; margin-top: 6px; border: 0; border-radius: 10px;
      background: rgba(255,255,255,.16); color: #fff; font-family: inherit; font-size: 14px; font-weight: 700;
      backdrop-filter: blur(10px); -webkit-backdrop-filter: blur(10px); cursor: pointer; }
    .mslide-watch:active { background: rgba(255,255,255,.26); }
    .mhero-dots { display: flex; justify-content: center; gap: 6px; padding: 12px 0 0; }
    .mhero-dots button { width: 6px; height: 6px; padding: 0; border: 0; border-radius: 999px;
      background: var(--fg); opacity: .3; cursor: pointer; transition: width .25s, opacity .25s; }
    .mhero-dots button.on { width: 18px; opacity: .9; }

    /* ---- rows: portrait cards scrolling sideways ---- */
    .sec-title { font-size: 17px; }
    .sec-title strong { color: var(--accent); }
    .shelf + .shelf { margin-top: 24px; }
    .shelf-head { margin-bottom: 10px; }
    .shelf-grid { display: flex; gap: 8px; margin: 0 -16px; padding: 0 16px 4px; overflow-x: auto;
      scroll-snap-type: x proximity; scroll-padding: 0 16px; scrollbar-width: none; }
    .shelf-grid::-webkit-scrollbar { display: none; }
    .card { flex: none; width: 31vw; max-width: 150px; border-radius: 8px; box-shadow: none;
      scroll-snap-align: start; }
    .card:hover { transform: none; box-shadow: none; }
    .card-thumb { aspect-ratio: 3 / 4.2; }
    .card-play { display: none; }
    .card-info { left: 8px; right: 8px; bottom: 8px; gap: 1px; }
    .card-title { font-size: 15px; }
    .card-meta { font-size: 10px; }
    .card-badge { left: 6px; right: auto; top: 6px; padding: 2px 6px; border-radius: 4px; font-size: 9px;
      letter-spacing: .04em; text-transform: uppercase; }
    .card.skeleton { width: 31vw; max-width: 150px; aspect-ratio: 3 / 4.2; }
    .more-days { margin-top: 24px; }

  }
  /* touch screens have no hover: keep the play hint faintly visible */
  @media (hover: none) {
    .card-play { opacity: .85; transform: none; }
  }
  @media (max-width: 480px) {
    /* 16px keeps iOS Safari from zooming in when the search box is focused */
    .field input { font-size: 16px; }
    .picker-btn { padding: 0 12px; gap: 7px; }
    .picker-caret { display: none; }
    .chip { padding: 0 10px; font-size: 11px; }
    .clips { gap: 16px 10px; }
    .thumb { border-radius: 12px; }
    .clip-body { flex-direction: column; gap: 2px; }
    .clip-time { font-size: 14px; }
    .clip-meta { font-size: 11px; }
    .day-head { margin-bottom: 10px; }
  }

  /* =================== motion =================== */
  /* page entrance */
  .studio, .watch { animation: page-in .6s ease both; }
  @keyframes page-in { from { opacity: 0; } }
  .mainbar, .watch-bar { animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
  .rail { animation: rail-in .7s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rail-in { from { opacity: 0; transform: translateX(-16px) scale(.97); } }
  .rail-group > * { animation: slide-in .5s cubic-bezier(.2,.8,.2,1) both; }
  .rail-group > :nth-child(2) { animation-delay: .05s; } .rail-group > :nth-child(3) { animation-delay: .1s; }
  .rail-group > :nth-child(4) { animation-delay: .15s; } .rail-group > :nth-child(5) { animation-delay: .2s; }
  .mainbar { animation-delay: .1s; }
  .toolbar { animation: rise .6s .25s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes rise { from { opacity: 0; transform: translateY(14px); } }
  @keyframes slide-in { from { opacity: 0; transform: translateX(-12px); } }

  /* banner + hero copy: staggered lines each time the slide changes */
  .banner { animation: rise .8s .15s cubic-bezier(.2,.8,.2,1) both; }
  .banner-copy > *, .mslide-copy > *, .watch-info > * { animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
  .banner-copy > :nth-child(2), .mslide-copy > :nth-child(2), .watch-info > :nth-child(2) { animation-delay: .07s; }
  .banner-copy > :nth-child(3), .mslide-copy > :nth-child(3), .watch-info > :nth-child(3) { animation-delay: .14s; }
  .banner-copy > :nth-child(4), .mslide-copy > :nth-child(4), .watch-info > :nth-child(4) { animation-delay: .21s; }
  .watch-info > :nth-child(5), .watch-info > :nth-child(6) { animation-delay: .28s; }
  /* slow drift on the big pictures */
  .banner-bg > .thumb-media > *, .mslide > .thumb-media > * { animation: drift 22s ease-in-out infinite alternate; }
  @keyframes drift { from { transform: scale(1.02) translate(0, 0); } to { transform: scale(1.12) translate(-2%, -1.5%); } }
  .pick.active { animation: glow 2.4s ease-in-out infinite; }
  @keyframes glow { 50% { box-shadow: 0 0 0 3px rgba(95,227,154,.25), 0 0 18px rgba(95,227,154,.35); } }
  .btn-watch, .watch-download { position: relative; overflow: hidden; }
  .btn-watch::after, .watch-download::after { content: ""; position: absolute; inset: 0; pointer-events: none;
    background: linear-gradient(110deg, transparent 30%, rgba(255,255,255,.45) 50%, transparent 70%);
    transform: translateX(-120%); animation: shine 4.5s 1.2s ease-in-out infinite; }
  @keyframes shine { 0%, 70% { transform: translateX(-120%); } 100% { transform: translateX(120%); } }

  /* player pops in on the watch page */
  .watch-grid > .player { animation: zoom-in .7s .1s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes zoom-in { from { opacity: 0; transform: scale(.96); } }

  /* lists: stagger in on first paint */
  .shelf { animation: rise .6s cubic-bezier(.2,.8,.2,1) both; }
  .shelf:nth-child(2) { animation-delay: .08s; } .shelf:nth-child(3) { animation-delay: .16s; }
  .card, .ep, .comment { animation: card-in .55s cubic-bezier(.2,.8,.2,1) both; }
  .card:nth-child(2), .ep:nth-child(2) { animation-delay: .05s; }
  .card:nth-child(3), .ep:nth-child(3) { animation-delay: .1s; }
  .card:nth-child(4), .ep:nth-child(4) { animation-delay: .15s; }
  .card:nth-child(n+5), .ep:nth-child(n+5) { animation-delay: .2s; }
  @keyframes card-in { from { opacity: 0; transform: translateY(20px) scale(.96); } }
  /* where supported, cards further down reveal as they scroll into view instead */
  @supports (animation-timeline: view()) {
    .card, .ep, .shelf-head {
      animation: card-in linear both; animation-delay: 0s;
      animation-timeline: view(); animation-range: entry 0% entry 60%;
    }
  }
  .card .thumb-media > *, .ep .thumb-media > * { transition: transform .6s cubic-bezier(.2,.8,.2,1); }
  .card:hover .thumb-media > *, .ep:hover .thumb-media > * { transform: scale(1.07); }

  /* tabs: underline grows in */
  .mtab.active::after, .wtab.active::after, .nav-link.active::after { animation: underline .35s cubic-bezier(.2,.8,.2,1) both; }
  @keyframes underline { from { transform: scaleX(0); } }

  /* counters bump when they change */
  .bump { display: inline-block; animation: bump .35s cubic-bezier(.34,1.56,.64,1); }
  @keyframes bump { from { transform: translateY(-6px) scale(1.3); opacity: .4; } }

  /* empty states fade */
  .empty, .ep-empty, .comments-note { animation: rise .5s ease both; }

  /* respect "reduce motion" */
  @media (prefers-reduced-motion: reduce) {
    *, *::before, *::after { animation-duration: .01ms !important; animation-delay: 0s !important;
      animation-iteration-count: 1 !important; transition-duration: .01ms !important; scroll-behavior: auto !important; }
    .card, .ep, .shelf-head { animation-timeline: auto !important; }
  }
`;
