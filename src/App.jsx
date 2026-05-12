import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import './App.css';
import Login from './components/Login';
import Arena from './components/Arena.jsx';
import LiveChatArena from './components/LiveChatArena.jsx';
import Sidebar from './components/Sidebar';
import Header from './components/Header';
import Modal from './components/Modal';
import ErrorBoundary from './components/ErrorBoundary';
import AppleHudAlert from './components/AppleHudAlert';
import MatchmakingSheet from './components/MatchmakingSheet';
import { findCountry } from './data/countries';
import { getProtocolTreasuryAddress, getRuntimeConfigSummary } from './config/appEnv.js';
import { isSupabaseBrowserConfigured, isSupabaseMatchmakingEnabled } from './config/supabaseEnv.js';
import { getSupabaseBrowserClient } from './lib/supabaseClient.js';
import { safeSupabaseErrorCode } from './lib/supabaseError.js';
import {
  cancelQueuedMatchmaking,
  ensureSupabaseSessionAndProfile,
  joinMatchmaking,
  pickOpponentFromMatchMeta,
  resolveMatchRound,
  rivalFromOpponentBlob,
  subscribeMatchInserts,
  subscribeMatchRowUpdates,
} from './services/supabaseMatchmaking.js';
import { getFlipEngine } from './game/getFlipEngine.js';
import { getLocalCommissionDecimal } from './game/stakeTiers.js';
import {
  playDepositSound,
  playFlipTick,
  playWinSound,
  prewarmAudio,
} from './utils/sound';
import { DEFAULT_CHASFLIP_AVATAR_URL, normalizeStoredAvatar } from './data/chasflipAvatars.js';
import { useWalletPanel } from './lib/useWalletPanel.js';
import { useUserBalance } from './lib/useUserBalance.js';
import { useOnchainAddressLink } from './lib/useOnchainAddressLink.js';
import {
  freshIdempotencyKey,
  recordDepositDemo,
  recordWithdrawDemo,
} from './services/supabaseLedger.js';

const SESSION_KEY = 'chasflip:session:v1';

const flipEngine = getFlipEngine();
const protocolTreasuryAddress = getProtocolTreasuryAddress();

const SUPABASE_MATCH_READY = isSupabaseMatchmakingEnabled() && isSupabaseBrowserConfigured();

function readSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    if (!data || typeof data !== 'object') return null;
    if (!data.email || data.avatar == null || data.avatar === '' || !data.paisCode) return null;
    return {
      ...data,
      avatar: normalizeStoredAvatar(data.avatar, data.email),
    };
  } catch {
    return null;
  }
}

