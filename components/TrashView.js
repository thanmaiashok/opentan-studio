'use client';

// "Recently Deleted" — its own page, opened from the sidebar (owner 2026-11-14, law 22).
// Everything deleted on the board waits here for 1 day (outputs/.trash), then the server hands it to
// the Mac Trash. It speaks the client folder's language (owner 2026-11-14: "just like the general"):
// the same Finder tiles, size switch and a Newest / Oldest sort by the day it was deleted. Click selects
// (⌘ / Shift add, ⌘A all), right-click or the selection bar restores or deletes.
// Restore: the image lifts out of its tile and flies into its folder in the sidebar, then the grid closes
// the gap. Delete here erases for good behind the 5 s quick undo (Undo · Delete now, law 16): the tiles
// step back, turn to dust, and the grid closes the gap.

import EmptyStack from '@/components/EmptyStack';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { dust } from '@/components/Dust';
import { ContextMenu } from '@/components/Menu';
import PageTop from '@/components/PageTop';
import { SIZES, SizeIcon } from '@/components/FolderView';
import { smooth, useBarMorph } from '@/lib/motion';

const UNDO = 5;
const thumb = (f) => `/api/thumb?p=${encodeURIComponent(f)}`;
const at = (it) => new Date(it.deletedAt).getTime();
const SORTS = {
  newest: { label: 'Newest', fn: (a, b) => at(b) - at(a) },
  oldest: { label: 'Oldest', fn: (a, b) => at(a) - at(b) },
};
const still = () => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// Trash count for the sidebar; `gulp` ticks up whenever something new lands (the lid opens).
export function useTrashCount(kind = 'image') {
  const [count, setCount] = useState(0);
  const [gulp, setGulp] = useState(0);
  const last = useRef(-1);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      const d = await fetch(`/api/trash?kind=${kind}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
      if (!alive || !d) return;
      const n = d.items.length;
      if (last.current >= 0 && n > last.current) setGulp((g) => g + 1);
      last.current = n;
      setCount(n);
    };
    load();
    const poll = setInterval(load, 5000);
    const kick = () => setTimeout(load, 400);
    window.addEventListener('studio:trashed', kick);
    window.addEventListener('studio:trash-changed', kick);
    return () => { alive = false; clearInterval(poll); window.removeEventListener('studio:trashed', kick); window.removeEventListener('studio:trash-changed', kick); };
  }, []);
  return { count, gulp };
}

function title(it) {
  if (!it.prompt) return 'Image';
  return it.prompt.replace(/^Poster · /, '').replace(/\s*\(recipe.*\)$/, '').replace(/^Restored · /, '');
}
function leftLabel(ms) {
  if (ms <= 0) return 'to Mac Trash';
  const h = Math.floor(ms / 3600000);
  if (h >= 1) return `${h} h left`;
  return `${Math.max(1, Math.ceil(ms / 60000))} min left`;
}

// `tight` crops the view box to the ink (stroke included), so a page header can sit it flush on the
// page's left edge at the folder icon's 24 px height (alignment law 16).
export function TrashIcon({ className, tight }) {
  return (
    <svg viewBox={tight ? '2.5 2.45 15 15.8' : '0 0 20 20'} aria-hidden="true" className={className}>
      <g className="bin-lid"><rect x="3.25" y="5.1" width="13.5" height="1.9" rx="0.95" /><path d="M8.1 5.1V4.2c0-.6.4-1 1-1h1.8c.6 0 1 .4 1 1v.9" /></g>
      <path d="M4.9 7.6l.75 8.1c.1 1 .9 1.8 1.9 1.8h4.9c1 0 1.8-.8 1.9-1.8l.75-8.1" />
      <path className="bin-ribs" d="M8.4 10v4.6M11.6 10v4.6" />
    </svg>
  );
}
const RestoreIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.25a3.75 3.75 0 0 1 0 7.5H6" /></svg>;
const EraseIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" /></svg>;
const CloseIcon = () => <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>;

// Restore motion: a copy of the image lifts out of its tile and flies along an arc into its folder's
// row in the sidebar (shrinking to the folder icon), the row catches it with a small bounce. X and Y run
// on different curves, so the path bends instead of sliding in a straight line. No sidebar row on screen
// (sidebar hidden, phone) → it lifts and fades in place.
function flyHome(img, client, done) {
  const from = img?.getBoundingClientRect();
  if (!from || !from.width || still()) { done(); return; }
  const row = document.querySelector(`[data-side="folder:${client || 'general'}"]`);
  const rr = row?.getBoundingClientRect();
  const icon = row?.querySelector('.side-thumb, svg')?.getBoundingClientRect();
  const onScreen = rr && rr.width > 0 && rr.right > 0 && rr.top >= 0 && rr.bottom <= window.innerHeight;
  const fx = from.left + from.width / 2, fy = from.top + from.height / 2;
  const tx = onScreen ? (icon || rr).left + (icon || rr).width / 2 : fx;
  const ty = onScreen ? (icon || rr).top + (icon || rr).height / 2 : fy - 60;
  const end = onScreen ? 18 / from.width : 0.55;

  const outer = document.createElement('div');
  outer.className = 'bin-fly';
  Object.assign(outer.style, { left: `${from.left}px`, top: `${from.top}px`, width: `${from.width}px`, height: `${from.height}px` });
  const inner = img.cloneNode();
  inner.removeAttribute('loading');
  outer.appendChild(inner);
  document.body.appendChild(outer);

  const T = onScreen ? 720 : 420;
  outer.animate([{ transform: 'translateX(0)' }, { transform: `translateX(${tx - fx}px)` }],
    { duration: T, easing: 'cubic-bezier(.45, 0, .25, 1)', fill: 'forwards' });
  const fly = inner.animate([
    { transform: 'translateY(0) scale(1)', borderRadius: '11px', opacity: 1, filter: 'blur(0)' },
    { offset: 0.2, transform: 'translateY(-14px) scale(1.05)', borderRadius: '11px', opacity: 1, filter: 'blur(0)' },
    { transform: `translateY(${ty - fy}px) scale(${end})`, borderRadius: onScreen ? `${4 / end}px` : '11px', opacity: onScreen ? 0.35 : 0, filter: onScreen ? 'blur(0)' : 'blur(6px)' },
  ], { duration: T, easing: 'cubic-bezier(.5, 0, .3, 1)', fill: 'forwards' });
  fly.onfinish = () => {
    outer.remove();
    if (onScreen) {
      row.removeAttribute('data-caught');
      void row.offsetWidth; // restart the catch bounce for a second arrival
      row.setAttribute('data-caught', '');
      setTimeout(() => row.removeAttribute('data-caught'), 700);
    }
    done();
  };
}

export default function TrashView({ folders = [], kind = 'image' }) {
  const [items, setItems] = useState(null);
  const [now, setNow] = useState(() => Date.now());
  const [sort, setSort] = useState('newest');
  const [size, setSize] = useState('m');
  const [selected, setSelected] = useState(() => new Set());
  const [anchor, setAnchor] = useState(null);
  const [menu, setMenu] = useState(null);
  const [pending, setPending] = useState(null); // { names, n, all } while the undo countdown runs
  const [left, setLeft] = useState(0);
  const [gone, setGone] = useState(() => ({})); // name -> 'flying' | 'burning' while it leaves
  const [toast, setToast] = useState(null);
  const pendingRef = useRef(null);
  const timers = useRef([]);
  const holding = useRef(new Set()); // names still on screen while their exit animation plays
  const imgs = useRef({});
  const bar = useRef(null);
  const box = useRef(null);

  useEffect(() => { try { const v = localStorage.getItem('folder-size'); if (SIZES[v]) setSize(v); const o = localStorage.getItem('trash-sort'); if (SORTS[o]) setSort(o); } catch {} }, []);
  const pickSize = (v) => { smooth(() => setSize(v)); try { localStorage.setItem('folder-size', v); } catch {} };
  const pickSort = (v) => { smooth(() => setSort(v)); try { localStorage.setItem('trash-sort', v); } catch {} };

  const nameOf = (id) => folders.find((f) => f.id === (id || 'general'))?.name || (id ? id.toUpperCase() : 'General');

  // A poll never yanks a tile out while its exit animation is still playing.
  const load = useCallback(async () => {
    const d = await fetch(`/api/trash?kind=${kind}`, { cache: 'no-store' }).then((r) => r.json()).catch(() => null);
    if (!d) return;
    setItems((old) => {
      const kept = (old || []).filter((i) => holding.current.has(i.name) && !d.items.some((x) => x.name === i.name));
      const next = [...d.items, ...kept];
      return JSON.stringify(old) === JSON.stringify(next) ? old : next;
    });
  }, [kind]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 3000);
    const clock = setInterval(() => setNow(Date.now()), 30000);
    const kick = () => setTimeout(load, 400);
    window.addEventListener('studio:trashed', kick);
    return () => { clearInterval(poll); clearInterval(clock); window.removeEventListener('studio:trashed', kick); };
  }, [load]);
  useEffect(() => { if (!toast) return undefined; const t = setTimeout(() => setToast(null), 2400); return () => clearTimeout(t); }, [toast]);

  const list = useMemo(() => [...(items || [])].sort(SORTS[sort].fn), [items, sort]);
  const n = (items || []).length;
  const selItems = list.filter((i) => selected.has(i.name));

  const post = (body) => fetch('/api/trash', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const changed = () => window.dispatchEvent(new Event('studio:trash-changed'));

  // Take tiles off the grid once their exit is done; the rest glide into the gap (View Transition).
  const drop = (names) => {
    names.forEach((k) => holding.current.delete(k));
    smooth(() => {
      setItems((l) => (l || []).filter((i) => !names.includes(i.name)));
      setGone((g) => { const x = { ...g }; names.forEach((k) => delete x[k]); return x; });
    });
  };

  // ---- erase for good: step back (countdown) → dust → gone ----
  const burn = (names) => {
    names.forEach((k) => holding.current.add(k));
    setGone((g) => { const x = { ...g }; names.forEach((k) => { x[k] = 'burning'; }); return x; });
    let waiting = names.length;
    const done = async () => {
      if (--waiting) return;
      await post({ action: 'purge', names }).catch(() => null);
      drop(names);
      changed();
    };
    names.forEach((name, i) => {
      const el = imgs.current[name];
      const go = () => (el && !still() ? dust(el, done) : done());
      if (i) setTimeout(go, Math.min(i, 12) * 70); else go();
    });
  };

  const stopTimers = () => { timers.current.forEach(clearTimeout); timers.current = []; };
  const commit = () => {
    const p = pendingRef.current; if (!p) return;
    stopTimers(); pendingRef.current = null; setPending(null);
    burn(p.names);
  };
  const undo = () => { stopTimers(); pendingRef.current = null; setPending(null); };
  const askErase = (names, all = false) => {
    if (!names.length || pendingRef.current) return;
    const p = { names, n: names.length, all };
    pendingRef.current = p; setPending(p); setMenu(null); setSelected(new Set());
    setLeft(UNDO);
    for (let i = 1; i < UNDO; i++) timers.current.push(setTimeout(() => setLeft(UNDO - i), i * 1000));
    timers.current.push(setTimeout(commit, UNDO * 1000));
  };
  // Leaving the page (or a reload) CANCELS a pending erase: nothing is erased unless its countdown
  // reached 0 on screen or Delete now was pressed (MISTAKES U06).
  useEffect(() => () => { stopTimers(); pendingRef.current = null; }, []);

  // ---- restore: fly home to the folder in the sidebar → gone ----
  const restore = async (its) => {
    if (!its.length) return;
    setMenu(null); setSelected(new Set());
    const names = its.map((i) => i.name);
    names.forEach((k) => holding.current.add(k));
    const res = await Promise.all(its.map((it) => post({ action: 'restore', name: it.name }).catch(() => null)));
    const ok = its.filter((_, i) => res[i]?.ok);
    const bad = its.filter((_, i) => !res[i]?.ok).map((i) => i.name);
    bad.forEach((k) => holding.current.delete(k));
    if (bad.length) setToast(`Could not restore ${bad.length}`);
    if (!ok.length) return;
    changed();
    let waiting = ok.length;
    ok.forEach((it, i) => {
      const client = res[its.indexOf(it)].client ?? it.client;
      setTimeout(() => {
        flyHome(imgs.current[it.name], client, () => { if (--waiting === 0) drop(ok.map((x) => x.name)); });
        setGone((g) => ({ ...g, [it.name]: 'flying' })); // the tile's own image leaves the moment its copy lifts
      }, Math.min(i, 12) * 80);
    });
  };

  const select = (it, e) => {
    const k = it.name;
    if (e.shiftKey && anchor) {
      const a = list.findIndex((x) => x.name === anchor);
      const b = list.findIndex((x) => x.name === k);
      const [lo, hi] = a < b ? [a, b] : [b, a];
      setSelected(new Set(list.slice(lo, hi + 1).map((x) => x.name)));
    } else if (e.metaKey || e.ctrlKey) {
      setSelected((s) => { const x = new Set(s); x.has(k) ? x.delete(k) : x.add(k); return x; });
      setAnchor(k);
    } else {
      setSelected(new Set([k])); setAnchor(k);
    }
  };

  const openMenu = (it, e) => {
    const list2 = selected.has(it.name) ? selItems : [it];
    if (!selected.has(it.name)) { setSelected(new Set([it.name])); setAnchor(it.name); }
    const many = list2.length > 1;
    setMenu({
      x: e.clientX, y: e.clientY,
      items: [
        { label: many ? `Restore ${list2.length} Items` : `Restore to ${nameOf(it.client)}`, onClick: () => restore(list2) },
        { sep: true },
        { label: many ? `Delete ${list2.length} for Good` : 'Delete for Good', shortcut: '⌫', danger: true, onClick: () => askErase(list2.map((x) => x.name)) },
      ],
    });
  };

  // Keyboard: ⌘A all · Delete/Backspace erase (with undo) · Esc clears; during a countdown Esc / ⌘Z undo, ⌘⌫ delete now.
  useEffect(() => {
    const onKey = (e) => {
      if (menu || e.target.closest?.('input, textarea')) return;
      if (pendingRef.current) {
        if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); undo(); }
        else if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); commit(); }
        return;
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') { e.preventDefault(); setSelected(new Set(list.filter((i) => !gone[i.name]).map((i) => i.name))); }
      else if ((e.key === 'Backspace' || e.key === 'Delete') && selItems.length) { e.preventDefault(); askErase(selItems.map((i) => i.name)); }
      else if (e.key === 'Escape') setSelected(new Set());
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  useBarMorph(bar, pending ? 'undo' : 'main');
  const busy = Object.keys(gone).length > 0;
  const pendingSet = pending ? new Set(pending.names) : null;

  return (
    <section className="page trash-page" onClick={(e) => { if (e.target === e.currentTarget || e.target === box.current) setSelected(new Set()); }}>
      <PageTop
        kicker={{ video: 'Video', model: '3D' }[kind] || 'Image'}
        icon={<span className="trash-head-icon"><TrashIcon tight /></span>}
        title="Recently Deleted"
        chips={<>
          <span className="chip chip-count">{n} {n === 1 ? 'item' : 'items'}</span>
          {n > 0 && <span className="chip" title="Each item waits 1 day here, then goes to your Mac Trash">1 day</span>}
        </>}
        right={n > 0 && (
          <div className="glass-bar" role="toolbar" aria-label="View">
            <div className="tabs" role="group" aria-label="Thumbnail size">
              {Object.entries(SIZES).map(([k, v]) => (
                <button key={k} className="tab tab-icon" aria-pressed={size === k} onClick={() => pickSize(k)} title={v.label} aria-label={v.label}><SizeIcon k={k} /></button>
              ))}
            </div>
            <span className="glass-sep" aria-hidden="true" />
            <div className="tabs" role="group" aria-label="Sort by deleted date">
              {Object.entries(SORTS).map(([k, v]) => (
                <button key={k} className="tab" aria-pressed={sort === k} onClick={() => pickSort(k)}>{v.label}</button>
              ))}
            </div>
            <span className="glass-sep" aria-hidden="true" />
            <button className="fsel-btn icon danger bin-empty-btn" onClick={() => askErase(list.map((i) => i.name), true)} disabled={!!pending || busy} title="Empty Trash" aria-label="Empty Trash">
              <EraseIcon />
            </button>
          </div>
        )}
      />

      {items && n === 0 && (
        <EmptyStack compact icon={<TrashIcon />} title="Nothing deleted" text={`Deleted ${{ image: 'images', video: 'videos', model: '3D items' }[kind] || `${kind}s`} wait here for a day, then go to your Mac Trash.`} />
      )}

      {n > 0 && (
        <div className="fgrid bin-grid" ref={box} role="listbox" aria-multiselectable="true" style={{ '--tile': `${SIZES[size].px}px` }}>
          {list.map((it) => {
            const ms = new Date(it.expiresAt).getTime() - now;
            const g = gone[it.name];
            const cls = ['ftile', 'bin-tile'];
            if (selected.has(it.name)) cls.push('selected');
            if (pendingSet?.has(it.name) || g === 'burning') cls.push('pending');
            if (g) cls.push(g);
            return (
              <div
                key={it.name}
                className={cls.join(' ')}
                onClick={(e) => !g && select(it, e)}
                onContextMenu={(e) => { e.preventDefault(); if (!g && !pending) openMenu(it, e); }}
                role="option" aria-selected={selected.has(it.name)} tabIndex={-1}
              >
                <div className="ftile-thumb">
                  {/\.(mp4|mov|webm)$/i.test(it.file) // a 3D animation is a video too
                    ? <video ref={(el) => { imgs.current[it.name] = el; }} src={`/api/file?p=${encodeURIComponent(it.file)}#t=0.5`} muted playsInline preload="metadata" />
                    // eslint-disable-next-line @next/next/no-img-element
                    : <img ref={(el) => { imgs.current[it.name] = el; }} src={thumb(it.file)} alt="" draggable={false} />}
                </div>
                <div className="ftile-name" title={it.prompt || it.name}>{title(it)}</div>
                <div className={`ftile-sub${ms < 3600000 ? ' bin-soon' : ''}`}><span>{nameOf(it.client)}</span><i>·</i><span>{leftLabel(ms)}</span></div>
              </div>
            );
          })}
        </div>
      )}

      {(selItems.length > 0 || pending) && (
        <div ref={bar} className={`glass-bar fsel${pending ? ' is-undo' : ''}`} role="toolbar" aria-label={pending ? 'Deleting' : 'Selection'}>
          {pending ? (
            <div className="fsel-face" key="undo">
              <span className="fsel-sweep" aria-hidden="true" />
              <span className="fsel-tick" style={{ '--i': 0 }} aria-hidden="true"><b key={left}>{left}</b></span>
              <span className="fsel-msg" style={{ '--i': 1 }} aria-live="polite">{pending.all ? `Emptying trash · ${pending.n}` : `Deleting ${pending.n} for good`}</span>
              <button className="fsel-btn undo" style={{ '--i': 2 }} onClick={undo} title="Undo (Esc)"><RestoreIcon />Undo</button>
              <button className="fsel-btn danger now" style={{ '--i': 3 }} onClick={commit} title="Delete now (⌘⌫)"><EraseIcon />Delete now</button>
            </div>
          ) : (
            <div className="fsel-face" key="main">
              <span className="fsel-count" style={{ '--i': 0 }} aria-live="polite"><b key={selItems.length}>{selItems.length}</b>selected</span>
              <span className="glass-sep" style={{ '--i': 1 }} aria-hidden="true" />
              <button className="fsel-btn" style={{ '--i': 2 }} onClick={() => restore(selItems)}><RestoreIcon />Restore</button>
              <button className="fsel-btn danger" style={{ '--i': 3 }} onClick={() => askErase(selItems.map((i) => i.name))}><EraseIcon />Delete</button>
              <button className="fsel-btn icon fsel-x" style={{ '--i': 4 }} onClick={() => setSelected(new Set())} aria-label="Clear selection" title="Clear selection (Esc)"><CloseIcon /></button>
            </div>
          )}
        </div>
      )}

      {menu && <ContextMenu {...menu} onClose={() => setMenu(null)} />}
      {toast && <div className="ftoast" key={toast}>{toast}</div>}
    </section>
  );
}
