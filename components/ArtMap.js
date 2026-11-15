'use client';

// Art Direction map: the owner's reference posters, grouped region → family → poster.
// Two views: Glance (default — every region, family name and reference on one screen, no scrolling;
// hover a thumb to peek, click to read its card) and Map (the roomy version with rules and owner words).
// Built from library/posters/*.json, so new references and new cards appear on their own.

import { useEffect, useMemo, useState } from 'react';
import PageTop from '@/components/PageTop';
import { smooth } from '@/lib/motion';

const thumb = (p) => `/api/thumb?p=${encodeURIComponent(p)}`;
const full = (p) => `/api/file?p=${encodeURIComponent(p)}`;

const FIELDS = [
  ['idea', 'Idea'],
  ['field', 'Field'],
  ['light', 'Light'],
  ['type', 'Type'],
  ['layout', 'Layout'],
  ['copy', 'Copy'],
];

function Poster({ card, selected, made, onSelect }) {
  return (
    <button
      className="map-poster"
      aria-pressed={selected}
      onClick={() => onSelect(card)}
      title={card.idea || card.file}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={thumb(card.path)} alt="" loading="lazy" />
      <span className="map-poster-id">{card.id}</span>
      {made > 0 && <span className="map-poster-made" aria-label={`${made} made from this`}>{made}</span>}
    </button>
  );
}

function Family({ family, cards, selectedId, made, onSelect }) {
  return (
    <section className="map-family">
      <header>
        <h3>{family.name}<span>{cards.length}</span></h3>
        <p>{family.rule}</p>
        {family.words?.length > 0 && (
          <p className="map-words" title={family.words.join(', ')}>
            {family.words.slice(0, 5).map((w) => <span key={w}>{w}</span>)}
            {family.words.length > 5 && <em>+{family.words.length - 5}</em>}
          </p>
        )}
      </header>
      <div className="map-posters">
        {cards.map((c) => (
          <Poster key={c.id} card={c} selected={selectedId === c.id} made={(made[c.id] || []).length} onSelect={onSelect} />
        ))}
      </div>
    </section>
  );
}

// The Product region is twice as wide: split its families into two stacks of about equal height
// (height ≈ header + rows of 3 thumbs). Other regions are one stack.
function stacks(region, byFamily) {
  if (region.id !== 'product') return [region.families];
  const h = (f) => 1 + Math.ceil(Math.max(1, (byFamily[f.id] || []).length) / 3);
  const out = [[], []]; const tall = [0, 0];
  for (const f of [...region.families].sort((a, b) => h(b) - h(a))) {
    const i = tall[0] <= tall[1] ? 0 : 1;
    out[i].push(f); tall[i] += h(f);
  }
  const order = (list) => list.sort((a, b) => region.families.indexOf(a) - region.families.indexOf(b));
  return out.map(order);
}

// Glance: one column per region (Product spans two), every family as name + count + a 3-up thumb grid.
function Glance({ regions, byFamily, made, selectedId, onSelect, unsorted }) {
  const cols = unsorted.length
    ? [...regions, { id: 'unsorted', name: 'New', note: 'Not studied yet', families: [{ id: 'unsorted', name: 'Unsorted', rule: 'Waiting for a card.' }] }]
    : regions;
  return (
    <div className={`glance${unsorted.length ? ' with-new' : ''}`}>
      {cols.map((r) => {
        const n = r.families.reduce((k, f) => k + (byFamily[f.id] || []).length, 0);
        return (
          <section key={r.id} className={`glance-region region-${r.id}`} aria-label={r.name}>
            <header className="glance-region-head" title={r.note}>
              <strong>{r.name}</strong><span>{n}</span>
            </header>
            <div className="glance-families">
              {stacks(r, byFamily).map((stack, si) => (
                <div key={si} className="glance-stack">
              {stack.map((f) => {
                const cards = byFamily[f.id] || [];
                return (
                  <div key={f.id} className="glance-family" title={`${f.rule}${f.words?.length ? `\nSay: ${f.words.slice(0, 8).join(', ')}` : ''}`}>
                    <div className="glance-family-head"><span>{f.name}</span><em>{cards.length}</em></div>
                    <div className="glance-thumbs">
                      {cards.map((c) => (
                        <button
                          key={c.id}
                          className="glance-thumb"
                          aria-pressed={selectedId === c.id}
                          aria-label={`Reference ${c.id} · ${f.name}`}
                          onClick={() => onSelect(c)}
                        >
                          {/* eslint-disable-next-line @next/next/no-img-element */}
                          <img src={thumb(c.path)} alt="" loading="lazy" draggable={false} />
                          <span>{c.id}</span>
                          {(made[c.id] || []).length > 0 && <i aria-hidden="true" />}
                        </button>
                      ))}
                    </div>
                  </div>
                );
              })}
                </div>
              ))}
            </div>
          </section>
        );
      })}
    </div>
  );
}