function App() {
  const { t, i18n } = useTranslation();
  const numLocale = (i18n.resolvedLanguage || i18n.language || 'en').split('-')[0];
  const [usuario, setUsuario] = useState(() => readSession());
  // Saldo legacy local (fallback cuando Supabase no está configurado o
  // todavía no terminó el bootstrap). Fuente de verdad solo si NO hay ledger.
  const [localSaldo, setLocalSaldo] = useState(0);
  const [fase, setFase] = useState('idle');
  const [resultado, setResultado] = useState(null);
  const [ultimaGanancia, setUltimaGanancia] = useState(null);
  const [modal, setModal] = useState(null);
  const [verificationMeta, setVerificationMeta] = useState(null);
  // Wallet on-chain real (wagmi + RainbowKit, Fase 2.A). Sigue conviviendo con
  // el saldo demo de `localStorage` — el dinero on-chain aún NO mueve el saldo
  // del juego (eso llega en Fase 2.B con el ledger en Supabase).
  const {
    address: walletAddress,
    chainId: walletChainId,
    isConnected: walletConectada,
    isOnSupportedChain: walletIsOnSupportedChain,
    usdtSymbol: walletUsdtSymbol,
    usdtBalanceFormatted: walletUsdtBalance,
    openConnectModal,
    openAccountModal,
    disconnect: disconnectWallet,
  } = useWalletPanel();
  // HUD informativo: la primera vez que se conecte una wallet en esta sesión,
  // mostramos el "próximamente podrás depositar real" para no engañar al user.
  const walletInfoShownRef = useRef(false);
  const [appleHud, setAppleHud] = useState(
    /** @type {{ title: string, message?: string } | null} */ (null),
  );
  const [matchSheet, setMatchSheet] = useState({
    open: false,
    phase: /** @type {'searching' | 'queued' | 'paired'} */ ('searching'),
    stake: 10,
    commission: /** @type {number | null} */ (null),
  });
  const [rivalRemote, setRivalRemote] = useState(
    /** @type {null | { avatar: string, paisCode: string, nombre: string }} */ (null),
  );
  /** Fila `matches` más reciente vista por Realtime (INSERT/UPDATE). */
  const [liveMatchRow, setLiveMatchRow] = useState(
    /** @type {Record<string, unknown> | null} */ (null),
  );

  /** PnL acumulado de la sesión local (para badge social del chat en modo demo). */
  const [pnlSession, setPnlSession] = useState({ total_won: 0, total_lost: 0 });

  /** auth.uid() activo en el cliente Supabase tras bootstrap anónimo. */
  const [supaUserId, setSupaUserId] = useState(/** @type {string | null} */ (null));

  // -------------------- LEDGER AUTORITATIVO (Fase 2.B.2) --------------------
  // `useUserBalance` lee `public.transactions.balance_after` y se suscribe a
  // Realtime para nuevos asientos. Cuando `status === 'ready'` el balance del
  // servidor es la fuente de verdad y el `localSaldo` no se usa para nada.
  const ledger = useUserBalance(supaUserId);
  const useLedger = ledger.status === 'ready';
  const saldo = useLedger ? Number(ledger.balance ?? 0) : localSaldo;

  /**
   * Helper para mutar el saldo SOLO en el path legacy. Si el ledger está
   * activo, ignoramos la mutación: el servidor ya cobró/acreditó y Realtime
   * traerá el nuevo `balance_after` en milisegundos.
   * @param {(prev: number) => number} fn
   */
  const mutateLocalSaldo = useCallback(
    (fn) => {
      if (!useLedger) setLocalSaldo(fn);
    },
    [useLedger],
  );

  // -------------------- WALLET ↔ AUTH.UID LINK (Fase 2.C.1) ----------------
  // Cuando el user conecta su wallet, intentamos vincular su address con su
  // `auth.uid()` server-side (tabla `public.onchain_addresses`). Es idempotente.
  // Cuando llegue un evento `Deposited` on-chain, el listener busca por address
  // a quien acreditarle el saldo.
  useOnchainAddressLink({
    supaUserId,
    walletAddress,
    walletChainId,
    walletConnected: Boolean(walletConectada),
  });

  const unsubMatchesRef = useRef(/** @type {null | (() => void)} */ (null));
  const matchRowUnsubRef = useRef(/** @type {null | (() => void)} */ (null));
  const queueWatchdogRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  const postRoundTimerRef = useRef(/** @type {ReturnType<typeof setTimeout> | null} */ (null));
  // Guards de doble-click: bloquean re-entradas a operaciones que mueven dinero.
  const jugarBusyRef = useRef(false);
  const retiroBusyRef = useRef(false);
  // Limpiamos el guard de `jugar` cuando vuelve a 'idle' (por cualquier razón:
  // resolución, cancel, timeout, error). Así el siguiente click ya puede pasar.
  useEffect(() => {
    if (fase === 'idle') jugarBusyRef.current = false;
  }, [fase]);

  const clearPostRoundTimer = useCallback(() => {
    if (postRoundTimerRef.current != null) {
      clearTimeout(postRoundTimerRef.current);
      postRoundTimerRef.current = null;
    }
  }, []);

  const exitPostRoundToIdle = useCallback(() => {
    clearPostRoundTimer();
    setFase('idle');
    setResultado(null);
    setUltimaGanancia(null);
    setVerificationMeta(null);
    setRivalRemote(null);
    matchRowUnsubRef.current?.();
    matchRowUnsubRef.current = null;
    setLiveMatchRow(null);
  }, [clearPostRoundTimer]);

  const clearMatchmakingListeners = useCallback(() => {
    unsubMatchesRef.current?.();
    unsubMatchesRef.current = null;
    matchRowUnsubRef.current?.();
    matchRowUnsubRef.current = null;
    if (queueWatchdogRef.current != null) {
      clearTimeout(queueWatchdogRef.current);
      queueWatchdogRef.current = null;
    }
  }, []);

  useEffect(
    () => () => {
      unsubMatchesRef.current?.();
      unsubMatchesRef.current = null;
      matchRowUnsubRef.current?.();
      matchRowUnsubRef.current = null;
      if (queueWatchdogRef.current != null) {
        clearTimeout(queueWatchdogRef.current);
        queueWatchdogRef.current = null;
      }
    },
    [],
  );

  useEffect(() => {
    if (usuario) {
      try {
        localStorage.setItem(SESSION_KEY, JSON.stringify(usuario));
      } catch {
        /* ignore */
      }
    }
  }, [usuario]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.info('[chasflip] config', getRuntimeConfigSummary());
    if (isSupabaseMatchmakingEnabled() && !isSupabaseBrowserConfigured()) {
      console.warn('[chasflip] Supabase matching activado pero falta URL/anon — se usará modo local hasta configurar.');
    }
  }, []);

  /* ---------------- Bootstrap auth Supabase (anon) -----------------------
     Apenas carga la app, intenta recuperar/crear una sesión anónima para que
     `auth.uid()` esté disponible en chat, matching y badges. Subscribe a
     onAuthStateChange para mantener `supaUserId` sincronizado.                */
  useEffect(() => {
    if (!isSupabaseBrowserConfigured()) return;
    let alive = true;
    let unsub = /** @type {null | (() => void)} */ (null);

    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();

        const sub = supabase.auth.onAuthStateChange((_event, session) => {
          if (!alive) return;
          setSupaUserId(session?.user?.id || null);
        });
        unsub = () => sub.data.subscription.unsubscribe();

        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user) {
          if (alive) setSupaUserId(session.user.id);
          return;
        }

        const { data: signInData, error: signInErr } =
          await supabase.auth.signInAnonymously();
        if (signInErr) {
          if (import.meta.env.DEV) {
            console.warn('[chasflip] signInAnonymously falló:', signInErr);
          }
          return;
        }
        if (alive && signInData.session?.user) {
          setSupaUserId(signInData.session.user.id);
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.info('[chasflip] supabase bootstrap saltado:', e);
        }
      }
    })();

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  useEffect(() => {
    let armed = true;
    const onFirstGesture = () => {
      if (!armed) return;
      armed = false;
      prewarmAudio();
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
    window.addEventListener('pointerdown', onFirstGesture, { once: false });
    window.addEventListener('keydown', onFirstGesture, { once: false });
    window.addEventListener('touchstart', onFirstGesture, { once: false });
    return () => {
      window.removeEventListener('pointerdown', onFirstGesture);
      window.removeEventListener('keydown', onFirstGesture);
      window.removeEventListener('touchstart', onFirstGesture);
    };
  }, []);

  const handleEntrar = ({ email, avatar, paisCode }) => {
    const pais = findCountry(paisCode);
    const em = email.trim();
    setUsuario({
      email: em,
      avatar: normalizeStoredAvatar(avatar, em),
      paisCode,
      paisNombre: pais?.name || paisCode,
    });
    setLocalSaldo(0);
  };

  /** Demo local después de timeouts de UX (sin servidor). */
  const runLocalRound = useCallback((monto, commissionDecimal) => {
    const tickInterval = setInterval(() => playFlipTick({ volume: 0.13 }), 210);
    const stopTicks = () => clearInterval(tickInterval);

    window.setTimeout(() => {
      setFase('jugando');
      window.setTimeout(() => {
        stopTicks();
        const result = flipEngine.resolveRoundSync({
          stakeAmount: monto,
          commissionDecimal,
        });

        const {
          won,
          payout,
          matchId,
          roundId,
          source,
          vrfRequestTxHash,
          vrfFulfillmentTxHash,
        } = result;

        setVerificationMeta({
          matchId,
          roundId,
          source,
          vrfRequestTxHash: vrfRequestTxHash ?? null,
          vrfFulfillmentTxHash: vrfFulfillmentTxHash ?? null,
        });
        setResultado(won ? 'gano' : 'perdio');
        setFase('resultado');
        if (won && payout > 0) {
          mutateLocalSaldo((prev) => prev + payout);
          setUltimaGanancia(payout);
          playWinSound({ monto, volume: 0.9 });
          setPnlSession((p) => ({
            ...p,
            total_won: p.total_won + Math.max(payout - monto, 0),
          }));
        } else {
          setPnlSession((p) => ({ ...p, total_lost: p.total_lost + monto }));
        }

        clearPostRoundTimer();
        postRoundTimerRef.current = window.setTimeout(() => {
          postRoundTimerRef.current = null;
          exitPostRoundToIdle();
        }, 12_000);
      }, 3000);
    }, 1500);
  }, [clearPostRoundTimer, exitPostRoundToIdle]);

  const spinResolveAndSettlement = useCallback((stakeAmount, commissionDec, mid, oppBlob, stopTicksEarly) => {
    const opp = rivalFromOpponentBlob(oppBlob);

    stopTicksEarly();

    matchRowUnsubRef.current?.();
    matchRowUnsubRef.current = subscribeMatchRowUpdates(mid, (newRow) => {
      setLiveMatchRow({ ...newRow });
    });

    let tickSpin = window.setInterval(() => playFlipTick({ volume: 0.13 }), 210);

    setMatchSheet({
      open: true,
      phase: 'paired',
      stake: stakeAmount,
      commission: commissionDec,
    });

    const sheetTimer = window.setTimeout(() => {
      setMatchSheet({ open: false, phase: 'searching', stake: stakeAmount, commission: commissionDec });
    }, 980);

    setRivalRemote(opp || { avatar: DEFAULT_CHASFLIP_AVATAR_URL, paisCode: 'XX', nombre: '@rival' });
    setFase('jugando');

    void (async () => {
      try {
        await new Promise((r) => window.setTimeout(r, 3000));

        window.clearInterval(tickSpin);
        window.clearTimeout(sheetTimer);
        tickSpin = /** @type {any} */ (null);

        const outRaw = await resolveMatchRound(mid);

        const won = Boolean(outRaw.won);
        const payoutRaw = typeof outRaw.payout === 'number' ? outRaw.payout : Number(outRaw.payout);

        /** @type {string} */
        const cid =
          typeof outRaw.match_id === 'string' ? outRaw.match_id : String(outRaw.match_id ?? mid ?? '');

        setVerificationMeta({
          matchId: cid,
          roundId: `supabase-${cid}`,
          source: 'supabase',
          vrfRequestTxHash: null,
          vrfFulfillmentTxHash: null,
        });

        setResultado(won ? 'gano' : 'perdio');
        setFase('resultado');

        if (won && Number.isFinite(payoutRaw) && payoutRaw > 0) {
          mutateLocalSaldo((prev) => prev + payoutRaw);
          setUltimaGanancia(payoutRaw);
          playWinSound({ monto: stakeAmount, volume: 0.9 });
          setPnlSession((p) => ({
            ...p,
            total_won: p.total_won + Math.max(payoutRaw - stakeAmount, 0),
          }));
        } else {
          setPnlSession((p) => ({ ...p, total_lost: p.total_lost + stakeAmount }));
        }

        clearPostRoundTimer();
        postRoundTimerRef.current = window.setTimeout(() => {
          postRoundTimerRef.current = null;
          exitPostRoundToIdle();
        }, 12_000);
      } catch {
        window.clearInterval(tickSpin);

        window.clearTimeout(sheetTimer);
        // En modo ledger, la apuesta ya está cobrada en el servidor; el server
        // puede resolver el match igual y el `win` llegará via Realtime. NO
        // devolvemos saldo localmente. En modo legacy sí restituimos.
        mutateLocalSaldo((prev) => prev + stakeAmount);
        setAppleHud({
          title: 'Resolución no disponible',
          message:
            'No pudimos registrar el resultado con Supabase. Tu apuesta de demostración vuelve al saldo.',
        });

        setRivalRemote(null);
        matchRowUnsubRef.current?.();
        matchRowUnsubRef.current = null;
        setLiveMatchRow(null);
        setMatchSheet({ open: false, phase: 'searching', stake: stakeAmount, commission: null });
        setFase('idle');
      }
    })();
  }, [clearPostRoundTimer, exitPostRoundToIdle]);

  const jugarWithSupabase = useCallback(
    (monto, searchTicksStop) => {
      void (async () => {
        let userIdLocal = '';

        try {
          const ctx = await ensureSupabaseSessionAndProfile(usuario);
          userIdLocal = ctx.userId;
        } catch (rawErr) {
          searchTicksStop?.();
          // En modo ledger nada se cobró si auth falló (no llegamos al bet).
          // En modo legacy devolvemos lo que descontamos optimistamente.
          mutateLocalSaldo((prev) => prev + monto);

          clearMatchmakingListeners();
          setMatchSheet({ open: false, phase: 'searching', stake: monto, commission: null });
          setFase('idle');

          if (import.meta.env.DEV) {
            console.warn('[chasflip] auth/profile init falló:', rawErr);
          }

          try {
            getSupabaseBrowserClient();
          } catch {
            setAppleHud({
              title: t('hud.supabase_failed_title'),
              message: t('hud.supabase_failed_msg'),
            });

            return;
          }

          const e = /** @type {{ code?: string, message?: string }} */ (rawErr || {});
          if (e.code === 'profile_upsert_failed') {
            setAppleHud({
              title: t('hud.profile_failed_title'),
              message: `${t('hud.profile_failed_msg')} (${e.message || ''})`,
            });
          } else if (e.code === 'anon_disabled') {
            setAppleHud({
              title: t('hud.anon_disabled_title'),
              message: t('hud.anon_disabled_msg'),
            });
          } else {
            setAppleHud({
              title: t('hud.supabase_failed_title'),
              message: `${t('hud.supabase_failed_msg')} (${e.message || ''})`,
            });
          }
          return;
        }

        let joinParsed = /** @type {Record<string, unknown>} */ ({});

        try {
          // Idempotency_key del asiento `bet` que crea `matchmaking_join` en
          // ledger autoritativo. Si el cliente reintenta esta misma RPC tras
          // un fallo de red, el server reconoce la clave y no duplica.
          const betIdem = freshIdempotencyKey();
          /** @type {unknown} */
          const joinPayload = await joinMatchmaking(monto, { idempotencyKey: betIdem });
          joinParsed =
            typeof joinPayload === 'object' && joinPayload !== null ? /** @type {Record<string, unknown>} */ (
              joinPayload
            )
            : {};

          const commissionDec = Number(joinParsed.commission_decimal);
          if (!Number.isFinite(commissionDec)) {
            throw new Error('commission_invalid');
          }

          searchTicksStop?.();

          const matchedNow = Boolean(joinParsed.matched);
          /** @type {string | undefined} */
          let matchUid = typeof joinParsed.match_id === 'string' ? joinParsed.match_id : undefined;

          if (matchedNow && matchUid) {
            setMatchSheet({
              open: true,
              phase: 'paired',
              stake: monto,
              commission: commissionDec,
            });

            const stopEarly = searchTicksStop || (() => {});

            setLiveMatchRow({
              id: matchUid,
              stake_amount: monto,
              commission_decimal: commissionDec,
              status: 'in_progress',
            });

            spinResolveAndSettlement(monto, commissionDec, matchUid, joinParsed.opponent, stopEarly);

            return;
          }

          setMatchSheet({
            open: true,
            phase: 'queued',
            stake: monto,
            commission: commissionDec,
          });

          let paired = false;

          unsubMatchesRef.current = subscribeMatchInserts(userIdLocal, (row) => {
            if (paired) return;
            if (Math.trunc(Number(row.stake_amount)) !== monto) return;
            if (row.player_one_id !== userIdLocal && row.player_two_id !== userIdLocal) return;

            paired = true;
            unsubMatchesRef.current?.();
            unsubMatchesRef.current = null;
            if (queueWatchdogRef.current) {
              clearTimeout(queueWatchdogRef.current);
              queueWatchdogRef.current = null;
            }

            /** @type {string} */
            const insertedId = typeof row.id === 'string' ? row.id : String(row.id);
            matchUid = insertedId;

            setLiveMatchRow({ ...row });

            const metaOpp = pickOpponentFromMatchMeta(row, userIdLocal);

            spinResolveAndSettlement(monto, commissionDec, matchUid, metaOpp, searchTicksStop || (() => {}));
          });

          queueWatchdogRef.current = window.setTimeout(() => {
            if (paired) return;

            paired = true;
            unsubMatchesRef.current?.();
            unsubMatchesRef.current = null;
            queueWatchdogRef.current = null;

            void (async () => {
              searchTicksStop?.();

              try {
                await cancelQueuedMatchmaking();
              } catch {
                /* ignore */
              }

              clearMatchmakingListeners();
              // En modo ledger, `cancel_matchmaking` ya hizo refund server-side
              // (apartado D de la migración 20260512120000_ledger_cutover.sql);
              // Realtime traerá el balance actualizado. En legacy sí devolvemos.
              mutateLocalSaldo((prev) => prev + monto);
              setMatchSheet({
                open: false,
                phase: 'queued',
                stake: monto,
                commission: commissionDec,
              });
              setFase('idle');

              setAppleHud({
                title: 'Sin contrincante disponible por ahora',
                message:
                  'Abre otro navegador o pide que un rival entre con el mismo monto tras desplegar la base. La cola se liberó solo.',
              });
            })();
          }, 120_000);
        } catch (e) {
          searchTicksStop?.();
          clearMatchmakingListeners();

          // No filtramos detalles internos: traducimos el código a un mensaje
          // genérico vía i18n.  El mensaje crudo solo va a console.warn (DEV).
          if (import.meta.env.DEV) {
            console.warn('[chasflip] matchmaking_join error:', e);
          }
          const code = safeSupabaseErrorCode(e);

          // Si fue `insufficient_funds` en ledger, el server no debitó nada
          // (toda la RPC es transaccional). Si fue otro error pre-bet o legacy,
          // este `mutateLocalSaldo` actúa como restituidor en modo legacy y es
          // no-op en modo ledger.
          mutateLocalSaldo((prev) => prev + monto);
          setMatchSheet({
            open: false,
            phase: 'searching',
            stake: monto,
            commission:
              typeof joinParsed.commission_decimal === 'number' ? Number(joinParsed.commission_decimal) : null,
          });
          setFase('idle');

          setAppleHud({
            title: t('hud.err_title'),
            message: t(`hud.err.${code}`, t('hud.err.unknown')),
          });
        }
      })();
    },

    [
      usuario,
      clearMatchmakingListeners,
      spinResolveAndSettlement,
    ],
  );

  const jugar = (monto) => {
    // Defensa-en-profundidad: aunque los botones ya se deshabilitan cuando
    // `fase !== 'idle'`, este ref bloquea re-entradas en el mismo tick antes
    // de que React rerenderice.
    if (jugarBusyRef.current) return;
    jugarBusyRef.current = true;
    // Si caemos en una validación temprana, liberamos el guard inmediatamente.
    const release = () => { jugarBusyRef.current = false; };

    if (saldo < monto) {
      setAppleHud({
        title: t('hud.insufficient_title'),
        message: t('hud.insufficient_msg'),
      });
      release();
      return;
    }

    prewarmAudio();

    clearMatchmakingListeners();

    const comLocal = getLocalCommissionDecimal(monto);
    if (comLocal == null) {
      setAppleHud({
        title: t('hud.invalid_table_title'),
        message: t('hud.invalid_table_msg'),
      });
      release();
      return;
    }

    clearPostRoundTimer();

    // El guard se libera en el listener que pone `fase` de vuelta a 'idle'
    // (post-resolución, cancelación o timeout). Mientras tanto, otros clicks
    // están bloqueados también por `disabled={fase !== 'idle'}` en el botón.
    setFase('buscando');

    setResultado(null);

    setUltimaGanancia(null);
    setVerificationMeta(null);

    setRivalRemote(null);
    setLiveMatchRow(null);
    // En modo ledger NO descontamos local: el `bet` server-side ya lo hará
    // dentro de `matchmaking_join`. Realtime mostrará el balance actualizado.
    mutateLocalSaldo((prev) => prev - monto);

    if (SUPABASE_MATCH_READY && usuario) {
      const tickSearch = window.setInterval(() => playFlipTick({ volume: 0.13 }), 210);
      const stopSearchTicks = () => window.clearInterval(tickSearch);

      setMatchSheet({
        open: true,
        phase: 'searching',
        stake: monto,
        commission: null,
      });

      jugarWithSupabase(monto, stopSearchTicks);
      return;
    }

    setMatchSheet({ open: false, phase: 'searching', stake: monto, commission: null });
    runLocalRound(monto, comLocal);
  };

  const handleDepositar = (monto) => {
    if (retiroBusyRef.current) return;
    retiroBusyRef.current = true;
    prewarmAudio();
    playDepositSound();

    // Modo ledger: depositamos contra `public.transactions` con una idem nueva.
    if (useLedger) {
      void (async () => {
        try {
          await recordDepositDemo({
            amount: monto,
            idempotencyKey: freshIdempotencyKey(),
            meta: { from: 'modal_demo' },
          });
        } catch (err) {
          if (import.meta.env.DEV) console.warn('[chasflip] deposit ledger error', err);
          const code = safeSupabaseErrorCode(err);
          setAppleHud({
            title: t('hud.err_title'),
            message: t(`hud.err.${code}`, t('hud.err.unknown')),
          });
        } finally {
          retiroBusyRef.current = false;
        }
      })();
      return;
    }

    try {
      setLocalSaldo((prev) => prev + monto);
    } finally {
      retiroBusyRef.current = false;
    }
  };

  const handleRetirar = (monto) => {
    if (retiroBusyRef.current) return;
    retiroBusyRef.current = true;

    if (monto > saldo) {
      setAppleHud({
        title: t('hud.withdraw_too_much_title'),
        message: t('hud.withdraw_too_much_msg'),
      });
      retiroBusyRef.current = false;
      return;
    }

    if (useLedger) {
      void (async () => {
        try {
          await recordWithdrawDemo({
            amount: monto,
            idempotencyKey: freshIdempotencyKey(),
            meta: { from: 'modal_demo' },
          });
          setAppleHud({
            title: t('hud.withdraw_done_title'),
            message: t('hud.withdraw_done_msg', {
              amount: monto.toLocaleString(numLocale, { maximumFractionDigits: 2 }),
            }),
          });
        } catch (err) {
          if (import.meta.env.DEV) console.warn('[chasflip] withdraw ledger error', err);
          const code = safeSupabaseErrorCode(err);
          setAppleHud({
            title: t('hud.err_title'),
            message: t(`hud.err.${code}`, t('hud.err.unknown')),
          });
        } finally {
          retiroBusyRef.current = false;
        }
      })();
      return;
    }

    try {
      setLocalSaldo((prev) => prev - monto);
      setAppleHud({
        title: t('hud.withdraw_done_title'),
        message: t('hud.withdraw_done_msg', {
          amount: monto.toLocaleString(numLocale, { maximumFractionDigits: 2 }),
        }),
      });
    } finally {
      retiroBusyRef.current = false;
    }
  };

  // CTA de "Conectar wallet". FASE 2.A — usa wagmi + RainbowKit:
  //  - Si no hay wallet conectada: abre el modal de selección (MetaMask /
  //    Coinbase / Rabby / WalletConnect).
  //  - Si ya hay una: abre el panel de cuenta (cambiar / desconectar / ver
  //    address). Como fallback (RainbowKit todavía no listo) desconecta.
  // El saldo del juego sigue siendo DEMO local; este botón solo conecta la
  // wallet "para verificar identidad on-chain". Dinero real llega en 2.C.
  const handleConnectWallet = () => {
    if (walletConectada) {
      if (typeof openAccountModal === 'function') {
        openAccountModal();
      } else {
        try {
          disconnectWallet();
        } catch {
          /* ignore */
        }
      }
      return;
    }
    if (typeof openConnectModal === 'function') {
      openConnectModal();
    }
  };

  // Avisar UNA vez por sesión cuando se conecte una wallet real, para que el
  // user entienda que aún no se mueve dinero real.
  useEffect(() => {
    if (walletConectada && !walletInfoShownRef.current) {
      walletInfoShownRef.current = true;
      setAppleHud({
        title: t('hud.wallet_connected_title'),
        message: t('hud.wallet_connected_msg'),
      });
    }
    if (!walletConectada) {
      walletInfoShownRef.current = false;
    }
  }, [walletConectada, t]);

  const handleCancelQueuedMatch = () => {
    void (async () => {
      try {
        await cancelQueuedMatchmaking();
      } catch {
        /* ignore */
      }

      clearMatchmakingListeners();
      // En modo ledger el refund lo hizo `cancel_matchmaking` server-side.
      // En modo legacy restauramos el descuento local.
      mutateLocalSaldo((prev) => prev + matchSheet.stake);
      setMatchSheet((s) => ({ ...s, open: false }));
      setFase('idle');
      setAppleHud({
        title: t('hud.queue_canceled_title'),
        message: t('hud.queue_canceled_msg', {
          stake: matchSheet.stake.toLocaleString(numLocale),
        }),
      });
    })();
  };

  if (!usuario) return <Login onEntrar={handleEntrar} />;

  return (
    <div className="app-container">
      <AppleHudAlert
        open={Boolean(appleHud)}
        title={appleHud?.title || ''}
        message={appleHud?.message || ''}

        onDismiss={() => setAppleHud(null)}
      />

      <MatchmakingSheet

        open={matchSheet.open}
        phase={
          /** @type {'searching' | 'queued' | 'paired'} */ (
            matchSheet.phase === 'searching'
              ? 'searching'
              : matchSheet.phase === 'paired'
                ? 'paired'

                : 'queued'
          )
        }
        stakeAmount={matchSheet.stake}

        serverCommissionDecimal={matchSheet.commission ?? undefined}
        onCancelQueue={
          SUPABASE_MATCH_READY && matchSheet.phase === 'queued'

            ? handleCancelQueuedMatch
            : () => {}
        }
      />

      {modal && (
        <Modal tipo={modal} onCerrar={() => setModal(null)} onConfirmar={modal === 'depositar' ? handleDepositar : handleRetirar} />
      )}

      <Sidebar usuario={usuario} />

      <main className="main-content">
        <Header
          usuario={usuario}
          saldo={saldo}
          walletConectada={walletConectada}
          walletAddress={walletAddress}
          walletUsdtBalance={walletUsdtBalance}
          walletUsdtSymbol={walletUsdtSymbol}
          walletIsOnSupportedChain={walletIsOnSupportedChain}
          onConectarWallet={handleConnectWallet}
          onDepositar={() => setModal('depositar')}
          onRetirar={() => setModal('retirar')}
        />
        <div className="main-body">
          <div className="content-shell">
            <div className={`game-area ${resultado === 'gano' ? 'is-winning' : ''} ${resultado === 'perdio' ? 'is-losing' : ''}`}>
              <Arena
                fase={fase}
                jugar={jugar}
                usuario={usuario}
                saldo={saldo}
                resultado={resultado}
                ultimaGanancia={ultimaGanancia}
                roundVerification={verificationMeta}
                protocolTreasuryAddress={protocolTreasuryAddress}
                useServerMatchmaking={SUPABASE_MATCH_READY}
                rivalRemote={rivalRemote}
                liveMatchRow={SUPABASE_MATCH_READY ? liveMatchRow : null}
                onSeguirJugando={exitPostRoundToIdle}
                onConectarWallet={handleConnectWallet}
                onAbrirDeposito={() => setModal('depositar')}
              />
            </div>

            <section className="live-chat-card">
              <ErrorBoundary>
                <LiveChatArena
                  usuario={usuario}
                  saldo={saldo}
                  myStats={pnlSession}
                  supaUserId={supaUserId}
                />
              </ErrorBoundary>
            </section>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;
