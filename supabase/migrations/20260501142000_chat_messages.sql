-- Live Chat Arena: tabla pública leíble por authenticated, escritura del propio user.
-- Realtime: canal `public:messages` por postgres_changes (INSERT).

CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  email text NOT NULL DEFAULT '',
  avatar text NOT NULL DEFAULT '',
  pais_code text NOT NULL DEFAULT 'XX',
  body text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT messages_body_len CHECK (char_length(btrim(body)) BETWEEN 1 AND 240)
);

CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at DESC);

ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

-- Lectura para cualquier usuario autenticado (chat público de la arena).
DROP POLICY IF EXISTS "messages_select_authenticated" ON public.messages;
CREATE POLICY "messages_select_authenticated"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (true);

-- Inserción solo del propio user.
-- ⚠️ Reglas de negocio: gating por saldo > 0 (ChasFlip).
--   La RLS NO conoce el saldo del jugador todavía. Cuando se modele el saldo
--   server-side (tabla balances o RPC `player_can_write(uid)`), agregar:
--     AND public.player_can_write(auth.uid())
DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND char_length(btrim(body)) BETWEEN 1 AND 240
  );

-- Realtime: publicar tabla en el publication usado por supabase_realtime.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'messages'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.messages';
  END IF;
END
$$;
