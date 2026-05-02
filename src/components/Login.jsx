import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import GlassSelect from './GlassSelect';
import AvatarFace from './AvatarFace';
import { CHASFLIP_AVATAR_URLS } from '../data/chasflipAvatars.js';
import { COUNTRIES } from '../data/countries';
import { playLaunchSound, prewarmAudio } from '../utils/sound';

const COUNTRY_OPTIONS = COUNTRIES.map((c) => ({
  value: c.code,
  label: c.name,
  code: c.code,
}));

export default function Login({ onEntrar }) {
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [avatarIndex, setAvatarIndex] = useState(null);
  const [paisCode, setPaisCode] = useState('MX');
  const [error, setError] = useState('');

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const avatarOk = avatarIndex !== null;
  const paisOk = !!paisCode;

  const handleEntrar = () => {
    const missing = [];
    if (!emailOk) missing.push(t('login.missing_email'));
    if (!paisOk) missing.push(t('login.missing_country'));
    if (!avatarOk) missing.push(t('login.missing_avatar'));

    if (missing.length > 0) {
      setError(t('login.missing_prefix', { items: missing.join(', ') }));
      return;
    }

    setError('');
    // Unlock the AudioContext inside this user gesture so the launch sound
    // (and every subsequent sound) plays without browser autoplay blocks.
    prewarmAudio();
    playLaunchSound({ volume: 0.9 });

    onEntrar({
      email: email.trim(),
      avatar: CHASFLIP_AVATAR_URLS[avatarIndex],
      paisCode,
    });
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter') handleEntrar();
  };

  return (
    <div className="login-screen">
      <div className="login-hero">
        <h1 className="login-logo">
          <span className="gold-text">CHAS</span>FLIP
        </h1>
        <p className="login-sub">{t('login.tagline')}</p>
      </div>

      <div className="login-box">
        <div>
          <p className="field-label">{t('login.email_label')}</p>
          <input
            className="input-glass"
            type="email"
            placeholder={t('login.email_placeholder')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            autoComplete="email"
          />
        </div>

        <div>
          <p className="field-label">{t('login.country_label')}</p>
          <GlassSelect
            value={paisCode}
            onChange={setPaisCode}
            options={COUNTRY_OPTIONS}
            placeholder={t('login.country_placeholder')}
          />
        </div>

        <div>
          <p className="field-label field-label--tight-gap">{t('login.avatar_label')}</p>
          <div className="avatar-grid">
            {CHASFLIP_AVATAR_URLS.map((src, i) => (
              <div
                key={src}
                role="button"
                tabIndex={0}
                aria-pressed={avatarIndex === i}
                aria-label={t('login.avatar_aria', { n: i + 1 })}
                className={`avatar-option ${avatarIndex === i ? 'selected' : ''}`}
                onClick={() => setAvatarIndex(i)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setAvatarIndex(i);
                  }
                }}
              >
                <AvatarFace value={src} variant="pick" />
              </div>
            ))}
          </div>
        </div>

        {error && (
          <div className="login-error" role="alert">
            {error}
          </div>
        )}

        <button className="btn-cta" onClick={handleEntrar}>
          {t('login.cta')}
        </button>
      </div>
    </div>
  );
}
