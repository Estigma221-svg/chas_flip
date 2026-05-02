import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import AvatarFace from './AvatarFace';
import CountryFlag from './CountryFlag';
import Bitcoin3D from './Bitcoin3D.jsx';
import ErrorBoundary from './ErrorBoundary';
import ArenaRoundTransparency from './ArenaRoundTransparency';
import { getTargetChain } from '../config/chains.js';
import { CHASFLIP_AVATAR_URLS } from '../data/chasflipAvatars.js';
import { getLocalCommissionDecimal } from '../game/stakeTiers.js';

function Coin3DFallback() {
  return <div className="coin-fallback">C</div>;
}

/** Mesas fijas (`S`): en Supabase la comisión la fija Postgres; aquí sólo muestra referencia UX en modo local. */
const APUESTAS = [
  { monto: 10,      etiqueta: '$10',        clase: 'bet-10' },
  { monto: 100,     etiqueta: '$100',       clase: 'bet-100' },
  { monto: 1000,    etiqueta: '$1,000',     clase: 'bet-1k' },
  { monto: 10000,   etiqueta: '$10,000',    clase: 'bet-10k' },
  { monto: 100000,  etiqueta: '$100,000',   clase: 'bet-100k' },
  { monto: 1000000, etiqueta: '$1,000,000', clase: 'bet-millon' },
];

const RIVALES = [
  { nombre: '@CryptoKing',   paisCode: 'US' },
  { nombre: '@DubaiWhale',   paisCode: 'AE' },
  { nombre: '@TokyoFlip',    paisCode: 'JP' },
  { nombre: '@MadridBull',   paisCode: 'ES' },
  { nombre: '@RioGold',      paisCode: 'BR' },
  { nombre: '@LondonWolf',   paisCode: 'GB' },
  { nombre: '@MonterreyX',   paisCode: 'MX' },
  { nombre: '@NYCFlip',      paisCode: 'US' },
  { nombre: '@BerlinWhale',  paisCode: 'DE' },
  { nombre: '@ShanghaiKing', paisCode: 'CN' },
].map((r, i) => ({
  ...r,
  avatar: CHASFLIP_AVATAR_URLS[i % CHASFLIP_AVATAR_URLS.length],
}));

const rivalAleatorio = () => RIVALES[Math.floor(Math.random() * RIVALES.length)];

/** @param {number} stake */
function pctLabelForStake(stake) {
  const d = getLocalCommissionDecimal(stake);
  if (d == null) return null;
  return `${Math.round(d * 1000) / 10}%`;
}

/** @param {unknown} d */
function pctFromCommissionDec(d) {
  const n = typeof d === 'number' ? d : Number(d);
  if (!Number.isFinite(n)) return '—';
  const p = n * 100;
  return `${Number.isInteger(p) ? String(p) : p.toFixed(2)} %`;
}

