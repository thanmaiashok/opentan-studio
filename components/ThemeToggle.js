'use client';

// Light / dark switch, pinned top-right on every page. Remembers the choice;
// the first visit follows the Mac's appearance setting.

import { useEffect, useState } from 'react';

function Sun() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="10" cy="10" r="3.4" />
      <path d="M10 2.6v1.6M10 15.8v1.6M2.6 10h1.6M15.8 10h1.6M4.8 4.8l1.1 1.1M14.1 14.1l1.1 1.1M4.8 15.2l1.1-1.1M14.1 5.9l1.1-1.1" />
    </svg>
  );
}

function Moon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M15.6 12.6A6.2 6.2 0 0 1 7.4 4.4a6.2 6.2 0 1 0 8.2 8.2z" />
    </svg>
  );
}

export default function ThemeToggle() {
  const [theme, setTheme] = useState(null);
  useEffect(() => { setTheme(document.documentElement.dataset.theme || 'light'); }, []);

  const pick = (t) => {
    setTheme(t);
    document.documentElement.dataset.theme = t;
    try { localStorage.setItem('theme', t); } catch {}
  };

  return (
    <div className="theme-toggle" role="group" aria-label="Appearance">
      <span className={`theme-knob${theme === 'dark' ? ' right' : ''}`} aria-hidden="true" />
      <button aria-pressed={theme !== 'dark'} aria-label="Light mode" title="Light mode" onClick={() => pick('light')}><Sun /></button>
      <button aria-pressed={theme === 'dark'} aria-label="Dark mode" title="Dark mode" onClick={() => pick('dark')}><Moon /></button>
    </div>
  );
}
