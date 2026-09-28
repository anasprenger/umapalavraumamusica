# Testes

| Suíte | Comando | O que cobre |
| --- | --- | --- |
| Lógica do app e busca musical | `npm test` | Modo local, ranking com empates, normalização, destaque do trecho, `MusicSearchService`, provedor Musixmatch (com respostas simuladas) |
| Regras do modo online | `npm run test:db` | Funções RPC num Postgres real: ordem dos palpites, rodadas, votação, finalização, host, conexão e permissões |
| Edge Function | `npm run check:functions` | Checagem de tipos em Deno (inclui o SDK da IA opcional) |
| App | `npm run typecheck` e `npm run lint` | TypeScript e ESLint (regras do React Compiler) |

## Rodando os testes de banco

Precisam de um Postgres 15+ acessível. O teste cria um banco temporário, aplica um “stub” mínimo do
Supabase (`supabase/tests/supabase-stub.sql`: papéis, `auth.uid()`, publicação do Realtime) e as
migrações, e apaga o banco no final.

```bash
# exemplo com Docker
docker run -d --name upum-pg -e POSTGRES_PASSWORD=postgres -p 54329:5432 postgres:16
TEST_DATABASE_URL=postgres://postgres:postgres@127.0.0.1:54329/postgres npm run test:db
```

Sem `TEST_DATABASE_URL`, o padrão é `postgres://postgres@127.0.0.1:54329/postgres`.

A passagem do tempo é simulada adiantando `phase_ends_at` / `last_seen_at`, e a concorrência é testada
com conexões simultâneas de verdade.

## Lista obrigatória da especificação (§ 52)

| Item | Onde |
| --- | --- |
| **Palpite:** título correto/incorreto, trecho correto/incorreto, título sem a palavra, trecho que contém a palavra, acentuação, maiúsculas/minúsculas, vários resultados, nenhum resultado | `supabase/functions/_shared/music/musicSearchService.test.ts` |
| **Ordem:** 2 e 3 jogadores simultâneos, primeiro palpite correto/incorreto | `supabase/tests/game.test.mjs` → “ordem dos palpites” |
| **Rodadas:** acertada, errada + nova tentativa, errada + nova palavra, pulada sem tentativa, com tentativa e pulada, contador | `game.test.mjs` → “contagem de rodadas” e `src/game/local/reducer.test.ts` |
| **Votação:** maioria, empate, ninguém escolhe | `game.test.mjs` → “votação” |
| **Finalização:** maioria, jogador ignorando, número par, host pedindo | `game.test.mjs` → “finalizar jogo” |
| **Host:** host sai, novo host, novo host sai, entrada durante a partida | `game.test.mjs` → “host” |
| **Conexão:** desconecta, reconecta, host desconecta, vários desconectam | `game.test.mjs` → “conexão” |

Também há testes de segurança (RLS, funções internas, palpite forjado) e de esgotamento do banco de
palavras.

## Teste de ponta a ponta (manual)

Com o backend local (`npx supabase start`, ver [CONFIGURACAO.md](CONFIGURACAO.md)) e
`MUSIC_PROVIDER=mock`, abra o app em dois navegadores/aparelhos, crie uma sala em um e entre pelo código
no outro. O catálogo fictício reconhece, por exemplo: AMOR → “Amor Colorido”, TRANSFORMAR → “Vejo
enfim a luz brilhar”, CASA → “Casa Vazia”, MAR → “Saudade”, CORAÇÃO → “Coração de Papel”.
