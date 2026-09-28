# Uma Palavra, Uma Música — guia para agentes

App Expo (SDK 57, Expo Router, React 19, React Compiler) + backend Supabase. Interface e comentários
em português do Brasil. Leia `docs/ARQUITETURA.md` antes de mexer nas regras do jogo.

## Comandos

```bash
npm test                 # vitest: modo local, utils, MusicSearchService
npm run test:db          # regras online num Postgres real (TEST_DATABASE_URL, ver docs/TESTES.md)
npm run check:functions  # deno check da Edge Function
npm run typecheck && npm run lint
npx expo install <pkg>   # sempre use para dependências nativas (versões compatíveis com o SDK)
```

Rode typecheck, lint e os testes relevantes antes de concluir uma tarefa.

## Onde fica cada coisa

- `src/app/` só tem rotas finas; telas em `src/screens/`, componentes reutilizáveis em `src/components/`
  (exportados por `src/components/index.ts`), tokens visuais em `src/theme/`.
- Modo local: reducer puro em `src/game/local/reducer.ts` (as palavras sorteadas chegam nas ações).
- Modo online: o servidor decide tudo. Regras em `supabase/migrations/*_game_functions.sql`; o app usa
  `src/services/onlineApi.ts` e `src/hooks/useOnlineRoom.ts`.
- Busca musical: `supabase/functions/_shared/music/` (`MusicSearchService` + provedores). Nunca coloque
  chaves secretas no app; só `EXPO_PUBLIC_SUPABASE_URL` e a chave anon.

## Regras que não podem quebrar

- Palavra exibida ≠ rodada contabilizada: só conta com palpite **verificado**, e uma única vez.
- O primeiro palpite é decidido no banco (trava na linha da sala); nunca no cliente.
- Mudou uma regra online? Crie uma **nova** migração (não edite migrações já aplicadas em produção) e
  cubra o caso em `supabase/tests/game.test.mjs`.
- Mensagens técnicas nunca aparecem para o jogador (`OnlineError` traduz os códigos).
- Reanimated com React Compiler: use `sharedValue.get()/set()`; não chame `setState` direto no corpo de
  efeitos (o ESLint acusa).
