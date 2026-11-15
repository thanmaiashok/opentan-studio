'use client';

// Models are touched, not looked at (owner 2026-11-14: "Models means you can interact 3D … when I click,
// I should be able to interact it"). The viewer stage for a 3D model: its GLB in <model-viewer>, drag to turn,
// scroll / pinch to zoom, right-drag to pan, double-click to reset. The preview still shows at once while the
// GLB streams in (a thin blue line fills under it); it slowly turns until the first touch.

import { useEffect, useRef, useState } from 'react';

export default function ModelStage({ job, poster, name, dragRef }) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false); // the web component is defined (client only)
  const [progress, setProgress] = useState(0);
  const [failed, setFailed] = useState(false);
  const src = `/api/model?job=${encodeURIComponent(job.id)}&inline=1`;

  useEffect(() => {
    let live = true;
    import('@google/model-viewer').then(() => { if (live) setReady(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; };
  }, []);

  useEffect(() => { setProgress(0); setFailed(false); }, [job.id]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return undefined;
    const onProgress = (e) => setProgress(e.detail?.totalProgress ?? 0);
    const onError = () => setFailed(true);
    // keys turn the model while it has focus; they must not also step to the next item
    const onKey = (e) => { if (e.key.startsWith('Arrow')) e.stopPropagation(); };
    el.addEventListener('progress', onProgress);
    el.addEventListener('error', onError);
    el.addEventListener('keydown', onKey);
    return () => {
      el.removeEventListener('progress', onProgress);
      el.removeEventListener('error', onError);
      el.removeEventListener('keydown', onKey);
    };
  }, [ready, job.id]);

  // a drag that ends outside the model must not count as a click on the backdrop (that closes the viewer)
  const start = useRef(null);
  // only the click that ends the drag is swallowed: the flag clears right after the release, wherever it lands
  const down = (e) => {
    start.current = [e.clientX, e.clientY];
    if (dragRef) dragRef.current = false;
    const release = () => {
      window.removeEventListener('pointerup', release, true);
      window.removeEventListener('pointercancel', release, true);
      start.current = null;
      setTimeout(() => { if (dragRef) dragRef.current = false; }, 0); // after this release's click
    };
    window.addEventListener('pointerup', release, true);
    window.addEventListener('pointercancel', release, true);
  };
  const move = (e) => {
    if (!start.current || !dragRef) return;
    if (Math.hypot(e.clientX - start.current[0], e.clientY - start.current[1]) > 4) dragRef.current = true;
  };
  const up = () => { start.current = null; };
  const reset = () => {
    const el = ref.current;
    if (!el) return;
    el.cameraOrbit = 'auto auto auto';
    el.cameraTarget = 'auto auto auto';
    el.fieldOfView = 'auto';
    el.jumpCameraToGoal?.();
  };

  return (
    <div
      className="vw-model"
      onClick={(e) => e.stopPropagation()}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onDoubleClick={reset}
    >
      {failed || !ready ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img className="vw-model-poster" src={poster} alt={name} />
      ) : (
        <model-viewer
          key={job.id}
          ref={ref}
          src={src}
          poster={poster}
          alt={name}
          camera-controls=""
          auto-rotate=""
          auto-rotate-delay="0"
          rotation-per-second="14deg"
          interaction-prompt="none"
          shadow-intensity="1"
          shadow-softness="0.9"
          exposure="1"
          environment-image="neutral"
          interpolation-decay="120"
          touch-action="none"
          style={{ width: '100%', height: '100%', '--poster-color': 'transparent', '--progress-bar-height': '0px' }}
        />
      )}
      <div className={`vw-model-load${progress >= 1 || failed ? ' is-done' : ''}`} aria-hidden="true">
        <span style={{ transform: `scaleX(${failed ? 0 : progress})` }} />
      </div>
      <p className="vw-model-hint" role="note">
        {failed ? 'Could not load the GLB, showing its still' : 'Drag to turn · scroll to zoom · double-click to reset'}
      </p>
    </div>
  );
}
