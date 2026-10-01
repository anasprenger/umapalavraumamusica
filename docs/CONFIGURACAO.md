# Configuração e publicação

O modo local funciona sem nenhuma configuração. Este guia prepara o **modo online**.

## 1. Criar o projeto Supabase

1. Crie um projeto em [supabase.com](https://supabase.com).
2. Em **Authentication → Sign In / Providers**, ative **Allow anonymous sign-ins** (o app usa login
   anônimo: cada aparelho ganha uma identidade estável, sem cadastro).
3. Anote, em **Project Settings → API**, a **Project URL** e a chave **anon** (ou *publishable*). Essas
   duas são públicas e vão no app. As chaves secretas nunca vão no app.

## 2. Banco de dados (migrações)

Com a [Supabase CLI](https://supabase.com/docs/guides/cli):

```bash
npx supabase login
npx supabase link --project-ref SEU_PROJECT_REF
npx supabase db push          # aplica supabase/migrations (tabelas, RLS, regras e banco de palavras)
```

Sem a CLI, dá para colar o conteúdo dos arquivos de `supabase/migrations/`, em ordem, no **SQL Editor**.

As migrações já adicionam `rooms` e `players` à publicação do Realtime (`supabase_realtime`).

## 3. Edge Function `submit-guess`

```bash
npx supabase functions deploy submit-guess --no-verify-jwt
npx supabase secrets set MUSIXMATCH_API_KEY=sua_chave_do_musixmatch
```

- `--no-verify-jwt`: a função valida o token do jogador internamente (`auth.getUser`), o que funciona
  tanto com as chaves JWT antigas quanto com as novas.
- `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` já existem automaticamente nas Edge Functions.

Variáveis opcionais (`npx supabase secrets set NOME=valor`):

| Variável | Uso |
| --- | --- |
| `MUSIC_PROVIDER` | `musixmatch` (padrão) ou `mock` — catálogo fictício para testar sem chave |
| `ANTHROPIC_API_KEY` | Liga a IA como **segunda camada** apenas em casos ambíguos |
| `AI_DISAMBIGUATION` | `off` desliga a IA mesmo com a chave configurada |
| `AI_MODEL` | Modelo da IA (padrão `claude-opus-5-5`) |

Sobre a IA: ela só recebe músicas **reais** encontradas pela fonte musical e responde qual corresponde
ao palpite (ou nenhuma). Usa esforço baixo e, se o modelo recusar a tarefa, o próprio serviço tenta o
modelo de reserva recomendado (`fallbacks: "default"`). Sem a chave, o jogo funciona normalmente.

### Musixmatch

Crie uma conta de desenvolvedor em [developer.musixmatch.com](https://developer.musixmatch.com).
Pontos de atenção:

- O **plano gratuito** devolve apenas parte da letra (~30%) e é para uso **não comercial**. O app
  compensa confirmando a palavra pela busca por letra do Musixmatch, mas o trecho em destaque só aparece
  quando a palavra está na parte recebida. Para publicar comercialmente, use um plano pago.
- Cada palpite faz até ~11 chamadas (3 buscas + letras dos candidatos). Considere o limite diário do plano.
- Para trocar de fonte no futuro, implemente `MusicProvider` e selecione-o em
  `supabase/functions/_shared/music/factory.ts`.

## 4. Configurar o app

```bash
cp .env.example .env
# edite .env:
# EXPO_PUBLIC_SUPABASE_URL=https://SEU-PROJETO.supabase.co
# EXPO_PUBLIC_SUPABASE_ANON_KEY=sua-anon-key
npx expo start
```

O app funciona no **Expo Go** (todas as bibliotecas usadas estão incluídas nele), no simulador e na web.

## 5. Banco de palavras

- **Pelo painel:** tabela `words` no Table Editor (coluna `active` desativa uma palavra sem apagar).
- **Pelo código:** edite `src/data/words.pt-BR.json` (também usado no modo local) e gere o SQL:
  `npm run words:sql -- --out supabase/migrations/<data>_mais_palavras.sql`, depois `npx supabase db push`.

A comparação ignora acentos e caixa: “coração” e “coracao” são a mesma palavra e nunca se repetem na
mesma partida.

## 6. Publicar

- **Android/iOS:** [EAS Build](https://docs.expo.dev/build/introduction/) — `npx eas-cli@latest build
  --profile production --platform android` (ou `ios`). O `eas.json` já tem os perfis `preview` e
  `production`. Configure as variáveis `EXPO_PUBLIC_*` no EAS (**Environment variables**) ou no `.env`.
- **Web:** `npx expo export --platform web` gera `dist/` (site estático, pronto para qualquer hospedagem).
- **Ícones:** `assets/icon/icon.svg` é a fonte; `npm install --no-save sharp && npm run icons` regenera os PNGs.

## 7. Desenvolvimento local do backend (opcional)

Com Docker, `npx supabase start` sobe Postgres, Auth, Realtime e Edge Functions usando
`supabase/config.toml` (login anônimo já habilitado). Depois:

```bash
npx supabase db reset                                   # aplica as migrações
npx supabase functions serve submit-guess --no-verify-jwt --env-file supabase/functions/.env
```

Para jogar sem chave do Musixmatch, coloque `MUSIC_PROVIDER=mock` em `supabase/functions/.env`
(catálogo fictício em `_shared/music/providers/mock.ts`).
