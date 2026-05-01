import { useState } from 'react';
import { ESCROW_SECURITY_CHECKLIST } from '../game/contractSecurityHardening.js';
import { getExplorerAddressUrl } from '../config/chains.js';

/**
 * @typedef {object} RoundVerificationSnapshot
 * @property {string} roundId
 * @property {string | null | undefined} [matchId]
 * @property {'mock' | 'onchain' | 'supabase'} source
 * @property {string | null | undefined} vrfRequestTxHash
 * @property {string | null | undefined} vrfFulfillmentTxHash
 */

/**
 * @typedef {object} ChainLite
 * @property {string} name
 * @property {string} blockExplorerUrl
 */

function txUrl(explorerBase, hash) {
  const h = (hash || '').trim();
  if (!/^0x[a-fA-F0-9]{64}$/.test(h)) return null;
  return `${explorerBase.replace(/\/$/, '')}/tx/${h}`;
}

function shortenAddress(addr) {
  const a = (addr || '').trim();
  if (!/^0x[a-fA-F0-9]{40}$/i.test(a)) return null;
  return `0x${a.slice(2, 8)}…${a.slice(-4)}`;
}

/**
 * Para jugadores nuevos: texto claro. El detalle técnico está en el bloque desplegable.
 *
 * @param {object} props
 * @param {ChainLite} props.chain
 * @param {RoundVerificationSnapshot | null | undefined} props.verification
 * @param {`0x${string}` | null | undefined} props.protocolTreasuryAddress
 */
