import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AvatarFace from './AvatarFace';
import CountryFlag from './CountryFlag';

const NOMBRES = [
  '@MonterreyX', '@VegasBoss', '@DubaiWhale', '@RioGold', '@TokyoFlip',
  '@JaviStyle', '@CryptoKing', '@MadridWhale', '@LondonBull', '@NYCFlip',
];

// ISO 3166-1 alpha-2 — banderas vía CDN (CountryFlag)
const PAISES = ['MX', 'US', 'AE', 'BR', 'JP', 'ES', 'GB', 'CA', 'AR', 'DE', 'FR', 'KR'];

const montoRandom = () => {
  const opciones = [1, 10, 100, 1000, 10000, 100000, 1000000];
  return opciones[Math.floor(Math.random() * opciones.length)];
};

const POOL_INICIAL = 60158748;

export default function Sidebar({ usuario }) {
  const { t, i18n } = useTranslation();
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];

  const [users, setUsers] = useState([
    { id: 1, code: 'MX', name: '@JaviStyle',  monto: 10,      gano: true  },
    { id: 2, code: 'US', name: '@CryptoKing', monto: 100,     gano: false },
    { id: 3, code: 'ES', name: '@MadridWhale',monto: 1000000, gano: true  },
  ]);

  const [totalVivo, setTotalVivo] = useState(POOL_INICIAL);
  const [conteo, setConteo] = useState(54312);

  useEffect(() => {
    const interval = setInterval(() => {
      const monto = montoRandom();
      const gano = Math.random() > 0.5;
      const newUser = {
        id: Date.now(),
        code: PAISES[Math.floor(Math.random() * PAISES.length)],
        name: NOMBRES[Math.floor(Math.random() * NOMBRES.length)],
        monto,
        gano,
      };
      setUsers((prev) => [newUser, ...prev.slice(0, 9)]);
      setTotalVivo((prev) => prev + (gano ? monto * 0.95 : -monto * 0.1));
      setConteo((prev) => prev + Math.floor(Math.random() * 3) - 1);
    }, 2500);
    return () => clearInterval(interval);
  }, []);

  return (
    <aside className="sidebar">
      <div className="side-title">{t('sidebar.title')}</div>

      <div className="pool-card">
        <p className="field-label">{t('sidebar.pool_label')}</p>
        <p className="pool-card__value">
          ${Math.floor(totalVivo).toLocaleString(numLocale)}
        </p>
        <p className="pool-card__hint">{t('sidebar.pool_hint')}</p>
      </div>

      <div className="live-list">
        {usuario && (
          <div className="user-row is-you" title={usuario.email}>
            <span className="user-row__main">
              <span className="user-row__flag" aria-hidden="true">
                <CountryFlag code={usuario.paisCode} />
              </span>
              <span className="user-row__avatar-emoji">
                <AvatarFace value={usuario.avatar} variant="row" />
              </span>
              <span className="user-row__name">{usuario.email}</span>
            </span>
            <span className="pill user-row__you-pill pill--you">{t('sidebar.you_pill')}</span>
          </div>
        )}

        {users.map((user) => (
          <div key={user.id} className="user-row fade-in">
            <span className="user-row__main user-row__main--ghost">
              <span className="user-row__flag">
                <CountryFlag code={user.code} />
              </span>
              <span className="user-row__name">{user.name}</span>
            </span>
            <span className={`pill ${user.gano ? 'pill--up' : 'pill--down'}`}>
              {user.gano ? '+' : '-'}${user.monto.toLocaleString(numLocale)}
            </span>
          </div>
        ))}
      </div>

      <div className="side-footer">
        <span className="online-dot" />
        {t('sidebar.playing_now', { count: conteo.toLocaleString(numLocale) })}
      </div>
    </aside>
  );
}