function Detail({ card, family, made, onClose }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <aside className="map-detail" aria-label={`Reference ${card.id}`}>
      <button className="map-detail-close" aria-label="Close" onClick={onClose}>×</button>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img className="map-detail-img" src={full(card.path)} alt="" />
      <div className="map-detail-body">
        <p className="map-detail-kicker">Recipe {card.id} · {family?.name || 'Not studied yet'}</p>
        <h2>{card.file.replace(/^\d+-/, '').replace(/\.\w+$/, '').replace(/-/g, ' ')}</h2>
        {card.family === 'unsorted' ? (
          <p className="map-detail-note">New reference. Ask Claude to study it and it gets a card and a family.</p>
        ) : (
          <dl>
            {FIELDS.map(([k, label]) => card[k] && (
              <div key={k}><dt>{label}</dt><dd>{card[k]}</dd></div>
            ))}
          </dl>
        )}
        {made.length > 0 && (
          <div className="map-made">
            <h4>Made from this recipe</h4>
            <div>
              {made.map((f) => (
                // eslint-disable-next-line @next/next/no-img-element
                <a key={f} href={full(f)} target="_blank" rel="noreferrer"><img src={thumb(f)} alt="" /></a>
              ))}
            </div>
          </div>
        )}
        {card.family !== 'unsorted' && <code className="map-use">"recipe": "{card.id}"</code>}
      </div>
    </aside>
  );
}

export default function ArtMap() {
  const [data, setData] = useState(null);
  const [selected, setSelected] = useState(null);
  const [view, setView] = useState('glance');
  useEffect(() => { try { const v = localStorage.getItem('art-view'); if (v === 'map' || v === 'glance') setView(v); } catch {} }, []);
  const pickView = (v) => { smooth(() => setView(v)); try { localStorage.setItem('art-view', v); } catch {} };

  useEffect(() => {
    let alive = true;
    // Re-render only when the map really changed; an identical poll left all 75 thumbs re-rendering every 5 s.
    let last = '';
    const load = () => fetch('/api/art', { cache: 'no-store' }).then((r) => r.text())
      .then((raw) => { if (!alive || raw === last) return; last = raw; setData(JSON.parse(raw)); }).catch(() => {});
    load();
    const t = setInterval(load, 5000);
    return () => { alive = false; clearInterval(t); };
  }, []);

  const byFamily = useMemo(() => {
    const m = {};
    for (const c of data?.cards || []) (m[c.family] ||= []).push(c);
    return m;
  }, [data]);

  const familyOf = useMemo(() => {
    const m = {};
    for (const r of data?.regions || []) for (const f of r.families) m[f.id] = f;
    return m;
  }, [data]);

  if (!data) return <section className="page"><PageTop kicker="Image" title="Art Direction" /></section>;

  const total = data.cards.filter((c) => c.family !== 'unsorted').length;
  const unsorted = byFamily.unsorted || [];
  const familyCount = data.regions.reduce((n, r) => n + r.families.length, 0);
  const [lead, ...rest] = data.regions;

  const renderRegion = (region) => (
    <div key={region.id} className={`map-region region-${region.id}`}>
      <div className="map-region-label"><strong>{region.name}</strong><span>{region.note}</span></div>
      <div className="map-families">
        {region.families.map((f) => (
          <Family
            key={f.id} family={f} cards={byFamily[f.id] || []} selectedId={selected?.id}
            made={data.made} onSelect={setSelected}
          />
        ))}
      </div>
    </div>
  );

  return (
    <section className={`page map-page view-${view}${selected ? ' has-detail' : ''}`}>
      <PageTop
        kicker="Image"
        title="Art Direction"
        chips={<>
          <span className="chip chip-count">{total} references</span>
          <span className="chip">{familyCount} families</span>
          <span className="chip">{data.regions.length} regions</span>
          {unsorted.length > 0 && <span className="chip chip-new">{unsorted.length} new</span>}
        </>}
        right={(
          <div className="glass-bar" role="toolbar" aria-label="View">
            <div className="tabs" role="group" aria-label="Layout">
              <button className="tab" aria-pressed={view === 'glance'} onClick={() => pickView('glance')}>Glance</button>
              <button className="tab" aria-pressed={view === 'map'} onClick={() => pickView('map')}>Map</button>
            </div>
          </div>
        )}
      />

      {view === 'glance' ? (
        <Glance regions={data.regions} byFamily={byFamily} made={data.made} selectedId={selected?.id} onSelect={setSelected} unsorted={unsorted} />
      ) : (
        <div className="map-canvas">
          {renderRegion(lead)}
          <div className="map-row">{rest.map(renderRegion)}</div>
          {unsorted.length > 0 && renderRegion({
            id: 'unsorted', name: 'New, not studied yet', note: 'Dropped into the reference folder. Claude will add cards.',
            families: [{ id: 'unsorted', name: 'Unsorted', rule: 'Waiting for an art-direction card.' }],
          })}
        </div>
      )}

      {selected && (
        <Detail
          card={selected}
          family={familyOf[selected.family]}
          made={data.made[selected.id] || []}
          onClose={() => setSelected(null)}
        />
      )}
    </section>
  );
}
