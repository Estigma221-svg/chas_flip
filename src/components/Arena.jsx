import { useEffect, useState } from 'react';
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
          <span className="arena-sync-strip__pulse" title="Canal en vivo" />
          <span className="arena-sync-strip__meta">
            Mesa ${Number(liveMatchRow.stake_amount ?? 0).toLocaleString('es-MX')} · comisión{' '}
            {pctFromCommissionDec(liveMatchRow.commission_decimal)}
          </span>
          <span className="arena-sync-strip__divider">·</span>
          {liveMatchRow.status === 'completed' ? (
            <span className="arena-sync-strip__done">Mesa cerrada</span>
          ) : (
            <span className="arena-sync-strip__meta">Conectado · partida en vivo</span>
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
                <span className="arena-outcome-banner__title">¡Ganaste esta ronda!</span>
                {ultimaGanancia != null ? (
                  <span className="arena-outcome-banner__amt">
                    +${ultimaGanancia.toLocaleString('es-MX', { maximumFractionDigits: 2 })}
                  </span>
                ) : (
                  <span className="arena-outcome-banner__amt">¡Bien jugado!</span>
                )}
              </div>
              <p className="arena-outcome-banner__hint">
                {rival
                  ? `Tu cuenta y tu bandera son las de «Tú» abajo — ${rival.nombre} fue solo tu contrincante en esta ronda.`
                  : 'Tu cuenta va con la etiqueta «Tú» debajo.'}
              </p>
            </>
          ) : (
            <>
              <div className="arena-outcome-banner__main">
                <span className="arena-outcome-banner__title">Esta vez no fue</span>
                {rival ? (
                  <span className="arena-outcome-banner__vs">Te ganó {rival.nombre}</span>
                ) : (
                  <span className="arena-outcome-banner__vs">Sigue cuando quieras</span>
                )}
              </div>
              <p className="arena-outcome-banner__hint">Aquí mismo eliges otro monto cuando estés listo.</p>
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
                {tieneDeposito ? usuario?.email : 'Sin saldo'}
              </span>
            </div>
            {fase === 'resultado' && tieneDeposito && (
              <span className="arena-role-pill arena-role-pill--you">Tú</span>
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
                ? 'Buscando rival en cola en vivo…'
                : 'Buscando rival...'}
            </p>
          )}
          {fase === 'jugando' && (
            <p className={`arena-coin-msg arena-coin-msg--busy${useServerMatchmaking ? ' arena-coin-msg--live' : ''}`}>
              {useServerMatchmaking
                ? 'Cayendo la moneda — el servidor decide esta ronda con reglas públicas.'
                : 'Cayendo la moneda…'}
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
                  ? 'Buscando rival'
                  : tieneDeposito
                    ? 'Elige una apuesta'
                    : 'Deposita para jugar'}
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
                      ? 'Pulsa $10 / $100…'
                      : 'Sin contrincante aún'}
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
                {resultado === 'perdio' ? 'Ganó esta vez' : 'Contrincante'}
              </span>
            )}
          </div>
        </div>
      </div>

      {fase === 'resultado' && typeof onSeguirJugando === 'function' && (
        <div className="arena-continue-banner" role="status">
          <button type="button" className="arena-continue-banner__cta" onClick={onSeguirJugando}>
            Seguir jugando
          </button>
          <p className="arena-continue-banner__note">
            Abajo tienes opcional cómo copiar el código de la partida · si esperas unos segundos también cierra solo.
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
          El tanto por ciento lo fija el servidor del juego, no algo inventado aquí en el navegador.
        </p>
      )}

      {!useServerMatchmaking && (
        <p className="arena-server-caption arena-server-caption--muted">
          Modo práctica: ejemplo de tasas (~{pctLabelForStake(10)} en mesas pequeñas, ~{pctLabelForStake(100)} en otras).
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
          ⚡ Deposita mínimo $10 para entrar a la arena
        </p>
      )}

      <div className={`arena-info ${infoOpen ? 'open' : ''}`}>
        <button
          type="button"
          className="arena-info__toggle"
          onClick={() => setInfoOpen((v) => !v)}
        >
          <span>Cómo funciona ChasFlip</span>
          <span className="arena-info__chev">{infoOpen ? '▾' : '▸'}</span>
        </button>

        <div className="arena-info__body" aria-hidden={!infoOpen}>
          <p className="arena-info__text">
            ChasFlip opera con un <span className="arena-info__accent">smart pool dinámico</span> integrado con{' '}
            <strong>Supabase</strong>: el pool en vivo concentra la actividad de las mesas y mantiene los saldos y
            movimientos <strong>coherentes y centralizados</strong> para todos los jugadores.
          </p>
          <p className="arena-info__text">
            Cada vez que juegas una ronda, el motor del juego apunta a un resultado <strong>rápido en la experiencia</strong>{' '}
            y <strong>verificable después</strong>—queda como un{' '}
            <span className="arena-info__accent">ticket</span> que puedes copiar: nadie desde esta pantalla puede alterar
            quién ganó una vez hecha la apuesta. Con billetera conectada, en la{' '}
            <a href={chain.blockExplorerUrl} target="_blank" rel="noopener noreferrer" className="arena-info__link">
              cadena oficial
            </a>{' '}
            ves la misma información pública que el resto.
          </p>
          <p className="arena-info__text">
            ¿Y <span className="arena-info__accent-vrf">“VRF”</span>? En cripto es la forma habitual de obtener azar{' '}
            <strong>revisable por terceros</strong>. Si no te interesa el detalle: la idea es{' '}
            <strong>honestidad con prueba</strong>, no tecnología en tu contra.
          </p>
        </div>
      </div>
    </section>
  );
}
