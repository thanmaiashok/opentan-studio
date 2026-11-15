'use client';

// The board. Three segments, Image, Video and 3D (Blender), switched from a Mac-style dock.
// It only shows what Claude made: control happens in Claude Code (bin/studio.mjs).

import ArtMap from '@/components/ArtMap';
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import JobCard, { engineLabel, fileUrl, formatSeconds, seconds } from '@/components/JobCard';
import Intro from '@/components/Intro';
import FolderView from '@/components/FolderView';
import PageTop from '@/components/PageTop';
import { ContextMenu, Sheet, UndoPill } from '@/components/Menu';
import Settings from '@/components/Settings';
import KitView from '@/components/KitView';
import SlidingPills from '@/components/SlidingPills';
import TrashView, { useTrashCount, TrashIcon } from '@/components/TrashView';
import { smooth } from '@/lib/motion';
import EmptyStack from '@/components/EmptyStack';
import VideoStudio, { VIDEO_STUDIOS, StudioIcon, studioOf } from '@/components/VideoStudio';
import VideoDirector from '@/components/VideoDirector';
import ModelDirector, { ModelStudio, MODEL_STUDIOS, modelStudioOf } from '@/components/ModelDirector';
import EditView, { probeDuration } from '@/components/EditView';
import ModelStage from '@/components/ModelStage';

const SEGMENTS = [
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'model', label: '3D' },
];
const IMAGE_MARK = <svg viewBox="0 0 24 24"><rect x="4" y="5" width="16" height="14" rx="3" /><path d="M5 17l4.5-4.5 3 3 2.5-2.5L19.5 17" /><circle cx="9.5" cy="10" r="1.6" /></svg>;
const SEGMENT_PAGE = {
  image: { kicker: 'Image', title: 'Gallery', none: 'No images yet', unit: ['image', 'images'] },
  video: { kicker: 'Video', title: 'Videos', none: 'No videos yet', unit: ['video', 'videos'] },
  model: { kicker: '3D', title: 'All 3D', none: 'No 3D yet', unit: ['item', 'items'] },
};


// ---------- dock ----------

function ImageIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3.5" y="4.5" width="17" height="15" rx="2.5" />
      <circle cx="9" cy="9.5" r="1.7" />
      <path d="M4 17l4.6-4.6a1.4 1.4 0 0 1 2 0L15 16.8M13.5 15.3l1.9-1.9a1.4 1.4 0 0 1 2 0l3 3" />
    </svg>
  );
}

function VideoIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <rect x="3" y="5.5" width="13" height="13" rx="2.5" />
      <path d="M16 10.2l4.1-2.4a.6.6 0 0 1 .9.5v7.4a.6.6 0 0 1-.9.5L16 13.8" />
    </svg>
  );
}

function ModelIcon() {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 3.4l7.6 4.3v8.6L12 20.6l-7.6-4.3V7.7z" />
      <path d="M4.6 7.8L12 12l7.4-4.2M12 12v8.4" />
    </svg>
  );
}

const ICONS = { image: ImageIcon, video: VideoIcon, model: ModelIcon };

function Dock({ active, onSelect, counts }) {
  return (
    <nav className="dock" aria-label="Segments">
      {SEGMENTS.map((s) => {
        const Icon = ICONS[s.id];
        return (
          <button
            key={s.id}
            className="dock-item"
            aria-current={active === s.id ? 'page' : undefined}
            onClick={() => onSelect(s.id)}
          >
            <span className="dock-label">{s.label}{counts[s.id] ? ` · ${counts[s.id]}` : ''}</span>
            <span className={`dock-tile dock-${s.id}`}><Icon /></span>
            <span className="dock-dot" />
          </button>
        );
      })}
    </nav>
  );
}

// ---------- image sidebar ----------

// Pages inside the Image segment. Groups hold sub pages; add new ones here.
const IMAGE_PAGES = [
  { id: 'gallery', label: 'Gallery', icon: 'grid' },
  {
    group: 'Pages',
    items: [
      { id: 'art-direction', label: 'Art Direction', icon: 'compass' },
      { id: 'trash', label: 'Recently Deleted', icon: 'trash' }, // law 22: 1 day here, then the Mac Trash
    ],
  },
];

