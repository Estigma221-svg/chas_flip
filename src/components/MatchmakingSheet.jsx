/**
 * Overlay estilo iOS/App Store durante cola Supabase · comisión servidor.
 */

function formatUsd(n) {
  return `$${Number(n).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
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
  if (!open) return null;

  const pct = percentFromDecimal(serverCommissionDecimal);
  const showFee = pct !== '';

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
          {phase === 'searching'
            ? 'Buscando oponente'
            : phase === 'queued'
              ? 'En sala de espera'
              : 'Emparejado'}
        </h2>

        <p id="match-sheet-desc" className="match-sheet-body">
          {phase === 'searching'
            ? 'Estamos encontrando jugadores con tu mismo nivel en la mesa escrow · la comisión oficial se firma desde el servidor de Supabase y no desde tu navegador.'
            : phase === 'queued'
              ? `Estás en la cola con mesa ${formatUsd(stakeAmount)}. Mantén la app abierta: el emparejamiento es casi instantáneo entre dos jugadores reales cuando ambos están en línea en el mismo nivel.`
              : 'Hay un jugador válido contra ti. Preparando la moneda verificable…'}
        </p>

        {showFee && (
          <div className="match-sheet-pill-row">
            <span className="match-sheet-pill">
              Comisión de mesa · {pct}% <span className="match-sheet-pill-lock">🔒 servidor</span>
            </span>
          </div>
        )}

        {phase !== 'paired' && (
          <div className="match-sheet-actions">
            {phase === 'queued' && (
              <button type="button" className="match-sheet-btn match-sheet-btn--ghost" onClick={onCancelQueue}>
                Cancelar y salir de la cola
              </button>
            )}
            {phase === 'searching' && (
              <p className="match-sheet-muted">Calculando nivel de confianza on-chain...</p>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
