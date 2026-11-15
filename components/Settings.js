'use client';

// Settings: a gear pinned bottom-left on every page, opening a panel with four tabs.
// General shows whether every tool the studio drives is live; Image, Video and 3D (Blender) hold the
// owner's defaults (bin/studio.mjs reads them) and the rules Claude follows (data/settings.json).

import { useCallback, useEffect, useRef, useState } from 'react';

const TABS = [
  { id: 'general', label: 'General' },
  { id: 'image', label: 'Image' },
  { id: 'video', label: 'Video' },
  { id: 'model', label: '3D' },
];
const TAB_TITLE = { image: 'Image', video: 'Video', model: '3D' };

function TabIcon({ id }) {
  if (id === 'image') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="3" y="3.8" width="14" height="12.4" rx="2.2" /><circle cx="7.6" cy="8" r="1.4" />
        <path d="M3.4 14.2l3.8-3.8a1.2 1.2 0 0 1 1.7 0l3.6 3.6M11.4 12.9l1.6-1.6a1.2 1.2 0 0 1 1.7 0l2.4 2.4" />
      </svg>
    );
  }
  if (id === 'model') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <path d="M10 2.8l6.2 3.5v7.4L10 17.2l-6.2-3.5V6.3z" /><path d="M3.9 6.3L10 9.8l6.1-3.5M10 9.8v7.3" />
      </svg>
    );
  }
  if (id === 'video') {
    return (
      <svg viewBox="0 0 20 20" aria-hidden="true">
        <rect x="2.6" y="4.8" width="10.8" height="10.4" rx="2.2" />
        <path d="M13.4 8.6l3.4-2a.5.5 0 0 1 .8.4v6a.5.5 0 0 1-.8.4l-3.4-2" />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M3.5 6h8M14.5 6h2M3.5 14h2M8.5 14h8" /><circle cx="13" cy="6" r="1.8" /><circle cx="7" cy="14" r="1.8" />
    </svg>
  );
}

function Gear() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <path d="M8.6 2.8h2.8l.4 2a5.4 5.4 0 0 1 1.5.9l1.9-.7 1.4 2.4-1.5 1.3a5.4 5.4 0 0 1 0 1.8l1.5 1.3-1.4 2.4-1.9-.7a5.4 5.4 0 0 1-1.5.9l-.4 2H8.6l-.4-2a5.4 5.4 0 0 1-1.5-.9l-1.9.7-1.4-2.4 1.5-1.3a5.4 5.4 0 0 1 0-1.8L3.4 7.4l1.4-2.4 1.9.7a5.4 5.4 0 0 1 1.5-.9z" />
      <circle cx="10" cy="10" r="2.3" />
    </svg>
  );
}

const STATE_LABEL = { live: 'Ready', off: 'Off', busy: 'Busy', checking: 'Checking' };

function ago(iso, now) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 5) return 'just now';
  if (s < 60) return `${s} s ago`;
  if (s < 3600) return `${Math.round(s / 60)} min ago`;
  if (s < 86400) return `${Math.round(s / 3600)} h ago`;
  return `${Math.round(s / 86400)} d ago`;
}

export function Segmented({ value, options, onChange, label }) {
  return (
    <div className="set-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>{o.label}</button>
      ))}
    </div>
  );
}