// Pages inside the Video segment (law 25): compact like Image — All Videos, the Video Director page (every studio
// on one screen, like Art Direction) and the client folders. Studio galleries open from Video Director.
const VIDEO_PAGES = [
  { id: 'videos', label: 'All Videos', icon: 'grid' },
  {
    group: 'Pages',
    items: [
      { id: 'director', label: 'Video Director', icon: 'clapper' },
      { id: 'edit', label: 'Edit', icon: 'edit' }, // law 27: minimal clip editor (cut / smooth)
      { id: 'trash', label: 'Recently Deleted', icon: 'trash' }, // law 22: its own trash, videos only
    ],
  },
];
// Pages inside the 3D segment (law 24, law 33): All 3D (folders + recents), then two pages. Scenes = what a render
// gives back (stills + animations); Models = exported GLBs you can turn in the viewer. No separate Renders page.
const MODEL_PAGES = [
  { id: 'all', label: 'All 3D', icon: 'grid' },
  {
    group: 'Pages',
    items: [
      { id: 'director3d', label: '3D Director', icon: 'clapper' }, // law 32: our shot types as studios
      { id: 'scenes', label: 'Scenes', icon: 'scene' },
      { id: 'models', label: 'Models', icon: 'cube' },
      { id: 'trash', label: 'Recently Deleted', icon: 'trash' }, // law 22: its own trash, 3D only
    ],
  },
];
// What each 3D page holds and how it says so when empty (law 23: one EmptyStack, its own mark).
const MODEL_VIEWS = {
  scenes: { title: 'Scenes', unit: ['scene', 'scenes'], none: 'No scenes yet', text: 'Every render Claude makes in Blender lands here: stills and animations.', test: (j) => j.kind !== 'model' },
  models: { title: 'Models', unit: ['model', 'models'], none: 'No models yet', text: 'Exported models land here. Open one to turn it, zoom and look around.', test: (j) => j.kind === 'model' },
};
const STUDIO_IDS = new Set(VIDEO_STUDIOS.map((st) => st.id));
const MODEL_STUDIO_IDS = new Set(MODEL_STUDIOS.map((st) => `shot:${st.id}`)); // 3D Director studio pages
const DEFAULT_PAGE = { image: 'gallery', video: 'videos', model: 'all' };
const SIDEBAR_SEGMENTS = ['image', 'video', 'model'];
const SEGMENT_PAGES = { image: IMAGE_PAGES, video: VIDEO_PAGES, model: MODEL_PAGES };
const SEGMENT_TITLE = { image: 'Image', video: 'Video', model: '3D' };

function SideIcon({ name }) {
  if (name === 'scene') {
    // a cube standing on a ground plane: a whole scene
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 3.6l4.2 2.4v4.8L10 13.2l-4.2-2.4V6z" /><path d="M5.9 6.1L10 8.4l4.1-2.3M10 8.4v4.7" />
        <path d="M2.8 14.6L10 17.4l7.2-2.8" />
      </svg>
    );
  }
  if (name === 'cube') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2.8l6.3 3.6v7.2L10 17.2l-6.3-3.6V6.4z" /><path d="M3.9 6.5L10 10l6.1-3.5M10 10v7" />
      </svg>
    );
  }
  if (name === 'clapper') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="7.5" width="14" height="9" rx="1.8" /><path d="M3.4 7.4l12.9-3.1.4 1.8M7.3 6.5l1.9 2.6M11.2 5.6l1.9 2.6" />
      </svg>
    );
  }
  if (name === 'edit') {
    // a film strip with one cut through it (law 27)
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.75" y="5" width="14.5" height="10" rx="2.2" /><path d="M10 3.5v13M2.75 8h2.5M2.75 12h2.5M14.75 8h2.5M14.75 12h2.5" />
      </svg>
    );
  }
  if (name === 'trash') return <TrashIcon />;
  if (name === 'folder') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M2.8 6.2c0-1 .8-1.8 1.8-1.8h3.1l1.6 1.7h6.1c1 0 1.8.8 1.8 1.8v6.9c0 1-.8 1.8-1.8 1.8H4.6c-1 0-1.8-.8-1.8-1.8z" />
        <path d="M2.8 8.3h14.4" />
      </svg>
    );
  }
  if (name === 'grid') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3" width="6" height="6" rx="1.5" /><rect x="11" y="3" width="6" height="6" rx="1.5" />
        <rect x="3" y="11" width="6" height="6" rx="1.5" /><rect x="11" y="11" width="6" height="6" rx="1.5" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="7" /><path d="M12.8 7.2l-1.7 4-4 1.7 1.7-4z" />
    </svg>
  );
}

function ArrowIcon({ dir }) {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2.5" />
      <path d="M7.5 4v12" />
      <path d={dir === 'left' ? 'M13.2 8l-2 2 2 2' : 'M11.2 8l2 2-2 2'} />
    </svg>
  );
}

function SideItem({ item, nested, page, onSelect, onFolderMenu, onHover }) {
  return (
    <button
      className={`side-item${nested ? ' nested' : ''}${item.gulp ? ' gulp' : ''}`}
      data-side={item.id}
      onMouseEnter={(e) => onHover?.(e.currentTarget)}
      onFocus={(e) => onHover?.(e.currentTarget)}
      aria-current={page === item.id || (item.id.startsWith('folder:') && page === `kit:${item.id.slice(7)}`) ? 'page' : undefined}
      onClick={() => onSelect(item.id)}
      onContextMenu={item.id.startsWith('folder:') ? (e) => { e.preventDefault(); onFolderMenu?.(item.id.slice(7), e); } : undefined}
    >
      {item.logo ? (
        // a client folder shows the client's own logo (library/clients/<id>/icon.png, law 5)
        // eslint-disable-next-line @next/next/no-img-element
        <span className="side-thumb side-logo"><img src={`/api/file?p=${encodeURIComponent(item.logo)}`} alt="" draggable={false} /></span>
      ) : <SideIcon name={item.icon} />}
      <span className="side-label">{item.label}</span>
      {item.count > 0 && <em className="side-count" key={item.count}>{item.count}</em>}
    </button>
  );
}

