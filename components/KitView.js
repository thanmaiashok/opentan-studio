'use client';

// Key components of a client: the things Claude must never ask for twice — logo (and where it
// sits on every poster), website, colours, type, rules, facts and the real product packs.
// Source: library/clients/<id>/kit.json (served by /api/kit).

import EmptyStack from '@/components/EmptyStack';
import { useEffect, useState } from 'react';
import PageTop, { FolderIcon } from '@/components/PageTop';

const file = (p) => `/api/file?p=${encodeURIComponent(p)}`;
const thumb = (p) => `/api/thumb?p=${encodeURIComponent(p)}`;

const PLACES = {
  'top-center': 'Top centre',
  'top-left': 'Top left',
  'top-right': 'Top right',
  'bottom-center': 'Bottom centre',
  'bottom-right': 'Bottom right',
  'bottom-left': 'Bottom left',
};

// A small 4:5 poster frame showing the clear logo space and the logo inside it.
function Placement({ logo }) {
  const place = logo.placement || 'top-right';
  const w = `${(logo.width || 0.22) * 100}%`;
  const m = `${(logo.margin || 0.04) * 100}%`;
  const style = { width: w };
  if (place.startsWith('bottom')) style.bottom = m; else style.top = m;
  if (place.endsWith('left')) style.left = m;
  else if (place.endsWith('right')) style.right = m;
  else { style.left = '50%'; style.transform = 'translateX(-50%)'; }
  return (
    <div className="kit-frame" aria-label={`Logo ${PLACES[place] || place}`}>
      <span className={`kit-band ${place.startsWith('bottom') ? 'bottom' : 'top'} ${place.endsWith('left') ? 'left' : place.endsWith('right') ? 'right' : ''}`} />
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={file(logo.path)} alt="" style={style} />
      <span className="kit-frame-body"><i /><i /><i /></span>
    </div>
  );
}

function Section({ title, children, aside }) {
  return (
    <section className="kit-section">
      <div className="kit-section-head"><h2>{title}</h2>{aside}</div>
      {children}
    </section>
  );
}

