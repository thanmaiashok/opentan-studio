'use client';

// 3D Director (law 32, owner 2026-11-14: "art director, video director … in 3D … we are going to name it as 3D
// Director"): our shot types as 3D studios, in the same two views as Video Director — Glance (a column per
// group, text only) and Map (framed regions, every owner word that picks the studio via `studio ddirect`, its latest
// renders). A card opens that studio's gallery (ModelStudio): only the renders made with `studio shot <id>`.
// Built from library/3d-studios.json. Same CSS as Video Director (vd-*), so the two pages read as one family.

import { useEffect, useState } from 'react';
import PageTop from '@/components/PageTop';
import EmptyStack from '@/components/EmptyStack';
import { smooth } from '@/lib/motion';
import { fileUrl } from '@/components/JobCard';
import DATA from '@/library/3d-studios.json';

export const MODEL_STUDIOS = DATA.studios;
export const MODEL_GROUPS = DATA.groups;
export const modelStudioOf = (job) => job.studio || null; // untagged renders belong to no studio page

const GROUP_NOTE = {
  Product: 'The product, shown at its best.',
  'Light & Camera': 'How light and lens move.',
  'World & Type': 'Where it stands; words in metal.',
  Effects: 'Real-looking air and matter.',
};

const isVideo = (f) => /\.(mp4|mov|webm)$/i.test(f);

// Line icons, 20×20, same stroke as the sidebar.
export function ModelStudioIcon({ name }) {
  const p = {
    render: <><path d="M3 6.5V4.8c0-1 .8-1.8 1.8-1.8h1.7M13.5 3h1.7c1 0 1.8.8 1.8 1.8v1.7M17 13.5v1.7c0 1-.8 1.8-1.8 1.8h-1.7M6.5 17H4.8c-1 0-1.8-.8-1.8-1.8v-1.7" /><circle cx="10" cy="10" r="3.4" /></>,
    sweep: <><circle cx="10" cy="11" r="4.2" /><path d="M3 4.5l14 0M3 4.5l2.2 3M17 4.5l-2.2 3" /></>,
    turntable: <><ellipse cx="10" cy="14.5" rx="6.5" ry="2" /><path d="M10 4.5l3.2 1.8v3.6L10 11.7 6.8 9.9V6.3z" /><path d="M15.2 11.4l1.3 1.1-1.6.6" /></>,
    orbit: <><circle cx="10" cy="10" r="2.4" /><path d="M3.2 12.6c1.4 2.4 4 3.9 6.8 3.9s5.4-1.5 6.8-3.9" /><path d="M14.8 15.2l2-2.6.2 3" /></>,
    exploded: <><rect x="7.5" y="7.5" width="5" height="5" rx="1" /><path d="M5 5l1.6 1.6M15 5l-1.6 1.6M5 15l1.6-1.6M15 15l-1.6-1.6" /><rect x="2.6" y="2.6" width="2.4" height="2.4" rx=".6" /><rect x="15" y="15" width="2.4" height="2.4" rx=".6" /></>,
    macro: <><circle cx="8.5" cy="8.5" r="4.8" /><path d="M12 12l4.8 4.8" /><circle cx="8.5" cy="8.5" r="1.6" /></>,
    fpv: <><path d="M3 13.5c3-1 5.5-3.6 7-7 1.5 3.4 4 6 7 7" /><path d="M10 6.5v7.5" /><circle cx="10" cy="15.5" r="1.4" /></>,
    studio: <><path d="M3 15.5h14M5 15.5V8.5l5-3 5 3v7" /><path d="M7.5 4.2h5" /></>,
    sun: <><circle cx="10" cy="12.5" r="3" /><path d="M2.5 15.5h15M10 5.5v1.6M4.8 7.6l1.1 1.1M15.2 7.6l-1.1 1.1" /></>,
    motes: <><circle cx="6" cy="7" r="1" /><circle cx="12.5" cy="5.5" r=".8" /><circle cx="14.5" cy="11.5" r="1.2" /><circle cx="8" cy="13.5" r=".9" /><circle cx="10.5" cy="9.5" r=".6" /></>,
    spark: <><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" /></>,
    voxels: <><rect x="4" y="9" width="4" height="4" rx=".6" /><rect x="9" y="9" width="4" height="4" rx=".6" /><rect x="12" y="4.5" width="3" height="3" rx=".5" /><rect x="15.5" y="2.5" width="2" height="2" rx=".4" /></>,
    haze: <><path d="M4 3.5l3 13M9 3.5l2 13M14 3.5l1 13" /></>,
    type: <><path d="M4.5 5h11M10 5v11M7.5 16h5" /></>,
  }[name] || <circle cx="10" cy="10" r="6" />;
  return <svg viewBox="0 0 20 20" aria-hidden="true">{p}</svg>;
}

function Thumb({ file }) {
  return isVideo(file) ? (
    <video
      src={`${fileUrl(file)}#t=0.5`} muted playsInline loop preload="metadata"
      onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }}
      onMouseLeave={(e) => { const v = e.currentTarget; v.pause(); v.currentTime = 0.5; }}
    />
  // eslint-disable-next-line @next/next/no-img-element
  ) : <img src={`/api/thumb?p=${encodeURIComponent(file)}`} alt="" />;
}

function fit(words, room = 30) {
  const out = [];
  let used = 0;
  for (const w of words) {
    if (out.length && used + w.length > room) break;
    out.push(w); used += w.length + 3;
  }
  return out;
}

