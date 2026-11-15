'use client';

// One equal-size card per output.
// Running: the whole card is the progress (fill panel + line + big %), with live seconds.
// Done: the image reveals blurred-to-sharp from the top, the way ChatGPT shows a new image.
// Delete: the image breaks into coloured dust that drifts away (canvas), then the card closes.

import { useEffect, useRef, useState } from 'react';

const isVideo = (f) => /\.(mp4|mov|webm)$/i.test(f);
export const fileUrl = (f) => `/api/file?p=${encodeURIComponent(f)}`;
export const engineLabel = (job) => ({ codex: 'ChatGPT', blender: 'Blender', edit: 'Edit' }[job.engine] || 'Google Flow');

export function seconds(job, now = Date.now()) {
  const start = new Date(job.createdAt).getTime();
  const end = job.finishedAt ? new Date(job.finishedAt).getTime() : now;
  return Math.max(0, Math.round((end - start) / 1000));
}

export function formatSeconds(s) {
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  return `${m}m ${String(s % 60).padStart(2, '0')}s`;
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = Math.max(1, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.round(s / 60)}m ago`;
  if (s < 86400) return `${Math.round(s / 3600)}h ago`;
  return new Date(iso).toLocaleDateString();
}

// ---------- progress (running / failed) ----------

function useNow(active) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (!active) return undefined;
    const t = setInterval(() => setNow(Date.now()), 250);
    return () => clearInterval(t);
  }, [active]);
  return now;
}

// Smooth estimate: approaches 95 % around the expected time, never claims done early.
function estimate(elapsed, expected) {
  return Math.min(95, Math.round(100 * (1 - Math.exp((-1.4 * elapsed) / Math.max(10, expected)))));
}

function ProgressLine({ pct, failed }) {
  const ref = useRef(null);
  useEffect(() => {
    let raf;
    const path = ref.current;
    const draw = (t) => {
      const tip = pct; // 0–100 in viewBox units
      const pts = [];
      for (let x = 0; x <= tip; x += 0.5) {
        const near = Math.max(0, 1 - (tip - x) / (failed ? 7 : 22)); // only the last stretch moves
        const amp = failed ? 24 * near * near : 1.4 * near;
        const freq = failed ? 1.25 : 0.55;
        const phase = failed ? t / 260 : t / 180;
        const y = 50 + amp * Math.sin(x * freq - phase);
        pts.push(`${x.toFixed(2)},${y.toFixed(2)}`);
      }
      path.setAttribute('d', `M${pts.join(' L')}`);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [pct, failed]);
  return (
    <svg className="pg-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
      <path ref={ref} vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function Progress({ job, expected }) {
  const failed = job.status === 'failed';
  const now = useNow(!failed);
  const elapsed = seconds(job, now);
  // a job that reports real progress (Blender renders: frames saved + samples) shows that, never the guess;
  // 99 % at most until the job says done (the MP4 is still being joined after the last frame)
  const real = job.progress && job.progress.total ? job.progress : null;
  const pct = failed ? (job.lastPct ?? (real ? Math.round(real.frac * 100) : 64))
    : real ? Math.min(99, Math.round(real.frac * 100)) : estimate(elapsed, expected);
  const left = real && real.frac >= 0.02 && real.frac < 1 ? (elapsed * (1 - real.frac)) / real.frac : null;
  return (
    <div className={`pg${failed ? ' pg-failed' : ''}`} title={failed ? job.error || 'Failed' : undefined}>
      <div className="pg-fill" style={{ width: `${pct}%` }} />
      <div className="pg-pct"><span>{pct}</span><i>%</i></div>
      <ProgressLine pct={pct} failed={failed} />
      <div className="pg-foot">
        {failed ? (
          <span className="pg-chip">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 4.5v4M8 11v.5" /><circle cx="8" cy="8" r="6.2" /></svg>
            Failed
          </span>
        ) : (
          <span className="pg-chip">
            {real && real.total > 1 ? <b>{real.done}/{real.total} frames</b> : <b>{formatSeconds(elapsed)}</b>}
            {left != null ? ` · ~${formatSeconds(Math.max(1, Math.round(left)))} left` : ` · ${job.type === 'video' || real ? 'Rendering' : 'Generating'}`}
          </span>
        )}
      </div>
    </div>
  );
}

// ---------- dust delete ----------
// The disintegration lives in Dust.js (one concept, one file); re-exported for FolderView.

import { dust } from '@/components/Dust';

export { dust };

// ---------- card ----------

export default function JobCard({ job, file, expected, reveal, onOpen, onDelete, label }) {
  const mediaRef = useRef(null);
  const [state, setState] = useState('idle'); // idle | waiting | dusting | closing
  const [left, setLeft] = useState(5);
  const wait = useRef([]);
  useEffect(() => () => wait.current.forEach(clearTimeout), []);

  const burn = () => {
    setState('dusting');
    const finish = () => { setState('closing'); setTimeout(() => onDelete(job, file), 260); };
    if (mediaRef.current && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) dust(mediaRef.current, finish);
    else finish();
  };

  // Quick undo (law 16): the trash button turns into an "Undo 5" pill on the card; dust only at 0.
  const remove = (e) => {
    e.stopPropagation();
    if (state === 'waiting') { wait.current.forEach(clearTimeout); wait.current = []; setState('idle'); return; }
    if (state !== 'idle') return;
    setState('waiting'); setLeft(5);
    for (let i = 1; i < 5; i++) wait.current.push(setTimeout(() => setLeft(5 - i), i * 1000));
    wait.current.push(setTimeout(burn, 5000));
  };
  // Delete now: skip the rest of the countdown, same dust.
  const now = (e) => {
    e.stopPropagation();
    if (state !== 'waiting') return;
    wait.current.forEach(clearTimeout); wait.current = [];
    burn();
  };

  const showProgress = job.status === 'running' || (job.status === 'failed' && !file);

  return (
    <article className={`card card-${state}`}>
      <div className="card-media">
        {showProgress ? <Progress job={job} expected={expected} /> : file && (
          <div className={`reveal${reveal ? ' reveal-play' : ''}`} onClick={() => onOpen({ job, file })}>
            {isVideo(file) ? (
              <video ref={mediaRef} src={fileUrl(file)} muted loop playsInline autoPlay crossOrigin="anonymous" />
            ) : (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                {reveal && <img className="reveal-blur" src={fileUrl(file)} alt="" aria-hidden="true" />}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img ref={mediaRef} className="reveal-sharp" src={fileUrl(file)} alt="" />
              </>
            )}
          </div>
        )}
        {(file || job.status === 'failed') && (
          <div className="card-acts">
          {state === 'waiting' && (
            <button className="trash-now" aria-label="Delete now" title="Delete now" onClick={now}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" /></svg>
              <span>Delete now</span>
            </button>
          )}
          <button className={`trash${state === 'waiting' ? ' is-undo' : ''}`} aria-label={state === 'waiting' ? 'Undo delete' : 'Delete'} onClick={remove}>
            {state === 'waiting' ? (
              <span className="trash-undo" key="undo">
                <span className="trash-sweep" aria-hidden="true" />
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.25a3.75 3.75 0 0 1 0 7.5H6" /></svg>
                Undo<b key={left}>{left}</b>
              </span>
            ) : (
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M4.5 6h11M8.2 6V4.6c0-.4.3-.7.7-.7h2.2c.4 0 .7.3.7.7V6M6 6l.7 9.3c.1.8.7 1.4 1.5 1.4h3.6c.8 0 1.4-.6 1.5-1.4L14 6M8.6 9v4.6M11.4 9v4.6" />
              </svg>
            )}
          </button>
          </div>
        )}
      </div>
      <div className="meta">
        <p className="prompt" title={job.prompt}>{label || job.prompt}</p>
        <div className="tags">
          <span className="tag">{engineLabel(job)}</span>
          {job.status !== 'running' && job.finishedAt && <span className="tag tag-time">{formatSeconds(seconds(job))}</span>}
          {job.cost != null && <span className="tag">{job.cost} cr</span>}
          <time dateTime={job.createdAt}>{timeAgo(job.finishedAt || job.createdAt)}</time>
        </div>
      </div>
    </article>
  );
}
