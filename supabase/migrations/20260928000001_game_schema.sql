-- =============================================================================
-- Uma Palavra, Uma Música — esquema do modo online
--
-- Princípios:
--   * O backend é a fonte oficial do estado da partida.
--   * Clientes só LEEM tabelas (via RLS) e ALTERAM estado através de funções
--     RPC (security definer) que validam jogador, sala, rodada e ordem.
--   * Cada palavra exibida é uma linha em `rounds`. Ela só vira "rodada
--     contabilizada" (round_number preenchido) quando recebe o primeiro
--     palpite efetivamente verificado.
-- =============================================================================

create schema if not exists app_private;
revoke all on schema app_private from public;

-- Chave de comparação de palavras: ignora caixa, espaços nas pontas e acentos
-- ("Coração" = "coracao"). Usada para garantir que nenhuma palavra se repita.
create or replace function app_private.word_key(p_word text)
returns text
language sql
immutable
parallel safe
set search_path = ''
as $$
  select translate(
    lower(btrim(p_word)),
    'áàâãäåéèêëíìîïóòôõöúùûüçñ',
    'aaaaaaeeeeiiiiooooouuuucn'
  );
$$;

-- -----------------------------------------------------------------------------
-- Tipos
-- -----------------------------------------------------------------------------

-- Máquina de estados da sala (ver docs/ARQUITETURA.md):
--   waiting → starting → playing ⇄ verifying
--   verifying → correct → countdown → playing
--   verifying → incorrect → decision → playing (mesma palavra ou nova)
--   playing → decision (pedido de "Pular palavra")
--   qualquer estado → finished (pódio)
create type public.room_status as enum (
  'waiting',
  'starting',
  'playing',
  'verifying',
  'correct',
  'countdown',
  'incorrect',
  'decision',
  'finished'
);

create type public.word_status as enum ('active', 'won', 'discarded');

create type public.guess_status as enum ('verifying', 'correct', 'incorrect', 'error');

create type public.vote_choice as enum ('new_guess', 'new_word');

create type public.decision_origin as enum ('incorrect_guess', 'skip_request');

create type public.end_reason as enum (
  'rounds_completed',
  'majority_finish',
  'host_ended',
  'words_exhausted',
  'abandoned'
);

create type public.player_exit as enum ('left', 'timeout', 'kicked');

-- -----------------------------------------------------------------------------
-- Banco de palavras (editável pelo painel do Supabase)
-- -----------------------------------------------------------------------------
create table public.words (
  id bigint generated always as identity primary key,
  word text not null check (char_length(btrim(word)) between 1 and 40),
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create unique index words_word_key on public.words (app_private.word_key(word));

comment on table public.words is
  'Banco de palavras do modo online. Adicione/desative palavras livremente; a lógica do jogo não precisa mudar.';

-- -----------------------------------------------------------------------------
-- Salas
-- -----------------------------------------------------------------------------
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  code text not null unique check (code ~ '^[A-Z0-9]{6}$'),
  host_player_id uuid,
  status public.room_status not null default 'waiting',
  -- Prazo da fase atual (starting, verifying, correct, countdown, incorrect, decision).
  phase_ends_at timestamptz,
  configured_rounds integer not null check (configured_rounds between 1 and 9999),
  -- Rodadas contabilizadas até agora (equivale ao "current_round" da especificação).
  rounds_played integer not null default 0 check (rounds_played >= 0),
  current_word_id uuid,
  active_guess_id uuid,
  decision_origin public.decision_origin,
  -- Incrementa a cada janela de decisão, para separar as votações.
  decision_number integer not null default 0,
  -- Valor de configured_rounds para o qual o host respondeu "NÃO" ao aviso de última rodada.
  final_prompt_answered_for integer,
  end_reason public.end_reason,
  -- Incrementa a cada mudança de estado; os clientes recarregam quando muda.
  state_version bigint not null default 0,
  created_by uuid not null,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  ended_at timestamptz,
  updated_at timestamptz not null default now()
);

-- -----------------------------------------------------------------------------
-- Jogadores
-- -----------------------------------------------------------------------------
create table public.players (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- Usuário autenticado (login anônimo do Supabase). Garante que a reconexão
  -- recupere o mesmo jogador, sem duplicar e sem perder pontos.
  user_id uuid not null,
  name text not null check (char_length(btrim(name)) between 1 and 24),
  score integer not null default 0 check (score >= 0),
  -- Ordem de entrada: define a transferência de host.
  join_order integer not null,
  is_active boolean not null default true,
  last_seen_at timestamptz not null default now(),
  joined_at timestamptz not null default now(),
  left_at timestamptz,
  left_reason public.player_exit,
  unique (room_id, user_id),
  unique (room_id, join_order)
);

create index players_room_idx on public.players (room_id);
create index players_user_idx on public.players (user_id);