export default function KitView({ client, onBackToFolder, onBackToGallery }) {
  const [data, setData] = useState(null);
  const [copied, setCopied] = useState(null);

  useEffect(() => {
    let alive = true;
    fetch(`/api/kit?client=${encodeURIComponent(client.id)}`, { cache: 'no-store' })
      .then((r) => r.json()).then((d) => alive && setData(d)).catch(() => alive && setData({ kit: null }));
    return () => { alive = false; };
  }, [client.id]);

  const copy = (hex) => {
    navigator.clipboard?.writeText(hex);
    setCopied(hex);
    setTimeout(() => setCopied((c) => (c === hex ? null : c)), 1200);
  };

  const kit = data?.kit;
  const kicker = (
    <>
      <button onClick={onBackToGallery}>Gallery</button><span>›</span>
      <button onClick={onBackToFolder}>{client.name}</button><span>›</span>Key components
    </>
  );

  if (!data) return <section className="page"><PageTop kicker={kicker} icon={<FolderIcon />} title="Key components" /></section>;

  if (!kit) {
    return (
      <section className="page">
        <PageTop kicker={kicker} icon={<FolderIcon />} title="Key components" />
        <EmptyStack
          icon={<svg viewBox="0 0 20 20"><circle cx="7" cy="10" r="3.4" /><path d="M10.4 10h6.6M14.6 10v2.6M17 10v1.8" /></svg>}
          title="Nothing stored yet"
          text="Send Claude this client's logo and website. They are kept here, so nobody asks for them again."
        />
      </section>
    );
  }

  return (
    <section className="page kit-page">
      <PageTop
        kicker={kicker}
        icon={<FolderIcon />}
        title="Key components"
        chips={<>
          <span className="chip chip-count">{kit.name}</span>
          {kit.brand && <span className="chip">{kit.brand}</span>}
          {kit.website && <a className="chip kit-link" href={kit.website} target="_blank" rel="noreferrer">{kit.website.replace(/^https?:\/\/|\/$/g, '')} ↗</a>}
        </>}
      />

      <div className="kit-grid">
        {kit.logo && (
          <Section title="Logo" aside={<span className="kit-tag">On every poster</span>}>
            <div className="kit-logo-row">
              <div className="kit-logo-card">
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={file(kit.logo.path)} alt={`${kit.name} logo`} />
              </div>
              <div className="kit-logo-side">
                <Placement logo={kit.logo} />
                <dl className="kit-facts">
                  <div><dt>Place</dt><dd>{PLACES[kit.logo.placement] || kit.logo.placement}</dd></div>
                  <div><dt>Size</dt><dd>{Math.round((kit.logo.width || 0.22) * 100)}% of width</dd></div>
                  <div><dt>How</dt><dd>{kit.logo.mode === 'overlay' ? 'Pasted after' : 'Input to ChatGPT'}</dd></div>
                </dl>
              </div>
            </div>
            {kit.logo.text?.length > 0 && (
              <div className="kit-logo-text">
                {kit.logo.text.map((t) => (
                  <div key={t.string}><strong lang="kn">{t.string}</strong><span>{t.where}</span><small>{t.font}</small></div>
                ))}
              </div>
            )}
            <p className="kit-note">{kit.logo.rule}</p>
          </Section>
        )}

        {kit.colours?.length > 0 && (
          <Section title="Colours" aside={<span className="kit-tag">Click to copy</span>}>
            <div className="kit-swatches">
              {kit.colours.map((c) => (
                <button key={c.hex} className={`kit-swatch${copied === c.hex ? ' is-copied' : ''}`} onClick={() => copy(c.hex)} title={`Copy ${c.hex}`}>
                  <span className="kit-chip" style={{ background: c.hex }} />
                  <strong>{c.name}</strong>
                  <code key={copied === c.hex ? 'copied' : 'hex'}>
                    {copied === c.hex && <svg viewBox="0 0 16 16" aria-hidden="true"><path d="M3.5 8.5 6.5 11.5 12.5 4.5" /></svg>}
                    {copied === c.hex ? 'Copied' : c.hex}
                  </code>
                  {c.use && <small>{c.use}</small>}
                </button>
              ))}
            </div>
          </Section>
        )}

        <Section title="Brand">
          <div className="kit-card kit-brand">
            <h3>{kit.fullName || kit.name}</h3>
            {kit.taglines?.length > 0 && <p className="kit-taglines">{kit.taglines.map((t) => <span key={t}>{t}</span>)}</p>}
            {kit.about && <p>{kit.about}</p>}
            {kit.facts?.length > 0 && <div className="kit-pills">{kit.facts.map((f) => <span key={f}>{f}</span>)}</div>}
            {kit.contact && (
              <dl className="kit-facts kit-contact">
                {kit.contact.address && <div><dt>Address</dt><dd>{kit.contact.address}</dd></div>}
                {kit.contact.phone && <div><dt>Phone</dt><dd>{kit.contact.phone}</dd></div>}
                {kit.contact.email && <div><dt>Email</dt><dd>{kit.contact.email}</dd></div>}
              </dl>
            )}
          </div>
        </Section>

        <Section title="Rules">
          <div className="kit-card">
            <ol className="kit-rules">{(kit.rules || []).map((r) => <li key={r}>{r}</li>)}</ol>
            {kit.type && <p className="kit-note"><strong>Type · </strong>{kit.type}</p>}
          </div>
        </Section>

        {kit.products?.length > 0 && (
          <Section title="Products" aside={<span className="kit-tag">{kit.products.length} real packs</span>}>
            <div className="kit-products">
              {kit.products.map((p) => (
                <a key={p.name} className="kit-product" href={file(p.path)} target="_blank" rel="noreferrer">
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <span className="kit-product-img"><img src={thumb(p.path)} alt="" loading="lazy" /></span>
                  <strong>{p.name}</strong>
                  {p.spec && <small>{p.spec}</small>}
                </a>
              ))}
            </div>
          </Section>
        )}
      </div>
      {kit.source && <p className="kit-source">{kit.source}</p>}
    </section>
  );
}
