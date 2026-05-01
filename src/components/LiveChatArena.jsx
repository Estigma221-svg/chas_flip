import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import './LiveChatArena.css';
import AvatarFace from './AvatarFace';
import {
  CHASFLIP_AVATAR_URLS,
  normalizeStoredAvatar,
} from '../data/chasflipAvatars.js';
import { isSupabaseBrowserConfigured } from '../config/supabaseEnv.js';
import { getSupabaseBrowserClient } from '../lib/supabaseClient.js';

const MAX_LEN = 240;
const FETCH_LIMIT = 50;
const MAX_RENDER = 80;

/**
 * Mensaje del chat en vivo (contrato Supabase).
 *
 * @typedef {object} ChatMessage
 * @property {string}  id
 * @property {string}  user_id
 * @property {string}  user_name
 * @property {string}  text
 * @property {number}  badge_earnings
 * @property {string=} avatar
 * @property {string=} pais_code
 * @property {string}  created_at
 */

const SEED_MESSAGES = /** @type {ChatMessage[]} */ ([
  {
    id: 'seed-1',
    user_id: 'seed-cryptoking',
    user_name: '@CryptoKing',
    avatar: CHASFLIP_AVATAR_URLS[0],
    pais_code: 'US',
    text: '¡Acabo de ganar 100 dólares en la mesa de $10! Esto está prendido.',
    badge_earnings: 1130,
    created_at: new Date(Date.now() - 5 * 60_000).toISOString(),
  },
  {
    id: 'seed-2',
    user_id: 'seed-tokyoflip',
    user_name: '@TokyoFlip',
    avatar: CHASFLIP_AVATAR_URLS[2],
    pais_code: 'JP',
    text: 'Esa moneda está bendecida 🪙 racha de tres seguidas',
    badge_earnings: 460,
    created_at: new Date(Date.now() - 4 * 60_000).toISOString(),
  },
  {
    id: 'seed-3',
    user_id: 'seed-madridbull',
    user_name: '@MadridBull',
    avatar: CHASFLIP_AVATAR_URLS[3],
    pais_code: 'ES',
    text: 'Subí a la mesa de $1,000, quien se anima',
    badge_earnings: -380,
    created_at: new Date(Date.now() - 2 * 60_000).toISOString(),
  },
  {
    id: 'seed-4',
    user_id: 'seed-riogold',
    user_name: '@RioGold',
    avatar: CHASFLIP_AVATAR_URLS[4],
    pais_code: 'BR',
    text: 'Acabo de retirar a la wallet, salida limpia',
    badge_earnings: 2000,
    created_at: new Date(Date.now() - 60_000).toISOString(),
  },
  {
    id: 'seed-5',
    user_id: 'seed-londonwolf',
    user_name: '@LondonWolf',
    avatar: CHASFLIP_AVATAR_URLS[1],
    pais_code: 'GB',
    text: 'Comisión del 5% en mesa $10 me parece justa, vamos otra',
    badge_earnings: 50,
    created_at: new Date(Date.now() - 25_000).toISOString(),
  },
]);

/** @param {number} net */
function formatPnl(net) {
  const sign = net >= 0 ? '+' : '−';
  const abs = Math.abs(net);
  const fmt = abs >= 100
    ? abs.toLocaleString('es-MX', { maximumFractionDigits: 0 })
    : abs.toLocaleString('es-MX', { maximumFractionDigits: 2 });
  return `${sign}$${fmt}`;
}

/** @param {string} iso */
function timeLabel(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.valueOf())) return '';
  return d.toLocaleTimeString('es-MX', { hour: '2-digit', minute: '2-digit' });
}

/** @param {string} name */
function shortName(name) {
  if (!name) return '@anon';
  if (name.startsWith('@')) return name.slice(0, 24);
  return `@${name.split('@')[0] || name}`.slice(0, 24);
}

/** @param {{ total_won: number, total_lost: number } | undefined} stats */
function netFromStats(stats) {
  if (!stats) return null;
  return (Number(stats.total_won) || 0) - (Number(stats.total_lost) || 0);
}