export default function ArenaRoundTransparency({
  chain,
  verification,
  protocolTreasuryAddress,
}) {
  const [copiedField, setCopiedField] = useState(/** @type {null | 'simple' | 'round' | 'match'} */ (null));

  const clearCopiedSoon = () => {
    window.setTimeout(() => setCopiedField(null), 2000);
  };

  const copyRoundId = () => {
    if (!verification?.roundId || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(verification.roundId).then(() => {
      setCopiedField('round');
      clearCopiedSoon();
    });
  };

  const copyMatchId = () => {
    const raw = verification?.matchId?.trim?.() ?? verification?.matchId;
    const id = typeof raw === 'string' ? raw.trim() : '';
    if (!id || !navigator.clipboard?.writeText) return;
    void navigator.clipboard.writeText(id).then(() => {
      setCopiedField('match');
      clearCopiedSoon();
    });
  };

  const copyFriendlyRef = () => {
    if (!verification || !navigator.clipboard?.writeText) return;
    const line = verifyLine(verification);
    void navigator.clipboard.writeText(line).then(() => {
      setCopiedField('simple');
      clearCopiedSoon();
    });
  };

  if (!verification?.roundId) return null;

  const {
    roundId,
    matchId,
    source,
    vrfRequestTxHash,
    vrfFulfillmentTxHash,
  } = verification;

  const treasury = typeof protocolTreasuryAddress === 'string' ? protocolTreasuryAddress.trim() : '';
  const treasuryOk = /^0x[a-fA-F0-9]{40}$/.test(treasury);
  const treasuryUrl = treasuryOk ? getExplorerAddressUrl(chain.blockExplorerUrl, /** @type {`0x${string}`} */ (treasury)) : null;

  const reqUrl = txUrl(chain.blockExplorerUrl, vrfRequestTxHash);
  const fulUrl = txUrl(chain.blockExplorerUrl, vrfFulfillmentTxHash);

  const matchIdDisplay =
    typeof matchId === 'string' && matchId.trim().length > 0 ? matchId.trim() : null;

  return (
    <div
      className="arena-round-transparency arena-round-transparency--simple"
      role="region"
      aria-label="Resumen honesto de la ronda"
    >
      <div className="arena-round-transparency__head arena-round-transparency__head--soft">
        <span className="arena-round-transparency__title arena-round-transparency__title--plain">
          Partida cerrada · puedes comprobarla
        </span>
      </div>

      <p className="arena-round-transparency__lead">
        {source === 'mock' && (
          <>
            Estás en <strong>modo práctica</strong>. El resultado no lo inventa esta pantalla: queda enlazado a un{' '}
            <strong>código de rastro</strong> (como el ticket de una rifa). Más abajo puedes copiarlo si algún día
            quieres revisarlo.
          </>
        )}
        {source === 'supabase' && (
          <>
            El resultado salió del <strong>servidor del juego</strong>, no de un número escondido en tu navegador.
            Igual que un sorteo público deja constancia, aquí tienes un <strong>código</strong> de esta partida por si lo
            quieres revisar.
          </>
        )}
        {source !== 'mock' && source !== 'supabase' && (
          <>
            Esta ronda tiene registro público en la cadena. Abajo están los datos que enlazan con la red{' '}
            <strong>{chain.name}</strong>.
          </>
        )}
      </p>

      <div className="arena-round-transparency__friendly-actions">
        <button
          type="button"
          className="arena-round-transparency__friendly-copy"
          onClick={copyFriendlyRef}
        >
          {copiedField === 'simple' ? 'Copiado' : 'Copiar código de esta partida'}
        </button>
      </div>
      <p className="arena-round-transparency__hint" aria-live="polite">
        <code className="arena-round-transparency__hint-code">{verifyLine(verification)}</code>
      </p>

      <details className="arena-round-transparency__details">
        <summary className="arena-round-transparency__details-sum">¿Quieres ver el detalle técnico?</summary>

        <p className="arena-round-transparency__demo arena-round-transparency__demo--tight">
          {source === 'mock' && (
            <>
              Demo local: los mismos datos servirían para enlazar a un futuro{' '}
              <strong>contrato en blockchain</strong> y a un sistema de números aleatorios público (
              <a
                href="https://docs.chain.link/vrf"
                target="_blank"
                rel="noopener noreferrer"
                className="arena-round-transparency__quick-link arena-round-transparency__quick-link--inline"
              >
                Chainlink VRF
              </a>
              ).
            </>
          )}
          {source === 'supabase' && (
            <>
              El <strong>matchId</strong> es el identificador de fila en la base del juego; en producción on-chain debe
              mapear al escrow. La comisión de mesa la fija Postgres, no esta página.
            </>
          )}
        </p>

        {matchIdDisplay && (
          <div className="arena-round-transparency__field arena-round-transparency__field--spaced">
            <span className="arena-round-transparency__label">ID partida · matchId</span>
            <div className="arena-round-transparency__mono-row">
              <code className="arena-round-transparency__mono">{matchIdDisplay}</code>
              <button type="button" className="arena-round-transparency__copy" onClick={copyMatchId}>
                {copiedField === 'match' ? 'Copiado' : 'Copiar'}
              </button>
            </div>
          </div>
        )}

        <div className="arena-round-transparency__field arena-round-transparency__field--spaced">
          <span className="arena-round-transparency__label">ID correlación · roundId</span>
          <div className="arena-round-transparency__mono-row">
            <code className="arena-round-transparency__mono">{roundId}</code>
            <button type="button" className="arena-round-transparency__copy" onClick={copyRoundId}>
              {copiedField === 'round' ? 'Copiado' : 'Copiar'}
            </button>
          </div>
        </div>

        <div className="arena-round-transparency__field arena-round-transparency__field--spaced">
          <span className="arena-round-transparency__label">Tesorería del protocolo (fees)</span>
          {treasuryOk && treasuryUrl ? (
            <div className="arena-round-transparency__treasury-row">
              <a
                href={treasuryUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="arena-round-transparency__treasury-link"
                title={treasury}
              >
                {shortenAddress(treasury)} → explorer ↗
              </a>
            </div>
          ) : (
            <p className="arena-round-transparency__treasury-missing">
              Configura <code className="arena-round-transparency__env-code">VITE_PROTOCOL_TREASURY</code> en el entorno
              del front para mostrar la dirección en el explorador.
            </p>
          )}
        </div>

        {(reqUrl || fulUrl || (source !== 'mock' && source !== 'supabase')) && (
          <div className="arena-round-transparency__tx-grid">
            {reqUrl && (
              <a href={reqUrl} target="_blank" rel="noopener noreferrer" className="arena-round-transparency__tx-link">
                Solicitud VRF → explorer ↗
              </a>
            )}
            {!reqUrl && source !== 'mock' && vrfRequestTxHash == null && (
              <span className="arena-round-transparency__tx-muted">Esperando hash petición VRF…</span>
            )}
            {fulUrl && (
              <a href={fulUrl} target="_blank" rel="noopener noreferrer" className="arena-round-transparency__tx-link">
                Cumplimiento VRF → explorer ↗
              </a>
            )}
            {!fulUrl && source !== 'mock' && vrfFulfillmentTxHash == null && (
              <span className="arena-round-transparency__tx-muted">Esperando hash fulfilment…</span>
            )}
          </div>
        )}

        <details className="arena-round-transparency__security">
          <summary className="arena-round-transparency__security-summary">Checklist de diseño del contrato</summary>
          <p className="arena-round-transparency__security-intro">
            El dinero real se protege en el contrato desplegado y en la operación del protocolo, no en este sitio.
          </p>
          <ul className="arena-round-transparency__security-list">
            {ESCROW_SECURITY_CHECKLIST.map((line) => (
              <li key={line} className="arena-round-transparency__security-item">
                {line}
              </li>
            ))}
          </ul>
        </details>

        <div className="arena-round-transparency__quick">
          <a
            href={chain.blockExplorerUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="arena-round-transparency__quick-link"
          >
            Abrir explorer de {chain.name} ↗
          </a>
          <span className="arena-round-transparency__dot">·</span>
          <a
            href="https://docs.chain.link/vrf"
            target="_blank"
            rel="noopener noreferrer"
            className="arena-round-transparency__quick-link"
          >
            Cómo funciona VRF (Chainlink) ↗
          </a>
        </div>
      </details>
    </div>
  );
}

/** @param {RoundVerificationSnapshot} v */
function verifyLine(v) {
  const m = typeof v.matchId === 'string' && v.matchId.trim() ? v.matchId.trim() : null;
  if (m) return `ChasFlip · partida: ${m} · ronda: ${v.roundId}`;
  return `ChasFlip · ronda: ${v.roundId}`;
}
