'use client';

// Inside a client folder: a compact Finder-style icon grid.
// Click selects (⌘/Shift adds), double-click or Enter opens, right-click for actions,
// Delete key deletes the selection, ⌘A selects all.
// Delete never opens a dialog: the selection bar turns into a 5 s "Deleting · Undo"
// countdown (house motion "quick undo"); Esc or ⌘Z undoes. Files go to outputs/.trash.

import EmptyStack from '@/components/EmptyStack';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { ContextMenu, keysBlocked } from '@/components/Menu';
import { dust, fileUrl, formatSeconds, seconds } from '@/components/JobCard';
import PageTop, { FolderIcon } from '@/components/PageTop';
import { smooth, useBarMorph } from '@/lib/motion';

const thumb = (f) => `/api/thumb?p=${encodeURIComponent(f)}`;
const keyOf = (t) => `${t.job.id}|${t.file || ''}`;
const SORTS = {
  newest: { label: 'Newest', fn: (a, b) => new Date(b.job.createdAt) - new Date(a.job.createdAt) },
  oldest: { label: 'Oldest', fn: (a, b) => new Date(a.job.createdAt) - new Date(b.job.createdAt) },
  name: { label: 'Name', fn: (a, b) => a.job.prompt.localeCompare(b.job.prompt) },
};

export const SIZES = { s: { label: 'Small', px: 140 }, m: { label: 'Medium', px: 190 }, l: { label: 'Large', px: 250 } };

// Thumbnail size as a grid: more cells = smaller thumbnails.
export function SizeIcon({ k }) {
  const n = { s: 3, m: 2, l: 1 }[k];
  const gap = 1.5, span = 12, cell = (span - gap * (n - 1)) / n;
  const cells = [];
  for (let r = 0; r < n; r++) for (let c = 0; c < n; c++) {
    cells.push(<rect key={`${r}${c}`} x={2 + c * (cell + gap)} y={2 + r * (cell + gap)} width={cell} height={cell} rx={n === 1 ? 2.5 : 1} />);
  }
  return <svg viewBox="0 0 16 16" aria-hidden="true">{cells}</svg>;
}

const DownloadIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M8 2.5v7.5M4.75 7 8 10.25 11.25 7M3 13h10" /></svg>;
const TrashIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" /></svg>;
const UndoIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.25a3.75 3.75 0 0 1 0 7.5H6" /></svg>;
const CheckIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>;
const UNDO_MS = 5000;
const CloseIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;
// Empty folder: back + tab, a photo sheet that drops in, and the front flap that tips open to catch it.
const EmptyFolderArt = () => (
  <svg viewBox="0 0 20 20" aria-hidden="true">
    <path d="M2.8 15.6V4.9c0-.8.6-1.4 1.4-1.4h3.1c.4 0 .8.2 1.1.5l1.1 1.2h6.3c.8 0 1.4.6 1.4 1.4v1.4" />
    <g className="fe-sheet"><rect x="5.1" y="4.6" width="9.8" height="8.6" rx="0.9" /><circle cx="12.4" cy="6.7" r="0.85" /><path d="M6.6 9.6l1.9-1.7 1.8 1.5" /></g>
    <path className="fe-front" d="M2.3 8.4h15.4c.3 0 .5.3.5.6l-1 6.9c-.1.8-.8 1.4-1.6 1.4H4.5c-.8 0-1.5-.6-1.6-1.4l-1-6.9c0-.3.2-.6.4-.6z" />
  </svg>
);

function shortName(job) {
  return job.prompt.replace(/^Poster · /, '').replace(/\s*\(recipe.*\)$/, '');
}

