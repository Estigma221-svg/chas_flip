import { useCallback, useEffect, useRef, useState } from 'react';
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
  onConectarWallet,
  onAbrirDeposito,
}) {
  const { t, i18n } = useTranslation();
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const [infoOpen, setInfoOpen] = useState(false);
  const [localRival, setLocalRival] = useState(null);
  const chain = getTargetChain();

  /* ----------------------------- FREE PLAY -------------------------------- */
  /**
   * Modo "Probar gratis": un único tiro demo, siempre ganador, sin tocar saldo
   * ni Supabase. La idea es reducir fricción inicial — el user ve cómo es la
   * mecánica con su propia cifra elegida y al final decide si conecta wallet.
   *
   * `claimed` se persiste en localStorage para que un mismo navegador no abuse
   * recargando. Si borra cookies puede volver a tener uno; el costo nuestro es
   * cero (animación local), así que no es problema.
   */
  const [freePlayPhase, setFreePlayPhase] = useState(
    /** @type {'idle' | 'searching' | 'flipping' | 'won'} */ ('idle'),
  );
  const [freePlayStake, setFreePlayStake] = useState(0);
  const [freePlayRival, setFreePlayRival] = useState(null);
  const [freePlayClaimed, setFreePlayClaimed] = useState(() => {
    try {
      return typeof window !== 'undefined'
        && window.localStorage.getItem('chasflip:freePlayClaimed') === '1';
    } catch { return false; }
  });
  const freePlayTimers = useRef(/** @type {number[]} */ ([]));

  const cerrarBannerGratis = useCallback(() => {
    freePlayTimers.current.forEach((id) => window.clearTimeout(id));
    freePlayTimers.current = [];
    setFreePlayPhase('idle');
    setFreePlayStake(0);
    setFreePlayRival(null);
  }, []);

  const iniciarTiroGratis = useCallback(
    /** @param {number} monto */
    (monto) => {
      if (freePlayClaimed || freePlayPhase !== 'idle' || fase !== 'idle') return;
      setFreePlayStake(monto);
      setFreePlayRival(rivalAleatorio());
      setFreePlayPhase('searching');
      const t1 = window.setTimeout(() => setFreePlayPhase('flipping'), 1600);
      const t2 = window.setTimeout(() => {
        setFreePlayPhase('won');
        try {
          window.localStorage.setItem('chasflip:freePlayClaimed', '1');
        } catch { /* almacenamiento bloqueado: ignoramos */ }
        setFreePlayClaimed(true);
      }, 1600 + 2400);
      freePlayTimers.current.push(t1, t2);
    },
    [freePlayClaimed, freePlayPhase, fase],
  );

  // Limpieza al desmontar para evitar setState en componente unmounted.
  useEffect(() => () => {
    freePlayTimers.current.forEach((id) => window.clearTimeout(id));
    freePlayTimers.current = [];
  }, []);

  const handleClickConectarWallet = () => {
    onConectarWallet?.();
    cerrarBannerGratis();
  };
  const handleClickDepositarFromBanner = () => {
    onAbrirDeposito?.();
    cerrarBannerGratis();
  };

  /* Estado local sólo cuando no viene rival Supabase · actualizado al ritmo UI `fase`. */
  /* eslint-disable react-hooks/set-state-in-effect -- oponente demo no deriva de fetch externo */
  useEffect(() => {
    if (rivalRemote) return;
    if (fase === 'buscando') setLocalRival(null);
    if (fase === 'jugando') setLocalRival(rivalAleatorio());
    if (fase === 'idle') setLocalRival(null);
  }, [fase, rivalRemote]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const realRival = rivalRemote ?? localRival;
  const tieneDeposito = saldo >= 10;

  // Variables derivadas: durante el Free Play, todo lo visual (moneda, rival,
  // banner) se conduce con valores "display" sintéticos para que la animación
  // se vea idéntica al juego real sin tocar el estado real ni matchmaking.
  const isFreePlay = freePlayPhase !== 'idle';
  const displayFase = isFreePlay
    ? freePlayPhase === 'searching'
      ? 'buscando'
      : freePlayPhase === 'flipping'
        ? 'jugando'
        : 'resultado'
    : fase;
  const rival = isFreePlay ? freePlayRival : realRival;
  const displayResultado = freePlayPhase === 'won' ? 'gano' : isFreePlay ? null : resultado;
  const jugando = displayFase === 'jugando' || displayFase === 'resultado';
  // El banner especial de Free Play sustituye el banner normal de victoria.
  const showFreePlayWonBanner = freePlayPhase === 'won';
  const showRegularOutcomeBanner = !isFreePlay && fase === 'resultado' && resultado;
  // El botón "Probar gratis" aparece solo cuando el user no tiene saldo, no ha
  // usado su tiro y no hay nada en curso.
  const canShowFreePlayCta =
    !tieneDeposito && !freePlayClaimed && fase === 'idle' && freePlayPhase === 'idle';

  // En modo Free Play tratamos al jugador como "listo" (no lock) aunque saldo=0.
  const youAvatarClass = (!tieneDeposito && !isFreePlay)
    ? 'arena-avatar arena-avatar--you-lock'
    : displayResultado === 'gano'
      ? 'arena-avatar arena-avatar--you-win'
      : displayResultado === 'perdio'
        ? 'arena-avatar arena-avatar--you-lose'
        : 'arena-avatar arena-avatar--you-ready';

  const rivalAvatarClass =
    jugando && rival
      ? displayResultado === 'perdio'
        ? 'arena-avatar arena-avatar--rival-win'
        : displayResultado === 'gano'
          /** Rojo antes parecía “premio”; al ganar el rival debe verse apagado, no luminoso */
          ? 'arena-avatar arena-avatar--rival-beaten'
          : 'arena-avatar arena-avatar--rival-idle'
      : '';

  return (
    <section
      className={[
        'arena',
        `arena--fase-${displayFase}`,
        displayResultado ? `arena--out-${displayResultado}` : '',
        useServerMatchmaking ? 'arena--online' : '',
        isFreePlay ? 'arena--freeplay' : '',
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

      {showRegularOutcomeBanner && (
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

      {showFreePlayWonBanner && (
        <div className="arena-freeplay-banner" role="status" aria-live="polite">
          <div className="arena-freeplay-banner__head">
            <span className="arena-freeplay-banner__pulse" />
            <span className="arena-freeplay-banner__pill">{t('free_play.banner_pill')}</span>
          </div>
          <h3 className="arena-freeplay-banner__title">
            {t('free_play.banner_title', {
              amount: freePlayStake.toLocaleString(numLocale, { maximumFractionDigits: 2 }),
            })}
          </h3>
          <p className="arena-freeplay-banner__sub">{t('free_play.banner_sub')}</p>
          <div className="arena-freeplay-banner__ctas">
            <button
              type="button"
              className="arena-freeplay-banner__cta arena-freeplay-banner__cta--primary"
              onClick={handleClickConectarWallet}
            >
              <span className="btn-icon">🔗</span>
              {t('free_play.cta_wallet')}
            </button>
            <button
              type="button"
              className="arena-freeplay-banner__cta arena-freeplay-banner__cta--secondary"
              onClick={handleClickDepositarFromBanner}
            >
              {t('free_play.cta_deposit')}
            </button>
          </div>
          <button
            type="button"
            className="arena-freeplay-banner__close"
            onClick={cerrarBannerGratis}
            aria-label={t('common.close')}
          >
            ✕
          </button>
        </div>
      )}

      <div className={`arena-players-row${displayFase === 'resultado' ? ' arena-players-row--outcome' : ''}`}>
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
                {(tieneDeposito || isFreePlay) ? usuario?.email : t('arena.no_balance')}
              </span>
            </div>
            {displayFase === 'resultado' && (tieneDeposito || isFreePlay) && (
              <span className="arena-role-pill arena-role-pill--you">{t('arena.you')}</span>
            )}
          </div>
        </div>

        <div className="arena-coin-col">
          <div className="coin-box">
            <ErrorBoundary fallback={<Coin3DFallback />}>
                <Bitcoin3D fase={displayFase} />
            </ErrorBoundary>
          </div>
          {displayFase === 'buscando' && (
            <p className={`arena-coin-msg arena-coin-msg--search${useServerMatchmaking && !isFreePlay ? ' arena-coin-msg--live' : ''}`}>
              {isFreePlay
                ? t('free_play.searching')
                : useServerMatchmaking
                  ? t('arena.searching_live')
                  : t('arena.searching_local')}
            </p>
          )}
          {displayFase === 'jugando' && (
            <p className={`arena-coin-msg arena-coin-msg--busy${useServerMatchmaking && !isFreePlay ? ' arena-coin-msg--live' : ''}`}>
              {isFreePlay
                ? t('free_play.flipping')
                : useServerMatchmaking
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
              className={`arena-rival-empty ${displayFase === 'buscando' ? 'is-searching' : ''}`}
            >
              <span className="arena-rival-empty__label">
                {displayFase === 'buscando'
                  ? t('arena.rival_searching_label')
                  : (tieneDeposito || isFreePlay)
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
                  : displayFase === 'buscando'
                    ? '…'
                    : (tieneDeposito || isFreePlay)
                      ? t('arena.rival_idle_name')
                      : t('arena.rival_locked_name')}
              </span>
            </div>
            {jugando && rival && displayFase === 'resultado' && (
              <span
                className={
                  displayResultado === 'gano'
                    ? 'arena-role-pill arena-role-pill--opp'
                    : displayResultado === 'perdio'
                      ? 'arena-role-pill arena-role-pill--opp arena-role-pill--opp-win'
                      : 'arena-role-pill arena-role-pill--opp'
                }
              >
                {displayResultado === 'perdio' ? t('arena.opponent_won') : t('arena.opponent_label_default')}
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
          const enableForFreePlay = canShowFreePlayCta;
          const realDisabled = fase !== 'idle' || !tieneDeposito;
          const isDisabled = realDisabled && !enableForFreePlay;
          const handleClick = enableForFreePlay
            ? () => iniciarTiroGratis(monto)
            : () => jugar(monto);

          return (
            <button
              key={monto}
              type="button"
              className={`bet-btn ${clase}${!tieneDeposito && !enableForFreePlay ? ' is-locked' : ''}${
                tieneDeposito && fase !== 'idle' ? ' is-busy' : ''
              }${enableForFreePlay ? ' is-freeplay' : ''}`}
              onClick={handleClick}
              disabled={isDisabled || isFreePlay}
            >
              <span className="bet-btn__amt">{etiqueta}</span>
              {refPct && !useServerMatchmaking && (
                <span className="bet-btn__fee">{refPct}</span>
              )}
            </button>
          );
        })}
      </div>

      {canShowFreePlayCta && (
        <div className="arena-freeplay-cta" role="region" aria-label={t('free_play.cta_aria')}>
          <span className="arena-freeplay-cta__pulse" />
          <span className="arena-freeplay-cta__label">
            🔥 {t('free_play.cta_hint')}
          </span>
          <span className="arena-freeplay-cta__sub">{t('free_play.cta_sub')}</span>
        </div>
      )}

      {!tieneDeposito && !canShowFreePlayCta && !isFreePlay && (
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
