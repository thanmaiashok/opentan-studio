'use client';

// One blue pill per segmented control (.tabs, .set-seg) that SLIDES and stretches from the old choice
// to the new one instead of jumping. Mounted once; it watches the whole page, so every switch — folder
// size + sort, Art Direction Glance/Map, Settings — gets it with no per-component code.
import { useEffect } from 'react';

const GROUPS = '.tabs, .set-seg';
const ACTIVE = '[aria-pressed="true"], [aria-checked="true"]';

function place(group) {
  const active = group.querySelector(ACTIVE);
  if (!active) { group.classList.remove('pill-on'); return; }
  const s = group.style;
  s.setProperty('--pill-x', `${active.offsetLeft}px`);
  s.setProperty('--pill-y', `${active.offsetTop}px`);
  s.setProperty('--pill-w', `${active.offsetWidth}px`);
  s.setProperty('--pill-h', `${active.offsetHeight}px`);
  s.setProperty('--pill-r', getComputedStyle(active).borderRadius);
  if (!group.classList.contains('pill-on')) {
    group.classList.add('pill-on');
    // First placement never animates (no slide in from the left edge); later moves do.
    setTimeout(() => group.classList.add('pill-ready'), 60);
  }
}

export default function SlidingPills() {
  useEffect(() => {
    // Coalesce: at most one measure per ~frame. A timer, not requestAnimationFrame (rAF pauses in
    // background/embedded views), and never cancel-and-reschedule (constant updates would starve it).
    let frame = 0;
    const all = () => {
      if (frame) return;
      frame = setTimeout(() => { frame = 0; document.querySelectorAll(GROUPS).forEach(place); }, 16);
    };
    all();
    const mo = new MutationObserver(all);
    mo.observe(document.body, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-pressed', 'aria-checked', 'class'] });
    window.addEventListener('resize', all);
    document.fonts?.ready?.then(all);
    return () => { mo.disconnect(); window.removeEventListener('resize', all); clearTimeout(frame); };
  }, []);
  return null;
}
