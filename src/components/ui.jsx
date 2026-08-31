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
