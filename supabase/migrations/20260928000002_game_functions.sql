-- =============================================================================
-- Uma Palavra, Uma Música — regras do jogo no servidor
--
-- Todas as decisões oficiais acontecem aqui (nunca no aparelho):
--   quem enviou primeiro, quem acertou, qual palavra foi sorteada, quem ganhou
--   ponto, quem é host, se a maioria foi atingida e quando a partida terminou.
--
-- Concorrência: toda função que altera a sala faz `select ... for update` na
-- linha de `rooms`. Assim, dois palpites simultâneos são processados em fila:
-- o primeiro muda o estado para `verifying` e o segundo é descartado.
--
-- Prazos: cada fase temporizada grava `phase_ends_at`. Qualquer cliente chama
-- `advance_room` quando o prazo vence; o servidor confere o horário e avança
-- (a chamada é idempotente, então vários aparelhos podem chamá-la juntos).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Configuração
-- -----------------------------------------------------------------------------
create or replace function app_private.phase_duration(p_phase text)
returns interval
language sql
immutable
set search_path = ''
as $$
  select case p_phase
    when 'starting' then interval '3 seconds'        -- "Preparem-se" antes da 1ª palavra
    when 'correct' then interval '3 seconds'         -- animação de acerto
    when 'countdown' then interval '3 seconds'       -- "Próxima palavra em 3, 2, 1"
    when 'incorrect' then interval '2 seconds'       -- "Música incorreta"
    when 'decision' then interval '3 seconds'        -- votação Novo palpite × Nova palavra
    when 'verify_timeout' then interval '25 seconds' -- segurança caso a verificação trave
    when 'player_timeout' then interval '30 seconds' -- sem sinal por 30 s = desconectado
  end;
$$;

create or replace function app_private.max_players()
returns integer language sql immutable set search_path = '' as $$ select 10 $$;

create or replace function app_private.min_players()
returns integer language sql immutable set search_path = '' as $$ select 2 $$;

create or replace function app_private.max_rounds()
returns integer language sql immutable set search_path = '' as $$ select 9999 $$;

-- -----------------------------------------------------------------------------
-- Utilitários
-- -----------------------------------------------------------------------------
create or replace function app_private.fail(p_code text)
returns void
language plpgsql
set search_path = ''
as $$
begin
  -- A mensagem é um código estável; o app traduz para um texto amigável.
  raise exception '%', p_code using errcode = 'P0001';
end;
$$;

create or replace function app_private.require_uid()
returns uuid
language plpgsql
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    perform app_private.fail('not_authenticated');
  end if;
  return v_uid;
end;
$$;

create or replace function app_private.clean_name(p_name text)
returns text
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g'));
begin
  if char_length(v_name) = 0 then
    perform app_private.fail('invalid_name');
  end if;
  return left(v_name, 24);
end;
$$;

create or replace function app_private.random_code()
returns text
language sql
volatile
set search_path = ''
as $$
  -- Sem caracteres ambíguos (0/O, 1/I).
  select string_agg(substr('ABCDEFGHJKLMNPQRSTUVWXYZ23456789', 1 + floor(random() * 32)::int, 1), '')
  from generate_series(1, 6);
$$;

create or replace function app_private.lock_room(p_room_id uuid)
returns public.rooms
language plpgsql
set search_path = ''
as $$
declare
  v_room public.rooms;
begin
  select * into v_room from public.rooms where id = p_room_id for update;
  if not found then
    perform app_private.fail('room_not_found');
  end if;
  return v_room;
end;
$$;

create or replace function app_private.find_player(p_room_id uuid, p_user_id uuid)
returns public.players
language plpgsql
set search_path = ''
as $$
declare
  v_player public.players;
begin
  select * into v_player from public.players where room_id = p_room_id and user_id = p_user_id;
  if not found then
    perform app_private.fail('not_in_room');
  end if;
  if v_player.left_reason = 'kicked' then
    perform app_private.fail('kicked');
  end if;
  return v_player;
end;
$$;

-- Jogador ativo da sala (reativa automaticamente quem tinha caído por falta de sinal).
create or replace function app_private.active_player(p_room public.rooms, p_user_id uuid)
returns public.players
language plpgsql
set search_path = ''
as $$
declare
  v_player public.players := app_private.find_player(p_room.id, p_user_id);
begin
  if not v_player.is_active then
    if v_player.left_reason = 'timeout'
       and p_room.status <> 'finished'
       and app_private.active_count(p_room.id) < app_private.max_players() then
      update public.players
        set is_active = true, left_at = null, left_reason = null, last_seen_at = now()
        where id = v_player.id
        returning * into v_player;
      perform app_private.ensure_host(p_room.id);
    else
      perform app_private.fail('not_active');
    end if;
  else
    update public.players set last_seen_at = now() where id = v_player.id;
  end if;
  return v_player;
end;
$$;

create or replace function app_private.require_host(p_room public.rooms, p_user_id uuid)
returns public.players
language plpgsql
set search_path = ''
as $$
declare
  v_player public.players := app_private.active_player(p_room, p_user_id);
