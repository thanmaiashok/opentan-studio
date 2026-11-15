'use client';

// Video → Edit (law 27, guide/EDIT.md): a minimal clip editor like the one Google Flow opens on a generation.
// One preview, the transport under it, one timeline strip of clips with a + to add the next one.
// Ops: add · trim (edge handles) · split at the playhead · reorder (drag) · remove (quick undo) · cut / smooth joins.
// Every clip is made ready first (law 28: Gemini mark off, then a fast-seek proxy — lib/ingest.js), so playback
// never waits on a full-size decode. The edit is data (data/edits/<id>.json); Export renders one MP4 (lib/edits.js).

import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import PageTop from '@/components/PageTop';
import EmptyStack from '@/components/EmptyStack';
import { ContextMenu, Sheet, UndoPill, keysBlocked } from '@/components/Menu';
import { Segmented, Switch } from '@/components/Settings';
import { fileUrl } from '@/components/JobCard';

const SMOOTH = 0.5; // same as lib/edits.js
const MIN_CLIP = 0.5;
const FPS = 30;
const TRACK_H = 64;
const SLOTS = 3; // clip i plays in slot i % 3: the next two clips always wait, loaded, at their first frame
const LONG = { '1080p': 1920, '2k': 2560, '4k': 3840 };

// ---------- the timeline maths (mirror of lib/edits.js) ----------

function smoothFor(clips, i) {
  if (i < 1 || clips[i].join !== 'smooth') return 0;
  const a = clips[i - 1].out - clips[i - 1].in, b = clips[i].out - clips[i].in;
  return Math.min(SMOOTH, a / 2, b / 2);
}

function layout(clips) {
  let end = 0;
  return clips.map((c, i) => {
    const len = c.out - c.in;
    const d = smoothFor(clips, i);
    const start = i ? end - d : 0;
    end = start + len;
    return { ...c, i, len, d, start };
  });
}

const timecode = (s) => {
  const t = Math.max(0, s);
  const m = Math.floor(t / 60), sec = Math.floor(t % 60), f = Math.floor((t % 1) * FPS);
  return [m, sec, f].map((n) => String(n).padStart(2, '0')).join(':');
};

