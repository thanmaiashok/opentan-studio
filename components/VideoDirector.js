'use client';

// Video Director (law 25, owner 2026-11-14: "same as art director, but for videos"): every video studio of the
// the classic video studios, in Art Direction's two views — Glance (a column per group, everything on one screen, text
// only: no videos, owner 2026-11-14)
// and Map (a framed region per group, roomy cards with the rule, every owner word that picks the studio
// (`studio vdirect`) and its latest videos, which play on hover). A card opens that studio's gallery.
// Built from library/video-studios.json.

import { useEffect, useState } from 'react';
import PageTop from '@/components/PageTop';
import { smooth } from '@/lib/motion';
import { fileUrl } from '@/components/JobCard';
import { VIDEO_STUDIOS, VIDEO_GROUPS, StudioIcon, studioOf } from '@/components/VideoStudio';

// one line per group, for the Map's region labels
const GROUP_NOTE = {
  Create: 'One shot from words or a still.',
  People: 'A face, a voice, a persona.',
  Remix: 'One video becomes many.',
  Business: 'Ads and clips that sell.',
};

// A still frame that plays, muted, while the pointer is on it.
function Clip({ file }) {
  return (
    <video
      src={`${fileUrl(file)}#t=0.5`} muted playsInline loop preload="metadata"
      onMouseEnter={(e) => { e.currentTarget.play().catch(() => {}); }}
      onMouseLeave={(e) => { const v = e.currentTarget; v.pause(); v.currentTime = 0.5; }}
    />
  );
}

// Glance shows as many words as fit one line of a card (~30 letters) and counts the rest, so "+N" never wraps alone.
function fit(words, room = 30) {
  const out = [];
  let used = 0;
  for (const w of words) {
    if (out.length && used + w.length > room) break;
    out.push(w); used += w.length + 3;
  }
  return out;
}

function MapCard({ s, mine, onOpen }) {
  return (
    <div
      className={`map-family vd-map-card${s.status === 'none' ? ' is-soon' : ''}`} role="button" tabIndex={0}
      onClick={() => onOpen(s.id)} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(s.id); } }}
    >
      <header>
        <h3>
          <span className="vd-name"><StudioIcon name={s.icon} />{s.label}</span>
          {mine.length > 0 ? <span className="vd-count">{mine.length}</span> : s.status === 'none' ? <i className="vd-soon">Soon</i> : null}
        </h3>
        <p>{s.what}</p>
        <p className="map-words">{s.words.map((w) => <span key={w}>{w}</span>)}</p>
      </header>
      {mine.length > 0 && (
        <div className="vd-map-thumbs">
          {mine.slice(0, 6).map((t) => <span key={t.file} className="vd-thumb"><Clip file={t.file} /></span>)}
        </div>
      )}
    </div>
  );
}

export default function VideoDirector({ tiles = [], onOpen }) {
  const by = {};
  for (const t of tiles) (by[studioOf(t.job)] ||= []).push(t);
  const soon = VIDEO_STUDIOS.filter((s) => s.status === 'none').length;
  const [view, setView] = useState('glance');
  useEffect(() => { try { const v = localStorage.getItem('video-view'); if (v === 'map' || v === 'glance') setView(v); } catch {} }, []);
  const pickView = (v) => { smooth(() => setView(v)); try { localStorage.setItem('video-view', v); } catch {} };
  const mineOf = (id) => (by[id] || []).filter((t) => t.file);
  return (
    <section className={`page vd-page view-${view}`}>
      <PageTop
        kicker="Video"
        title="Video Director"
        chips={<>
          <span className="chip chip-count">{VIDEO_STUDIOS.length} studios</span>
          <span className="chip">{VIDEO_GROUPS.length} groups</span>
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
          {VIDEO_GROUPS.map((g) => (
            <div key={g} className="map-region">
              <div className="map-region-label"><strong>{g}</strong><span>{GROUP_NOTE[g]}</span></div>
              <div className="map-families">
                {VIDEO_STUDIOS.filter((s) => s.group === g).map((s) => <MapCard key={s.id} s={s} mine={mineOf(s.id)} onOpen={onOpen} />)}
              </div>
            </div>
          ))}
        </div>
      ) : (
      <div className="vd-glance">
        {VIDEO_GROUPS.map((g) => {
          const list = VIDEO_STUDIOS.filter((s) => s.group === g);
          return (
            <section key={g} className="glance-region" aria-label={g}>
              <header className="glance-region-head"><strong>{g}</strong><span>{list.length}</span></header>
              <div className="glance-families">
                {list.map((s) => {
                  const mine = mineOf(s.id);
                  return (
                    <button key={s.id} className={`glance-family vd-card${s.status === 'none' ? ' is-soon' : ''}`} onClick={() => onOpen(s.id)}>
                      <span className="glance-family-head">
                        <span className="vd-name"><StudioIcon name={s.icon} />{s.label}</span>
                        {mine.length > 0 ? <em>{mine.length}</em> : s.status === 'none' ? <i className="vd-soon">Soon</i> : null}
                      </span>
                      <span className="vd-rule">{s.what}</span>
                      <span className="map-words vd-words">
                        {fit(s.words).map((w) => <span key={w}>{w}</span>)}
                        {s.words.length > fit(s.words).length && <em>+{s.words.length - fit(s.words).length}</em>}
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
