import { useState } from 'react';
import AvatarFace from './AvatarFace';
import CountryFlag from './CountryFlag';
import {
  isSoundEnabled,
  playFlipTick,
  prewarmAudio,
  setSoundEnabled,
} from '../utils/sound';

export default function Header({ usuario, saldo, onDepositar, onRetirar }) {
  const [walletConectada, setWalletConectada] = useState(false);
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());

  const toggleSound = () => {
    prewarmAudio();
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      // Audible confirmation: a quick metallic tick proves the audio works.
      playFlipTick({ volume: 0.11 });
      setTimeout(() => playFlipTick({ pitchVar: 0.045, volume: 0.1 }), 75);
    }
  };

  return (
    <header className="header-flex">
      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <div className="brand">
          <h1>
            <span className="gold-text">CHAS</span>FLIP
          </h1>
          <p className="blockchain-tag">Bitcoin Native · Live</p>
        </div>

        {usuario && (
          <div className="user-chip" title={usuario.email}>
            <span className="user-chip__avatar">
              <AvatarFace value={usuario.avatar} variant="chip" />
            </span>
            <span className="user-chip__flag">
              <CountryFlag code={usuario.paisCode} />
            </span>
            <span className="user-chip__name">{usuario.email}</span>
          </div>
        )}
      </div>

      <div className="header-right">
        <button
          type="button"
          className={`btn-glass btn-glass--icon ${soundOn ? 'is-active' : ''}`}
          onClick={toggleSound}
          title={soundOn ? 'Sonido activado · click para silenciar' : 'Sonido apagado · click para activar'}
          aria-label={soundOn ? 'Silenciar sonidos' : 'Activar sonidos'}
        >
          <span className="btn-icon">{soundOn ? '🔊' : '🔇'}</span>
        </button>

        <button
          type="button"
          className={`btn-glass ${walletConectada ? 'is-active' : ''}`}
          onClick={() => setWalletConectada((v) => !v)}
        >
          <span className="btn-icon">🔗</span>
          {walletConectada ? 'Wallet conectada' : 'Conectar wallet'}
        </button>

        <button
          type="button"
          className="btn-glass btn-glass--secondary"
          onClick={onRetirar}
        >
          Retirar
        </button>

        <button
          type="button"
          className="btn-glass btn-glass--primary"
          onClick={onDepositar}
        >
          Depositar
        </button>

        <div className="balance-card">
          <small>Saldo USDT</small>
          <h2>${saldo.toLocaleString('es-MX', { maximumFractionDigits: 2 })}</h2>
        </div>
      </div>
    </header>
  );
}
