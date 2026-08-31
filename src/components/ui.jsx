import React, { createContext, useCallback, useContext, useEffect, useState } from 'react';

/* ---------------------------------------------------------------- toasts */

const ToastContext = createContext(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const push = useCallback((message, kind = 'info') => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), kind === 'err' ? 7000 : 3800);
  }, []);

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div className="toast-wrap">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>{t.message}</div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

/* ---------------------------------------------------------------- modals */

export function Modal({ title, onClose, children, footer, wide }) {
  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'modal-wide' : ''}`}>
        <div className="card-head">
          <h3>{title}</h3>
          <div className="spacer" />
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Close</button>
        </div>
        <div className="card-pad">{children}</div>
        {footer && <div className="card-head" style={{ borderTop: '1px solid var(--line-soft)', borderBottom: 0 }}>{footer}</div>}
      </div>
    </div>
  );
}

export function ConfirmButton({ onConfirm, children, confirmLabel = 'Confirm', className = 'btn btn-sm btn-danger' }) {
  const [armed, setArmed] = useState(false);
  useEffect(() => {
    if (!armed) return undefined;
    const t = setTimeout(() => setArmed(false), 4000);
    return () => clearTimeout(t);
  }, [armed]);

  return (
    <button
      className={className}
      onClick={() => (armed ? (setArmed(false), onConfirm()) : setArmed(true))}
    >
      {armed ? confirmLabel : children}
    </button>
  );
}

/* ------------------------------------------------------------ primitives */

export const Spinner = () => <div className="spinner" />;

export function Switch({ checked, onChange, id }) {
  return (
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={!!checked}
      className={`switch ${checked ? 'on' : ''}`}
      onClick={() => onChange(!checked)}
    />
  );
}

export function Empty({ title, children, action }) {
  return (
    <div className="empty">
      <div style={{ fontWeight: 600, color: 'var(--text-soft)', marginBottom: 6 }}>{title}</div>
      {children && <div className="small">{children}</div>}
      {action && <div style={{ marginTop: 14 }}>{action}</div>}
    </div>
  );
}

export function Banner({ kind = 'info', children }) {
  return <div className={`banner banner-${kind}`}>{children}</div>;
}

/* --------------------------------------------------------------- secrets */

const EyeIcon = ({ off }) => (
  <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M1.6 12S5.3 5.2 12 5.2 22.4 12 22.4 12 18.7 18.8 12 18.8 1.6 12 1.6 12Z" />
    <circle cx="12" cy="12" r="3.1" />
    {off && <line x1="3.2" y1="20.8" x2="20.8" y2="3.2" />}
  </svg>
);

/**
 * A secret field that can be revealed.
 *
 * Keys get pasted, mistyped and re-checked, and a masked field gives no way to
 * confirm what actually landed - so the value can be shown deliberately. It
 * re-masks whenever the field loses focus, so a revealed key is never left
 * sitting on screen in a shop.
 */
export function SecretInput({ value, onChange, placeholder, autoFocus, onEnter }) {
  const [revealed, setRevealed] = useState(false);

  return (
    <div className="secret-field">
      <input
        className="input mono"
        type={revealed ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        autoFocus={autoFocus}
        spellCheck={false}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onBlur={() => setRevealed(false)}
        onKeyDown={(e) => e.key === 'Enter' && onEnter?.()}
      />
      <button
        type="button"
        className="secret-reveal"
        title={revealed ? 'Hide' : 'Show'}
        aria-label={revealed ? 'Hide the value' : 'Show the value'}
        aria-pressed={revealed}
        onMouseDown={(e) => e.preventDefault()} /* keep focus in the input */
        onClick={() => setRevealed((v) => !v)}
      >
        <EyeIcon off={revealed} />
      </button>
    </div>
  );
}

/** Text input that commits on blur, so typing does not hit the database on every keystroke. */
export function DebouncedInput({ value, onCommit, as = 'input', ...rest }) {
  const [local, setLocal] = useState(value ?? '');
  useEffect(() => setLocal(value ?? ''), [value]);

  const commit = () => {
    if ((local ?? '') !== (value ?? '')) onCommit(local);
  };

  const Tag = as;
  return (
    <Tag
      {...rest}
      value={local}
      onChange={(e) => setLocal(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && as === 'input') e.currentTarget.blur();
        rest.onKeyDown?.(e);
      }}
    />
  );
}