export default function LiveChatArena({ usuario, saldo, myStats, supaUserId }) {
  /** @type {[ChatMessage[], React.Dispatch<React.SetStateAction<ChatMessage[]>>]} */
  const [messages, setMessages] = useState(SEED_MESSAGES);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const [meId, setMeId] = useState(/** @type {string | null} */ (null));

  /** Mapa user_id → { total_won, total_lost } sincronizado por realtime. */
  const [pnlByUser, setPnlByUser] = useState(
    /** @type {Record<string, { total_won: number, total_lost: number }>} */ ({}),
  );

  const listRef = useRef(/** @type {HTMLDivElement | null} */ (null));
  const supaConfigured = isSupabaseBrowserConfigured();

  // Si App.jsx ya hizo bootstrap anónimo, usamos ese uid sin esperar getSession.
  useEffect(() => {
    if (supaUserId) setMeId(supaUserId);
  }, [supaUserId]);

  const canWrite = Number(saldo) > 0;

  /** Mantén el badge propio en sincronía con la sesión en curso (modo demo). */
  useEffect(() => {
    if (!myStats || !usuario?.email) return;
    const myKey = meId || usuario.email;
    setPnlByUser((prev) => ({
      ...prev,
      [myKey]: {
        total_won: Number(myStats.total_won) || 0,
        total_lost: Number(myStats.total_lost) || 0,
      },
    }));
  }, [myStats, meId, usuario?.email]);

  /* --------------------- Auto scroll a lo más reciente --------------------- */
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages]);

  /* ------------- Fetch inicial: últimos 50 ordenados por fecha ------------- */
  useEffect(() => {
    if (!supaConfigured) return;
    let cancelled = false;

    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const sessionRes = await supabase.auth.getSession();
        const myId = sessionRes.data.session?.user?.id || null;
        if (!cancelled) setMeId(myId);

        const { data, error: selErr } = await supabase
          .from('messages')
          .select(
            'id, user_id, user_name, text, badge_earnings, avatar, pais_code, created_at',
          )
          .order('created_at', { ascending: false })
          .limit(FETCH_LIMIT);

        if (cancelled) return;
        if (selErr) {
          if (import.meta.env.DEV) {
            console.info('[chasflip:chat] select messages error:', selErr.message);
          }
          return;
        }
        if (Array.isArray(data) && data.length > 0) {
          setMessages(/** @type {ChatMessage[]} */ ([...data].reverse()));
        }
      } catch (e) {
        if (import.meta.env.DEV) {
          console.info('[chasflip:chat] init falló (modo demo):', e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [supaConfigured]);

  /* ----------------- Suscripción realtime INSERT (chat) -------------------- */
  useEffect(() => {
    if (!supaConfigured) return;

    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      return;
    }

    const ch = supabase
      .channel('public:messages')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        (payload) => {
          const row = /** @type {ChatMessage} */ (payload.new);
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            const next = [
              ...prev.filter((m) => !m.id.startsWith('seed-')),
              row,
            ];
            return next.length > MAX_RENDER
              ? next.slice(next.length - MAX_RENDER)
              : next;
          });
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supaConfigured]);

  /* --------------------- Stats por usuario (badge PnL) --------------------- */
  // Carga inicial de stats para los user_id que ya están en pantalla.
  useEffect(() => {
    if (!supaConfigured) return;
    const knownIds = Array.from(
      new Set(
        messages
          .map((m) => m.user_id)
          .filter((id) => typeof id === 'string' && !id.startsWith('seed-')),
      ),
    );
    if (knownIds.length === 0) return;

    let cancelled = false;
    void (async () => {
      try {
        const supabase = getSupabaseBrowserClient();
        const { data, error: selErr } = await supabase
          .from('user_stats')
          .select('user_id, total_won, total_lost')
          .in('user_id', knownIds);

        if (cancelled || selErr || !Array.isArray(data)) return;
        setPnlByUser((prev) => {
          const next = { ...prev };
          for (const r of data) {
            next[r.user_id] = {
              total_won: Number(r.total_won) || 0,
              total_lost: Number(r.total_lost) || 0,
            };
          }
          return next;
        });
      } catch (e) {
        if (import.meta.env.DEV) {
          console.info('[chasflip:chat] user_stats fetch falló:', e);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [messages, supaConfigured]);

  // Realtime: actualiza el badge cuando el servidor recalcula PnL al cerrar
  // una partida (trigger sobre `matches`).
  useEffect(() => {
    if (!supaConfigured) return;
    let supabase;
    try {
      supabase = getSupabaseBrowserClient();
    } catch {
      return;
    }

    const handleRow = (row) => {
      const id = row && /** @type {{ user_id?: string }} */ (row).user_id;
      if (!id) return;
      setPnlByUser((prev) => ({
        ...prev,
        [id]: {
          total_won: Number(row.total_won) || 0,
          total_lost: Number(row.total_lost) || 0,
        },
      }));
    };

    const ch = supabase
      .channel('public:user_stats')
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'user_stats' },
        (payload) => handleRow(payload.new),
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'user_stats' },
        (payload) => handleRow(payload.new),
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(ch);
    };
  }, [supaConfigured]);

  /* ------------------------------ Envío ------------------------------------ */
  const sendMessage = useCallback(
    /** @param {string} textRaw */
    async (textRaw) => {
      const text = textRaw.trim();
      if (!text || text.length > MAX_LEN) return;

      // ⚠️ Reglas de negocio: gating por saldo > 0.
      // TODO[backend]: validar también server-side antes de producción
      //   (RLS: `player_can_write(auth.uid())`).
      if (!canWrite) {
        setError('Necesitas saldo > 0 para escribir en el chat.');
        return;
      }
      setError('');

      const myKey = meId || usuario?.email || 'me';
      const myNet = netFromStats(pnlByUser[myKey]) ?? 0;

      // Si no hay Supabase, lo agregamos local con id sintético.
      const optimistic = /** @type {ChatMessage} */ ({
        id: `local-${Date.now()}`,
        user_id: myKey,
        user_name: shortName(usuario?.email || '@yo'),
        avatar: normalizeStoredAvatar(usuario?.avatar, usuario?.email),
        pais_code: usuario?.paisCode || 'XX',
        text,
        badge_earnings: myNet,
        created_at: new Date().toISOString(),
      });

      setSending(true);
      try {
        if (!supaConfigured) {
          setMessages((prev) => [...prev, optimistic]);
          return;
        }

        const supabase = getSupabaseBrowserClient();
        const sessionRes = await supabase.auth.getSession();
        const uid = sessionRes.data.session?.user?.id;
        if (!uid) {
          setError('Inicia sesión con Supabase para enviar mensajes.');
          return;
        }

        const { error: insErr } = await supabase.from('messages').insert({
          user_id: uid,
          user_name: shortName(usuario?.email || ''),
          text,
          badge_earnings: myNet,
          avatar: optimistic.avatar,
          pais_code: optimistic.pais_code,
        });

        if (insErr) {
          setError(insErr.message || 'No pudimos enviar el mensaje.');
          return;
        }
        // Realtime se encargará de añadirlo a la lista.
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Error inesperado al enviar.');
      } finally {
        setSending(false);
      }
    },
    [canWrite, meId, pnlByUser, supaConfigured, usuario],
  );

  const handleSubmit = (e) => {
    e.preventDefault();
    if (sending) return;
    void sendMessage(draft);
    setDraft('');
  };

  const renderable = useMemo(
    () => messages.slice(-MAX_RENDER),
    [messages],
  );

  return (
    <section className="live-chat" aria-label="Chat en vivo de la arena">
      <header className="live-chat__header">
        <div className="live-chat__title">
          <span className="live-chat__title-pulse" aria-hidden />
          Live chat · arena
        </div>
        <div className="live-chat__count">{renderable.length} mensajes</div>
      </header>

      <div ref={listRef} className="live-chat__list" role="log" aria-live="polite">
        {renderable.map((m) => {
          const isMine = meId
            ? m.user_id === meId
            : usuario && m.user_name === shortName(usuario.email);
          const live = pnlByUser[m.user_id];
          const liveNet = netFromStats(live);
          const net = liveNet != null ? liveNet : Number(m.badge_earnings) || 0;
          const badgeClass =
            net >= 0
              ? 'live-chat__badge live-chat__badge--up'
              : 'live-chat__badge live-chat__badge--down';

          return (
            <article
              key={m.id}
              className={`live-chat__msg${isMine ? ' live-chat__msg--mine' : ''}`}
            >
              <span className="live-chat__avatar">
                <AvatarFace value={m.avatar} variant="row" />
              </span>
              <div className="live-chat__body">
                <div className="live-chat__row">
                  <span className="live-chat__name">{shortName(m.user_name)}</span>
                  <span
                    className={badgeClass}
                    title={
                      live
                        ? `Ganado $${live.total_won.toLocaleString('es-MX')} · Perdido $${live.total_lost.toLocaleString('es-MX')}`
                        : 'PnL al momento del mensaje'
                    }
                  >
                    {formatPnl(net)}
                  </span>
                  <span className="live-chat__time">{timeLabel(m.created_at)}</span>
                </div>
                <p className="live-chat__text">{m.text}</p>
              </div>
            </article>
          );
        })}
      </div>

      <footer className="live-chat__footer">
        <form className="live-chat__form" onSubmit={handleSubmit}>
          <input
            className="live-chat__input"
            type="text"
            value={draft}
            maxLength={MAX_LEN}
            onChange={(e) => setDraft(e.target.value)}
            placeholder={
              canWrite
                ? 'Escribe un mensaje en la arena…'
                : 'Necesitas saldo > 0 para escribir'
            }
            disabled={!canWrite || sending}
          />
          <button
            type="submit"
            className="live-chat__send"
            disabled={!canWrite || sending || draft.trim().length === 0}
          >
            {sending ? 'Enviando' : 'Enviar'}
          </button>
        </form>
        <p className="live-chat__hint" role="status">
          {error
            ? error
            : supaConfigured
              ? 'Mensajes en tiempo real · canal public:messages'
              : 'Modo demo · conecta Supabase para ver mensajes reales'}
        </p>
      </footer>
    </section>
  );
}