function Sidebar({ segment = 'image', page: current, onSelect, open: shown, onToggle, folders = [], onFolderMenu, onNewFolder, counts = {} }) {
  // a studio gallery belongs to Video Director: keep that row lit while one is open
  const page = segment === 'video' && STUDIO_IDS.has(current) ? 'director'
    : segment === 'model' && MODEL_STUDIO_IDS.has(current) ? 'director3d' : current;
  const [open, setOpen] = useState({}); // every group starts open; false = folded
  const trash = useTrashCount(segment); // each segment counts only its own deletes
  const pages = [
    ...SEGMENT_PAGES[segment].map((e) => (e.group ? { ...e, items: e.items.map((it) => (it.id === 'trash' ? { ...it, count: trash.count, gulp: trash.gulp } : { ...it, count: counts[it.id] })) } : e)),
    // same client folders in both segments; in Video they hold that client's videos
    { group: 'Folders', items: folders.map((f) => ({ id: `folder:${f.id}`, label: f.name, icon: 'folder', count: f.count, logo: f.icon })) },
  ];
  const title = SEGMENT_TITLE[segment];

  // Gliding pills (house motion, law 16): one active pill slides to the current page, one soft hover pill
  // follows the pointer from row to row. Both are measured, never hard-coded.
  const nav = useRef(null);
  const place = useCallback(() => {
    const box = nav.current; if (!box) return;
    const on = box.querySelector('.side-item[aria-current="page"]');
    if (!on) { box.classList.remove('has-active'); return; }
    box.style.setProperty('--ay', `${on.offsetTop}px`);
    box.style.setProperty('--ah', `${on.offsetHeight}px`);
    if (!box.classList.contains('has-active')) {
      box.classList.add('has-active');
      setTimeout(() => box.classList.add('pills-ready'), 60); // first placement never slides in
    }
  }, []);
  useLayoutEffect(place);
  // rows can still move after the first paint (sidebar slide-in, fonts, a group folding): measure again then
  useEffect(() => {
    const box = nav.current; if (!box) return undefined;
    const ro = new ResizeObserver(place);
    ro.observe(box);
    document.fonts?.ready.then(place);
    return () => ro.disconnect();
  }, [place]);
  const hover = (el) => {
    const box = nav.current; if (!box || !el) return;
    box.style.setProperty('--hy', `${el.offsetTop}px`);
    box.style.setProperty('--hh', `${el.offsetHeight}px`);
    box.classList.add('hovering');
  };

  // SideItem lives outside Sidebar: a component defined inside would be a new type every render,
  // so React would rebuild every row on each 1.5 s jobs poll (the sidebar flicker).
  // the trash row remounts when something lands, so its lid-open animation plays again
  const item = (it, nested) => <SideItem key={it.gulp ? `${it.id}-${it.gulp}` : it.id} item={it} nested={nested} page={page} onSelect={onSelect} onFolderMenu={onFolderMenu} onHover={hover} />;
  return (
    <aside className={`sidebar${shown ? '' : ' collapsed'}`} aria-label={`${title} pages`} inert={!shown}>
      <div className="side-top">
        <div className="side-title"><img className="side-mark" src="/opentan/opentan-T-flat.svg" alt="" draggable={false} />{title}</div>
        <button className="side-toggle" onClick={onToggle} aria-label="Hide sidebar" title="Hide sidebar (⌘\)" tabIndex={shown ? 0 : -1}>
          <ArrowIcon dir="left" />
        </button>
      </div>
      <nav className="side-nav" ref={nav} onMouseLeave={() => nav.current?.classList.remove('hovering')}>
        <span className="side-pill side-pill-hover" aria-hidden="true" />
        <span className="side-pill side-pill-on" aria-hidden="true" />
        {pages.map((entry) => (entry.group ? (
          <div key={entry.group} className="side-group">
            <div className="side-group-row">
              <button
                className="side-group-head"
                aria-expanded={open[entry.group] !== false}
                onClick={() => setOpen((o) => ({ ...o, [entry.group]: o[entry.group] === false }))}
              >
                {entry.group}
                <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 3l4 3-4 3" /></svg>
              </button>
              {entry.group === 'Folders' && (
                <button className="side-add" onClick={onNewFolder} aria-label="New folder" title="New folder">
                  <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M6 2.5v7M2.5 6h7" /></svg>
                </button>
              )}
            </div>
            {open[entry.group] !== false && entry.items.map((it) => item(it, true))}
          </div>
        ) : item(entry, false)))}
      </nav>
    </aside>
  );
}

// ---------- recents: small cards that keep sliding ----------

const RECENT_W = 168; // card width (px), same column as a folder card; image stays 4:5
const RECENT_GAP = 14;
const SPEED = 28; // px per second

function Recents({ items, render }) {
  const box = useRef(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (box.current) ro.observe(box.current);
    return () => ro.disconnect();
  }, []);
  if (!items.length) return null;
  // Few recents that fit the row: stay still. More than fit: slide in an endless loop.
  const unit = items.length * (RECENT_W + RECENT_GAP) - RECENT_GAP;
  const moving = width > 0 && unit > width;
  const distance = items.length * (RECENT_W + RECENT_GAP);
  const list = moving ? [...items, ...items] : items;
  return (
    <div className={`recents${moving ? '' : ' still'}`} ref={box}>
      <div
        className={`recents-track${moving ? ' moving' : ''}`}
        style={moving ? { '--distance': `${distance}px`, '--duration': `${distance / SPEED}s` } : undefined}
      >
        {list.map((t, i) => (
          // stable key: a new job at the front must not remount every card (a running Undo would be lost)
          <div className="recent" key={`${t.job.id}-${t.file || 'job'}${i >= items.length ? '-b' : ''}`} aria-hidden={i >= items.length ? true : undefined}>
            {render(t)}
          </div>
        ))}
      </div>
    </div>
  );
}

// ---------- gallery ----------

const isVideo = (f) => /\.(mp4|mov|webm)$/i.test(f);
const DEFAULT_SECONDS = { 'codex-image': 55, 'flow-image': 45, 'flow-video': 150, 'blender-model': 20 };

