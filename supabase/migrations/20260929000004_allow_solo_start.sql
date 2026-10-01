-- =============================================================================
-- O host pode iniciar a partida sozinho (útil para testar o modo online).
-- Os demais continuam podendo entrar durante a partida pelo código da sala.
-- =============================================================================
create or replace function app_private.min_players()
returns integer language sql immutable set search_path = '' as $$ select 1 $$;