function Tile({ t, selected, pending, burning, onSelect, onOpen, onMenu, imgRef }) {
  const { job, file } = t;
  const running = job.status === 'running';
  const failed = job.status === 'failed' && !file;
  return (
    <div
      className={`ftile${selected ? ' selected' : ''}${pending || burning ? ' pending' : ''}${burning ? ' burning' : ''}`}
      onClick={(e) => onSelect(t, e)}
      onDoubleClick={() => file && onOpen(t)}
      onContextMenu={(e) => { e.preventDefault(); onMenu(t, e); }}
      role="option"
      aria-selected={selected}
      tabIndex={-1}
    >
      <div className={`ftile-thumb${running ? ' running' : ''}${failed ? ' failed' : ''}`}>
        {file && !running && (/\.(mp4|mov|webm)$/i.test(file)
          // a video folder (law 25): the clip's first second, still, as its thumbnail
          ? <video ref={imgRef} src={`/api/file?p=${encodeURIComponent(file)}#t=0.5`} muted playsInline preload="metadata" />
          // eslint-disable-next-line @next/next/no-img-element
          : <img ref={imgRef} src={thumb(file)} alt="" loading="lazy" draggable={false} />
        )}
        {running && <span>{formatSeconds(seconds(job))}</span>}
        {failed && <span>Failed</span>}
      </div>
      <div className="ftile-name" title={job.prompt}>{shortName(job)}</div>
      <div className="ftile-sub">
        {job.finishedAt ? formatSeconds(seconds(job)) : job.status}
        {job.ratio && <><i>·</i>{job.ratio}</>}
        <i>·</i>{job.engine === 'codex' ? 'ChatGPT' : 'Flow'}
      </div>
    </div>
  );
}

