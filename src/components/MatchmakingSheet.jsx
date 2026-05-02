import { useTranslation } from 'react-i18next';

/**
 * Overlay estilo iOS/App Store durante cola Supabase · comisión servidor.
 */

function formatUsd(n, locale) {
  return `$${Number(n).toLocaleString(locale, { maximumFractionDigits: 0 })}`;
}

function percentFromDecimal(dec) {
  const x = typeof dec === 'number' ? dec : Number(dec);
  if (!Number.isFinite(x)) return '';
  const p = x * 100;
  return `${Number.isInteger(p) ? String(p) : p.toFixed(2)}`;
}

export default function MatchmakingSheet({
  open,
  phase,
  stakeAmount,
  serverCommissionDecimal,
  onCancelQueue,
}) {
  const { t, i18n } = useTranslation();

  if (!open) return null;

  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const pct = percentFromDecimal(serverCommissionDecimal);
  const showFee = pct !== '';

  const title =
    phase === 'searching'
      ? t('matchmaking.title_searching')
      : phase === 'queued'
        ? t('matchmaking.title_queued')
        : t('matchmaking.title_paired');

  const body =
    phase === 'searching'
      ? t('matchmaking.body_searching')
      : phase === 'queued'
        ? t('matchmaking.body_queued', { stake: formatUsd(stakeAmount, numLocale) })
        : t('matchmaking.body_paired');

  return (
    <div className="match-sheet-root">
      <div className="match-sheet-backdrop" aria-hidden />

      <div
        className="match-sheet-card"
        role="dialog"
        aria-modal="true"
        aria-labelledby="match-sheet-title"
        aria-describedby="match-sheet-desc"
      >
        <div className="match-sheet-grabber" />

        <h2 id="match-sheet-title" className="match-sheet-title">
          {title}
        </h2>

        <p id="match-sheet-desc" className="match-sheet-body">
          {body}
        </p>

        {showFee && (
          <div className="match-sheet-pill-row">
            <span className="match-sheet-pill">
              {t('matchmaking.fee_chip', { pct })}
            </span>
          </div>
        )}

        {phase !== 'paired' && (
          <div className="match-sheet-actions">
            {phase === 'queued' && (
              <button type="button" className="match-sheet-btn match-sheet-btn--ghost" onClick={onCancelQueue}>
                {t('matchmaking.cancel_cta')}
              </button>
            )}
            {phase === 'searching' && (
              <p className="match-sheet-muted">{t('matchmaking.calculating')}</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
