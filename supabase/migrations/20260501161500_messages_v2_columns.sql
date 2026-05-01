-- Live Chat Arena · v2 column set: { id, created_at, user_id, user_name, text, badge_earnings }
-- Idempotente: si ya existe la versión anterior (email/body), la renombra.
-- Mantiene avatar / pais_code como columnas opcionales para los visuales del chat.

-- ---------------------------------------------------------------------------
-- 1) Asegura que la tabla exista con el set canónico solicitado.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users (id) ON DELETE CASCADE,
  user_name text NOT NULL DEFAULT '',
  text text NOT NULL DEFAULT '',
  badge_earnings numeric(24, 10) NOT NULL DEFAULT 0,
  avatar text NOT NULL DEFAULT '',
  pais_code text NOT NULL DEFAULT 'XX',
  created_at timestamptz NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- 2) Migración suave de columnas previas: email → user_name, body → text.
-- ---------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'email'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'user_name'
  ) THEN
    EXECUTE 'ALTER TABLE public.messages RENAME COLUMN email TO user_name';
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'body'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'messages' AND column_name = 'text'
  ) THEN
    EXECUTE 'ALTER TABLE public.messages RENAME COLUMN body TO text';
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 3) Asegurar columnas nuevas en cualquier escenario (instalación previa).
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages
  ADD COLUMN IF NOT EXISTS user_name text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS text text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS badge_earnings numeric(24, 10) NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS avatar text NOT NULL DEFAULT '',
  ADD COLUMN IF NOT EXISTS pais_code text NOT NULL DEFAULT 'XX';

-- ---------------------------------------------------------------------------
-- 4) Constraint de longitud sobre la columna `text`.
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_body_len;
ALTER TABLE public.messages DROP CONSTRAINT IF EXISTS messages_text_len;
ALTER TABLE public.messages
  ADD CONSTRAINT messages_text_len
  CHECK (char_length(btrim(text)) BETWEEN 1 AND 240);

CREATE INDEX IF NOT EXISTS messages_created_at_idx
  ON public.messages (created_at DESC);

-- ---------------------------------------------------------------------------
-- 5) RLS — lectura para todo authenticated, escritura solo del propio user.
-- ---------------------------------------------------------------------------
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "messages_select_authenticated" ON public.messages;
CREATE POLICY "messages_select_authenticated"
  ON public.messages
  FOR SELECT
  TO authenticated
  USING (true);

DROP POLICY IF EXISTS "messages_insert_own" ON public.messages;
CREATE POLICY "messages_insert_own"
  ON public.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND char_length(btrim(text)) BETWEEN 1 AND 240
  );

-- ---------------------------------------------------------------------------
-- 6) Realtime publication.
-- ---------------------------------------------------------------------------
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
