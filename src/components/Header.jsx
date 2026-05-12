import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import AvatarFace from './AvatarFace';
import CountryFlag from './CountryFlag';
import LanguagePicker from './LanguagePicker';
import {
  isSoundEnabled,
  playFlipTick,
  prewarmAudio,
  setSoundEnabled,
} from '../utils/sound';
import { truncateAddress } from '../lib/wagmiConfig.js';

export default function Header({
  usuario,
  saldo,
  walletConectada = false,
  walletAddress = null,
  walletUsdtBalance = null,
  walletUsdtSymbol = 'USDT',
  walletIsOnSupportedChain = true,
  onConectarWallet,
  onDepositar,
  onRetirar,
}) {
  const { t, i18n } = useTranslation();
  const [soundOn, setSoundOn] = useState(() => isSoundEnabled());

  const toggleSound = () => {
    prewarmAudio();
    const next = !soundOn;
    setSoundEnabled(next);
    setSoundOn(next);
    if (next) {
      playFlipTick({ volume: 0.11 });
      setTimeout(() => playFlipTick({ pitchVar: 0.045, volume: 0.1 }), 75);
    }
  };

  const localeForNumber = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

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
        <LanguagePicker />

        <button
          type="button"
          className={`btn-glass btn-glass--icon ${soundOn ? 'is-active' : ''}`}
          onClick={toggleSound}
          title={soundOn ? t('header.sound_on_title') : t('header.sound_off_title')}
          aria-label={soundOn ? t('header.sound_aria_mute') : t('header.sound_aria_unmute')}
        >
          <span className="btn-icon">{soundOn ? '🔊' : '🔇'}</span>
        </button>

        <button
          type="button"
          className={`btn-glass btn-glass--wallet ${walletConectada ? 'is-active' : ''} ${
            walletConectada && !walletIsOnSupportedChain ? 'is-wrong-network' : ''
          }`}
          onClick={onConectarWallet}
          title={
            walletConectada
              ? walletIsOnSupportedChain
                ? t('header.wallet_connected_title', { address: walletAddress || '' })
                : t('header.wallet_wrong_network_title')
              : t('header.wallet_connect_title')
          }
        >
          <span className="btn-icon">🔗</span>
          {walletConectada ? (
            <span className="btn-wallet-info">
              <span className="btn-wallet-info__addr">
                {walletIsOnSupportedChain
                  ? truncateAddress(walletAddress)
                  : t('header.wallet_wrong_network')}
              </span>
              {walletIsOnSupportedChain && walletUsdtBalance !== null && (
                <span className="btn-wallet-info__balance">
                  {walletUsdtBalance} {walletUsdtSymbol}
                </span>
              )}
            </span>
          ) : (
            t('header.connect_wallet')
          )}
        </button>

        <button
          type="button"
          className="btn-glass btn-glass--secondary"
          onClick={onRetirar}
        >
          {t('header.withdraw')}
        </button>

        <button
          type="button"
          className="btn-glass btn-glass--primary"
          onClick={onDepositar}
        >
          {t('header.deposit')}
        </button>

        <div className="balance-card">
          <small>{t('header.balance_label')}</small>
          <h2>${saldo.toLocaleString(localeForNumber, { maximumFractionDigits: 2 })}</h2>
        </div>
      </div>
    </header>
  );
}