begin
  -- Relê o host, pois active_player pode ter corrigido a transferência.
  if v_player.id is distinct from (select host_player_id from public.rooms where id = p_room.id) then
    perform app_private.fail('not_host');
  end if;
  return v_player;
end;
$$;

create or replace function app_private.active_count(p_room_id uuid)
returns integer
language sql
stable
set search_path = ''
as $$
  select count(*)::int from public.players where room_id = p_room_id and is_active;
$$;

-- Marca uma mudança de estado: os clientes recarregam quando a versão muda.
create or replace function app_private.touch(p_room_id uuid)
returns void
language sql
set search_path = ''
as $$
  update public.rooms
    set state_version = state_version + 1, updated_at = now()
    where id = p_room_id;
$$;

-- Nome único dentro da sala ("Ana", "Ana 2"...).
create or replace function app_private.unique_name(p_room_id uuid, p_name text)
returns text
language plpgsql
set search_path = ''
as $$
declare
  v_candidate text := p_name;
  v_suffix integer := 2;
begin
  while exists (
    select 1 from public.players
    where room_id = p_room_id
      and lower(name) = lower(v_candidate)
      and left_reason is distinct from 'kicked'
  ) loop
    v_candidate := left(p_name, 24 - char_length(v_suffix::text) - 1) || ' ' || v_suffix;
    v_suffix := v_suffix + 1;
  end loop;
  return v_candidate;
end;
$$;