export default function FolderView({ folder, folders, onBack, onOpen, onDelete, onChanged, onKit, kind = 'image' }) {
  const noun = (n) => ({ image: ['image', 'images'], video: ['video', 'videos'], model: ['item', 'items'] }[kind] || [kind, `${kind}s`])[n === 1 ? 0 : 1];
  const [sort, setSort] = useState('newest');
  const [size, setSize] = useState('m');
  useEffect(() => { try { const v = localStorage.getItem('folder-size'); if (SIZES[v]) setSize(v); } catch {} }, []);
  const pickSize = (v) => { smooth(() => setSize(v)); try { localStorage.setItem('folder-size', v); } catch {} };
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null); // { list, keys, n } while the undo countdown runs
  const [burning, setBurning] = useState(() => new Set()); // tiles turning to dust: stay stepped back, then fade
  const [left, setLeft] = useState(0);
  const [dl, setDl] = useState('idle'); // idle | saving | done
  const pendingRef = useRef(null);
  const bar = useRef(null);
  const [toast, setToast] = useState(null);
  const imgs = useRef({});

  const box = useRef(null);

  const items = useMemo(() => [...folder.tiles].sort(SORTS[sort].fn), [folder.tiles, sort]);
  // A deleted tile leaves the list -> forget it, so a file restored from the Trash comes back normal.
  useEffect(() => {
    setBurning((b) => { if (!b.size) return b; const live = new Set(items.map(keyOf)); const n = new Set([...b].filter((k) => live.has(k))); return n.size === b.size ? b : n; });
  }, [items]);
  const selItems = items.filter((t) => selected.has(keyOf(t)));

  useEffect(() => { setSelected(new Set()); }, [folder.id]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 2200); return () => clearTimeout(t); }, [toast]);

  const select = (t, e) => {
    const k = keyOf(t);
    if (e.shiftKey && anchor) {
      const a = items.findIndex((x) => keyOf(x) === anchor);
      const b = items.findIndex((x) => keyOf(x) === k);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(items.slice(lo, hi + 1).map(keyOf)));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => { const n = new Set(s); n.has(k) ? n.delete(k) : n.add(k); return n; });
      setAnchor(k);
    } else {
      setSelected(new Set([k])); setAnchor(k);
    }
  };

  const removeMany = (list) => {
    setBurning((b) => { const n = new Set(b); list.forEach((t) => n.add(keyOf(t))); return n; });
    for (const t of list) {
      const el = imgs.current[keyOf(t)];
      const done = () => onDelete(t.job, t.file);
      if (el && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) dust(el, done); else done();
    }
    setSelected(new Set());
  };

  // Quick undo: the bar counts down; nothing is deleted until it reaches 0.
  const timers = useRef([]);
  const stopTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const commit = () => {
    const p = pendingRef.current; if (!p) return;
    stopTimers(); pendingRef.current = null; setPending(null);
    removeMany(p.list);
  };
  const undo = () => { stopTimers(); pendingRef.current = null; setPending(null); };
  const askDelete = (list) => {
    if (!list.length || pendingRef.current) return;
    const p = { list, keys: new Set(list.map(keyOf)), n: list.length };
    pendingRef.current = p; setPending(p); setMenu(null);
    const secs = UNDO_MS / 1000;
    setLeft(secs);
    for (let i = 1; i < secs; i++) timers.current.push(setTimeout(() => setLeft(secs - i), i * 1000));
    timers.current.push(setTimeout(commit, UNDO_MS));
  };
  // Leaving the folder (or a hot reload) mid-countdown CANCELS: nothing is ever deleted without the
  // countdown reaching 0 on screen (MISTAKES U06: a remount once deleted an image during a test).
  // The page stays mounted across folders, so the countdown bar, anchor and selection reset too.
  useEffect(() => () => { stopTimers(); pendingRef.current = null; setPending(null); setAnchor(null); setSelected(new Set()); }, [folder.id]);

  // Progress inside the button that started it: Download → Saving → Saved.
  const downloadSel = () => {
    if (dl !== 'idle') return;
    selItems.filter((x) => x.file).forEach(download);
    setDl('saving');
    setTimeout(() => setDl('done'), 900);
    setTimeout(() => setDl('idle'), 2100);
  };

  // The bar keeps its centre and morphs its width when its face changes (FLIP on width).
  useBarMorph(bar, pending ? 'undo' : 'main');

  const moveTo = async (list, to) => {
    const ids = [...new Set(list.map((t) => t.job.id))];
    await fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'move', ids, to }) });
    setSelected(new Set());
    setToast(`Moved ${ids.length} to ${folders.find((f) => f.id === to)?.name || to}`);
    onChanged();
  };

  const reveal = (t) => fetch('/api/files', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'reveal', file: t.file }) });

  const download = (t) => {
    const a = document.createElement('a');
    // a 3D item downloads as its GLB model (owner 2026-11-14); /api/model exports it from the .blend if needed
    if (t.job?.type === 'model') { a.href = `/api/model?job=${encodeURIComponent(t.job.id)}`; a.download = ''; }
    else { a.href = fileUrl(t.file); a.download = t.file.split('/').pop(); }
    document.body.appendChild(a); a.click(); a.remove();
  };

  const openMenu = (t, e) => {
    const k = keyOf(t);
    const list = selected.has(k) ? selItems : [t];
    if (!selected.has(k)) { setSelected(new Set([k])); setAnchor(k); }
    const many = list.length > 1;
    const others = folders.filter((f) => f.id !== folder.id);
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: 'Open', shortcut: '↵', disabled: many || !t.file, onClick: () => onOpen(t) },
        { label: 'Show in Finder', disabled: many || !t.file, onClick: () => reveal(t) },
        { label: many ? `Download ${list.length} Items` : 'Download', disabled: !list.some((x) => x.file), onClick: () => list.filter((x) => x.file).forEach(download) },
        { label: 'Copy Path', disabled: many || !t.file, onClick: () => { navigator.clipboard?.writeText(t.file); setToast('Path copied'); } },
        { label: 'Copy Prompt', disabled: many, onClick: () => { navigator.clipboard?.writeText(t.job.fullPrompt || t.job.prompt); setToast('Prompt copied'); } },
        { sep: true },
        { label: 'Move to', sub: others.length ? others.map((f) => ({ label: f.name, onClick: () => moveTo(list, f.id) })) : [{ label: 'No other folders', disabled: true }] },
        { sep: true },
        { label: many ? `Delete ${list.length} Items` : 'Delete', shortcut: '⌫', danger: true, onClick: () => askDelete(list) },
      ],
    });
  };

  // Keyboard: Enter opens, Delete/Backspace deletes, ⌘A selects all, Escape clears.
  useEffect(() => {
    const onKey = (e) => {
      if (menu || keysBlocked(e)) return; // the viewer, Settings or a menu on top owns the keys
      if (pendingRef.current) {
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); undo(); }
        else if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); commit(); } // delete now
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(items.map(keyOf))); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selItems.length) { e.preventDefault(); askDelete(selItems); }
      else if (e.key === 'Enter' && selItems.length === 1 && selItems[0].file) onOpen(selItems[0]);
      else if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  return (
    <section className="page folder-page" onClick={(e) => { if (e.target === e.currentTarget || e.target === box.current) setSelected(new Set()); }}>
      <PageTop
        kicker={<><button onClick={onBack}>{{ video: 'All Videos', model: 'All 3D' }[kind] || 'Gallery'}</button><span>›</span>Folders</>}
        icon={<FolderIcon />}
        title={folder.name}
        chips={<>
          {(folder.note || '').split('·').map((x) => x.trim()).filter(Boolean).map((x) => <span key={x} className="chip">{x}</span>)}
          <span className="chip chip-count">{folder.count} {noun(folder.count)}</span>
          {onKit && (
            <button className="chip chip-kit" onClick={onKit}>
              <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="2.5" y="2.5" width="4.5" height="4.5" rx="1.2" /><rect x="9" y="2.5" width="4.5" height="4.5" rx="2.25" /><rect x="2.5" y="9" width="4.5" height="4.5" rx="2.25" /><rect x="9" y="9" width="4.5" height="4.5" rx="1.2" /></svg>
              Key components
            </button>
          )}
        </>}
        right={<>
          <div className="glass-bar" role="toolbar" aria-label="View">
            <div className="tabs" role="group" aria-label="Thumbnail size">
              {Object.entries(SIZES).map(([k, v]) => (
                <button key={k} className="tab tab-icon" aria-pressed={size === k} onClick={() => pickSize(k)} title={v.label} aria-label={v.label}><SizeIcon k={k} /></button>
              ))}
            </div>
            <span className="glass-sep" aria-hidden="true" />
            <div className="tabs" role="group" aria-label="Sort">
              {Object.entries(SORTS).map(([k, v]) => (
                <button key={k} className="tab" aria-pressed={sort === k} onClick={() => smooth(() => setSort(k))}>{v.label}</button>
              ))}
            </div>
          </div>
        </>}
      />

      {items.length ? (
        <div className="fgrid" ref={box} role="listbox" aria-multiselectable="true" style={{ '--tile': `${SIZES[size].px}px` }}>
          {items.map((t) => (
            <Tile
              key={keyOf(t)} t={t}
              selected={selected.has(keyOf(t))}
              pending={pending?.keys.has(keyOf(t))}
              burning={burning.has(keyOf(t))}
              onSelect={select}
              onOpen={onOpen}
              onMenu={openMenu}
              imgRef={(el) => { imgs.current[keyOf(t)] = el; }}
            />
          ))}
        </div>
      ) : (
        <EmptyStack compact icon={<EmptyFolderArt />} title={`Nothing in ${folder.name} yet`} text={`${{ video: 'Videos', model: 'Renders, scenes and models' }[kind] || 'Images'} made for ${folder.name} land here.`} />
      )}

      {(selItems.length > 0 || pending) && (
        <div ref={bar} className={`glass-bar fsel${pending ? ' is-undo' : ''}`} role="toolbar" aria-label={pending ? 'Deleting' : 'Selection'}>
          {pending ? (
            <div className="fsel-face" key="undo">
              <span className="fsel-sweep" aria-hidden="true" />
              <span className="fsel-tick" style={{ '--i': 0 }} aria-hidden="true"><b key={left}>{left}</b></span>
              <span className="fsel-msg" style={{ '--i': 1 }} aria-live="polite">Deleting {pending.n} {noun(pending.n)}</span>
              <button className="fsel-btn undo" style={{ '--i': 2 }} onClick={undo} title="Undo (Esc)"><UndoIcon />Undo</button>
              <button className="fsel-btn danger now" style={{ '--i': 3 }} onClick={commit} title="Delete now (⌘⌫)"><TrashIcon />Delete now</button>
            </div>
          ) : (
            <div className="fsel-face" key="main">
              <span className="fsel-count" style={{ '--i': 0 }} aria-live="polite"><b key={selItems.length}>{selItems.length}</b>selected</span>
              <span className="glass-sep" style={{ '--i': 1 }} aria-hidden="true" />
              <button className={`fsel-btn dl is-${dl}`} style={{ '--i': 2 }} onClick={downloadSel} disabled={!selItems.some((x) => x.file)}>
                <span className="fsel-fill" aria-hidden="true" />
                <span className="fsel-label" key={dl}>
                  {dl === 'done' ? <CheckIcon /> : <DownloadIcon />}
                  {dl === 'saving' ? 'Saving' : dl === 'done' ? 'Saved' : 'Download'}
                </span>
              </button>
              <button className="fsel-btn danger" style={{ '--i': 3 }} onClick={() => askDelete(selItems)}>
                <TrashIcon />Delete
              </button>
              <button className="fsel-btn icon fsel-x" style={{ '--i': 4 }} onClick={() => setSelected(new Set())} aria-label="Clear selection" title="Clear selection (Esc)">
                <CloseIcon />
              </button>
            </div>
          )}
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {toast && <div className="ftoast">{toast}</div>}
    </section>
  );
}
