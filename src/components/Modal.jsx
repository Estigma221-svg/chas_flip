import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';

const QUICK = [10, 100, 1000, 10000];

export default function Modal({ tipo, onCerrar, onConfirmar }) {
  const { t, i18n } = useTranslation();
  const [monto, setMonto] = useState('');
  const [step, setStep] = useState(/** @type {'amount' | 'confirm'} */ ('amount'));
  const [submitting, setSubmitting] = useState(false);
  // Guard de doble-click: ignora confirmaciones consecutivas dentro de la misma
  // operación incluso si React aún no actualizó el estado `submitting`.
  const busyRef = useRef(false);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape') onCerrar?.();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onCerrar]);

  const isDeposit = tipo === 'depositar';
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

  const parsedMonto = (() => {
    const n = parseFloat(monto);
    return Number.isFinite(n) && n > 0 ? n : null;
  })();

  const handlePrimary = () => {
    if (busyRef.current || submitting) return;

    if (parsedMonto === null) {
      // eslint-disable-next-line no-alert
      alert(t('modal.alert_invalid_amount'));
      return;
    }

    // Para retiros, primero pedimos confirmación explícita.
    if (!isDeposit && step === 'amount') {
      setStep('confirm');
      return;
    }

    busyRef.current = true;
    setSubmitting(true);
    try {
      onConfirmar(parsedMonto);
      onCerrar();
    } finally {
      busyRef.current = false;
      setSubmitting(false);
    }
  };

  const goBack = () => {
    if (submitting) return;
    setStep('amount');
  };

  const showConfirm = !isDeposit && step === 'confirm';
  const formattedAmount =
    parsedMonto !== null
      ? parsedMonto.toLocaleString(numLocale, { maximumFractionDigits: 2 })
      : '0';

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">
              {showConfirm
                ? t('modal.withdraw_confirm_title')
                : isDeposit
                  ? t('modal.deposit_title')
                  : t('modal.withdraw_title')}
            </h2>
            <p className="modal-sub">
              {showConfirm
                ? t('modal.withdraw_confirm_msg', { amount: formattedAmount })
                : isDeposit
                  ? t('modal.deposit_subtitle')
                  : t('modal.withdraw_subtitle')}
            </p>
          </div>
          <button
            className="modal-close"
            onClick={onCerrar}
            aria-label={t('common.close')}
            disabled={submitting}
          >
            ✕
          </button>
        </div>

        {!showConfirm && (
          <>
            <div>
              <p className="field-label">{t('modal.quick_amounts')}</p>
              <div className="quick-amounts">
                {QUICK.map((m) => (
                  <button
                    key={m}
                    type="button"
                    className={`chip ${String(monto) === String(m) ? 'is-active' : ''}`}
                    onClick={() => setMonto(String(m))}
                    disabled={submitting}
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
                  disabled={submitting}
                />
              </div>
            </div>
          </>
        )}

        {showConfirm ? (
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <button
              type="button"
              className="btn-glass btn-glass--secondary"
              onClick={goBack}
              disabled={submitting}
              style={{ flex: '0 0 auto' }}
            >
              {t('modal.back_cta')}
            </button>
            <button
              type="button"
              className="btn-cta"
              onClick={handlePrimary}
              disabled={submitting}
              style={{ flex: '1 1 auto' }}
            >
              {submitting ? t('modal.processing') : t('modal.confirm_cta')}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-cta"
            onClick={handlePrimary}
            disabled={submitting || parsedMonto === null}
          >
            {submitting
              ? t('modal.processing')
              : isDeposit
                ? t('modal.deposit_now')
                : t('modal.withdraw_now')}
          </button>
        )}

        <p className="modal-footer-note">{t('modal.footer_note')}</p>
      </div>
    </div>
  );
}