alter table public.rooms
  add constraint rooms_host_fk foreign key (host_player_id) references public.players (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Palavras exibidas na partida (uma linha por palavra sorteada)
-- -----------------------------------------------------------------------------
create table public.rounds (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  -- Ordem em que a palavra apareceu (conta também palavras puladas sem tentativa).
  sequence integer not null,
  -- Número da rodada contabilizada. NULL enquanto nenhum palpite foi verificado.
  round_number integer,
  word text not null,
  status public.word_status not null default 'active',
  has_attempt boolean not null default false,
  winner_player_id uuid references public.players (id) on delete set null,
  winning_guess_id uuid,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  unique (room_id, sequence),
  -- Uma mesma rodada nunca é contabilizada duas vezes.
  unique (room_id, round_number),
  check ((round_number is null) = (not has_attempt))
);

create index rounds_room_idx on public.rounds (room_id);

alter table public.rooms
  add constraint rooms_current_word_fk foreign key (current_word_id) references public.rounds (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Palpites
-- -----------------------------------------------------------------------------
create table public.guesses (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  text text not null check (char_length(btrim(text)) between 1 and 200),
  submitted_at timestamptz not null default clock_timestamp(),
  status public.guess_status not null default 'verifying',
  verified_at timestamptz,
  result_song text,
  result_artist text,
  matched_excerpt text,
  matched_word text,
  confidence numeric(4, 3),
  -- no_match | word_not_in_song | ambiguous | provider_unavailable | timeout | cancelled
  failure_reason text,
  provider text,
  provider_track_id text
);

create index guesses_round_idx on public.guesses (round_id);
create index guesses_room_idx on public.guesses (room_id, submitted_at desc);
-- Garantias no próprio banco: um único palpite em verificação por sala
-- e um único palpite correto por palavra.
create unique index guesses_one_verifying_per_room on public.guesses (room_id) where status = 'verifying';
create unique index guesses_one_correct_per_round on public.guesses (round_id) where status = 'correct';

alter table public.rooms
  add constraint rooms_active_guess_fk foreign key (active_guess_id) references public.guesses (id) on delete set null;
alter table public.rounds
  add constraint rounds_winning_guess_fk foreign key (winning_guess_id) references public.guesses (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Votos "Novo palpite" × "Nova palavra"
-- -----------------------------------------------------------------------------
create table public.round_votes (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  round_id uuid not null references public.rounds (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  decision_number integer not null,
  choice public.vote_choice not null,
  created_at timestamptz not null default now(),
  unique (round_id, decision_number, player_id)
);

create index round_votes_room_idx on public.round_votes (room_id);

-- -----------------------------------------------------------------------------
-- Pedidos coletivos de finalização
-- -----------------------------------------------------------------------------
create table public.finish_requests (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  player_id uuid not null references public.players (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (room_id, player_id)
);

-- -----------------------------------------------------------------------------
-- Palavras já usadas em cada partida (nunca se repetem)
-- -----------------------------------------------------------------------------
create table public.used_words (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms (id) on delete cascade,
  word text not null,
  used_at timestamptz not null default now()
);

create unique index used_words_room_word_key on public.used_words (room_id, app_private.word_key(word));

-- -----------------------------------------------------------------------------
-- Segurança: RLS (leitura só para membros da sala; escrita só via RPC)
-- -----------------------------------------------------------------------------
create or replace function app_private.is_room_member(p_room_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.players p
    where p.room_id = p_room_id
      and p.user_id = (select auth.uid())
      and p.left_reason is distinct from 'kicked'
  );
$$;

grant usage on schema app_private to authenticated;
revoke all on function app_private.is_room_member(uuid) from public;
grant execute on function app_private.is_room_member(uuid) to authenticated;

alter table public.words enable row level security;
alter table public.rooms enable row level security;
alter table public.players enable row level security;
alter table public.rounds enable row level security;
alter table public.guesses enable row level security;
alter table public.round_votes enable row level security;
alter table public.finish_requests enable row level security;
alter table public.used_words enable row level security;

create policy "membros leem a sala" on public.rooms
  for select to authenticated using (app_private.is_room_member(id));
create policy "membros leem os jogadores" on public.players
  for select to authenticated using (app_private.is_room_member(room_id));
create policy "membros leem as palavras da partida" on public.rounds
  for select to authenticated using (app_private.is_room_member(room_id));
create policy "membros leem os palpites" on public.guesses
  for select to authenticated using (app_private.is_room_member(room_id));
create policy "membros leem os votos" on public.round_votes
  for select to authenticated using (app_private.is_room_member(room_id));
create policy "membros leem pedidos de finalização" on public.finish_requests
  for select to authenticated using (app_private.is_room_member(room_id));
create policy "membros leem palavras usadas" on public.used_words
  for select to authenticated using (app_private.is_room_member(room_id));
-- `words` não tem política de leitura: o sorteio acontece somente no servidor.

-- Nenhuma política de INSERT/UPDATE/DELETE: toda escrita passa pelas funções RPC.
revoke insert, update, delete on all tables in schema public from anon, authenticated;

-- -----------------------------------------------------------------------------
-- Realtime: cada mudança de estado incrementa rooms.state_version,
-- então basta assinar a linha da sala para saber quando recarregar.
-- -----------------------------------------------------------------------------
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime add table public.rooms;
    alter publication supabase_realtime add table public.players;
  end if;
end;
$$;
