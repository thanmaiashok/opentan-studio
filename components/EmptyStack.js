'use client';

// The one empty state of the board (law 23, owner 2026-11-14: "the same type of animations … inside my folder also"):
// a breathing stack of three cards, the front one black, and the page's own line mark drawing itself once in blue.
// Used by every empty page: Image Gallery, client folders, Key components, Recently Deleted, Videos, video studios.

export default function EmptyStack({ icon, title, text, compact }) {
  return (
    <div className={`empty${compact ? ' empty-compact' : ''}`}>
      <div className="empty-art video studio" aria-hidden="true">
        <span className="empty-card back" />
        <span className="empty-card mid" />
        <span className="empty-card front">{icon}</span>
      </div>
      <h1>{title}</h1>
      {text && <p>{text}</p>}
    </div>
  );
}