// Split a brief-style prompt ("Hero: …\nIdea: …") into labelled sections for reading.
function promptSections(text) {
  const out = [];
  for (const raw of String(text || '').split('\n')) {
    const line = raw.trim();
    if (!line) continue;
    const m = line.match(/^([A-Z][A-Za-z &/()-]{1,32}):\s*(.*)$/);
    if (m) out.push({ label: m[1], text: m[2] });
    else if (out.length) out[out.length - 1].text += `\n${line}`;
    else out.push({ label: 'Brief', text: line });
  }
  return out;
}

// The viewer (owner 2026-11-14, law 16): image stage, a side panel with the poster's name, fact chips,
// actions (Download · Copy prompt · Show in Finder) and the prompt in readable sections.
// ← / → step through the images of the same folder; Esc closes.
function Viewer({ open, all = [], folders = [], onMove, onClose, onEdit }) {
  const { job, file } = open;
  const siblings = useMemo(
    () => all.filter((t) => t.file && (t.job.client || 'general') === (job.client || 'general')),
    [all, job.client],
  );
  const at = siblings.findIndex((t) => t.file === file);
  const step = (d) => { if (siblings.length > 1 && at >= 0) onMove(siblings[(at + d + siblings.length) % siblings.length]); };
  const [copied, setCopied] = useState(false);
  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onClose();
      else if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });
  useEffect(() => { setCopied(false); }, [file]);
  const name = (job.prompt || '').replace(/^Poster · /, '').replace(/\s*\(recipe.*\)$/, '');
  const folder = folders.find((f) => f.id === (job.client || 'general'))?.name || 'General';
  const sections = promptSections(job.fullPrompt || job.prompt);
  // a 3D item downloads as its GLB model, never the preview still (owner 2026-11-14)
  const model = job.type === 'model';
  const turnable = model && job.kind === 'model'; // Models page items open as a live 3D stage (law 33)
  const dragged = useRef(false);
  const download = () => { const a = document.createElement('a'); a.href = model ? `/api/model?job=${encodeURIComponent(job.id)}` : fileUrl(file); a.download = model ? '' : file.split('/').pop(); document.body.appendChild(a); a.click(); a.remove(); };
  const copy = () => { navigator.clipboard?.writeText(job.fullPrompt || job.prompt); setCopied(true); setTimeout(() => setCopied(false), 1400); };
  const reveal = () => fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reveal', file }) });
  return (
    <div className="viewer vw" onClick={() => { if (dragged.current) { dragged.current = false; return; } onClose(); }}>
      <div className={`vw-stage${turnable ? ' is-model' : ''}`}>
        {turnable
          ? <ModelStage job={job} poster={fileUrl(file)} name={name} dragRef={dragged} />
          : isVideo(file)
          ? <video key={file} className="vw-media" src={fileUrl(file)} controls autoPlay loop onClick={(e) => e.stopPropagation()} />
          // eslint-disable-next-line @next/next/no-img-element
          : <img key={file} className="vw-media" src={fileUrl(file)} alt={name} onClick={(e) => e.stopPropagation()} />}
        {siblings.length > 1 && (
          <>
            <button className="vw-nav prev" aria-label="Previous image" title="Previous (←)" onClick={(e) => { e.stopPropagation(); step(-1); }}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M10 3.5 5.5 8l4.5 4.5" /></svg>
            </button>
            <button className="vw-nav next" aria-label="Next image" title="Next (→)" onClick={(e) => { e.stopPropagation(); step(1); }}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M6 3.5 10.5 8 6 12.5" /></svg>
            </button>
            <span className="vw-pos" key={at}>{at + 1} / {siblings.length}</span>
          </>
        )}
        <button className="vw-close" aria-label="Close" title="Close (Esc)" onClick={(e) => { e.stopPropagation(); onClose(); }}>
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
        </button>
      </div>

      <aside className="vw-panel" onClick={(e) => e.stopPropagation()} key={`p-${file}`}>
        <header className="vw-head">
          <span className="vw-kicker">{folder}</span>
          <h2>{name || 'Image'}</h2>
        </header>
        <div className="vw-facts">
          {job.finishedAt && <span className="chip chip-count">{formatSeconds(seconds(job))}</span>}
          {job.ratio && <span className="chip">{job.ratio}</span>}
          <span className="chip">{engineLabel(job)}</span>
          {job.recipe && <span className="chip">Recipe {job.recipe}</span>}
          {job.cost != null && <span className="chip">{job.cost} cr</span>}
        </div>
        <div className="glass-bar vw-actions" role="toolbar" aria-label="Image actions">
          <button className="fsel-btn" onClick={download}>
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13h10" /></svg>{model ? 'Download GLB' : 'Download'}
          </button>
          {isVideo(file) && onEdit && (
            // like Google Flow: any video opens straight into the Edit page (law 27)
            <button className="fsel-btn" onClick={() => onEdit(file, name)}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.25" y="4" width="11.5" height="8" rx="1.8" /><path d="M8 2.75v10.5" /></svg>Edit
            </button>
          )}
          <button className={`fsel-btn${copied ? ' is-done' : ''}`} onClick={copy}>
            <span className="fsel-label" key={copied ? 'y' : 'n'}>
              {copied
                ? <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>
                : <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="5.25" y="5.25" width="8" height="8" rx="2" /><path d="M10.75 5.25V4.5a1.75 1.75 0 0 0-1.75-1.75H4.5A1.75 1.75 0 0 0 2.75 4.5V9a1.75 1.75 0 0 0 1.75 1.75h.75" /></svg>}
              {copied ? 'Copied' : 'Copy prompt'}
            </span>
          </button>
          <button className="fsel-btn icon" onClick={reveal} aria-label="Show in Finder" title="Show in Finder">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 5c0-.97.78-1.75 1.75-1.75h2.2l1.3 1.4h3.5c.97 0 1.75.78 1.75 1.75v4.85c0 .97-.78 1.75-1.75 1.75h-7c-.97 0-1.75-.78-1.75-1.75z" /></svg>
          </button>
        </div>
        <section className="vw-prompt" aria-label="Prompt">
          {sections.map((sec, i) => (
            <div key={i} className="vw-sec" style={{ '--i': i }}>
              <span>{sec.label}</span>
              <p>{sec.text.charAt(0).toUpperCase() + sec.text.slice(1)}</p>
            </div>
          ))}
        </section>
        <dl className="vw-meta">
          <dt>Model</dt><dd>{job.model || '—'}</dd>
          <dt>Started</dt><dd>{new Date(job.createdAt).toLocaleString(undefined, { hour: 'numeric', minute: '2-digit', day: 'numeric', month: 'short' })}</dd>
          <dt>File</dt><dd className="vw-file" title={file}>{file.split('/').pop()}</dd>
        </dl>
      </aside>
    </div>
  );
}