const uid = () => Math.random().toString(36).slice(2, 10);
const ingestApi = (files) => fetch('/api/ingest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ files }) }).then((r) => r.json());

// Duration of a source, from the server (it also starts that video's clean-up + proxy right away).
export async function probeDuration(src) {
  const r = await ingestApi([src]).catch(() => ({}));
  return r?.[src]?.info?.dur || 0;
}

const frameUrl = (src, t, v = '', h = 120) => `/api/frame?p=${encodeURIComponent(src)}&t=${(Math.floor(Math.max(0, t) * 4) / 4).toFixed(2)}&h=${h}${v ? `&v=${v}` : ''}`;

// ---------- the clock: the playhead and the time text follow it without re-rendering the page ----------

function makeClock() {
  let t = 0;
  const subs = new Set();
  return {
    get: () => t,
    set: (x) => { t = x; subs.forEach((f) => f()); },
    subscribe: (f) => { subs.add(f); return () => subs.delete(f); },
  };
}
function useClock(clock) { return useSyncExternalStore(clock.subscribe, clock.get, clock.get); }
function TimeText({ clock }) { return <span className="ed-time">{timecode(useClock(clock))}</span>; }
function Playhead({ clock, scale }) {
  const t = useClock(clock);
  return <div className="ed-playhead" style={{ translate: `${t * scale}px 0` }} aria-hidden="true"><i /></div>;
}

// ---------- icons (16px line, same stroke as the board) ----------

const I = {
  play: <path d="M5.5 3.6v8.8a.6.6 0 0 0 .9.5l7-4.4a.6.6 0 0 0 0-1L6.4 3.1a.6.6 0 0 0-.9.5z" className="fill" />,
  pause: <><rect x="4.25" y="3.25" width="2.6" height="9.5" rx="0.8" className="fill" /><rect x="9.15" y="3.25" width="2.6" height="9.5" rx="0.8" className="fill" /></>,
  prev: <><path d="M3.75 3.5v9" /><path d="M12.5 3.9v8.2a.5.5 0 0 1-.8.4L6.3 8.4a.5.5 0 0 1 0-.8l5.4-4.1a.5.5 0 0 1 .8.4z" className="fill" /></>,
  next: <><path d="M12.25 3.5v9" /><path d="M3.5 3.9v8.2a.5.5 0 0 0 .8.4l5.4-4.1a.5.5 0 0 0 0-.8L4.3 3.5a.5.5 0 0 0-.8.4z" className="fill" /></>,
  sound: <><path d="M2.75 6.25h2.1L8 3.6v8.8L4.85 9.75h-2.1z" /><path d="M10.6 5.6a3.2 3.2 0 0 1 0 4.8M12.4 4a5.5 5.5 0 0 1 0 8" /></>,
  mute: <><path d="M2.75 6.25h2.1L8 3.6v8.8L4.85 9.75h-2.1z" /><path d="M10.5 6l3.5 4M14 6l-3.5 4" /></>,
  full: <path d="M2.75 6V3.75c0-.55.45-1 1-1H6M10 2.75h2.25c.55 0 1 .45 1 1V6M13.25 10v2.25c0 .55-.45 1-1 1H10M6 13.25H3.75c-.55 0-1-.45-1-1V10" />,
  loop: <><path d="M3 7.25V6.5a2.5 2.5 0 0 1 2.5-2.5h7.25M10.75 1.9 12.85 4l-2.1 2.1" /><path d="M13 8.75v.75a2.5 2.5 0 0 1-2.5 2.5H3.25M5.25 14.1 3.15 12l2.1-2.1" /></>,
  zoomIn: <><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2l3.3 3.3M5.1 7h3.8M7 5.1v3.8" /></>,
  zoomOut: <><circle cx="7" cy="7" r="4.25" /><path d="M10.2 10.2l3.3 3.3M5.1 7h3.8" /></>,
  split: <><path d="M8 2.25v11.5" /><path d="M5.25 5 2.5 8l2.75 3M10.75 5l2.75 3-2.75 3" /></>,
  trash: <path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" />,
  plus: <path d="M8 3.25v9.5M3.25 8h9.5" />,
  export: <><path d="M8 10V2.75M4.9 5.6 8 2.5l3.1 3.1" /><path d="M2.75 9.5v2.25c0 .83.67 1.5 1.5 1.5h7.5c.83 0 1.5-.67 1.5-1.5V9.5" /></>,
  check: <path d="M3.5 8.5 6.5 11.5 12.5 4.5" />,
  list: <><path d="M5.75 4.25h7.5M5.75 8h7.5M5.75 11.75h7.5" /><circle cx="3" cy="4.25" r=".6" className="fill" /><circle cx="3" cy="8" r=".6" className="fill" /><circle cx="3" cy="11.75" r=".6" className="fill" /></>,
  cut: <path d="M8 2.5v11" />,
  smooth: <><circle cx="6" cy="8" r="3.4" /><circle cx="10" cy="8" r="3.4" /></>,
  chev: <path d="M4.5 6.25 8 9.75l3.5-3.5" />,
};
const Ico = ({ n }) => <svg viewBox="0 0 16 16" aria-hidden="true">{I[n]}</svg>;

// the page's own mark for the empty state: a film strip with a cut through it
const EditMark = () => (
  <svg viewBox="0 0 24 24"><rect x="3.5" y="6" width="17" height="12" rx="2.5" /><path d="M12 4v16M3.5 9.5h3M3.5 14.5h3M17.5 9.5h3M17.5 14.5h3" /></svg>
);

const READY_LABEL = { queued: 'Preparing', cleaning: 'Removing mark', proxy: 'Preparing', new: 'Preparing', error: 'Could not prepare' };

// ---------- one clip on the track (memoised: the playhead moves every frame, the clips don't) ----------

const Strip = memo(function Strip({ src, v, inn, len, pps, tileW }) {
  const n = Math.max(1, Math.ceil((len * pps) / tileW));
  return (
    <div className="ed-strip">
      {Array.from({ length: n }, (_, k) => (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={`${k}-${v}`}
          src={frameUrl(src, inn + Math.min(len - 0.05, ((k + 0.5) * tileW) / pps), v)}
          alt="" draggable={false} decoding="async" style={{ width: tileW }}
          onLoad={(e) => e.currentTarget.classList.add('in')}
        />
      ))}
    </div>
  );
});

const Clip = memo(function Clip({ c, pps, selected, dragX, leaving, ready, onDown, onHandle }) {
  const w = Math.max(8, c.len * pps);
  const tileW = Math.round(TRACK_H * 16 / 9);
  const state = ready?.state || 'new';
  return (
    <div
      className={`ed-clip${selected ? ' on' : ''}${dragX != null ? ' lifted' : ''}${leaving ? ' leaving' : ''}${state !== 'ready' ? ' busy' : ''}`}
      style={{ left: c.start * pps, width: w, zIndex: dragX != null ? 9 : c.i + 1, translate: dragX != null ? `${dragX}px 0` : undefined, '--i': c.i }}
      onPointerDown={(e) => onDown(e, c)}
      data-clip={c.id}
    >
      <Strip src={c.src} v={ready?.v || ''} inn={c.in} len={c.len} pps={pps} tileW={tileW} />
      {state !== 'ready' && (
        <span className={`ed-badge${state === 'error' ? ' err' : ''}`} title={ready?.error || undefined}>
          {state !== 'error' && <i className="ed-spin" />}{READY_LABEL[state] || 'Preparing'}
        </span>
      )}
      {selected && !leaving && (
        <>
          <span className="ed-handle l" onPointerDown={(e) => onHandle(e, c, 'in')} aria-label="Trim start" />
          <span className="ed-handle r" onPointerDown={(e) => onHandle(e, c, 'out')} aria-label="Trim end" />
        </>
      )}
    </div>
  );
});

// ---------- export options: a card that drops from the Export button ----------

function ExportCard({ opts, setOpts, info, total, onGo, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const down = (e) => { if (!ref.current?.contains(e.target) && !e.target.closest('.ed-export')) onClose(); };
    const key = (e) => { if (e.key === 'Escape') onClose(); if (e.key === 'Enter') onGo(); };
    window.addEventListener('pointerdown', down);
    window.addEventListener('keydown', key);
    return () => { window.removeEventListener('pointerdown', down); window.removeEventListener('keydown', key); };
  }, [onClose, onGo]);
  const w = info?.w || 1280, h = info?.h || 720;
  const k = opts.resolution === 'source' ? 1 : LONG[opts.resolution] / Math.max(w, h);
  const W = Math.round((w * k) / 2) * 2, H = Math.round((h * k) / 2) * 2;
  const grows = W > w;
  const slow = info?.fps && info.fps < opts.fps - 0.5;
  const resLabel = { source: 'Source', '1080p': '1080p', '2k': '2K', '4k': '4K' }[opts.resolution];
  return (
    <div className="ed-xcard" ref={ref} role="dialog" aria-label="Export options">
      <div className="ed-xhead">
        <b>Export</b>
        <span>{W}×{H} · {opts.fps} fps · {timecode(total)}</span>
      </div>
      <div className="ed-xrow" style={{ '--i': 0 }}>
        <div><b>Resolution</b><small>Source is {w}×{h}</small></div>
        <Segmented label="Resolution" value={opts.resolution} onChange={(v) => setOpts((o) => ({ ...o, resolution: v }))}
          options={[['source', 'Source'], ['1080p', '1080p'], ['2k', '2K'], ['4k', '4K']].map(([value, label]) => ({ value, label }))} />
      </div>
      <div className="ed-xrow" style={{ '--i': 1 }}>
        <div><b>Frame rate</b><small>{slow ? `${Math.round(info.fps)} → ${opts.fps} fps with smooth motion` : 'Same motion as the source'}</small></div>
        <Segmented label="Frame rate" value={opts.fps} onChange={(v) => setOpts((o) => ({ ...o, fps: v }))}
          options={[30, 60].map((v) => ({ value: v, label: `${v} fps` }))} />
      </div>
      <div className={`ed-xrow${grows ? '' : ' off'}`} style={{ '--i': 2 }}>
        <div><b>Enhance</b><small>{grows ? 'TAN Upscaler Clean: sharper when the picture grows' : 'Not needed: the picture does not grow'}</small></div>
        <Switch label="Enhance" on={grows && opts.enhance} onChange={(v) => grows && setOpts((o) => ({ ...o, enhance: v }))} />
      </div>
      <button className="ed-xgo" onClick={onGo} style={{ '--i': 3 }}>
        <Ico n="export" />Export {resLabel} · {opts.fps} fps{grows && opts.enhance ? ' · Enhanced' : ''}
      </button>
    </div>
  );
}

