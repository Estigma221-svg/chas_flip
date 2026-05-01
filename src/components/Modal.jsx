import React, { useEffect, useState } from 'react';

const QUICK = [10, 100, 1000, 10000];

export default function Modal({ tipo, onCerrar, onConfirmar }) {
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
      alert('Ingresa un monto válido');
      return;
    }
    onConfirmar(num);
    onCerrar();
  };

  const isDeposit = tipo === 'depositar';

  return (
    <div className="modal-backdrop" onClick={onCerrar}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <div>
            <h2 className="modal-title">
              {isDeposit ? 'Depositar' : 'Retirar'}
            </h2>
            <p className="modal-sub">
              {isDeposit ? 'Agrega saldo a tu cuenta' : 'Retira tus ganancias'}
            </p>
          </div>
          <button className="modal-close" onClick={onCerrar} aria-label="Cerrar">
            ✕
          </button>
        </div>

        <div>
          <p className="field-label">Montos rápidos</p>
          <div className="quick-amounts">
            {QUICK.map((m) => (
              <button
                key={m}
                type="button"
                className={`chip ${String(monto) === String(m) ? 'is-active' : ''}`}
                onClick={() => setMonto(String(m))}
              >
                ${m.toLocaleString()}
              </button>
            ))}
          </div>
        </div>

        <div>
          <p className="field-label">Monto</p>
          <div className="input-amount">
            <span className="input-amount__prefix">$</span>
            <input
              type="number"
              inputMode="decimal"
              placeholder="0.00"
              value={monto}
              onChange={(e) => setMonto(e.target.value)}
            />
          </div>
        </div>

        <button className="btn-cta" onClick={handleConfirmar}>
          {isDeposit ? 'Depositar ahora' : 'Retirar ahora'}
        </button>

        <p className="modal-footer-note">
          ⛓ Producción: escrow en contrato · aleatoriedad Chainlink VRF verificable en explorer
        </p>
      </div>
    </div>
  );
}
