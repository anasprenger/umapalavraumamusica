/**
 * Edge Function: submit-guess
 *
 * Único caminho para enviar um palpite no modo online:
 *   1. Autentica o jogador pelo token da sessão (login anônimo do Supabase).
 *   2. Chama `submit_guess` no banco, que decide — com trava na sala — se este é o
 *      PRIMEIRO palpite. Os demais recebem `accepted: false` e são descartados.
 *   3. Responde na hora ao aparelho e, em segundo plano, consulta a fonte musical
 *      pelo MusicSearchService e grava o resultado com `resolve_guess`.
 *
 * Todos os aparelhos acompanham o resultado pelo Realtime. Erros técnicos da API
 * musical ficam só nos logs; o jogo apenas volta a aceitar palpites.
 */
import { createClient, type SupabaseClient } from 'npm:@supabase/supabase-js@2.117.2';

import { corsHeaders, json } from '../_shared/cors.ts';
import { createMusicSearchService } from '../_shared/music/factory.ts';
import type { MusicSearchService } from '../_shared/music/musicSearchService.ts';
import type { MusicVerificationResult } from '../_shared/music/types.ts';

/** Tempo mínimo da tela "Música de Ana em verificação..." (mesmo se a API responder rápido). */
const MIN_VERIFY_MS = 1500;
/** Limite da consulta musical; o banco também expira a verificação após 25 s. */
const VERIFY_TIMEOUT_MS = 18_000;

type Claim = {
  accepted: boolean;
  reason?: string;
  guess_id?: string;
  word?: string;
  player_name?: string;
};

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;

// Criado sob demanda: se faltar configuração (ex.: chave do Musixmatch), o erro cai no fluxo
// normal de "não foi possível verificar" em vez de derrubar a função.
let music: MusicSearchService | null = null;
function musicService(): MusicSearchService {
  music ??= createMusicSearchService(Deno.env);
  return music;
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, ms)));
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error(`timeout após ${ms} ms`)), ms)),
  ]);
}

async function resolveGuess(admin: SupabaseClient, guessId: string, outcome: string, details: Record<string, unknown>) {
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const { error } = await admin.rpc('resolve_guess', { p_guess_id: guessId, p_outcome: outcome, p_details: details });
    if (!error) return;
    console.error(`[submit-guess] resolve_guess falhou (tentativa ${attempt})`, error);
    await sleep(400 * attempt);
  }
}

function toDetails(result: MusicVerificationResult): { outcome: 'correct' | 'incorrect'; details: Record<string, unknown> } {
  if (result.found) {
    return {
      outcome: 'correct',
      details: {
        title: result.title,
        artist: result.artist,
        excerpt: result.matchedExcerpt,
        matchedWord: result.matchedWord,
        confidence: result.confidence,
        provider: result.provider + (result.decidedBy === 'ai' ? '+ai' : ''),
        trackId: result.trackId,
      },
    };
  }
  return {
    outcome: 'incorrect',
    details: { reason: result.reason, title: result.title ?? null, artist: result.artist ?? null },
  };
}

async function verifyAndResolve(admin: SupabaseClient, claim: Required<Pick<Claim, 'guess_id' | 'word'>>, text: string) {
  const startedAt = Date.now();
  try {
    const result = await withTimeout(musicService().verify({ guess: text, targetWord: claim.word }), VERIFY_TIMEOUT_MS);
    await sleep(MIN_VERIFY_MS - (Date.now() - startedAt));
    const { outcome, details } = toDetails(result);
    await resolveGuess(admin, claim.guess_id, outcome, details);
  } catch (error) {
    // Mensagem técnica apenas no log; o jogador vê "não foi possível verificar agora".
    console.error('[submit-guess] verificação indisponível', error);
    await sleep(MIN_VERIFY_MS - (Date.now() - startedAt));
    await resolveGuess(admin, claim.guess_id, 'error', { reason: 'provider_unavailable' });
  }
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });
  if (request.method !== 'POST') return json({ error: 'method_not_allowed' }, 405);

  const supabaseUrl = Deno.env.get('SUPABASE_URL');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? Deno.env.get('SERVICE_ROLE_KEY');
  if (!supabaseUrl || !serviceKey) {
    console.error('[submit-guess] SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY ausentes');
    return json({ error: 'server_misconfigured' }, 500);
  }

  const token = (request.headers.get('Authorization') ?? '').replace(/^Bearer\s+/i, '');
  const admin = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data: userData, error: authError } = await admin.auth.getUser(token);
  if (authError || !userData?.user) return json({ error: 'not_authenticated' }, 401);

  let body: { roomId?: unknown; text?: unknown };
  try {
    body = await request.json();
  } catch {
    return json({ error: 'invalid_request' }, 400);
  }
  const roomId = typeof body.roomId === 'string' ? body.roomId : '';
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!roomId || !text || text.length > 200) return json({ error: 'invalid_guess' }, 400);

  // A ordem dos palpites é decidida aqui, no banco, com trava na sala.
  const { data, error } = await admin.rpc('submit_guess', {
    p_user_id: userData.user.id,
    p_room_id: roomId,
    p_text: text,
  });
  if (error) {
    // Erros de regra (P0001) têm um código estável na mensagem (ex.: not_in_room).
    const code = error.code === 'P0001' ? error.message : 'server_error';
    if (code === 'server_error') console.error('[submit-guess] submit_guess falhou', error);
    return json({ error: code }, code === 'server_error' ? 500 : 400);
  }

  const claim = data as Claim;
  if (!claim.accepted || !claim.guess_id || !claim.word) {
    return json({ accepted: false, reason: claim.reason ?? 'not_accepting' });
  }

  const work = verifyAndResolve(admin, { guess_id: claim.guess_id, word: claim.word }, text);
  if (typeof EdgeRuntime !== 'undefined' && EdgeRuntime?.waitUntil) {
    EdgeRuntime.waitUntil(work);
  } else {
    await work;
  }
  return json({ accepted: true, guessId: claim.guess_id });
});
