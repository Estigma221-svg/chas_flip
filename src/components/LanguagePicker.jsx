import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '../i18n/index.js';
import CountryFlag from './CountryFlag';

export default function LanguagePicker() {
  const { i18n, t } = useTranslation();
  const [open, setOpen] = useState(false);
  const ref = useRef(/** @type {HTMLDivElement | null} */ (null));

  const current =
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.resolvedLanguage) ||
    SUPPORTED_LANGUAGES.find((l) => l.code === i18n.language?.split('-')[0]) ||
    SUPPORTED_LANGUAGES[0];

  useEffect(() => {
    if (!open) return;
    const handler = (ev) => {
      if (ref.current && !ref.current.contains(ev.target)) setOpen(false);
    };
    window.addEventListener('mousedown', handler);
    window.addEventListener('touchstart', handler);
    return () => {
      window.removeEventListener('mousedown', handler);
      window.removeEventListener('touchstart', handler);
    };
  }, [open]);

  const change = (code) => {
    void i18n.changeLanguage(code);
    setOpen(false);
  };

  return (
    <div className="lang-picker" ref={ref}>
      <button
        type="button"
        className={`btn-glass btn-glass--icon lang-picker__btn ${open ? 'is-active' : ''}`}
        onClick={() => setOpen((v) => !v)}
        title={t('header.language_label')}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={`${t('header.language_label')}: ${current.label}`}
      >
        <span className="lang-picker__flag" aria-hidden>
          <CountryFlag code={current.flag} />
        </span>
        <span className="lang-picker__code">{current.code.toUpperCase()}</span>
      </button>

      {open && (
        <ul className="lang-picker__list" role="listbox">
          {SUPPORTED_LANGUAGES.map((l) => (
            <li key={l.code}>
              <button
                type="button"
                className={`lang-picker__opt ${l.code === current.code ? 'is-current' : ''}`}
                onClick={() => change(l.code)}
                role="option"
                aria-selected={l.code === current.code}
              >
                <span className="lang-picker__opt-flag" aria-hidden>
                  <CountryFlag code={l.flag} />
                </span>
                <span className="lang-picker__opt-label">{l.label}</span>
                <span className="lang-picker__opt-code">{l.code.toUpperCase()}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
