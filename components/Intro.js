'use client';

// Opening animation (once per browser session): the OpenTan "hello" reveal from FoxMotion
// (film 2026-11-15_opentan-hello, kit in public/opentan/). "OpenTan" writes itself in blue
// liquid glass, folds into the T mark, then the board shows through. A click skips it.

import { useEffect, useRef, useState } from 'react';

const SRC = '/opentan/opentan-hello.js';

export default function Intro() {
  const [phase, setPhase] = useState('hidden'); // hidden | play | out | done
  const seen = useRef(null); // read once; survives React dev double-effects
  const el = useRef(null);

  useEffect(() => {
    // Decide once. React dev runs effects twice; a second run must not cancel the first decision.
    if (seen.current !== null) return;
    seen.current = false;
    try { seen.current = sessionStorage.getItem('intro-seen') === '1'; sessionStorage.setItem('intro-seen', '1'); } catch {}
    if (seen.current || window.matchMedia('(prefers-reduced-motion: reduce)').matches) { setPhase('done'); return; }
    if (!customElements.get('opentan-hello') && !document.querySelector(`script[src="${SRC}"]`)) {
      const s = document.createElement('script');
      s.src = SRC;
      document.body.appendChild(s);
    }
    setPhase('play');
  }, []);

  useEffect(() => {
    if (phase === 'out') { const t = setTimeout(() => setPhase('done'), 600); return () => clearTimeout(t); }
    if (phase !== 'play') return undefined;
    const node = el.current;
    const end = () => setPhase('out');
    node?.addEventListener('opentan:done', end);
    const guard = setTimeout(end, 9500); // the film is 8 s; never trap the board if the script fails
    return () => { node?.removeEventListener('opentan:done', end); clearTimeout(guard); };
  }, [phase]);

  if (phase === 'done' || phase === 'hidden') return null;
  return (
    <div className={`intro phase-${phase}`} aria-hidden="true" onClick={() => setPhase('out')}>
      <opentan-hello ref={el} sound="/opentan/opentan-hello.mp3" background="none" fit="contain" class="intro-film" />
    </div>
  );
}