export default function Arena({
  fase,
  jugar,
  usuario,
  saldo,
  resultado,
  ultimaGanancia,
  roundVerification,
  protocolTreasuryAddress,
  useServerMatchmaking,
  rivalRemote,
  liveMatchRow,
  onSeguirJugando,
}) {
  const { t, i18n } = useTranslation();
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const [infoOpen, setInfoOpen] = useState(false);
  const [localRival, setLocalRival] = useState(null);
  const chain = getTargetChain();

  /* Estado local sólo cuando no viene rival Supabase · actualizado al ritmo UI `fase`. */
  /* eslint-disable react-hooks/set-state-in-effect -- oponente demo no deriva de fetch externo */
  useEffect(() => {
    if (rivalRemote) return;
    if (fase === 'buscando') setLocalRival(null);
    if (fase === 'jugando') setLocalRival(rivalAleatorio());
    if (fase === 'idle') setLocalRival(null);
  }, [fase, rivalRemote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const rival = rivalRemote ?? localRival;
  const tieneDeposito = saldo >= 10;
  const jugando = fase === 'jugando' || fase === 'resultado';

  const youAvatarClass = !tieneDeposito
    ? 'arena-avatar arena-avatar--you-lock'
    : resultado === 'gano'
      ? 'arena-avatar arena-avatar--you-win'
      : resultado === 'perdio'
        ? 'arena-avatar arena-avatar--you-lose'
        : 'arena-avatar arena-avatar--you-ready';

  const rivalAvatarClass =
    jugando && rival
      ? resultado === 'perdio'
        ? 'arena-avatar arena-avatar--rival-win'
        : resultado === 'gano'
          /** Rojo antes parecía “premio”; al ganar el rival debe verse apagado, no luminoso */
          ? 'arena-avatar arena-avatar--rival-beaten'
          : 'arena-avatar arena-avatar--rival-idle'
      : '';

  return (
    <section
      className={[
        'arena',
        `arena--fase-${fase}`,
        resultado ? `arena--out-${resultado}` : '',
        useServerMatchmaking ? 'arena--online' : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      {liveMatchRow && (
        <div className="arena-sync-strip" role="status" aria-live="polite">
          <span className="arena-sync-strip__pulse" />
          <span className="arena-sync-strip__meta">
            {t('arena.live_strip_meta', {
              stake: Number(liveMatchRow.stake_amount ?? 0).toLocaleString(numLocale),
              pct: pctFromCommissionDec(liveMatchRow.commission_decimal),
            })}
          </span>
          <span className="arena-sync-strip__divider">·</span>
          {liveMatchRow.status === 'completed' ? (
            <span className="arena-sync-strip__done">{t('arena.live_strip_done')}</span>
          ) : (
            <span className="arena-sync-strip__meta">{t('arena.live_strip_meta_live')}</span>
          )}
        </div>
      )}

      {fase === 'resultado' && resultado && (
        <div
          className={`arena-outcome-banner ${
            resultado === 'gano' ? 'arena-outcome-banner--win' : 'arena-outcome-banner--lose'
          }`}
          role="status"
        >
          {resultado === 'gano' ? (
            <>
              <div className="arena-outcome-banner__main">
                <span className="arena-outcome-banner__title">{t('arena.win_title')}</span>
                {ultimaGanancia != null ? (
                  <span className="arena-outcome-banner__amt">
                    +${ultimaGanancia.toLocaleString(numLocale, { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className="arena-outcome-banner__amt">{t('arena.win_amount_default')}</span>
                )}
              </div>
              <p className="arena-outcome-banner__hint">
                {rival
                  ? t('arena.win_hint_with_rival', { rival: rival.nombre })
                  : t('arena.win_hint_no_rival')}
              </p>
            </>
          ) : (
            <>
              <div className="arena-outcome-banner__main">
                <span className="arena-outcome-banner__title">{t('arena.lose_title')}</span>
                {rival ? (
                  <span className="arena-outcome-banner__vs">
                    {t('arena.lose_with_rival', { rival: rival.nombre })}
                  </span>
                ) : (
                  <span className="arena-outcome-banner__vs">{t('arena.lose_no_rival')}</span>
                )}
              </div>
              <p className="arena-outcome-banner__hint">{t('arena.lose_hint')}</p>
            </>
          )}
        </div>
      )}

      <div className={`arena-players-row${fase === 'resultado' ? ' arena-players-row--outcome' : ''}`}>
        <div className="arena-player-col arena-player-col--you">
          <div className={youAvatarClass}>
            <AvatarFace value={usuario?.avatar} variant="arena" />
          </div>
          <div className="arena-player">
            <div className="arena-player__id" title={usuario?.email}>
              {usuario?.paisCode && (
                <span className="user-chip__flag arena-flag-slot">
                  <CountryFlag code={usuario.paisCode} />
                </span>
              )}
              <span className="arena-player__name">
                {tieneDeposito ? usuario?.email : t('arena.no_balance')}
              </span>
            </div>
            {fase === 'resultado' && tieneDeposito && (
              <span className="arena-role-pill arena-role-pill--you">{t('arena.you')}</span>
            )}
          </div>
        </div>

        <div className="arena-coin-col">
          <div className="coin-box">
            <ErrorBoundary fallback={<Coin3DFallback />}>
                <Bitcoin3D fase={fase} />
            </ErrorBoundary>
          </div>
          {fase === 'buscando' && (
            <p className={`arena-coin-msg arena-coin-msg--search${useServerMatchmaking ? ' arena-coin-msg--live' : ''}`}>
              {useServerMatchmaking
                ? t('arena.searching_live')
                : t('arena.searching_local')}
            </p>
          )}
          {fase === 'jugando' && (
            <p className={`arena-coin-msg arena-coin-msg--busy${useServerMatchmaking ? ' arena-coin-msg--live' : ''}`}>
              {useServerMatchmaking
                ? t('arena.playing_live')
                : t('arena.playing_local')}
            </p>
          )}
        </div>

        <div className="arena-player-col arena-player-col--rival">
          {jugando && rival ? (
            <div className={rivalAvatarClass}>
              <AvatarFace value={rival.avatar} variant="arena" />
            </div>
          ) : (
            <div
              className={`arena-rival-empty ${fase === 'buscando' ? 'is-searching' : ''}`}
            >
              <span className="arena-rival-empty__label">
                {fase === 'buscando'
                  ? t('arena.rival_searching_label')
                  : tieneDeposito
                    ? t('arena.rival_idle_label')
                    : t('arena.rival_idle_label_locked')}
              </span>
            </div>
          )}
          <div className="arena-player">
            <div className="arena-player__id">
              {jugando && rival && (
                <span className="user-chip__flag arena-flag-slot">
                  <CountryFlag code={rival.paisCode} />
                </span>
              )}
              <span className="arena-player__name arena-player__name--muted">
                {jugando && rival
                  ? rival.nombre
                  : fase === 'buscando'
                    ? '…'
                    : tieneDeposito
                      ? t('arena.rival_idle_name')
                      : t('arena.rival_locked_name')}
              </span>
            </div>
            {jugando && rival && fase === 'resultado' && (
              <span
                className={
                  resultado === 'gano'
                    ? 'arena-role-pill arena-role-pill--opp'
                    : resultado === 'perdio'
                      ? 'arena-role-pill arena-role-pill--opp arena-role-pill--opp-win'
                      : 'arena-role-pill arena-role-pill--opp'
                }
              >
                {resultado === 'perdio' ? t('arena.opponent_won') : t('arena.opponent_label_default')}
              </span>
            )}
          </div>
        </div>
      </div>

      {fase === 'resultado' && typeof onSeguirJugando === 'function' && (
        <div className="arena-continue-banner" role="status">
          <button type="button" className="arena-continue-banner__cta" onClick={onSeguirJugando}>
            {t('arena.continue_cta')}
          </button>
          <p className="arena-continue-banner__note">
            {t('arena.continue_note')}
          </p>
        </div>
      )}

      {fase === 'resultado' && roundVerification && (
        <ArenaRoundTransparency
          chain={chain}
          verification={roundVerification}
          protocolTreasuryAddress={protocolTreasuryAddress}
        />
      )}

      {useServerMatchmaking && (
        <p className="arena-server-caption">
          {t('arena.server_caption_live')}
        </p>
      )}

      {!useServerMatchmaking && (
        <p className="arena-server-caption arena-server-caption--muted">
          {t('arena.server_caption_demo', {
            small: pctLabelForStake(10),
            big: pctLabelForStake(100),
          })}
        </p>
      )}

      <div className="arena-bets-row">
        {APUESTAS.map(({ monto, etiqueta, clase }) => {
          const refPct = pctLabelForStake(monto);

          return (
            <button
              key={monto}
              type="button"
              className={`bet-btn ${clase}${!tieneDeposito ? ' is-locked' : ''}${
                tieneDeposito && fase !== 'idle' ? ' is-busy' : ''
              }`}
              onClick={() => jugar(monto)}
              disabled={fase !== 'idle' || !tieneDeposito}
            >
              <span className="bet-btn__amt">{etiqueta}</span>
              {refPct && !useServerMatchmaking && (
                <span className="bet-btn__fee">{refPct}</span>
              )}
            </button>
          );
        })}
      </div>

      {!tieneDeposito && (
        <p className="arena-deposit-hint">
          {t('arena.deposit_hint')}
        </p>
      )}

      <div className={`arena-info ${infoOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="arena-info__toggle"
          onClick={() => setInfoOpen((v) => !v)}
        >
          <span>{t('arena.info_toggle')}</span>
          <span className="arena-info__chev">{infoOpen ? '▾' : '▸'}</span>
        </button>

        <div className="arena-info__body" aria-hidden={!infoOpen}>
          <p
            className="arena-info__text"
            dangerouslySetInnerHTML={{ __html: t('arena.info_p1_html') }}
          />
          <p className="arena-info__text">
            <span dangerouslySetInnerHTML={{ __html: t('arena.info_p2_pre_link') }} />
            <a href={chain.blockExplorerUrl} target="_blank" rel="noopener noreferrer" className="arena-info__link">
              {t('arena.info_p2_link_label')}
            </a>
            <span dangerouslySetInnerHTML={{ __html: t('arena.info_p2_post_link') }} />
          </p>
          <p
            className="arena-info__text"
            dangerouslySetInnerHTML={{ __html: t('arena.info_p3_html') }}
          />
        </div>
      </div>
    </section>
  );
}
