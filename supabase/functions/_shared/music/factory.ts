/**
 * Monta o MusicSearchService a partir das variáveis de ambiente da Edge Function.
 *
 *   MUSIC_PROVIDER        "musixmatch" (padrão) ou "mock" (catálogo fictício para testes)
 *   MUSIXMATCH_API_KEY    chave do Musixmatch (obrigatória com "musixmatch")
 *   ANTHROPIC_API_KEY     opcional: liga a IA como segunda camada em casos ambíguos
 *   AI_DISAMBIGUATION     "off" desliga a IA mesmo com a chave configurada
 *   AI_MODEL              opcional: modelo usado na desambiguação
 *
 * Para trocar de fonte no futuro, basta criar outro MusicProvider e escolhê-lo aqui.
 */
import { AnthropicDisambiguator } from './ai/anthropicDisambiguator.ts';
import { MusicSearchService } from './musicSearchService.ts';
import { MockMusicProvider } from './providers/mock.ts';
import { MusixmatchProvider } from './providers/musixmatch.ts';
import type { Disambiguator, MusicProvider } from './types.ts';

type Env = { get(key: string): string | undefined };

export function createMusicSearchService(env: Env): MusicSearchService {
  const providerName = (env.get('MUSIC_PROVIDER') ?? 'musixmatch').toLowerCase();
  const provider: MusicProvider =
    providerName === 'mock'
      ? new MockMusicProvider()
      : new MusixmatchProvider({ apiKey: env.get('MUSIXMATCH_API_KEY') ?? '' });

  let disambiguator: Disambiguator | null = null;
  const anthropicKey = env.get('ANTHROPIC_API_KEY');
  if (anthropicKey && env.get('AI_DISAMBIGUATION') !== 'off') {
    disambiguator = new AnthropicDisambiguator({ apiKey: anthropicKey, model: env.get('AI_MODEL') || undefined });
  }

  return new MusicSearchService(provider, { disambiguator });
}