// The slider: blue track, white knob, the knob stretches while pressed and springs across.
// A locked rule stays fully on and carries a lock in its knob instead of being greyed out.
export function Switch({ on, onChange, label, locked }) {
  return (
    <button
      className={`set-switch${on ? ' on' : ''}${locked ? ' locked' : ''}`}
      role="switch" aria-checked={on} aria-label={label} aria-disabled={locked || undefined}
      title={locked ? 'Always on' : undefined}
      onClick={() => !locked && onChange(!on)}
    >
      <span className="set-knob">
        {locked
          ? <svg viewBox="0 0 12 12" aria-hidden="true"><rect x="2.6" y="5.4" width="6.8" height="4.6" rx="1.2" /><path d="M4.2 5.4V4a1.8 1.8 0 0 1 3.6 0v1.4" /></svg>
          : <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 6.2l1.9 1.9 3.7-4" /></svg>}
      </span>
    </button>
  );
}

function Row({ title, note, children }) {
  return (
    <div className="set-row">
      <div className="set-row-text"><span>{title}</span>{note && <small>{note}</small>}</div>
      <div className="set-row-control">{children}</div>
    </div>
  );
}

// The hero number, in the same blue card as "Generated in" on the image viewer.
function Hero({ label, value, tone }) {
  return (
    <div className={`set-hero${tone ? ` ${tone}` : ''}`}>
      <span>{label}</span>
      <strong key={value}>{value}</strong>
    </div>
  );
}

// The quieter numbers: a label / value list on a grey well, like the viewer's details.
function Facts({ items }) {
  return (
    <dl className="set-facts">
      {items.map(([label, value]) => (
        <div key={label}><dt>{label}</dt><dd>{value}</dd></div>
      ))}
    </dl>
  );
}

// Tool state as one quiet word with a mark, no traffic-light dots.
function State({ state }) {
  if (state === 'checking') return <span className="set-state checking" aria-label="Checking"><i /></span>;
  return (
    <span className={`set-state ${state}`}>
      {state === 'live' && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M3.2 6.2l1.9 1.9 3.7-4" /></svg>}
      {state === 'off' && <svg viewBox="0 0 12 12" aria-hidden="true"><path d="M4 4l4 4M8 4l-4 4" /></svg>}
      {state === 'busy' && <svg viewBox="0 0 12 12" aria-hidden="true" className="spin"><path d="M6 2.2a3.8 3.8 0 1 1-3.8 3.8" /></svg>}
      {STATE_LABEL[state]}
    </span>
  );
}

function General({ status, checking, onRefresh, now }) {
  const tools = status?.tools || [];
  const live = tools.filter((t) => t.state === 'live').length;
  const all = tools.length > 0 && live === tools.length;
  return (
    <>
      <header className="set-head">
        <h3>General</h3>
        <p>{!status ? 'Checking every tool…' : all ? 'Everything is connected and ready.' : `${tools.length - live} tool${tools.length - live === 1 ? '' : 's'} need attention.`}</p>
      </header>
      <Hero label="Tools ready" value={status ? `${live} of ${tools.length}` : '…'} tone={status && !all ? 'warn' : ''} />
      <div className="set-group">
        <div className="set-group-head">
          <span>Connections</span>
          <button className={`set-refresh${checking ? ' is-checking' : ''}`} onClick={onRefresh} disabled={checking}>
            <span className="set-refresh-fill" aria-hidden="true" />
            <svg viewBox="0 0 16 16" aria-hidden="true" className={checking ? 'spin' : ''}><path d="M13 8a5 5 0 1 1-1.5-3.6M13 2.8v2.6h-2.6" /></svg>
            <span className="set-refresh-label" key={checking ? 'c' : 'd'}>{checking ? 'Checking' : `Checked ${ago(status?.checkedAt, now)}`}</span>
          </button>
        </div>
        <div className="set-card">
          {(tools.length ? tools : [{ id: 'a' }, { id: 'b' }, { id: 'c' }, { id: 'd' }]).map((t) => {
            const state = checking || !t.state ? 'checking' : t.state;
            return (
              <div key={t.id} className={`set-tool${t.name ? '' : ' is-ghost'}`}>
                <div className="set-tool-text">
                  <span>{t.name || ' '}{t.version && <em>{t.version}</em>}</span>
                  <small>{t.detail || t.role || ' '}</small>
                </div>
                <State state={state} />
              </div>
            );
          })}
        </div>
      </div>
    </>
  );
}

// Upscaler (law 29): used only when a job asks for 2K / 4K. One setting, shown in Image and Video.
function Upscaler({ settings, set }) {
  const u = settings.upscale || { engine: 'tan', preset: 'ai' };
  return (
    <div className="set-group">
      <div className="set-group-head"><span>Upscaler</span></div>
      <div className="set-card">
        <Row title="Engine" note="Only for 2K / 4K jobs · TAN Upscaler is free">
          <Segmented label="Upscaler" value={u.engine} onChange={(v) => set('upscale', 'engine', v)}
            options={[{ value: 'tan', label: 'TAN Upscaler' }, { value: 'flow', label: 'Flow' }]} />
        </Row>
        <Row title="Mode" note="Clean for our work · Restore for old footage">
          <Segmented label="Upscale mode" value={u.preset} onChange={(v) => set('upscale', 'preset', v)}
            options={[{ value: 'ai', label: 'Clean' }, { value: 'restore', label: 'Restore' }]} />
        </Row>
      </div>
    </div>
  );
}

function ImageTab({ settings, info, set }) {
  const s = settings.image;
  return (
    <>
      <header className="set-head"><h3>Image</h3><p>Defaults for stills and posters.</p></header>
      <Hero label="Images made" value={info.images} />
      <Facts items={[['References', info.refs], ['Families', info.families], ['Folders', info.clients]]} />
      <div className="set-group">
        <div className="set-group-head"><span>Defaults</span></div>
        <div className="set-card">
          <Row title="Engine" note="Used when a job doesn't name one">
            <Segmented label="Engine" value={s.engine} onChange={(v) => set('image', 'engine', v)}
              options={[{ value: 'codex', label: 'ChatGPT' }, { value: 'flow', label: 'Flow' }]} />
          </Row>
          <Row title="Aspect ratio">
            <Segmented label="Aspect ratio" value={s.ratio} onChange={(v) => set('image', 'ratio', v)}
              options={['1:1', '4:5', '9:16', '16:9'].map((r) => ({ value: r, label: r }))} />
          </Row>
        </div>
      </div>
      <Upscaler settings={settings} set={set} />
      <div className="set-group">
        <div className="set-group-head"><span>Rules for Claude</span></div>
        <div className="set-card">
          <Row title="Judge every poster" note="Check against Art Direction, rerun if it fails">
            <Switch label="Judge every poster" on={s.judgePosters} onChange={(v) => set('image', 'judgePosters', v)} />
          </Row>
          <Row title="Pinterest backup" note="Search Pinterest only when no references are given">
            <Switch label="Pinterest backup" on={s.pinterestBackup} onChange={(v) => set('image', 'pinterestBackup', v)} />
          </Row>
        </div>
      </div>
    </>
  );
}

function VideoTab({ settings, info, set, now }) {
  const s = settings.video;
  return (
    <>
      <header className="set-head"><h3>Video</h3><p>Defaults for Google Flow video.</p></header>
      <Hero label="Videos made" value={info.videos} />
      <Facts items={[['Credits checked', ago(info.creditsCheckedAt, now)]]} />
      <div className="set-group">
        <div className="set-group-head"><span>Defaults</span></div>
        <div className="set-card">
          <Row title="Aspect ratio">
            <Segmented label="Aspect ratio" value={s.ratio} onChange={(v) => set('video', 'ratio', v)}
              options={['16:9', '9:16'].map((r) => ({ value: r, label: r }))} />
          </Row>
          <Row title="Resolution" note="1080p costs more credits">
            <Segmented label="Resolution" value={s.resolution} onChange={(v) => set('video', 'resolution', v)}
              options={['720p', '1080p'].map((r) => ({ value: r, label: r }))} />
          </Row>
        </div>
      </div>
      <Upscaler settings={settings} set={set} />
      {settings.edit && (
        // law 27: what Export on the Edit page starts with (owner 2026-11-14: "default … 2K 60fps")
        <div className="set-group">
          <div className="set-group-head"><span>Edit export</span></div>
          <div className="set-card">
            <Row title="Resolution" note="Export on the Edit page starts here">
              <Segmented label="Edit export resolution" value={settings.edit.resolution} onChange={(v) => set('edit', 'resolution', v)}
                options={[['source', 'Source'], ['1080p', '1080p'], ['2k', '2K'], ['4k', '4K']].map(([value, label]) => ({ value, label }))} />
            </Row>
            <Row title="Frame rate" note="Slower clips get smooth motion to reach it">
              <Segmented label="Edit export frame rate" value={settings.edit.fps} onChange={(v) => set('edit', 'fps', v)}
                options={[30, 60].map((v) => ({ value: v, label: `${v} fps` }))} />
            </Row>
            <Row title="Enhance" note="TAN Upscaler Clean when the picture grows">
              <Switch label="Enhance on export" on={settings.edit.enhance} onChange={(v) => set('edit', 'enhance', v)} />
            </Row>
          </div>
        </div>
      )}
      <div className="set-group">
        <div className="set-group-head"><span>Rules for Claude</span></div>
        <div className="set-card">
          <Row title="Draft first" note="Draft on Lite or Fast, Quality only for the final">
            <Switch label="Draft first" on={s.draftFirst} onChange={(v) => set('video', 'draftFirst', v)} />
          </Row>
          <Row title="Remove Gemini watermark" note="Clean the visible Veo mark from every new video, keep the original aside">
            <Switch label="Remove Gemini watermark" on={s.removeWatermark !== false} onChange={(v) => set('video', 'removeWatermark', v)} />
          </Row>
          <Row title="Ask before 50+ credits" note="Always on">
            <Switch label="Ask before 50+ credits" on locked onChange={() => {}} />
          </Row>
        </div>
      </div>
    </>
  );
}

function ModelTab({ settings, info, set, tool }) {
  const s = settings.blender;
  const b = (key) => (v) => set('blender', key, v);
  return (
    <>
      <header className="set-head"><h3>3D</h3><p>Blender, driven by Claude. Defaults for models and renders.</p></header>
      <Hero label="Renders made" value={info.models} />
      <Facts items={[['Scenes saved', info.modelAssets], ['Blender', tool?.version || '…'], ['Command', 'studio blender']]} />
      <div className="set-group">
        <div className="set-group-head"><span>Connection</span></div>
        <div className="set-card">
          <Row title="Work in" note="Live = open window · Headless = in the background">
            <Segmented label="Work in" value={s.bridge} onChange={b('bridge')}
              options={[{ value: 'live', label: 'Live' }, { value: 'cli', label: 'Headless' }]} />
          </Row>
        </div>
      </div>
      <div className="set-group">
        <div className="set-group-head"><span>Render</span></div>
        <div className="set-card">
          <Row title="Engine" note="Eevee is fast · Cycles is ray traced">
            <Segmented label="Engine" value={s.engine} onChange={b('engine')}
              options={[{ value: 'eevee', label: 'Eevee' }, { value: 'cycles', label: 'Cycles' }, { value: 'workbench', label: 'Workbench' }]} />
          </Row>
          <Row title="Device" note="GPU uses Metal on this Mac">
            <Segmented label="Device" value={s.device} onChange={b('device')}
              options={[{ value: 'gpu', label: 'GPU' }, { value: 'cpu', label: 'CPU' }]} />
          </Row>
          <Row title="Samples" note="More is cleaner and slower">
            <Segmented label="Samples" value={s.samples} onChange={b('samples')}
              options={[64, 128, 256, 512].map((n) => ({ value: n, label: String(n) }))} />
          </Row>
          <Row title="Aspect ratio">
            <Segmented label="Aspect ratio" value={s.ratio} onChange={b('ratio')}
              options={['1:1', '4:5', '9:16', '16:9'].map((r) => ({ value: r, label: r }))} />
          </Row>
          <Row title="Resolution" note="Short side of the frame">
            <Segmented label="Resolution" value={s.resolution} onChange={b('resolution')}
              options={[{ value: '1080p', label: '1080p' }, { value: '1440p', label: '1440p' }, { value: '4k', label: '4K' }]} />
          </Row>
          <Row title="Frame rate">
            <Segmented label="Frame rate" value={s.fps} onChange={b('fps')}
              options={[24, 30, 60].map((n) => ({ value: n, label: `${n} fps` }))} />
          </Row>
        </div>
      </div>
      <div className="set-group">
        <div className="set-group-head"><span>Export</span></div>
        <div className="set-card">
          <Row title="Model format" note="When a job names none">
            <Segmented label="Model format" value={s.export} onChange={b('export')}
              options={[{ value: 'glb', label: 'GLB' }, { value: 'fbx', label: 'FBX' }, { value: 'obj', label: 'OBJ' }, { value: 'usdz', label: 'USDZ' }, { value: 'blend', label: '.blend' }]} />
          </Row>
        </div>
      </div>
      <div className="set-group">
        <div className="set-group-head"><span>Rules for Claude</span></div>
        <div className="set-card">
          <Row title="Full access" note="Run any Python in Blender: build, edit, light, render, save">
            <Switch label="Full access" on={s.fullAccess} onChange={b('fullAccess')} />
          </Row>
          <Row title="Open Blender itself" note="Launch the app when a job needs the live scene">
            <Switch label="Open Blender itself" on={s.openBlender} onChange={b('openBlender')} />
          </Row>
          <Row title="Look after every step" note="Check the viewport before moving on">
            <Switch label="Look after every step" on={s.lookEachStep} onChange={b('lookEachStep')} />
          </Row>
          <Row title="Keep the scene" note="Save a .blend next to every render">
            <Switch label="Keep the scene" on={s.saveBlend} onChange={b('saveBlend')} />
          </Row>
          <Row title="Ask before AI models" note="Generating a model can use paid credits">
            <Switch label="Ask before AI models" on={s.askBeforeGenerate} onChange={b('askBeforeGenerate')} />
          </Row>
          <Row title="Ask before deleting objects" note="Always on">
            <Switch label="Ask before deleting objects" on locked onChange={() => {}} />
          </Row>
        </div>
      </div>
    </>
  );
}

export default function Settings() {
  const [open, setOpen] = useState(false);
  const [tab, setTab] = useState('general');
  const [status, setStatus] = useState(null);
  const [checking, setChecking] = useState(false);
  const [data, setData] = useState(null);
  const [loadErr, setLoadErr] = useState(false); // settings did not load: say so, with a retry
  const [now, setNow] = useState(() => Date.now());
  const panel = useRef(null);

  useEffect(() => {
    try { const t = localStorage.getItem('settings-tab'); if (TABS.some((x) => x.id === t)) setTab(t); } catch {}
  }, []);
  const pickTab = (id) => { setTab(id); try { localStorage.setItem('settings-tab', id); } catch {} };

  const check = useCallback((fresh) => {
    setChecking(true);
    fetch(`/api/status${fresh ? '?fresh=1' : ''}`, { cache: 'no-store' })
      .then((r) => r.json()).then(setStatus).catch(() => {})
      .finally(() => { setChecking(false); setNow(Date.now()); });
  }, []);

  const loadSettings = useCallback(() => {
    setLoadErr(false);
    fetch('/api/settings', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => { if (!d?.settings) throw new Error('no settings'); setData(d); })
      .catch(() => setLoadErr(true));
  }, []);

  useEffect(() => {
    if (!open) return undefined;
    check(false);
    loadSettings();
    const tick = setInterval(() => setNow(Date.now()), 5000);
    const key = (e) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', key);
    panel.current?.focus();
    return () => { clearInterval(tick); window.removeEventListener('keydown', key); };
  }, [open, check, loadSettings]);

  const set = (section, key, value) => {
    const prev = data?.settings?.[section]?.[key];
    const put = (v) => setData((d) => ({ ...d, settings: { ...d.settings, [section]: { ...d.settings[section], [key]: v } } }));
    put(value);
    // the server said no: the control springs back (only if nothing changed it since)
    const back = () => setData((d) => (d?.settings?.[section]?.[key] === value
      ? { ...d, settings: { ...d.settings, [section]: { ...d.settings[section], [key]: prev } } } : d));
    fetch('/api/settings', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ section, key, value }) })
      .then((r) => r.json()).then((res) => (res?.ok && res.settings ? setData((d) => ({ ...d, settings: res.settings })) : back())).catch(back);
  };

  const live = status?.tools?.every((t) => t.state === 'live');
  const offCount = status?.tools?.filter((t) => t.state === 'off').length || 0;

  return (
    <>
      <button className="settings-btn" onClick={() => setOpen(true)} aria-label="Settings" title="Settings">
        <Gear />
        {status && !live && <span className="settings-btn-alert" aria-hidden="true" />}
      </button>
      {open && (
        <div className="settings-backdrop" onMouseDown={() => setOpen(false)}>
          <div className="settings" role="dialog" aria-modal="true" aria-label="Settings" tabIndex={-1} ref={panel} onMouseDown={(e) => e.stopPropagation()}>
            <nav className="settings-nav" aria-label="Settings sections">
              <div className="settings-title">Settings</div>
              {TABS.map((t) => (
                <button key={t.id} className="settings-tab" aria-current={tab === t.id ? 'page' : undefined} onClick={() => pickTab(t.id)}>
                  <TabIcon id={t.id} /><span>{t.label}</span>
                  {t.id === 'general' && offCount > 0 && <b className="settings-tab-count" aria-label={`${offCount} off`}>{offCount}</b>}
                </button>
              ))}
            </nav>
            <section className="settings-pane">
              <button className="settings-close" onClick={() => setOpen(false)} aria-label="Close settings">
                <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" /></svg>
              </button>
              {tab === 'general' && <General status={status} checking={checking} onRefresh={() => check(true)} now={now} />}
              {tab !== 'general' && !data && (
                <header className="set-head">
                  <h3>{TAB_TITLE[tab]}</h3>
                  {loadErr ? (
                    <p>Could not load the settings. <button className="set-refresh" onClick={loadSettings}><span className="set-refresh-label">Try again</span></button></p>
                  ) : <p>Loading…</p>}
                </header>
              )}
              {tab === 'image' && data && <ImageTab settings={data.settings} info={data.info} set={set} />}
              {tab === 'video' && data && <VideoTab settings={data.settings} info={data.info} set={set} now={now} />}
              {tab === 'model' && data && <ModelTab settings={data.settings} info={data.info} set={set} tool={status?.tools?.find((t) => t.id === 'blender')} />}
            </section>
          </div>
        </div>
      )}
    </>
  );
}
