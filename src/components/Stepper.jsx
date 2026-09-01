import React, { useCallback, useEffect, useRef, useState } from 'react';

const Chevron = ({ left }) => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <polyline points={left ? '15 5 8 12 15 19' : '9 5 16 12 9 19'} />
  </svg>
);

/**
 * A horizontally scrolling tab strip with edge arrows.
 *
 * The consultation runs to thirteen steps, which is more than fits on any
 * sensible window width, so the strip scrolls. The arrows only appear when
 * there is actually something off-screen in that direction - on a short strip
 * (Settings, the client file) this renders as a plain row of tabs.
 */
export default function Stepper({ children, className = '', activeSelector = '.step-tab.active', scrollKey }) {
  const scrollerRef = useRef(null);
  const [edges, setEdges] = useState({ left: false, right: false });

  const measure = useCallback(() => {
    const el = scrollerRef.current;
    if (!el) return;
    const max = el.scrollWidth - el.clientWidth;
    setEdges({
      left: el.scrollLeft > 4,
      // A couple of pixels of slack: sub-pixel layout means scrollLeft rarely
      // lands exactly on the maximum.
      right: el.scrollLeft < max - 4,
    });
  }, []);

  useEffect(() => {
    const el = scrollerRef.current;
    if (!el) return undefined;
    measure();
    el.addEventListener('scroll', measure, { passive: true });
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', measure);
      observer.disconnect();
    };
  }, [measure, children]);

  // Keep the current step in view when it changes from elsewhere - the Next
  // button, or a jump straight to Summary.
  useEffect(() => {
    const active = scrollerRef.current?.querySelector(activeSelector);
    active?.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    const t = setTimeout(measure, 350);
    return () => clearTimeout(t);
  }, [scrollKey, activeSelector, measure]);

  const nudge = (direction) => {
    const el = scrollerRef.current;
    if (!el) return;
    // Just under a full page, so a tab or two stays visible as an anchor.
    el.scrollBy({ left: direction * el.clientWidth * 0.72, behavior: 'smooth' });
  };

  const scrollable = edges.left || edges.right;

  return (
    <div className={`stepper-shell ${scrollable ? 'scrollable' : ''} ${className}`}>
      {scrollable && (
        <button
          type="button"
          className="stepper-arrow"
          onClick={() => nudge(-1)}
          disabled={!edges.left}
          aria-label="Scroll steps left"
        >
          <Chevron left />
        </button>
      )}

      <div className={`stepper ${edges.left ? 'fade-left' : ''} ${edges.right ? 'fade-right' : ''}`} ref={scrollerRef}>
        {children}
      </div>

      {scrollable && (
        <button
          type="button"
          className="stepper-arrow"
          onClick={() => nudge(1)}
          disabled={!edges.right}
          aria-label="Scroll steps right"
        >
          <Chevron />
        </button>
      )}
    </div>
  );
}