-- -----------------------------------------------------------------------------
-- Host: se o host saiu, o cargo passa para o próximo na ordem de entrada.
-- -----------------------------------------------------------------------------
create or replace function app_private.ensure_host(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_current uuid;
  v_next uuid;
begin
  select host_player_id into v_current from public.rooms where id = p_room_id;
  if v_current is not null and exists (
    select 1 from public.players where id = v_current and is_active
  ) then
    return false;
  end if;

  select id into v_next
    from public.players
    where room_id = p_room_id and is_active
    order by join_order
    limit 1;

  if v_next is distinct from v_current then
    update public.rooms set host_player_id = v_next where id = p_room_id;
    return true;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Encerramento e sorteio
-- -----------------------------------------------------------------------------
create or replace function app_private.finish_room(p_room_id uuid, p_reason public.end_reason)
returns void
language plpgsql
set search_path = ''
as $$
begin
  update public.guesses
    set status = 'error', failure_reason = 'cancelled', verified_at = now()
    where room_id = p_room_id and status = 'verifying';

  update public.rounds
    set status = 'discarded', ended_at = now()
    where room_id = p_room_id and status = 'active';

  update public.rooms
    set status = 'finished',
        end_reason = p_reason,
        ended_at = now(),
        phase_ends_at = null,
        active_guess_id = null,
        decision_origin = null
    where id = p_room_id and status <> 'finished';
end;
$$;

-- Sorteia uma palavra ainda não usada na partida. Sem palavras: encerra a partida.
create or replace function app_private.draw_word(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_word text;
  v_sequence integer;
  v_round_id uuid;
begin
  select btrim(w.word) into v_word
    from public.words w
    where w.active
      and not exists (
        select 1 from public.used_words u
        where u.room_id = p_room_id
          and app_private.word_key(u.word) = app_private.word_key(w.word)
      )
    order by random()
    limit 1;

  if v_word is null then
    perform app_private.finish_room(p_room_id, 'words_exhausted');
    return false;
  end if;

  insert into public.used_words (room_id, word) values (p_room_id, v_word);

  select coalesce(max(sequence), 0) + 1 into v_sequence from public.rounds where room_id = p_room_id;

  insert into public.rounds (room_id, sequence, word)
    values (p_room_id, v_sequence, v_word)
    returning id into v_round_id;

  update public.rooms
    set current_word_id = v_round_id,
        status = 'playing',
        phase_ends_at = null,
        active_guess_id = null,
        decision_origin = null
    where id = p_room_id;
  return true;
end;
$$;

-- Primeira tentativa verificada: a palavra passa a contar como rodada (uma única vez).
create or replace function app_private.count_attempt(p_round_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_round public.rounds;
  v_number integer;
begin
  select * into v_round from public.rounds where id = p_round_id for update;
  if v_round.has_attempt then
    return;
  end if;

  update public.rooms
    set rounds_played = rounds_played + 1
    where id = v_round.room_id
    returning rounds_played into v_number;

  update public.rounds
    set has_attempt = true, round_number = v_number
    where id = p_round_id;
end;
$$;

-- Fim de uma palavra (acertada ou descartada): encerra se as rodadas acabaram.
create or replace function app_private.rounds_completed(p_room_id uuid)
returns boolean
language sql
stable
set search_path = ''
as $$
  select rounds_played >= configured_rounds from public.rooms where id = p_room_id;
$$;

-- -----------------------------------------------------------------------------
-- Finalização coletiva: mais de 50% dos jogadores ATIVOS pediram para finalizar.
-- -----------------------------------------------------------------------------
create or replace function app_private.check_finish_majority(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_status public.room_status;
  v_active integer;
  v_requests integer;
begin
  select status into v_status from public.rooms where id = p_room_id;
  if v_status in ('waiting', 'finished') then
    return false;
  end if;

  v_active := app_private.active_count(p_room_id);
  select count(*) into v_requests
    from public.finish_requests f
    join public.players p on p.id = f.player_id
    where f.room_id = p_room_id and p.is_active;

  if v_active > 0 and v_requests * 2 > v_active then
    perform app_private.finish_room(p_room_id, 'majority_finish');
    return true;
  end if;
  return false;
end;
$$;

-- -----------------------------------------------------------------------------
-- Conexão: jogadores sem sinal há 30 s ficam inativos (sem perder pontos).
-- -----------------------------------------------------------------------------
create or replace function app_private.sweep_players(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_changed boolean := false;
  v_count integer;
  v_status public.room_status;
begin
  update public.players
    set is_active = false, left_at = now(), left_reason = 'timeout'
    where room_id = p_room_id
      and is_active
      and last_seen_at < now() - app_private.phase_duration('player_timeout');
  get diagnostics v_count = row_count;
  v_changed := v_count > 0;

  if app_private.ensure_host(p_room_id) then
    v_changed := true;
  end if;

  select status into v_status from public.rooms where id = p_room_id;
  if v_status <> 'finished' and app_private.active_count(p_room_id) = 0 then
    perform app_private.finish_room(p_room_id, 'abandoned');
    v_changed := true;
  elsif v_changed and app_private.check_finish_majority(p_room_id) then
    v_changed := true;
  end if;
  return v_changed;
end;
$$;

-- -----------------------------------------------------------------------------
-- Votação "Novo palpite" × "Nova palavra"
--   maioria em Novo palpite → continua a mesma palavra
--   maioria em Nova palavra, empate ou ninguém votou → nova palavra
-- -----------------------------------------------------------------------------
create or replace function app_private.resolve_decision(p_room_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_keep integer;
  v_new integer;
begin
  select * into v_room from public.rooms where id = p_room_id;

  select
    count(*) filter (where choice = 'new_guess'),
    count(*) filter (where choice = 'new_word')
  into v_keep, v_new
  from public.round_votes
  where round_id = v_room.current_word_id and decision_number = v_room.decision_number;

  if v_keep > v_new then
    update public.rooms
      set status = 'playing', phase_ends_at = null, decision_origin = null
      where id = p_room_id;
    return;
  end if;

  -- A palavra é descartada. Ela já contou como rodada se teve palpite verificado
  -- (isso foi registrado em count_attempt) e nunca volta nesta partida.
  update public.rounds
    set status = 'discarded', ended_at = now()
    where id = v_room.current_word_id and status = 'active';

  if app_private.rounds_completed(p_room_id) then
    perform app_private.finish_room(p_room_id, 'rounds_completed');
  else
    perform app_private.draw_word(p_room_id);
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Avança as fases cujo prazo venceu (idempotente).
-- -----------------------------------------------------------------------------
create or replace function app_private.advance_phases(p_room_id uuid)
returns boolean
language plpgsql
set search_path = ''
as $$
declare
  v_room public.rooms;
  v_changed boolean := false;
begin
  for i in 1..8 loop
    select * into v_room from public.rooms where id = p_room_id;
    exit when v_room.phase_ends_at is null or v_room.phase_ends_at > now();

    case v_room.status
      when 'starting' then
        perform app_private.draw_word(p_room_id);

      when 'verifying' then
        -- A verificação não respondeu a tempo: o palpite não conta e o jogo segue.
        update public.guesses
          set status = 'error', failure_reason = 'timeout', verified_at = now()
          where id = v_room.active_guess_id and status = 'verifying';
        update public.rooms
          set status = 'playing', phase_ends_at = null, active_guess_id = null
          where id = p_room_id;

      when 'correct' then
        if app_private.rounds_completed(p_room_id) then
          perform app_private.finish_room(p_room_id, 'rounds_completed');
        else
          update public.rooms
            set status = 'countdown', phase_ends_at = now() + app_private.phase_duration('countdown')
            where id = p_room_id;
        end if;

      when 'countdown' then
        perform app_private.draw_word(p_room_id);

      when 'incorrect' then
        update public.rooms
          set status = 'decision',
              decision_origin = 'incorrect_guess',
              decision_number = decision_number + 1,
              phase_ends_at = now() + app_private.phase_duration('decision')
          where id = p_room_id;

      when 'decision' then
        perform app_private.resolve_decision(p_room_id);

      else
        update public.rooms set phase_ends_at = null where id = p_room_id;
    end case;

    v_changed := true;
  end loop;
  return v_changed;
end;
$$;

-- =============================================================================
-- RPCs públicas (chamadas pelo app com o usuário autenticado)
-- =============================================================================

-- Criar sala: quem cria entra automaticamente como HOST.
create or replace function public.create_room(p_player_name text, p_rounds integer)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_name text := app_private.clean_name(p_player_name);
  v_room_id uuid;
  v_player_id uuid;
  v_code text;
begin
  if p_rounds is null or p_rounds < 1 or p_rounds > app_private.max_rounds() then
    perform app_private.fail('invalid_rounds');
  end if;

  for attempt in 1..20 loop
    v_code := app_private.random_code();
    begin
      insert into public.rooms (code, configured_rounds, created_by)
        values (v_code, p_rounds, v_uid)
        returning id into v_room_id;
      exit;
    exception when unique_violation then
      v_room_id := null;
    end;
  end loop;

  if v_room_id is null then
    perform app_private.fail('try_again');
  end if;

  insert into public.players (room_id, user_id, name, join_order)
    values (v_room_id, v_uid, v_name, 1)
    returning id into v_player_id;

  update public.rooms set host_player_id = v_player_id, state_version = 1 where id = v_room_id;

  return jsonb_build_object('room_id', v_room_id, 'code', v_code, 'player_id', v_player_id);
end;
$$;

-- Entrar na sala (antes ou durante a partida). Também serve para reconectar:
-- o mesmo usuário recupera o mesmo jogador, com a mesma pontuação.
create or replace function public.join_room(p_code text, p_player_name text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_code text := upper(regexp_replace(coalesce(p_code, ''), '[^A-Za-z0-9]', '', 'g'));
  v_room public.rooms;
  v_player public.players;
  v_changed boolean := false;
begin
  select * into v_room from public.rooms where code = v_code for update;
  if not found then
    perform app_private.fail('room_not_found');
  end if;

  select * into v_player from public.players where room_id = v_room.id and user_id = v_uid;

  if found then
    if v_player.left_reason = 'kicked' then
      perform app_private.fail('kicked');
    end if;

    if v_player.is_active then
      update public.players set last_seen_at = now() where id = v_player.id;
    elsif v_room.status <> 'finished' then
      if app_private.active_count(v_room.id) >= app_private.max_players() then
        perform app_private.fail('room_full');
      end if;
      update public.players
        set is_active = true,
            left_at = null,
            left_reason = null,
            last_seen_at = now(),
            -- Quem saiu por conta própria e volta entra no fim da fila de host;
            -- quem só perdeu a conexão mantém a posição original.
            join_order = case
              when v_player.left_reason = 'left'
                then (select max(join_order) + 1 from public.players where room_id = v_room.id)
              else join_order
            end
        where id = v_player.id;
      v_changed := true;
    end if;
  else
    if v_room.status = 'finished' then
      perform app_private.fail('room_finished');
    end if;
    if app_private.active_count(v_room.id) >= app_private.max_players() then
      perform app_private.fail('room_full');
    end if;

    insert into public.players (room_id, user_id, name, join_order)
      values (
        v_room.id,
        v_uid,
        app_private.unique_name(v_room.id, app_private.clean_name(p_player_name)),
        (select coalesce(max(join_order), 0) + 1 from public.players where room_id = v_room.id)
      )
      returning * into v_player;
    v_changed := true;
  end if;

  if app_private.ensure_host(v_room.id) then
    v_changed := true;
  end if;
  if v_changed then
    perform app_private.touch(v_room.id);
  end if;

  return jsonb_build_object('room_id', v_room.id, 'code', v_room.code, 'player_id', v_player.id);
end;
$$;

-- Estado completo da partida para o aparelho (fonte única da interface).
create or replace function public.get_room_state(p_room_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms;
  v_me public.players;
  v_word public.rounds;
  v_active integer;
  v_display_round integer;
begin
  select * into v_room from public.rooms where id = p_room_id;
  if not found then
    perform app_private.fail('room_not_found');
  end if;

  select * into v_me from public.players where room_id = p_room_id and user_id = v_uid;
  if not found then
    perform app_private.fail('not_in_room');
  end if;

  if v_me.left_reason = 'kicked' then
    return jsonb_build_object(
      'kicked', true,
      'server_time', clock_timestamp(),
      'room', jsonb_build_object('id', v_room.id, 'code', v_room.code)
    );
  end if;

  select * into v_word from public.rounds where id = v_room.current_word_id;
  v_active := app_private.active_count(p_room_id);
  v_display_round := coalesce(v_word.round_number, v_room.rounds_played + 1);

  return jsonb_build_object(
    'kicked', false,
    'server_time', clock_timestamp(),
    'me', jsonb_build_object(
      'player_id', v_me.id,
      'is_host', v_me.id = v_room.host_player_id,
      'is_active', v_me.is_active,
      'left_reason', v_me.left_reason
    ),
    'room', jsonb_build_object(
      'id', v_room.id,
      'code', v_room.code,
      'status', v_room.status,
      'phase_ends_at', v_room.phase_ends_at,
      'configured_rounds', v_room.configured_rounds,
      'rounds_played', v_room.rounds_played,
      'host_player_id', v_room.host_player_id,
      'decision_origin', v_room.decision_origin,
      'decision_number', v_room.decision_number,
      'end_reason', v_room.end_reason,
      'state_version', v_room.state_version,
      'started_at', v_room.started_at,
      'ended_at', v_room.ended_at,
      'is_last_round', v_room.status not in ('waiting', 'finished') and v_display_round >= v_room.configured_rounds,
      'final_round_prompt', v_room.status not in ('waiting', 'finished')
        and v_room.rounds_played >= v_room.configured_rounds - 1
        and v_room.final_prompt_answered_for is distinct from v_room.configured_rounds
    ),
    'players', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'score', p.score,
        'join_order', p.join_order,
        'is_active', p.is_active,
        'left_reason', p.left_reason,
        'is_host', p.id = v_room.host_player_id
      ) order by p.join_order)
      from public.players p
      where p.room_id = p_room_id and p.left_reason is distinct from 'kicked'
    ), '[]'::jsonb),
    'active_players', v_active,
    'current_word', case when v_word.id is null then null else jsonb_build_object(
      'id', v_word.id,
      'sequence', v_word.sequence,
      'word', v_word.word,
      'status', v_word.status,
      'has_attempt', v_word.has_attempt,
      'round_number', v_word.round_number,
      'display_round', v_display_round,
      'winner_player_id', v_word.winner_player_id
    ) end,
    'active_guess', (
      select jsonb_build_object(
        'id', g.id,
        'player_id', g.player_id,
        'player_name', p.name,
        'text', g.text,
        'submitted_at', g.submitted_at
      )
      from public.guesses g
      join public.players p on p.id = g.player_id
      where g.id = v_room.active_guess_id
    ),
    'last_result', (
      select jsonb_build_object(
        'id', g.id,
        'player_id', g.player_id,
        'player_name', p.name,
        'text', g.text,
        'status', g.status,
        'result_song', g.result_song,
        'result_artist', g.result_artist,
        'matched_excerpt', g.matched_excerpt,
        'matched_word', g.matched_word,
        'failure_reason', g.failure_reason,
        'verified_at', g.verified_at
      )
      from public.guesses g
      join public.players p on p.id = g.player_id
      where g.round_id = v_room.current_word_id and g.status <> 'verifying'
      order by g.verified_at desc nulls last
      limit 1
    ),
    'votes', (
      select jsonb_build_object(
        'new_guess', count(*) filter (where v.choice = 'new_guess'),
        'new_word', count(*) filter (where v.choice = 'new_word'),
        'my_choice', max(v.choice::text) filter (where v.player_id = v_me.id)
      )
      from public.round_votes v
      where v.round_id = v_room.current_word_id and v.decision_number = v_room.decision_number
    ),
    'finish', (
      select jsonb_build_object(
        'count', count(*),
        'needed', v_active / 2 + 1,
        'i_requested', coalesce(bool_or(f.player_id = v_me.id), false),
        'requested_by', coalesce(jsonb_agg(p.name order by f.created_at), '[]'::jsonb)
      )
      from public.finish_requests f
      join public.players p on p.id = f.player_id
      where f.room_id = p_room_id and p.is_active
    )
  );
end;
$$;

-- Host inicia a partida (mínimo de 2 jogadores ativos).
create or replace function public.start_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status <> 'waiting' then
    perform app_private.fail('already_started');
  end if;
  if app_private.active_count(p_room_id) < app_private.min_players() then
    perform app_private.fail('not_enough_players');
  end if;

  update public.rooms
    set status = 'starting',
        started_at = now(),
        phase_ends_at = now() + app_private.phase_duration('starting')
    where id = p_room_id;
  perform app_private.touch(p_room_id);
end;
$$;

-- Host altera o número de rodadas no lobby.
create or replace function public.update_room_settings(p_room_id uuid, p_rounds integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status <> 'waiting' then
    perform app_private.fail('already_started');
  end if;
  if p_rounds is null or p_rounds < 1 or p_rounds > app_private.max_rounds() then
    perform app_private.fail('invalid_rounds');
  end if;
  update public.rooms set configured_rounds = p_rounds where id = p_room_id;
  perform app_private.touch(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Palpites (chamadas exclusivas do servidor: Edge Function com service_role)
-- -----------------------------------------------------------------------------

-- Reserva a verificação para o PRIMEIRO palpite. Os demais são descartados.
create or replace function public.submit_guess(p_user_id uuid, p_room_id uuid, p_text text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players := app_private.active_player(v_room, p_user_id);
  v_text text := btrim(regexp_replace(coalesce(p_text, ''), '\s+', ' ', 'g'));
  v_word public.rounds;
  v_guess_id uuid;
begin
  if char_length(v_text) = 0 or char_length(v_text) > 200 then
    perform app_private.fail('invalid_guess');
  end if;

  if v_room.status <> 'playing' then
    return jsonb_build_object(
      'accepted', false,
      'reason', case when v_room.status = 'verifying' then 'busy' else 'not_accepting' end
    );
  end if;

  select * into v_word from public.rounds where id = v_room.current_word_id;

  insert into public.guesses (room_id, round_id, player_id, text)
    values (p_room_id, v_word.id, v_player.id, v_text)
    returning id into v_guess_id;

  update public.rooms
    set status = 'verifying',
        active_guess_id = v_guess_id,
        phase_ends_at = now() + app_private.phase_duration('verify_timeout')
    where id = p_room_id;
  perform app_private.touch(p_room_id);

  return jsonb_build_object(
    'accepted', true,
    'guess_id', v_guess_id,
    'round_id', v_word.id,
    'word', v_word.word,
    'player_name', v_player.name
  );
end;
$$;

-- Aplica o resultado da verificação musical.
--   correct   → +1 ponto, palavra contabilizada, animação e contagem para a próxima
--   incorrect → palavra contabilizada, "Música incorreta" e votação
--   error     → a API falhou: o palpite não conta e o jogo volta a aceitar palpites
create or replace function public.resolve_guess(p_guess_id uuid, p_outcome text, p_details jsonb default '{}'::jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_guess public.guesses;
  v_room public.rooms;
  v_details jsonb := coalesce(p_details, '{}'::jsonb);
begin
  if p_outcome not in ('correct', 'incorrect', 'error') then
    perform app_private.fail('invalid_outcome');
  end if;

  select * into v_guess from public.guesses where id = p_guess_id;
  if not found then
    perform app_private.fail('guess_not_found');
  end if;

  v_room := app_private.lock_room(v_guess.room_id);
  select * into v_guess from public.guesses where id = p_guess_id;

  if v_guess.status <> 'verifying'
     or v_room.status <> 'verifying'
     or v_room.active_guess_id is distinct from p_guess_id then
    -- Chegou tarde (tempo esgotado ou partida encerrada): não altera a partida.
    update public.guesses
      set status = 'error', failure_reason = 'expired', verified_at = now()
      where id = p_guess_id and status = 'verifying';
    return jsonb_build_object('applied', false);
  end if;

  update public.guesses
    set status = p_outcome::public.guess_status,
        verified_at = now(),
        result_song = left(v_details ->> 'title', 300),
        result_artist = left(v_details ->> 'artist', 300),
        matched_excerpt = left(v_details ->> 'excerpt', 600),
        matched_word = left(v_details ->> 'matchedWord', 80),
        confidence = case
          when jsonb_typeof(v_details -> 'confidence') = 'number'
            then least(1, greatest(0, (v_details ->> 'confidence')::numeric))
        end,
        failure_reason = case
          when p_outcome = 'correct' then null
          else coalesce(v_details ->> 'reason', case when p_outcome = 'error' then 'provider_unavailable' else 'no_match' end)
        end,
        provider = left(v_details ->> 'provider', 40),
        provider_track_id = left(v_details ->> 'trackId', 80)
    where id = p_guess_id;

  if p_outcome in ('correct', 'incorrect') then
    perform app_private.count_attempt(v_guess.round_id);
  end if;

  if p_outcome = 'correct' then
    update public.rounds
      set status = 'won', winner_player_id = v_guess.player_id, winning_guess_id = p_guess_id, ended_at = now()
      where id = v_guess.round_id;
    update public.players set score = score + 1 where id = v_guess.player_id;
    update public.rooms
      set status = 'correct',
          active_guess_id = null,
          phase_ends_at = now() + app_private.phase_duration('correct')
      where id = v_room.id;
  elsif p_outcome = 'incorrect' then
    update public.rooms
      set status = 'incorrect',
          active_guess_id = null,
          phase_ends_at = now() + app_private.phase_duration('incorrect')
      where id = v_room.id;
  else
    update public.rooms
      set status = 'playing', active_guess_id = null, phase_ends_at = null
      where id = v_room.id;
  end if;

  perform app_private.touch(v_room.id);
  return jsonb_build_object('applied', true);
end;
$$;

-- -----------------------------------------------------------------------------
-- Decisões coletivas
-- -----------------------------------------------------------------------------

-- Voto durante a janela de 3 segundos ("Novo palpite" ou "Nova palavra").
create or replace function public.vote_decision(p_room_id uuid, p_choice text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players := app_private.active_player(v_room, v_uid);
begin
  if p_choice not in ('new_guess', 'new_word') then
    perform app_private.fail('invalid_choice');
  end if;
  if v_room.status <> 'decision' or v_room.phase_ends_at <= now() then
    perform app_private.fail('vote_closed');
  end if;

  insert into public.round_votes (room_id, round_id, player_id, decision_number, choice)
    values (p_room_id, v_room.current_word_id, v_player.id, v_room.decision_number, p_choice::public.vote_choice)
    on conflict (round_id, decision_number, player_id)
    do update set choice = excluded.choice, created_at = now();
  perform app_private.touch(p_room_id);
end;
$$;

-- "Pular palavra": abre a votação de 3 segundos (o pedido já conta como voto em Nova palavra).
create or replace function public.request_new_word(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players := app_private.active_player(v_room, v_uid);
begin
  if v_room.status <> 'playing' then
    perform app_private.fail('not_playing');
  end if;

  update public.rooms
    set status = 'decision',
        decision_origin = 'skip_request',
        decision_number = decision_number + 1,
        phase_ends_at = now() + app_private.phase_duration('decision')
    where id = p_room_id
    returning * into v_room;

  insert into public.round_votes (room_id, round_id, player_id, decision_number, choice)
    values (p_room_id, v_room.current_word_id, v_player.id, v_room.decision_number, 'new_word');
  perform app_private.touch(p_room_id);
end;
$$;

-- "Finalizar jogo": pedido coletivo, sem opção "Não". Maioria (> 50% dos ativos) encerra.
create or replace function public.request_finish(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players := app_private.active_player(v_room, v_uid);
  v_finished boolean;
begin
  if v_room.status in ('waiting', 'finished') then
    perform app_private.fail('not_in_game');
  end if;

  insert into public.finish_requests (room_id, player_id)
    values (p_room_id, v_player.id)
    on conflict (room_id, player_id) do nothing;

  v_finished := app_private.check_finish_majority(p_room_id);
  perform app_private.touch(p_room_id);
  return jsonb_build_object('finished', v_finished);
end;
$$;

-- -----------------------------------------------------------------------------
-- Funções do host
-- -----------------------------------------------------------------------------
create or replace function public.kick_player(p_room_id uuid, p_player_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_host public.players := app_private.require_host(v_room, v_uid);
begin
  if p_player_id = v_host.id then
    perform app_private.fail('cannot_kick_self');
  end if;

  update public.players
    set is_active = false, left_reason = 'kicked', left_at = now()
    where id = p_player_id and room_id = p_room_id and left_reason is distinct from 'kicked';
  if not found then
    perform app_private.fail('player_not_found');
  end if;

  delete from public.finish_requests where player_id = p_player_id;
  perform app_private.check_finish_majority(p_room_id);
  perform app_private.touch(p_room_id);
end;
$$;

-- Host encerra a sala/jogo para todos.
create or replace function public.end_game(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status = 'finished' then
    return;
  end if;
  perform app_private.finish_room(p_room_id, 'host_ended');
  perform app_private.touch(p_room_id);
end;
$$;

-- Host adiciona rodadas (sem limite baixo artificial).
create or replace function public.extend_rounds(p_room_id uuid, p_extra integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status = 'finished' then
    perform app_private.fail('room_finished');
  end if;
  if p_extra is null or p_extra < 1 or p_extra > app_private.max_rounds() then
    perform app_private.fail('invalid_rounds');
  end if;
  update public.rooms
    set configured_rounds = least(app_private.max_rounds(), configured_rounds + p_extra)
    where id = p_room_id;
  perform app_private.touch(p_room_id);
end;
$$;

-- Resposta do host ao aviso "O jogo está indo para a última rodada. Deseja adicionar mais?"
--   p_extra > 0 → SIM, adiciona rodadas;  p_extra = 0 → NÃO, a próxima rodada é a última.
create or replace function public.respond_final_round(p_room_id uuid, p_extra integer)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status in ('waiting', 'finished') then
    perform app_private.fail('not_in_game');
  end if;

  if coalesce(p_extra, 0) > 0 then
    if p_extra > app_private.max_rounds() then
      perform app_private.fail('invalid_rounds');
    end if;
    update public.rooms
      set configured_rounds = least(app_private.max_rounds(), configured_rounds + p_extra)
      where id = p_room_id;
  else
    update public.rooms set final_prompt_answered_for = configured_rounds where id = p_room_id;
  end if;
  perform app_private.touch(p_room_id);
end;
$$;

-- "Jogar novamente": o host reinicia a mesma sala (mesmo código e jogadores).
create or replace function public.restart_room(p_room_id uuid, p_rounds integer default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
begin
  perform app_private.require_host(v_room, v_uid);
  if v_room.status <> 'finished' then
    perform app_private.fail('not_finished');
  end if;
  if p_rounds is not null and (p_rounds < 1 or p_rounds > app_private.max_rounds()) then
    perform app_private.fail('invalid_rounds');
  end if;

  update public.rooms
    set status = 'waiting',
        current_word_id = null,
        active_guess_id = null,
        rounds_played = 0,
        decision_origin = null,
        decision_number = 0,
        final_prompt_answered_for = null,
        end_reason = null,
        started_at = null,
        ended_at = null,
        phase_ends_at = null,
        configured_rounds = coalesce(p_rounds, configured_rounds)
    where id = p_room_id;

  delete from public.rounds where room_id = p_room_id;
  delete from public.used_words where room_id = p_room_id;
  delete from public.finish_requests where room_id = p_room_id;
  update public.players set score = 0 where room_id = p_room_id;
  perform app_private.touch(p_room_id);
end;
$$;

-- -----------------------------------------------------------------------------
-- Conexão
-- -----------------------------------------------------------------------------

-- Sair da sala. Se era o host, o cargo passa para o próximo na ordem de entrada.
create or replace function public.leave_room(p_room_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players;
begin
  select * into v_player from public.players where room_id = p_room_id and user_id = v_uid;
  if not found or not v_player.is_active then
    return;
  end if;

  update public.players
    set is_active = false, left_reason = 'left', left_at = now()
    where id = v_player.id;
  delete from public.finish_requests where player_id = v_player.id;

  perform app_private.ensure_host(p_room_id);
  if v_room.status <> 'finished' and app_private.active_count(p_room_id) = 0 then
    perform app_private.finish_room(p_room_id, 'abandoned');
  else
    perform app_private.check_finish_majority(p_room_id);
  end if;
  perform app_private.touch(p_room_id);
end;
$$;

-- Sinal de vida (a cada ~5 s). Reconecta o jogador, detecta quem caiu,
-- transfere o host se preciso e avança prazos vencidos.
create or replace function public.heartbeat(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_player public.players;
  v_changed boolean := false;
begin
  select * into v_player from public.players where room_id = p_room_id and user_id = v_uid;
  if not found then
    perform app_private.fail('not_in_room');
  end if;
  if v_player.left_reason = 'kicked' then
    return jsonb_build_object('kicked', true, 'state_version', v_room.state_version, 'server_time', clock_timestamp());
  end if;

  if v_player.is_active then
    update public.players set last_seen_at = now() where id = v_player.id;
  elsif v_player.left_reason = 'timeout'
        and v_room.status <> 'finished'
        and app_private.active_count(p_room_id) < app_private.max_players() then
    -- Reconexão: mesmo jogador, mesma pontuação, mesma posição na fila de host.
    update public.players
      set is_active = true, left_at = null, left_reason = null, last_seen_at = now()
      where id = v_player.id;
    v_changed := true;
  end if;

  if app_private.sweep_players(p_room_id) then
    v_changed := true;
  end if;
  if app_private.advance_phases(p_room_id) then
    v_changed := true;
  end if;
  if v_changed then
    perform app_private.touch(p_room_id);
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  return jsonb_build_object(
    'kicked', false,
    'state_version', v_room.state_version,
    'status', v_room.status,
    'server_time', clock_timestamp()
  );
end;
$$;

-- Chamado pelos aparelhos quando um prazo vence (contagens de 3 s etc.).
create or replace function public.advance_room(p_room_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid uuid := app_private.require_uid();
  v_room public.rooms := app_private.lock_room(p_room_id);
  v_changed boolean := false;
begin
  perform app_private.find_player(p_room_id, v_uid);

  if app_private.sweep_players(p_room_id) then
    v_changed := true;
  end if;
  if app_private.advance_phases(p_room_id) then
    v_changed := true;
  end if;
  if v_changed then
    perform app_private.touch(p_room_id);
  end if;

  select * into v_room from public.rooms where id = p_room_id;
  return jsonb_build_object('state_version', v_room.state_version, 'status', v_room.status);
end;
$$;

-- =============================================================================
-- Permissões
-- =============================================================================
revoke all on all functions in schema app_private from public, anon, authenticated;
grant execute on function app_private.is_room_member(uuid) to authenticated;

revoke all on function public.create_room(text, integer) from public, anon;
revoke all on function public.join_room(text, text) from public, anon;
revoke all on function public.get_room_state(uuid) from public, anon;
revoke all on function public.start_game(uuid) from public, anon;
revoke all on function public.update_room_settings(uuid, integer) from public, anon;
revoke all on function public.vote_decision(uuid, text) from public, anon;
revoke all on function public.request_new_word(uuid) from public, anon;
revoke all on function public.request_finish(uuid) from public, anon;
revoke all on function public.kick_player(uuid, uuid) from public, anon;
revoke all on function public.end_game(uuid) from public, anon;
revoke all on function public.extend_rounds(uuid, integer) from public, anon;
revoke all on function public.respond_final_round(uuid, integer) from public, anon;
revoke all on function public.restart_room(uuid, integer) from public, anon;
revoke all on function public.leave_room(uuid) from public, anon;
revoke all on function public.heartbeat(uuid) from public, anon;
revoke all on function public.advance_room(uuid) from public, anon;

grant execute on function public.create_room(text, integer) to authenticated;
grant execute on function public.join_room(text, text) to authenticated;
grant execute on function public.get_room_state(uuid) to authenticated;
grant execute on function public.start_game(uuid) to authenticated;
grant execute on function public.update_room_settings(uuid, integer) to authenticated;
grant execute on function public.vote_decision(uuid, text) to authenticated;
grant execute on function public.request_new_word(uuid) to authenticated;
grant execute on function public.request_finish(uuid) to authenticated;
grant execute on function public.kick_player(uuid, uuid) to authenticated;
grant execute on function public.end_game(uuid) to authenticated;
grant execute on function public.extend_rounds(uuid, integer) to authenticated;
grant execute on function public.respond_final_round(uuid, integer) to authenticated;
grant execute on function public.restart_room(uuid, integer) to authenticated;
grant execute on function public.leave_room(uuid) to authenticated;
grant execute on function public.heartbeat(uuid) to authenticated;
grant execute on function public.advance_room(uuid) to authenticated;

-- Palpites só entram pela Edge Function (que valida o usuário e verifica a música).
revoke all on function public.submit_guess(uuid, uuid, text) from public, anon, authenticated;
revoke all on function public.resolve_guess(uuid, text, jsonb) from public, anon, authenticated;
grant execute on function public.submit_guess(uuid, uuid, text) to service_role;
grant execute on function public.resolve_guess(uuid, text, jsonb) to service_role;
