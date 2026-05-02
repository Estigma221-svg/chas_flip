import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';

const QUICK = [10, 100, 1000, 10000];

export default function Modal({ tipo, onCerrar, onConfirmar }) {
  const { t, i18n } = useTranslation();
  const [monto, setMonto] = useState('');

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCerrar?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

  const handleConfirmar = () => {
    const num = parseFloat(monto);
    if (!num || num <= 0) {
      alert(t('modal.alert_invalid_amount'));
      return;
    }
    onConfirmar(num);
    onCerrar();
  };

  const isDeposit = tipo === 'depositar';
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">
              {isDeposit ? t('modal.deposit_title') : t('modal.withdraw_title')}
            </h2>
            <p className="modal-sub">
              {isDeposit ? t('modal.deposit_subtitle') : t('modal.withdraw_subtitle')}
            </p>
          </div>
          <button className="modal-close" onClick={onCerrar} aria-label={t('common.close')}>
            ✕
          </button>
        </div>

        <div>
          <p className="field-label">{t('modal.quick_amounts')}</p>
          <div className="quick-amounts">
            {QUICK.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${String(monto) === String(m) ? 'is-active' : ''}`}
                onClick={() => setMonto(String(m))}
              >
                ${m.toLocaleString(numLocale)}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">{t('modal.amount_label')}</p>
          <div className="input-amount">
            <span className="input-amount__prefix">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder={t('modal.amount_placeholder')}
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
        </div>

        <button className="btn-cta" onClick={handleConfirmar}>
          {isDeposit ? t('modal.deposit_now') : t('modal.withdraw_now')}
        </button>

        <p className="modal-footer-note">{t('modal.footer_note')}</p>
      </div>
    </div>
  );
}
