import React, { useEffect, useMemo, useRef, useState } from 'react';
import CountryFlag from './CountryFlag';

/**
 * GlassSelect — Apple-style glass dropdown with optional flag rendering.
 *
 * Props:
 *  - value: selected value (any primitive)
 *  - options: [{ value, label, code? }]
 *  - placeholder
 *  - onChange(value)
 *  - searchable: boolean (default true)
 *  - flagKey: which option key carries the country code (defaults to "code")
 */
export default function GlassSelect({
  value,
  options,
  placeholder = 'Selecciona…',
  onChange,
  searchable = true,
  flagKey = 'code',
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const rootRef = useRef(null);
  const inputRef = useRef(null);

  const selected = useMemo(
    () => options.find((o) => o.value === value) || null,
    [options, value]
  );

  const filtered = useMemo(() => {
    if (!query) return options;
    const q = query.toLowerCase().trim();
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        String(o.value).toLowerCase().includes(q)
    );
  }, [options, query]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e) => {
      if (!rootRef.current) return;
      if (!rootRef.current.contains(e.target)) setOpen(false);
    };
    const onKey = (e) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDoc);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  useEffect(() => {
    if (open && searchable) {
      // micro-tick to ensure focus after layout
      const id = requestAnimationFrame(() => inputRef.current?.focus());
      return () => cancelAnimationFrame(id);
    }
  }, [open, searchable]);

  const handlePick = (opt) => {
    onChange?.(opt.value);
    setOpen(false);
    setQuery('');
  };

  return (
    <div className={`gselect ${open ? 'is-open' : ''}`} ref={rootRef}>
      <button
        type="button"
        className="gselect__trigger"
        onClick={() => setOpen((v) => !v)}
      >
        <span className="gselect__value">
          {selected ? (
            <>
              {selected[flagKey] && (
                <span className="gselect__flag">
                  <CountryFlag code={selected[flagKey]} />
                </span>
              )}
              <span className="gselect__label">{selected.label}</span>
            </>
          ) : (
            <span className="gselect__placeholder">{placeholder}</span>
          )}
        </span>
        <span className="gselect__chev" aria-hidden>
          ▾
        </span>
      </button>

      {open && (
        <div className="gselect__menu" role="listbox">
          {searchable && (
            <div className="gselect__search">
              <input
                ref={inputRef}
                type="text"
                placeholder="Buscar país…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </div>
          )}

          <div className="gselect__list">
            {filtered.length === 0 && (
              <div className="gselect__empty">Sin coincidencias</div>
            )}

            {filtered.map((opt) => {
              const isActive = opt.value === value;
              return (
                <button
                  key={opt.value}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  className={`gselect__option ${isActive ? 'is-active' : ''}`}
                  onClick={() => handlePick(opt)}
                >
                  {opt[flagKey] && (
                    <span className="gselect__flag">
                      <CountryFlag code={opt[flagKey]} />
                    </span>
                  )}
                  <span className="gselect__label">{opt.label}</span>
                  {isActive && <span className="gselect__check">✓</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