const soonOf = (s) => s.status === 'none';
const badge = (s, n) => (n > 0 ? null : soonOf(s) ? <i className="vd-soon">Soon</i> : s.kind === 'env' || s.kind === 'fx' ? <i className="vd-soon">Add-on</i> : null);

function MapCard({ s, mine, onOpen }) {
  return (
    <div
      className={`map-family vd-map-card${soonOf(s) ? ' is-soon' : ''}`} role="button" tabIndex={0}
      onClick={() => onOpen(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(s.id); } }}
    >
      <header>
        <h3>
          <span className="vd-name"><ModelStudioIcon name={s.icon} />{s.label}</span>
          {mine.length > 0 ? <span className="vd-count">{mine.length}</span> : badge(s, 0)}
        </h3>
        <p>{s.what}</p>
        <p className="map-words">{s.words.map((w) => <span key={w}>{w}</span>)}</p>
      </header>
      {mine.length > 0 && (
        <div className="vd-map-thumbs">
          {mine.slice(0, 6).map((t) => <span key={t.file} className="vd-thumb"><Thumb file={t.file} /></span>)}
        </div>
      )}
    </div>
  );
}

export default function ModelDirector({ tiles = [], onOpen }) {
  const by = {};
  for (const t of tiles) { const id = modelStudioOf(t.job); if (id) (by[id] ||= []).push(t); }
  const ready = MODEL_STUDIOS.filter((s) => s.status === 'ready').length;
  const soon = MODEL_STUDIOS.filter(soonOf).length;
  const [view, setView] = useState('glance');
  useEffect(() => { try { const v = localStorage.getItem('model-view'); if (v === 'map' || v === 'glance') setView(v); } catch {} }, []);
  const pickView = (v) => { smooth(() => setView(v)); try { localStorage.setItem('model-view', v); } catch {} };
  const mineOf = (id) => (by[id] || []).filter((t) => t.file);
  return (
    <section className={`page vd-page md-page view-${view}`}>
      <PageTop
        kicker="3D"
        title="3D Director"
        chips={<>
          <span className="chip chip-count">{MODEL_STUDIOS.length} studios</span>
          <span className="chip">{ready} ready</span>
          <span className="chip">{soon} coming soon</span>
        </>}
        right={(
          <div className="glass-bar" role="toolbar" aria-label="View">
            <div className="tabs" role="group" aria-label="Layout">
              <button className="tab" aria-pressed={view === 'glance'} onClick={() => pickView('glance')}>Glance</button>
              <button className="tab" aria-pressed={view === 'map'} onClick={() => pickView('map')}>Map</button>
            </div>
          </div>
        )}
      />
      {view === 'map' ? (
        <div className="map-canvas vd-map">
          {MODEL_GROUPS.map((g) => (
            <div key={g} className="map-region">
              <div className="map-region-label"><strong>{g}</strong><span>{GROUP_NOTE[g]}</span></div>
              <div className="map-families">
                {MODEL_STUDIOS.filter((s) => s.group === g).map((s) => <MapCard key={s.id} s={s} mine={mineOf(s.id)} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="vd-glance md-glance">
          {MODEL_GROUPS.map((g) => {
            const list = MODEL_STUDIOS.filter((s) => s.group === g);
            return (
              <section key={g} className="glance-region" aria-label={g}>
                <header className="glance-region-head"><strong>{g}</strong><span>{list.length}</span></header>
                <div className="glance-families">
                  {list.map((s) => {
                    const mine = mineOf(s.id);
                    const shown = fit(s.words);
                    return (
                      <button key={s.id} className={`glance-family vd-card${soonOf(s) ? ' is-soon' : ''}`} onClick={() => onOpen(s.id)}>
                        <span className="glance-family-head">
                          <span className="vd-name"><ModelStudioIcon name={s.icon} />{s.label}</span>
                          {mine.length > 0 ? <em>{mine.length}</em> : badge(s, 0)}
                        </span>
                        <span className="vd-rule">{s.what}</span>
                        <span className="map-words vd-words">
                          {shown.map((w) => <span key={w}>{w}</span>)}
                          {s.words.length > shown.length && <em>+{s.words.length - shown.length}</em>}
                        </span>
                      </button>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </section>
  );
}

// One 3D studio page: the gallery of renders made with `studio shot <id>`, nothing else (same rule as video, law 25).
export function ModelStudio({ studio: s, tiles = [], render, onBack }) {
  const kicker = <><button onClick={onBack}>3D Director</button><span>›</span>{s.group}</>;
  const n = tiles.filter((t) => t.file).length;
  if (!tiles.length) {
    return (
      <section className="page">
        <PageTop kicker={kicker} title={s.label} />
        <EmptyStack key={s.id} icon={<ModelStudioIcon name={s.icon} />} title={`No ${s.label.toLowerCase()} shots yet`}
          text={soonOf(s) ? 'Not built yet. Ask Claude in Claude Code when you want it.' : 'Ask Claude in Claude Code. What it renders here lands on its own.'} />
      </section>
    );
  }
  return (
    <section className="page gallery-page">
      <PageTop kicker={kicker} title={s.label} chips={<span className="chip chip-count">{n} {n === 1 ? 'render' : 'renders'}</span>} />
      <div className="grid grid-inline grid-wide">{tiles.map(render)}</div>
    </section>
  );
}
