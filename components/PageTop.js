'use client';

// The pinned top of every page, one grid in three rows: path; title with the theme
// toggle on its line; chips with the page controls on their line (first chip row
// centred on the 42px control bars). It stays fixed as a frosted layer while content scrolls
// under it, and tightens once you scroll.

import { useEffect, useState } from 'react';
import ThemeToggle from '@/components/ThemeToggle';

export function FolderIcon() {
  return <span className="fhead-icon" aria-hidden="true"><span /></span>;
}

export default function PageTop({ kicker, icon, title, chips, right }) {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    // Two thresholds, not one. Tightening makes the bar ~48 px shorter, which pulls the page up by
    // the same amount; with a single 24 px line that dropped scrollY back under the line, the bar grew,
    // the page pushed down, and it looped — the bar "vibrated" while scrolling. The gap between
    // ENTER and LEAVE (72 px) is wider than the shrink, so one toggle can never cause the next.
    const ENTER = 80, LEAVE = 8;
    const onScroll = () => {
      const y = window.scrollY;
      setScrolled((s) => (s ? y > LEAVE : y > ENTER));
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  return (
    <div className={`topbar${scrolled ? ' scrolled' : ''}`}>
      <div className="topbar-grid">
        {kicker && <div className="page-kicker crumbs tb-kicker">{kicker}</div>}
        <div className="fhead-title tb-title">{icon}<h1>{title}</h1></div>
        <div className="tb-theme"><ThemeToggle /></div>
        {chips && <div className="fhead-chips tb-chips">{chips}</div>}
        {right && <div className="fcontrols tb-controls">{right}</div>}
      </div>
    </div>
  );
}
