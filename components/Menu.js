'use client';

// Mac-style context menu (items stagger in, blur to sharp) and the prompt pill used by the file
// manager. The prompt is no dialog: a glass pill rises above the dock, like the selection bar
// (owner law 16: house motion motion, never a centred dialog).

import { useEffect, useLayoutEffect, useRef, useState } from 'react';

// Page shortcuts stay quiet while something sits on top (viewer, Settings, a prompt pill, a menu)
// or while typing: those keys belong to the layer in front.
export function keysBlocked(e) {
  const el = e?.target;
  if (el?.closest?.('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return true;
  return typeof document !== 'undefined' && !!document.querySelector('.viewer, .settings-backdrop, .ask-layer, .ctx');
}

/**
 * items: [{ label, onClick, danger, disabled, shortcut } | { sep: true } | { label, sub: [items] }]
 */
export function ContextMenu({ x, y, items, onClose }) {
  const ref = useRef(null);
  const [pos, setPos] = useState({ left: x, top: y });
  const [openSub, setOpenSub] = useState(null);

  useLayoutEffect(() => {
    const r = ref.current.getBoundingClientRect();
    setPos({
      left: Math.min(x, window.innerWidth - r.width - 8),
      top: Math.min(y, window.innerHeight - r.height - 8),
    });
  }, [x, y]);

  useEffect(() => {
    const close = (e) => { if (!ref.current?.contains(e.target)) onClose(); };
    const key = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('mousedown', close);
    window.addEventListener('keydown', key);
    window.addEventListener('blur', onClose);
    return () => {
      window.removeEventListener('mousedown', close);
      window.removeEventListener('keydown', key);
      window.removeEventListener('blur', onClose);
    };
  }, [onClose]);

  const run = (item) => { if (item.disabled || item.sub) return; onClose(); item.onClick?.(); };

  return (
    <div className="ctx" ref={ref} style={{ ...pos, transformOrigin: `${pos.left < x ? 'right' : 'left'} ${pos.top < y ? 'bottom' : 'top'}` }} role="menu" onContextMenu={(e) => e.preventDefault()}>
      {items.map((item, i) => (item.sep ? <div key={i} className="ctx-sep" style={{ '--i': i }} /> : (
        <div
          key={i}
          style={{ '--i': i }}
          role="menuitem"
          aria-disabled={item.disabled || undefined}
          className={`ctx-item${item.danger ? ' danger' : ''}${item.sub ? ' has-sub' : ''}`}
          onMouseEnter={() => setOpenSub(item.sub ? i : null)}
          onClick={() => run(item)}
        >
          <span>{item.label}</span>
          {item.shortcut && <kbd>{item.shortcut}</kbd>}
          {item.sub && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4.5 3l3 3-3 3" /></svg>}
          {item.sub && openSub === i && (
            <div className="ctx ctx-sub" role="menu">
              {item.sub.map((s, j) => (s.sep ? <div key={j} className="ctx-sep" /> : (
                <div
                  key={j}
                  role="menuitem"
                  aria-disabled={s.disabled || undefined}
                  className="ctx-item"
                  onClick={(e) => { e.stopPropagation(); run(s); }}
                >
                  <span>{s.label}</span>
                </div>
              )))}
            </div>
          )}
        </div>
      )))}
    </div>
  );
}

/**
 * Prompt pill: ask for a name / note, or confirm. Rises above the dock as one glass bar.
 * { title, message, input (default value) | undefined, placeholder, confirm: 'Create', danger, onSubmit(value) }
 */
export function Sheet({ title, message, input, placeholder, confirm = 'OK', danger, onSubmit, onClose }) {
  const [value, setValue] = useState(input ?? '');
  const field = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  // once on open: callers pass a new onClose every render, and a re-run would select (and so replace) what is typed
  useEffect(() => {
    const t = setTimeout(() => field.current?.select(), 60);
    const key = (e) => e.key === 'Escape' && closeRef.current();
    window.addEventListener('keydown', key);
    return () => { clearTimeout(t); window.removeEventListener('keydown', key); };
  }, []);
  const empty = input !== undefined && !value.trim();
  const submit = (e) => {
    e.preventDefault();
    if (empty) return;
    onSubmit(value.trim());
    onClose();
  };
  return (
    <div className="ask-layer" onMouseDown={onClose}>
      <form className="glass-bar ask-pill" onSubmit={submit} onMouseDown={(e) => e.stopPropagation()} aria-label={title}>
        {message && <p className="prompt-hint">{message}</p>}
        <div className="fsel-face">
          <span className="prompt-title" style={{ '--i': 0 }}>{title}</span>
          {input !== undefined && (
            <input
              ref={field} className="prompt-input" style={{ '--i': 1 }} value={value} placeholder={placeholder}
              onChange={(e) => setValue(e.target.value)} autoFocus spellCheck={false}
            />
          )}
          <button type="submit" className={`fsel-btn prompt-ok${danger ? ' danger-fill' : ''}`} style={{ '--i': 2 }} disabled={empty} autoFocus={input === undefined}>{confirm}</button>
          <button type="button" className="fsel-btn icon fsel-x" style={{ '--i': 3 }} onClick={onClose} aria-label="Cancel" title="Cancel (Esc)">
            <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7" /></svg>
          </button>
        </div>
      </form>
    </div>
  );
}

/**
 * Quick undo (house motion): a glass pill above the dock counts down, a red sweep fills it, and the
 * action runs only at 0. Undo, Esc or ⌘Z cancels. Same look as the folder selection bar's undo face.
 * { label: 'Deleting folder “X”', ms = 5000, onUndo, onDone }
 */
export function UndoPill({ label, ms = 5000, onUndo, onDone, onNow, nowLabel = 'Delete now' }) {
  const [left, setLeft] = useState(Math.round(ms / 1000));
  const cb = useRef({ onUndo, onDone, onNow });
  cb.current = { onUndo, onDone, onNow };
  const fired = useRef(false); // countdown end and Delete now never both run
  const finish = () => { if (fired.current) return; fired.current = true; (cb.current.onNow || cb.current.onDone)(); };
  useEffect(() => {
    const start = Date.now();
    const tick = setInterval(() => setLeft(Math.max(1, Math.ceil((ms - (Date.now() - start)) / 1000))), 200);
    const done = setTimeout(() => { if (!fired.current) { fired.current = true; cb.current.onDone(); } }, ms);
    const key = (e) => {
      if (e.key === 'Escape' || ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z')) { e.preventDefault(); cb.current.onUndo(); }
      else if ((e.metaKey || e.ctrlKey) && (e.key === 'Backspace' || e.key === 'Delete')) { e.preventDefault(); finish(); }
    };
    window.addEventListener('keydown', key);
    return () => { clearInterval(tick); clearTimeout(done); window.removeEventListener('keydown', key); };
  }, [ms]);
  return (
    <div className="glass-bar fsel is-undo" role="status" aria-label={label}>
      <div className="fsel-face">
        <span className="fsel-sweep" style={{ animationDuration: `${ms}ms` }} aria-hidden="true" />
        <span className="fsel-tick" style={{ '--i': 0 }} aria-hidden="true"><b key={left}>{left}</b></span>
        <span className="fsel-msg" style={{ '--i': 1 }}>{label}</span>
        <button className="fsel-btn undo" style={{ '--i': 2 }} onClick={() => cb.current.onUndo()} title="Undo (Esc)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M5.5 3.5 3 6l2.5 2.5M3 6h6.25a3.75 3.75 0 0 1 0 7.5H6" /></svg>Undo
        </button>
        <button className="fsel-btn danger now" style={{ '--i': 3 }} onClick={finish} title="Delete now (⌘⌫)">
          <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M2.75 4.25h10.5M6.5 4.25V2.75h3v1.5M4.25 4.25l.6 8.1a1 1 0 0 0 1 .9h4.3a1 1 0 0 0 1-.9l.6-8.1" /></svg>{nowLabel}
        </button>
      </div>
    </div>
  );
}