// ---------- the page ----------

export default function EditView({ videos = [], jobs = [] }) {
  const [edits, setEdits] = useState(null);
  const [edit, setEdit] = useState(null);
  const [t, setT] = useState(0); // slow copy of the clock for the controls (split, info); the playhead uses the clock
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [loop, setLoop] = useState(false);
  const [sel, setSel] = useState(null);
  const [pps, setPps] = useState(null); // pixels per second; null = fit to width
  const [picker, setPicker] = useState(false);
  const [gone, setGone] = useState(null);
  const [leaving, setLeaving] = useState(null);
  const [drag, setDrag] = useState(null);
  const [menu, setMenu] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [ready, setReady] = useState({}); // src → ingest status
  const [xOpen, setXOpen] = useState(false);
  const [xOpts, setXOpts] = useState({ resolution: '2k', fps: 60, enhance: true });
  const [xJob, setXJob] = useState(null); // { id, phase, p, error }

  const clock = useMemo(makeClock, []);
  const editRef = useRef(null); editRef.current = edit; // latest, for timers
  const jobsRef = useRef(jobs); jobsRef.current = jobs;
  const clips = edit?.clips || [];
  const lay = useMemo(() => layout(clips), [clips]);
  const total = lay.length ? lay[lay.length - 1].start + lay[lay.length - 1].len : 0;
  const firstInfo = ready[clips[0]?.src]?.info;
  const aspect = firstInfo?.w ? firstInfo.w / firstInfo.h : 16 / 9;

  // ---------- load + save ----------
  const api = (body) => fetch('/api/edits', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const loadList = useCallback(async (pick) => {
    const res = await fetch('/api/edits?ensure=1', { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!res?.edits?.length) { setTimeout(() => loadList(pick), 1500); return; } // server busy: try again, never make a second edit
    const list = res.edits;
    const cur = list.find((e) => e.id === pick) || list[0];
    clock.set(0);
    setEdits(list); setEdit(cur); setT(0); setSel(null); setPlaying(false); setPps(null);
    setGone(null); setLeaving(null); // a clip's undo belongs to its own edit
  }, [clock]);
  useEffect(() => { loadList(); }, [loadList]);
  useEffect(() => { fetch('/api/edits?defaults=1').then((r) => r.json()).then((d) => d?.resolution && setXOpts(d)).catch(() => {}); }, []);

  const saveTimer = useRef(null);
  const pendingSave = useRef(null);
  const flush = useCallback(() => {
    clearTimeout(saveTimer.current);
    const e = pendingSave.current; if (!e) return;
    pendingSave.current = null;
    api({ action: 'save', edit: e }).then((saved) => {
      if (saved?.id) setEdits((l) => (l || []).map((x) => (x.id === saved.id ? saved : x)));
    }).catch(() => {});
  }, []);
  useEffect(() => () => flush(), [flush]);
  const change = useCallback((fn) => {
    setEdit((e) => {
      const next = { ...e, ...fn(e) };
      pendingSave.current = next;
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(flush, 350);
      return next;
    });
  }, [flush]);
  const setClips = useCallback((fn) => change((e) => ({ clips: fn(e.clips) })), [change]);

  // ---------- ingest: every source is cleaned (law 28) and gets a proxy before it plays ----------
  const srcKey = [...new Set(clips.map((c) => c.src))].join('|');
  useEffect(() => {
    const srcs = srcKey ? srcKey.split('|') : [];
    if (!srcs.length) return undefined;
    let alive = true, timer;
    const poll = async () => {
      const r = await ingestApi(srcs).catch(() => null);
      if (!alive) return; // cleaned up: never reschedule (no zombie pollers)
      if (!r) { timer = setTimeout(poll, 1500); return; }
      setReady((old) => {
        const next = { ...old };
        for (const [k, v] of Object.entries(r)) next[k] = v;
        return next;
      });
      if (Object.values(r).some((s) => s.state !== 'ready' && s.state !== 'error' && s.state !== 'missing')) timer = setTimeout(poll, 700);
    };
    poll();
    return () => { alive = false; clearTimeout(timer); };
  }, [srcKey]);
  const urlFor = useCallback((src) => (ready[src]?.state === 'ready' ? `/api/ingest?proxy=${ready[src].proxy}` : fileUrl(src)), [ready]);

  // ---------- the player: three <video> slots, clip i plays in slot i % 3 ----------
  const slotRefs = useRef([]);
  const sync = useCallback((time, play) => {
    const at = Math.min(time, Math.max(0, total - 0.001));
    const visible = lay.filter((c) => at >= c.start && at < c.start + c.len);
    for (let s = 0; s < SLOTS; s += 1) {
      const v = slotRefs.current[s]; if (!v) continue;
      const c = visible.filter((x) => x.i % SLOTS === s).pop();
      if (!c) {
        // idle slot: wait on the next clip it will play, already at its first frame
        const nextC = lay.find((x) => x.i % SLOTS === s && x.start > at);
        v.style.opacity = '0';
        if (!v.paused) v.pause();
        if (nextC) {
          const url = urlFor(nextC.src);
          if (v.dataset.url !== url) { v.src = url; v.dataset.url = url; }
          if (v.readyState > 0 && Math.abs(v.currentTime - nextC.in) > 0.05) v.currentTime = nextC.in;
        }
        continue;
      }
      const url = urlFor(c.src);
      if (v.dataset.url !== url) { v.src = url; v.dataset.url = url; }
      const local = c.in + (at - c.start);
      if (v.readyState > 0 && Math.abs(v.currentTime - local) > (play ? 0.3 : 0.02)) v.currentTime = local;
      // smooth join: the newer clip fades in over the older one; sound crossfades the same way
      const inFade = c.d > 0 && at < c.start + c.d ? (at - c.start) / c.d : 1;
      const nxt = lay[c.i + 1];
      const outFade = nxt && nxt.d > 0 && at > nxt.start ? 1 - (at - nxt.start) / nxt.d : 1;
      v.style.opacity = String(inFade);
      v.style.zIndex = String(c.i + 1);
      v.muted = muted;
      v.volume = Math.max(0, Math.min(1, inFade * outFade));
      if (play && v.paused) v.play().catch(() => {});
      if (!play && !v.paused) v.pause();
    }
  }, [lay, total, muted, urlFor]);

  const scroller = useRef(null);
  const scaleRef = useRef(60);
  // the clock while playing: the oldest visible clip's own video drives time (no drift); wall clock otherwise
  useEffect(() => {
    if (!playing) { sync(clock.get(), false); return undefined; }
    let raf, last = performance.now(), lastUi = 0;
    const tick = (now) => {
      const dt = Math.min(0.25, (now - last) / 1000); last = now;
      let time = clock.get();
      const lead = lay.find((c) => time >= c.start && time < c.start + c.len);
      const v = lead && slotRefs.current[lead.i % SLOTS];
      if (v && v.dataset.url === urlFor(lead.src) && !v.paused && v.readyState >= 3 && !v.seeking) {
        // the playing video is the truth: the clock catches up with it (slow frames, a hidden window) and only
        // waits for it when it is a hair behind; a video far behind is moved to the clock instead
        const fromVideo = lead.start + (v.currentTime - lead.in);
        if (fromVideo >= time) time = fromVideo;
        else if (time - fromVideo > 0.3) { v.currentTime = lead.in + (time - lead.start); time += dt; }
      } else if (!v || v.readyState >= 2) time += dt;
      if (time >= total) {
        if (loop && total > 0) time = 0;
        else { clock.set(total); setT(total); setPlaying(false); return; }
      }
      clock.set(time);
      sync(time, true);
      // keep the playhead in view while it plays
      const sc = scroller.current;
      if (sc) {
        const x = time * scaleRef.current + 12;
        if (x > sc.scrollLeft + sc.clientWidth - 60 || x < sc.scrollLeft) sc.scrollTo({ left: Math.max(0, x - 80), behavior: 'smooth' });
      }
      if (now - lastUi > 200) { lastUi = now; setT(time); }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [playing, lay, total, loop, sync, clock, urlFor]);

  const seek = useCallback((time) => {
    const x = Math.max(0, Math.min(total, time));
    clock.set(x); setT(x);
    if (!playing) sync(x, false);
  }, [total, playing, sync, clock]);
  useEffect(() => { if (!playing) sync(clock.get(), false); }, [lay, muted, ready]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { if (clock.get() > total) seek(total); }, [total, seek, clock]);

  const toggle = () => {
    if (!lay.length) return;
    if (!playing && clock.get() >= total - 0.02) { clock.set(0); setT(0); }
    setPlaying((p) => !p);
  };
  const jump = (dir) => {
    const now = clock.get();
    const starts = lay.map((c) => c.start).concat(total);
    const target = dir < 0 ? [...starts].reverse().find((s) => s < now - 0.25) ?? 0 : starts.find((s) => s > now + 0.01) ?? total;
    seek(target);
  };
  const stage = useRef(null);
  const fullscreen = () => stage.current?.requestFullscreen?.();

  // ---------- timeline geometry ----------
  const [trackW, setTrackW] = useState(800);
  useLayoutEffect(() => {
    const el = scroller.current; if (!el) return undefined;
    const ro = new ResizeObserver(([e]) => setTrackW(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [edit?.id]);
  const fitPps = Math.max(24, Math.min(160, (trackW - 72) / Math.max(total + 2, 8)));
  const scale = pps ?? fitPps;
  scaleRef.current = scale;
  const zoom = (k) => setPps(Math.max(16, Math.min(320, scale * k)));
  const span = Math.max(total + 4, (trackW - 24) / scale);
  const tickEvery = scale >= 40 ? 1 : scale >= 20 ? 2 : 5;

  // ---------- pointer work: scrub, select, drag to reorder, trim ----------
  const toTime = (clientX) => {
    const r = scroller.current.getBoundingClientRect();
    return (clientX - r.left + scroller.current.scrollLeft - 12) / scale;
  };
  const scrub = (e) => {
    if (e.button !== 0) return;
    setPlaying(false); setPicker(false);
    if (!e.target.closest('.ed-clip')) setSel(null);
    seek(toTime(e.clientX));
    const move = (ev) => seek(toTime(ev.clientX));
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up); };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const onClipDown = useCallback((e, c) => {
    if (e.button !== 0 || e.target.closest('.ed-handle')) return;
    e.stopPropagation();
    setPlaying(false); setPicker(false); setSel(c.id);
    setPps((p) => p ?? scale); // freeze the zoom: the track must not rescale under the pointer
    const x0 = e.clientX;
    let moved = false;
    const target = (dx) => {
      // drop slot = where the lifted clip's centre lands among the others
      const centre = (c.start + c.len / 2) * scale + dx;
      let to = 0;
      lay.forEach((o) => { if (o.id !== c.id && centre > (o.start + o.len / 2) * scale) to += 1; });
      return to;
    };
    const move = (ev) => {
      const dx = ev.clientX - x0;
      if (!moved && Math.abs(dx) < 4) return;
      moved = true;
      setDrag({ id: c.id, dx, to: target(dx) });
    };
    const up = (ev) => {
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
      if (!moved) { seek(toTime(ev.clientX)); return; }
      const to = target(ev.clientX - x0);
      setDrag(null);
      setClips((list) => {
        const from = list.findIndex((x) => x.id === c.id);
        if (from < 0 || from === to) return list;
        const next = list.slice();
        const [it] = next.splice(from, 1);
        next.splice(to, 0, it);
        if (next[0].join === 'smooth') next[0] = { ...next[0], join: 'cut' };
        return next;
      });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [lay, scale, seek, setClips]); // eslint-disable-line react-hooks/exhaustive-deps

  const trimRef = useRef(null); // { id, edge } while a handle is held
  const onHandle = useCallback((e, c, edge) => {
    e.stopPropagation(); e.preventDefault();
    setPlaying(false);
    setPps((p) => p ?? scale);
    const x0 = e.clientX, orig = c[edge];
    trimRef.current = { id: c.id, edge };
    document.body.classList.add('ed-trimming');
    const move = (ev) => {
      const v = orig + (ev.clientX - x0) / scale;
      setClips((list) => list.map((x) => {
        if (x.id !== c.id) return x;
        if (edge === 'in') return { ...x, in: +Math.max(0, Math.min(x.out - MIN_CLIP, v)).toFixed(3) };
        return { ...x, out: +Math.max(x.in + MIN_CLIP, Math.min(x.dur || x.out, v)).toFixed(3) };
      }));
    };
    const up = () => {
      trimRef.current = null;
      document.body.classList.remove('ed-trimming');
      window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }, [scale, setClips]);
  // while trimming, the preview shows the frame at the edge being moved
  useEffect(() => {
    const tr = trimRef.current; if (!tr) return;
    const c = lay.find((x) => x.id === tr.id); if (!c) return;
    const x = tr.edge === 'out' ? c.start + c.len - 0.04 : c.start;
    clock.set(x); setT(x); sync(x, false);
  }, [lay, sync, clock]);

  // ---------- edit operations ----------
  const addClip = async (src) => {
    setPicker(false);
    const r = await ingestApi([src]).catch(() => null);
    const st = r?.[src];
    const dur = st?.info?.dur || 0;
    if (dur < MIN_CLIP) return;
    setReady((old) => ({ ...old, [src]: st }));
    const id = uid();
    setClips((list) => [...list, { id, src, dur, in: 0, out: dur, join: 'cut' }]);
    setSel(id);
  };
  const splitAt = () => {
    const now = clock.get();
    const c = [...lay].reverse().find((x) => now > x.start + 0.01 && now < x.start + x.len - 0.01);
    if (!c) return;
    const at = +(c.in + (now - c.start)).toFixed(3);
    if (at - c.in < MIN_CLIP || c.out - at < MIN_CLIP) return;
    const id = uid();
    setClips((list) => list.flatMap((x) => (x.id === c.id ? [{ ...x, out: at }, { ...x, id, in: at, join: 'cut' }] : [x])));
    setSel(id);
  };
  const canSplit = lay.some((c) => t - c.start >= MIN_CLIP && c.start + c.len - t >= MIN_CLIP);
  const removeSel = () => {
    const index = clips.findIndex((c) => c.id === sel);
    if (index < 0 || leaving) return;
    const clip = clips[index];
    setSel(null);
    setLeaving(clip.id); // the clip folds away first, then the others close the gap
    const editId = edit.id;
    setTimeout(() => {
      if (editRef.current?.id !== editId) return; // another edit opened meanwhile
      setLeaving(null);
      setGone({ clip, index, key: uid(), editId });
      setClips((list) => {
        const next = list.filter((x) => x.id !== clip.id);
        if (next[0]?.join === 'smooth') next[0] = { ...next[0], join: 'cut' };
        return next;
      });
    }, 190);
  };
  const undoRemove = () => {
    if (!gone) return;
    if (gone.editId !== edit?.id) { setGone(null); return; } // never put edit A's clip into edit B
    const { clip, index } = gone;
    setClips((list) => { const next = list.slice(); next.splice(Math.min(index, next.length), 0, clip); return next; });
    setSel(clip.id); setGone(null);
  };
  const toggleJoin = (id) => setClips((list) => list.map((x) => (x.id === id ? { ...x, join: x.join === 'smooth' ? 'cut' : 'smooth' } : x)));

  // ---------- keys: Space play · S split · ⌫ remove · ← → one frame ----------
  useEffect(() => {
    const key = (e) => {
      if (sheet || menu || xOpen || e.metaKey || e.ctrlKey || e.altKey || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) || keysBlocked(e)) return;
      if (e.key === ' ') { e.preventDefault(); document.activeElement?.blur?.(); toggle(); }
      else if (e.key === 's' || e.key === 'S') { e.preventDefault(); splitAt(); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && sel) { e.preventDefault(); removeSel(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); setPlaying(false); seek(clock.get() - 1 / FPS); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); setPlaying(false); seek(clock.get() + 1 / FPS); }
      else if (e.key === 'Escape') { setSel(null); setPicker(false); }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  });

  // the picker closes on any press outside it
  useEffect(() => {
    if (!picker) return undefined;
    const down = (e) => { if (!e.target.closest('.ed-picker') && !e.target.closest('.ed-add')) setPicker(false); };
    window.addEventListener('pointerdown', down);
    return () => window.removeEventListener('pointerdown', down);
  }, [picker]);

  // ---------- export: options card, then progress inside the button ----------
  const allReady = clips.length > 0 && clips.every((c) => ready[c.src]?.state === 'ready');
  const running = xJob && !['done', 'failed'].includes(xJob.phase);
  useEffect(() => {
    if (!xJob?.id || !running) return undefined;
    let alive = true, lost = 0;
    const poll = async () => {
      const p = await fetch(`/api/edits?progress=${xJob.id}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (!alive) return;
      if (p && p.phase !== 'unknown') { lost = 0; setXJob((j) => ({ ...j, ...p })); return; }
      // server restarted (progress lives in its memory): fall back on the latest job record
      const job = jobsRef.current.find((x) => x.id === xJob.id);
      if (job && job.status !== 'running') { setXJob((j) => ({ ...j, phase: job.status === 'done' ? 'done' : 'failed', error: job.error })); return; }
      // no progress and no finished record for ~6 s: the export died with the server, stop polling
      lost += 1;
      if (lost >= 15) setXJob((j) => ({ ...j, phase: 'failed', error: 'Export stopped (the board server restarted)' }));
    };
    const timer = setInterval(poll, 400);
    poll();
    return () => { alive = false; clearInterval(timer); };
  }, [xJob?.id, running]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (xJob?.phase !== 'done' && xJob?.phase !== 'failed') return undefined;
    const tm = setTimeout(() => setXJob(null), xJob.phase === 'done' ? 2800 : 6000);
    return () => clearTimeout(tm);
  }, [xJob?.phase]);
  const startExport = useCallback(async () => {
    if (!clips.length || running) return;
    setXOpen(false);
    flush();
    await new Promise((r) => setTimeout(r, 150));
    setXJob({ id: null, phase: 'clips', p: 0 });
    const r = await api({ action: 'export', id: edit.id, options: xOpts }).catch(() => ({}));
    if (r.job) setXJob({ id: r.job, phase: 'clips', p: 0 });
    else setXJob({ id: null, phase: 'failed', error: r.error || 'Export failed' });
  }, [clips.length, running, flush, edit?.id, xOpts]); // eslint-disable-line react-hooks/exhaustive-deps
  const xState = !xJob ? 'idle' : xJob.phase === 'done' ? 'done' : xJob.phase === 'failed' ? 'failed' : 'running';
  const xLabel = {
    idle: 'Export',
    running: `${xJob?.phase === 'join' ? 'Joining' : 'Exporting'} ${Math.round((xJob?.p || 0) * 100)}%`,
    done: 'Saved to Videos',
    failed: 'Export failed',
  }[xState];

  // ---------- edits menu ----------
  const newEdit = async () => { flush(); const e = await api({ action: 'create' }); await loadList(e.id); };
  const openMenu = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    setMenu({
      x: r.left, y: r.bottom + 6,
      items: [
        ...(edits || []).slice(0, 12).map((x) => ({ label: `${x.id === edit.id ? '✓ ' : ''}${x.title}`, onClick: () => { flush(); loadList(x.id); } })),
        { sep: true },
        { label: 'New Edit', onClick: newEdit },
        { label: 'Rename…', onClick: () => setSheet({ title: 'Rename Edit', input: edit.title, confirm: 'Rename', onSubmit: (title) => { change(() => ({ title: title.trim() || edit.title })); setEdits((l) => l.map((x) => (x.id === edit.id ? { ...x, title } : x))); } }) },
        { sep: true },
        { label: 'Delete Edit', danger: true, onClick: async () => { pendingSave.current = null; await api({ action: 'delete', id: edit.id }); loadList(); } },
      ],
    });
  };

  if (!edit) return <section className="page"><PageTop kicker="Video" title="Edit" /></section>;

  const selClip = lay.find((c) => c.id === sel);
  const pickable = videos.filter((v) => v.file && /\.(mp4|mov|webm)$/i.test(v.file) && v.job.status === 'done');
  const preparing = clips.filter((c) => ready[c.src]?.state && !['ready', 'error', 'missing'].includes(ready[c.src].state)).length;

  return (
    <section className="page ed-page">
      <PageTop
        kicker="Video"
        title={edit.title}
        chips={<>
          <span className="chip chip-count">{clips.length} {clips.length === 1 ? 'clip' : 'clips'}</span>
          <span className="chip ed-dur">{timecode(total)}</span>
          {preparing > 0 && <span className="chip ed-prep" key="prep"><i className="ed-spin" />Preparing {preparing}</span>}
        </>}
        right={(
          <div className="glass-bar ed-bar" role="toolbar" aria-label="Edit">
            <button className="fsel-btn" onClick={openMenu}><Ico n="list" />Edits</button>
            <button className="fsel-btn" onClick={newEdit}><Ico n="plus" />New</button>
            <button
              className={`fsel-btn ed-export is-${xState}${xOpen ? ' open' : ''}`}
              onClick={() => (xState === 'idle' ? setXOpen((o) => !o) : null)}
              disabled={!clips.length || (!allReady && xState === 'idle')}
              title={xState === 'failed' ? xJob?.error || 'Export failed' : !allReady ? 'Waiting for clips to be ready' : 'Export options'}
              aria-expanded={xOpen}
            >
              <span className="ed-export-fill" aria-hidden="true" style={{ transform: `scaleX(${xState === 'running' ? Math.max(0.02, xJob?.p || 0) : 0})` }} />
              <span className="fsel-label" key={xState}>
                <Ico n={xState === 'done' ? 'check' : 'export'} />
                <span className="ed-xl">{xLabel}</span>
                {xState === 'idle' && <span className="ed-chev"><Ico n="chev" /></span>}
              </span>
            </button>
            {xOpen && (
              <ExportCard opts={xOpts} setOpts={setXOpts} info={firstInfo} total={total} onGo={startExport} onClose={() => setXOpen(false)} />
            )}
          </div>
        )}
      />

      {/* preview: black stage at the edit's own shape */}
      <div className={`ed-stage${clips.length ? '' : ' is-empty'}`} ref={stage} onClick={toggle}>
        {!clips.length && (
          <EmptyStack icon={<EditMark />} title="No clips yet" text={pickable.length ? 'Press + on the timeline to add your first clip.' : 'Ask Claude in Claude Code for a video. It lands here to edit.'} />
        )}
        <div className="ed-screen" style={{ aspectRatio: aspect }}>
          {Array.from({ length: SLOTS }, (_, s) => (
            <video
              key={s}
              ref={(el) => { slotRefs.current[s] = el; }}
              className="ed-video"
              playsInline
              preload="auto"
              onLoadedData={() => { if (!playing) sync(clock.get(), false); }}
            />
          ))}
        </div>
      </div>

      {/* transport */}
      <div className="ed-transport">
        <button className="ed-tbtn" onClick={() => setMuted((m) => !m)} aria-label={muted ? 'Unmute' : 'Mute'} title={muted ? 'Unmute' : 'Mute'}><Ico n={muted ? 'mute' : 'sound'} /></button>
        <TimeText clock={clock} />
        <button className="ed-tbtn" onClick={() => jump(-1)} disabled={!clips.length} aria-label="Previous clip" title="Previous clip"><Ico n="prev" /></button>
        <button className="ed-play" onClick={toggle} disabled={!clips.length} aria-label={playing ? 'Pause' : 'Play'} title={playing ? 'Pause (Space)' : 'Play (Space)'}>
          <span key={playing ? 'pause' : 'play'}><Ico n={playing ? 'pause' : 'play'} /></span>
        </button>
        <button className="ed-tbtn" onClick={() => jump(1)} disabled={!clips.length} aria-label="Next clip" title="Next clip"><Ico n="next" /></button>
        <span className="ed-time dim">{timecode(total)}</span>
        <button className="ed-tbtn" onClick={fullscreen} disabled={!clips.length} aria-label="Full screen" title="Full screen"><Ico n="full" /></button>
        <button className={`ed-tbtn${loop ? ' on' : ''}`} onClick={() => setLoop((l) => !l)} aria-pressed={loop} aria-label="Loop" title="Loop"><Ico n="loop" /></button>
      </div>

      {/* timeline */}
      <div className="ed-timeline">
        <div className="ed-tools">
          <div className="ed-tools-left">
            <button className="fsel-btn" onClick={splitAt} disabled={!canSplit} title="Split at the playhead (S)"><Ico n="split" />Split</button>
            <button className="fsel-btn danger" onClick={removeSel} disabled={!selClip} title="Remove clip (⌫)"><Ico n="trash" />Remove</button>
            {selClip && (
              <span className="ed-sel-info" key={selClip.id}>{timecode(selClip.len)} · from {timecode(selClip.in)}</span>
            )}
          </div>
          <div className="ed-tools-right">
            <button className="fsel-btn icon" onClick={() => zoom(1 / 1.4)} aria-label="Zoom out" title="Zoom out"><Ico n="zoomOut" /></button>
            <button className="fsel-btn icon" onClick={() => zoom(1.4)} aria-label="Zoom in" title="Zoom in"><Ico n="zoomIn" /></button>
          </div>
        </div>

        <div className="ed-scroller" ref={scroller} onPointerDown={scrub}>
          <div className="ed-canvas" style={{ width: span * scale + 24 }}>
            <div className="ed-ruler">
              {Array.from({ length: Math.floor(span / tickEvery) + 1 }, (_, k) => k * tickEvery).map((s) => (
                <span key={s} className="ed-tick" style={{ left: s * scale }}><b>{String(s).padStart(2, '0')}</b></span>
              ))}
            </div>
            <div className="ed-track" style={{ height: TRACK_H + 8 }}>
              {lay.map((c) => (
                <Clip
                  key={c.id} c={c} pps={scale} selected={sel === c.id}
                  dragX={drag?.id === c.id ? drag.dx : null} leaving={leaving === c.id}
                  ready={ready[c.src]} onDown={onClipDown} onHandle={onHandle}
                />
              ))}
              {/* the seam between two clips: cut ⇄ smooth */}
              {lay.slice(1).map((c) => (
                <button
                  key={`j-${c.id}`}
                  className={`ed-join ${c.join}${drag || leaving ? ' hide' : ''}`}
                  style={{ left: (c.start + c.d / 2) * scale }}
                  onPointerDown={(e) => e.stopPropagation()}
                  onClick={() => toggleJoin(c.id)}
                  title={c.join === 'smooth' ? `Smooth · ${c.d.toFixed(1)} s dissolve — click for a cut` : 'Cut — click for a smooth dissolve'}
                  aria-label={c.join === 'smooth' ? 'Smooth join' : 'Cut join'}
                >
                  <span key={c.join}><Ico n={c.join === 'smooth' ? 'smooth' : 'cut'} /></span>
                </button>
              ))}
              {drag && (() => {
                const others = lay.filter((o) => o.id !== drag.id);
                const x = drag.to >= others.length ? (others.length ? others[others.length - 1].start + others[others.length - 1].len : 0) : others[drag.to].start;
                return <span className="ed-drop" style={{ left: x * scale }} />;
              })()}
              <div className="ed-add-wrap" style={{ left: total * scale + 10 }}>
                <button className={`ed-add${picker ? ' on' : ''}`} onPointerDown={(e) => e.stopPropagation()} onClick={() => setPicker((p) => !p)} aria-label="Add clip" title="Add clip">
                  <Ico n="plus" />
                </button>
              </div>
            </div>
            <Playhead clock={clock} scale={scale} />
          </div>
        </div>

        {picker && (
          <div className="ed-picker" role="dialog" aria-label="Add a clip">
            <div className="ed-picker-head">Add a clip <span>{pickable.length} {pickable.length === 1 ? 'video' : 'videos'}</span></div>
            {pickable.length ? (
              <div className="ed-picker-grid">
                {pickable.map((v, k) => (
                  <button key={v.file} className="ed-pick" style={{ '--i': Math.min(k, 12) }} onClick={() => addClip(v.file)} title={v.job.prompt || v.file}>
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={frameUrl(v.file, 1, ready[v.file]?.v || '', 180)} alt="" draggable={false} onLoad={(e) => e.currentTarget.classList.add('in')} />
                    <span>{(v.job.prompt || v.file.split('/').pop()).replace(/^Edit · /, '')}</span>
                  </button>
                ))}
              </div>
            ) : <p className="ed-picker-none">No videos yet. Ask Claude in Claude Code; new videos show up here.</p>}
          </div>
        )}
      </div>

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {sheet && <Sheet {...sheet} onClose={() => setSheet(null)} />}
      {gone && <UndoPill key={gone.key} label="Clip removed" nowLabel="Done" onUndo={undoRemove} onDone={() => setGone(null)} />}
    </section>
  );
}
