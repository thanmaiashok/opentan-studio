'use client';

// One Video studio page (law 25): a gallery of the videos Claude made in that studio, nothing else.
// Everything runs from Claude Code, so the board only shows results (owner 2026-11-14). What each studio
// takes in, its engine and options live in library/video-studios.json for Claude, never on the page.

import PageTop from '@/components/PageTop';
import EmptyStack from '@/components/EmptyStack';
import DATA from '@/library/video-studios.json';

export const VIDEO_STUDIOS = DATA.studios;
export const VIDEO_GROUPS = DATA.groups;

// A video job's page: its --studio tag; untagged videos are plain text / image to video.
export const studioOf = (job) => job.studio || 'make';

// Line icons, 20×20, same stroke as the sidebar.
export function StudioIcon({ name }) {
  const p = {
    play: <><rect x="3" y="4.5" width="14" height="11" rx="2.4" /><path d="M8.6 7.7v4.6l3.8-2.3z" /></>,
    aperture: <><circle cx="10" cy="10" r="6.8" /><path d="M10 3.2l2.6 6M16.4 7.6l-6.4 1M14.6 15l-4-5M6.6 15.9l3.4-5.9M3.4 8.4l6.6 1.6" /></>,
    orbit: <><circle cx="10" cy="10" r="2.2" /><ellipse cx="10" cy="10" rx="7" ry="3.2" transform="rotate(-25 10 10)" /><path d="M15.6 5.4l1.2-.6-.3 1.3" /></>,
    mouth: <><path d="M3.5 10c2.2-2.6 4.3-3.2 6.5-1.6 2.2-1.6 4.3-1 6.5 1.6-2 3-4.2 4.2-6.5 4.2S5.5 13 3.5 10z" /><path d="M5.6 10.3c2.9.9 5.9.9 8.8 0" /></>,
    person: <><circle cx="10" cy="7" r="3" /><path d="M4.4 16.4c.8-3 3-4.6 5.6-4.6s4.8 1.6 5.6 4.6" /></>,
    swap: <><path d="M4 7.2h10.4l-2.6-2.6M16 12.8H5.6l2.6 2.6" /></>,
    remix: <><path d="M3.5 6.5h3.2c3.2 0 3.4 7 6.6 7h3.2M3.5 13.5h3.2c1.3 0 2-.9 2.6-2.1M11 8.6c.6-1.2 1.3-2.1 2.6-2.1h3.2" /><path d="M14.8 4.8l1.7 1.7-1.7 1.7M14.8 11.8l1.7 1.7-1.7 1.7" /></>,
    spark: <><path d="M10 3l1.6 4.4L16 9l-4.4 1.6L10 15l-1.6-4.4L4 9l4.4-1.6z" /><path d="M15.2 13.6l.6 1.6 1.6.6-1.6.6-.6 1.6-.6-1.6-1.6-.6 1.6-.6z" /></>,
    megaphone: <><path d="M3.5 8.2v3.6h2.6l6.4 3.4V4.8L6.1 8.2z" /><path d="M6.4 11.8l1 3.8M15 7.6a3.4 3.4 0 0 1 0 4.8" /></>,
    scissors: <><circle cx="5.6" cy="6" r="2.2" /><circle cx="5.6" cy="14" r="2.2" /><path d="M7.5 7.2L16.5 14M7.5 12.8L16.5 6" /></>,
  }[name];
  return <svg viewBox="0 0 20 20" aria-hidden="true">{p}</svg>;
}

export default function VideoStudio({ studio: s, tiles = [], render, onBack }) {
  const kicker = <><button onClick={onBack}>Video Director</button><span>›</span>{s.group}</>;
  const n = tiles.length;
  if (!n) {
    return (
      <section className="page">
        <PageTop kicker={kicker} title={s.label} />
        <EmptyStack key={s.id} icon={<StudioIcon name={s.icon} />} title={`No ${s.label.toLowerCase()} videos yet`} text="Ask Claude in Claude Code. What it makes here lands on its own." />
      </section>
    );
  }
  return (
    <section className="page gallery-page">
      <PageTop kicker={kicker} title={s.label} chips={<span className="chip chip-count">{n} {n === 1 ? 'video' : 'videos'}</span>} />
      <div className="grid grid-inline">{tiles.map(render)}</div>
    </section>
  );
}
