'use client';

// Smooth motion helpers for the board (owner 2026-11-14: "I should feel it smooth … embodying to one another").
// smooth(fn): run a state change inside a View Transition, so the old view morphs into the new one
// (tiles that exist in both glide to their new size/place; the rest cross-fades). Falls back to an
// instant change when the browser lacks View Transitions or the user prefers reduced motion.
import { useLayoutEffect, useRef } from 'react';
import { flushSync } from 'react-dom';

export function smooth(update) {
  if (typeof document === 'undefined' || !document.startViewTransition
    || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { update(); return; }
  // Run the update exactly once: inside the transition, or after 250 ms if the view isn't painting
  // (a hidden/embedded window never starts the transition — the click must still work).
  let done = false;
  const run = () => { if (!done) { done = true; flushSync(update); } };
  const vt = document.startViewTransition(run);
  // A skipped transition rejects these promises; nothing waits on them, so keep the console clean.
  [vt.ready, vt.finished, vt.updateCallbackDone].forEach((p) => p?.catch?.(() => {}));
  setTimeout(() => { if (!done) { vt.skipTransition?.(); run(); } }, 250);
}

// A floating glass bar (selection bar) keeps its centre and morphs its width when its face changes
// (FLIP on width). Call on every render with the bar's ref and a string naming the current face.
export function useBarMorph(ref, face) {
  const last = useRef({ face: null, w: 0 });
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) { last.current = { face: null, w: 0 }; return; }
    const prev = last.current;
    if (prev.face && prev.face !== face && prev.w && !window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      el.style.width = '';
      const to = el.offsetWidth;
      el.style.width = `${prev.w}px`;
      el.getBoundingClientRect();
      el.style.width = `${to}px`;
      const end = () => { el.style.width = ''; el.removeEventListener('transitionend', end); };
      el.addEventListener('transitionend', end);
      last.current = { face, w: to };
    } else if (!el.style.width) {
      last.current = { face, w: el.offsetWidth };
    }
  });
}