export default function Board() {
  const [state, setState] = useState({ jobs: [], credits: null });
  const [loaded, setLoaded] = useState(false);
  const [segment, setSegment] = useState('image');
  const [page, setPage] = useState('gallery');
  const [open, setOpen] = useState(null);
  const [sideOpen, setSideOpen] = useState(true);
  const [hidden, setHidden] = useState(() => new Set()); // deleted this session, before the server confirms
  const [menu, setMenu] = useState(null);
  const [sheet, setSheet] = useState(null);
  const [gone, setGone] = useState(null); // folder waiting out its 5 s undo before it is deleted
  const reloadRef = useRef(() => {});
  const lastJobs = useRef('');
  const runningSeen = useRef(new Set()); // jobs we watched run: they get the reveal when they finish
  const [revealed, setRevealed] = useState(() => new Set());

  // Sidebar: remembered per browser; ⌘\ (Ctrl+\) toggles it.
  useEffect(() => {
    try { if (localStorage.getItem('sidebar-open') === '0') setSideOpen(false); } catch {}
  }, []);
  const toggleSide = () => setSideOpen((v) => {
    try { localStorage.setItem('sidebar-open', v ? '0' : '1'); } catch {}
    return !v;
  });
  useEffect(() => {
    const onKey = (e) => {
      if ((e.metaKey || e.ctrlKey) && e.key === '\\') { e.preventDefault(); toggleSide(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // Remember segment and page in the URL (?s=video, ?p=art-direction) so a reload stays put.
  useEffect(() => {
    const q = new URLSearchParams(window.location.search);
    const s = q.get('s') === 'video' || q.get('s') === 'model' ? q.get('s') : 'image';
    setSegment(s);
    setPage(q.get('p') || DEFAULT_PAGE[s]);
  }, []);
  const syncUrl = (s, p) => {
    const url = new URL(window.location.href);
    if (s === 'image') url.searchParams.delete('s'); else url.searchParams.set('s', s);
    if (p && p !== DEFAULT_PAGE[s]) url.searchParams.set('p', p); else url.searchParams.delete('p');
    window.history.replaceState(null, '', url);
  };
  const select = (id) => { if (id === segment) return; smooth(() => { setSegment(id); setPage(DEFAULT_PAGE[id]); }); syncUrl(id, DEFAULT_PAGE[id]); };
  const selectPage = (id) => { if (id === page) return; smooth(() => setPage(id)); syncUrl(segment, id); };

  useEffect(() => {
    let alive = true, busy = 0, sent = 0, applied = 0;
    // the 1.5 s tick skips while a poll is still out; an older answer never overwrites a newer one
    const load = (tick) => {
      if (tick === true && busy) return;
      const n = ++sent; busy += 1;
      fetch('/api/jobs', { cache: 'no-store' })
        .then((r) => r.text())
        .then((raw) => {
          if (!alive || n < applied) return;
          applied = n;
          // Same answer as last poll: change nothing, so nothing on the board re-renders.
          if (raw === lastJobs.current) { setLoaded(true); return; }
          lastJobs.current = raw;
          const s = JSON.parse(raw);
          const fresh = [];
          for (const j of s.jobs) {
            if (j.status === 'running') runningSeen.current.add(j.id);
            else if (j.status === 'done' && runningSeen.current.has(j.id)) { runningSeen.current.delete(j.id); fresh.push(j.id); }
          }
          if (fresh.length) {
            setRevealed((r) => new Set([...r, ...fresh]));
            // the reveal plays once: forget it after the animation (3.6 s) so a remount shows the plain image
            setTimeout(() => { if (alive) setRevealed((r) => new Set([...r].filter((id) => !fresh.includes(id)))); }, 4500);
          }
          // the server no longer has it = the delete is confirmed: forget the key, so a file restored
          // from Recently Deleted shows again. Keys still on the server stay (DELETE in flight).
          const byId = new Map(s.jobs.map((j) => [j.id, j]));
          setHidden((h) => {
            if (!h.size) return h;
            const keep = new Set([...h].filter((k) => {
              const [id, ...rest] = k.split('|');
              const j = byId.get(id);
              return j && (!rest.length || (j.files || []).includes(rest.join('|')));
            }));
            return keep.size === h.size ? h : keep;
          });
          setState(s); setLoaded(true);
        })
        .catch(() => {})
        .finally(() => { busy -= 1; });
    };
    load();
    reloadRef.current = load;
    const t = setInterval(() => load(true), 1500);
    return () => { alive = false; clearInterval(t); };
  }, []);

  // Expected seconds per engine+type, learned from finished jobs (used by the progress estimate).
  const expected = useMemo(() => {
    const acc = {};
    for (const j of state.jobs) {
      if (j.status !== 'done' || !j.finishedAt) continue;
      const k = `${j.engine}-${j.type}`;
      (acc[k] ||= []).push(seconds(j));
    }
    const out = { ...DEFAULT_SECONDS };
    for (const [k, v] of Object.entries(acc)) out[k] = v.reduce((a, b) => a + b, 0) / v.length;
    return out;
  }, [state.jobs]);

  const jobs = state.jobs.filter((j) => !hidden.has(j.id));

  const tiles = useMemo(() => jobs
    .filter((j) => j.type === segment)
    .flatMap((job) => (job.files?.length ? job.files.map((file) => ({ job, file })) : [{ job, file: null }]))
    .filter(({ job, file }) => !hidden.has(`${job.id}|${file}`)),
  [jobs, segment, hidden]);

  const counts = useMemo(() => ({
    image: jobs.filter((j) => j.type === 'image').reduce((n, j) => n + (j.files?.length || 0), 0),
    video: jobs.filter((j) => j.type === 'video').reduce((n, j) => n + (j.files?.length || 0), 0),
    model: jobs.filter((j) => j.type === 'model').reduce((n, j) => n + (j.files?.length || 0), 0),
  }), [jobs]);

  const remove = async (job, file) => {
    const key = file ? `${job.id}|${file}` : job.id;
    setHidden((h) => new Set([...h, key]));
    const r = await fetch(`/api/jobs?id=${encodeURIComponent(job.id)}${file ? `&file=${encodeURIComponent(file)}` : ''}`, { method: 'DELETE' }).catch(() => null);
    // the server said no: the card comes back
    if (!r?.ok) { setHidden((h) => { const n = new Set(h); n.delete(key); return n; }); return; }
    window.dispatchEvent(new Event('studio:trashed')); // the trash can opens its lid
  };

  // ---------- folders (one per client) ----------
  const folders = useMemo(() => {
    const list = (state.clients || []).map((c) => ({ ...c }));
    const byId = Object.fromEntries(list.map((c) => [c.id, c]));
    for (const t of tiles) {
      const id = t.job.client || 'general';
      if (!byId[id]) { byId[id] = { id, name: id === 'general' ? 'General' : id, note: '' }; list.push(byId[id]); }
      const f = byId[id];
      f.tiles = [...(f.tiles || []), t];
    }
    return list.map((f) => ({ ...f, tiles: f.tiles || [], count: (f.tiles || []).filter((t) => t.file).length }))
      .sort((a, b) => (a.id === 'general' ? -1 : b.id === 'general' ? 1 : 0));
  }, [state.clients, tiles]);

  // the card title is the poster's own name ("FIRST POUR"), not the recipe note
  const shortLabel = (job) => (job.prompt || '').replace(/^Poster · /, '').replace(/\s*\(recipe.*\)$/, '')
    + (job.kind === 'model' && job.format ? ` · ${job.format.toUpperCase()}` : '');
  const cardFor = ({ job, file }) => (
    <JobCard
      key={`${job.id}-${file || 'job'}`}
      job={job}
      file={file}
      label={shortLabel(job)}
      expected={expected[`${job.engine}-${job.type}`] || 60}
      reveal={revealed.has(job.id)}
      onOpen={setOpen}
      onDelete={remove}
    />
  );

  // Viewer → Edit: a new edit holding this one video, then the Edit page (law 27)
  const editWith = async (file, title) => {
    const dur = await probeDuration(file);
    if (!dur) { console.warn('Edit: could not read the video length', file); return; }
    const r = await fetch('/api/edits', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'create', title: (title || '').replace(/^Edit · /, '') || 'Untitled edit', clips: [{ src: file, dur, in: 0, out: dur }] }),
    }).catch(() => null);
    const made = r?.ok ? await r.json().catch(() => null) : null;
    // no new edit: stay in the viewer, never open some other edit
    if (!made?.id) { console.warn('Edit: could not create the edit', file); return; }
    setOpen(null);
    selectPage('edit');
  };

  const folderId = page.startsWith('folder:') ? page.slice(7) : null;
  const kitId = page.startsWith('kit:') ? page.slice(4) : null;

  // ---------- folder management ----------
  const clientsApi = async (body) => {
    const r = await fetch('/api/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    const out = await r.json().catch(() => ({}));
    reloadRef.current();
    return out;
  };
  const newFolder = () => setSheet({
    title: 'New Folder', message: `One folder per client. Claude saves that client's ${{ image: 'images', video: 'videos', model: '3D work' }[segment]} here.`,
    input: '', placeholder: 'Client name', confirm: 'Create',
    onSubmit: async (name) => { const r = await clientsApi({ action: 'create', name }); if (r.id) selectPage(`folder:${r.id}`); },
  });
  // Deleting a folder moves ALL its work (images, videos, 3D) to General, so count every segment.
  const allCount = (id) => state.jobs
    .filter((j) => !hidden.has(j.id) && (j.client || 'general') === id)
    .reduce((n, j) => n + (j.files || []).filter((file) => !hidden.has(`${j.id}|${file}`)).length, 0);
  const goneRef = useRef(null);
  goneRef.current = gone;
  const dropFolder = async (id) => {
    await clientsApi({ action: 'delete', id });
    if (folderId === id) selectPage(DEFAULT_PAGE[segment]);
  };
  const askDropFolder = (next) => {
    // a second delete while one counts down: the first one is committed now, never silently dropped
    const prev = goneRef.current;
    if (prev && prev.id !== next.id) dropFolder(prev.id);
    setGone(next);
  };
  const folderMenu = (id, e) => {
    const f = folders.find((x) => x.id === id) || { id, name: id, count: 0 };
    const fixed = id === 'general'; // General can be renamed in notes but never deleted
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Open', onClick: () => selectPage(`folder:${id}`) },
        { label: 'Rename…', onClick: () => setSheet({ title: 'Rename Folder', input: f.name, confirm: 'Rename', onSubmit: (name) => clientsApi({ action: 'rename', id, name }) }) },
        { label: 'Edit Note…', onClick: () => setSheet({ title: `Note for ${f.name}`, input: f.note || '', placeholder: 'e.g. dairy products', confirm: 'Save', onSubmit: (note) => clientsApi({ action: 'rename', id, note }) }) },
        { sep: true },
        { label: 'New Folder…', onClick: newFolder },
        { sep: true },
        {
          label: 'Delete Folder…', danger: true, disabled: fixed,
          // quick undo, no dialog (law 16): images move to General when the countdown ends
          onClick: () => askDropFolder({ id, name: f.name, count: allCount(id) }),
        },
      ],
    });
  };
  const folder = folderId ? folders.find((f) => f.id === folderId) : null;

  const seg = SEGMENT_PAGE[segment];
  const empty = (
    <section className="page">
      <PageTop kicker={seg.kicker} title={seg.title} />
      <EmptyStack
        key={segment}
        icon={segment === 'image'
          ? IMAGE_MARK
          : segment === 'model'
            ? <svg viewBox="0 0 24 24"><path d="M12 3.6l7.4 4.2v8.4L12 20.4l-7.4-4.2V7.8z" /><path d="M4.8 7.9L12 12l7.2-4.1M12 12v8.2" /></svg>
            : <StudioIcon name="play" />}
        title={seg.none}
        text={segment === 'model' ? 'Ask Claude in Claude Code. Blender scenes and models land here on their own.' : 'Ask Claude in Claude Code. What it makes lands here on its own.'}
      />
    </section>
  );

  const studio = segment === 'video' ? VIDEO_STUDIOS.find((st) => st.id === page) : null;
  const modelStudio = segment === 'model' && page.startsWith('shot:') ? MODEL_STUDIOS.find((st) => `shot:${st.id}` === page) : null;
  // sidebar counts for the 3D pages (files only, like every other count)
  const pageCounts = segment === 'model'
    ? Object.fromEntries(Object.entries(MODEL_VIEWS).map(([id, v]) => [id, tiles.filter((t) => t.file && v.test(t.job)).length]))
    : {};

  const kitClient = kitId ? (folders.find((f) => f.id === kitId) || { id: kitId, name: kitId }) : null;

  const imageCount = tiles.filter((t) => t.file).length;
  const gallery = !loaded ? null : kitClient ? (
    <KitView client={kitClient} onBackToFolder={() => selectPage(`folder:${kitClient.id}`)} onBackToGallery={() => selectPage('gallery')} />
  ) : folderId ? (
    folder ? (
      <FolderView
        kind={segment === 'model' ? 'model' : segment === 'video' ? 'video' : 'image'}
        folder={folder}
        folders={folders}
        onBack={() => selectPage(DEFAULT_PAGE[segment])}
        onOpen={setOpen}
        onDelete={remove}
        onChanged={() => reloadRef.current()}
        onKit={() => selectPage(`kit:${folder.id}`)}
      />
    ) : <section className="page"><PageTop kicker="Folders" title="Not found" /><p className="folder-empty">This folder no longer exists.</p></section>
  ) : segment === 'image' || segment === 'video' || (segment === 'model' && page === 'all') ? (
    // Image Gallery and Videos share one layout (owner 2026-11-14): client folders first, then Recents.
    // shown even when empty: the folders stay one click away (owner 2026-11-14)
    (
      <section className="page gallery-page">
        <PageTop
          kicker={seg.kicker}
          title={seg.title}
          chips={<>
            <span className="chip chip-count">{imageCount} {seg.unit[imageCount === 1 ? 0 : 1]}</span>
            <span className="chip">{folders.length} {folders.length === 1 ? 'folder' : 'folders'}</span>
          </>}
          right={(
            <div className="glass-bar" role="toolbar" aria-label="Gallery">
              <button className="fsel-btn" onClick={newFolder}>
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 3.25v9.5M3.25 8h9.5" /></svg>New Folder
              </button>
            </div>
          )}
        />

        {/* folders first: they are the way into every client's work */}
        <div className="section-head"><h2>Folders</h2><span>{folders.length}</span></div>
        <div className="folders">
          {folders.map((f) => (
            <button key={f.id} className={`folder${gone?.id === f.id ? ' pending' : ''}`} onClick={() => selectPage(`folder:${f.id}`)} onContextMenu={(e) => { e.preventDefault(); folderMenu(f.id, e); }}>
              <span className="folder-art">
                <span className="folder-back" />
                {f.tiles.filter((t) => t.file).slice(0, 3).map((t, i) => (
                  // a video peeks with one still from its first second
                  // eslint-disable-next-line @next/next/no-img-element
                  <img key={t.file} className={`folder-peek peek-${i}`} src={isVideo(t.file) ? `/api/frame?p=${encodeURIComponent(t.file)}&t=0.5&h=240` : `/api/thumb?p=${encodeURIComponent(t.file)}`} alt="" />
                ))}
                <span className="folder-front" />
              </span>
              <span className="folder-name">{f.name}</span>
              <span className="folder-meta">{f.count} {seg.unit[f.count === 1 ? 0 : 1]}{f.note ? ` · ${f.note}` : ''}</span>
            </button>
          ))}
          <button className="folder folder-new" onClick={newFolder}>
            <span className="folder-art folder-art-new" aria-hidden="true">
              <svg viewBox="0 0 24 24"><path d="M12 6v12M6 12h12" /></svg>
            </span>
            <span className="folder-name">New Folder</span>
            <span className="folder-meta">One folder per client</span>
          </button>
        </div>

        {/* nothing made yet: no Recents block at all, only the folders (owner 2026-11-14) */}
        {tiles.length > 0 && (
          <>
            <hr className="section-rule" />
            <div className="section-head"><h2>Recents</h2><span>{tiles.length} total</span></div>
            <Recents items={tiles.slice(0, 12)} render={cardFor} />
          </>
        )}
      </section>
    )
  ) : segment === 'model' && MODEL_VIEWS[page] ? (() => {
    // one 3D page: only the results of its kind (scenes · models), newest first
    const v = MODEL_VIEWS[page];
    const list = tiles.filter((t) => v.test(t.job));
    const n = list.filter((t) => t.file).length;
    const icon = <SideIcon name={MODEL_PAGES[1].items.find((it) => it.id === page).icon} />;
    return list.length === 0 ? (
      <section className="page">
        <PageTop kicker="3D" title={v.title} />
        <EmptyStack key={page} icon={icon} title={v.none} text={v.text} />
      </section>
    ) : (
      <section className="page gallery-page">
        <PageTop kicker="3D" title={v.title} chips={<span className="chip chip-count">{n} {v.unit[n === 1 ? 0 : 1]}</span>} />
        <div className="grid grid-inline grid-wide">{list.map(cardFor)}</div>
      </section>
    );
  })() : tiles.length === 0 ? empty : (
    <section className="page gallery-page">
      <PageTop kicker={seg.kicker} title={seg.title} chips={<span className="chip chip-count">{tiles.length} {seg.unit[tiles.length === 1 ? 0 : 1]}</span>} />
      <div className="grid grid-inline">{tiles.map(cardFor)}</div>
    </section>
  );

  return (
    <main className={SIDEBAR_SEGMENTS.includes(segment) ? `with-sidebar${sideOpen ? '' : ' side-closed'}` : ''}>
      {SIDEBAR_SEGMENTS.includes(segment) && <Sidebar key={segment} segment={segment} page={page} onSelect={selectPage} open={sideOpen} onToggle={toggleSide} folders={folders} onFolderMenu={folderMenu} onNewFolder={newFolder} counts={pageCounts} />}
      {SIDEBAR_SEGMENTS.includes(segment) && (
        <button className="side-reopen" onClick={toggleSide} aria-label="Show sidebar" title="Show sidebar (⌘\)" tabIndex={sideOpen ? -1 : 0}>
          <ArrowIcon dir="right" />
        </button>
      )}
      <div className="content">
        {segment === 'image' && page === 'art-direction' ? <ArtMap />
          : SIDEBAR_SEGMENTS.includes(segment) && page === 'trash' ? <TrashView key={segment} kind={segment} folders={folders} />
          : segment === 'video' && page === 'director' ? <VideoDirector tiles={tiles} onOpen={selectPage} />
          : segment === 'video' && page === 'edit' ? <EditView videos={tiles} jobs={state.jobs} />
          : segment === 'model' && page === 'director3d' ? <ModelDirector tiles={tiles} onOpen={(id) => selectPage(`shot:${id}`)} />
          : modelStudio ? <ModelStudio studio={modelStudio} tiles={tiles.filter((t) => modelStudioOf(t.job) === modelStudio.id)} render={cardFor} onBack={() => selectPage('director3d')} />
          : studio ? <VideoStudio studio={studio} tiles={tiles.filter((t) => studioOf(t.job) === studio.id)} render={cardFor} onBack={() => selectPage('director')} />
          : gallery}
      </div>
      <Dock active={segment} onSelect={select} counts={counts} />
      <Settings />
      <SlidingPills />
      {open && <Viewer open={open} all={tiles} folders={folders} onMove={setOpen} onClose={() => setOpen(null)} onEdit={editWith} />}
      {loaded && <Intro />}
      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {sheet && <Sheet {...sheet} onClose={() => setSheet(null)} />}
      {gone && (
        <UndoPill
          key={gone.id}
          label={`Deleting “${gone.name}”${gone.count ? ` · ${gone.count} to General` : ''}`}
          onUndo={() => setGone(null)}
          onDone={() => { const id = gone.id; setGone(null); dropFolder(id); }}
        />
      )}
    </main>
  );
}
