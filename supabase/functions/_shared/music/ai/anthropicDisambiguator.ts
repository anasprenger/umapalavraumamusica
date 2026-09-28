/**
 * Segunda camada OPCIONAL: usa o Claude para escolher, entre candidatos REAIS
 * devolvidos pela fonte musical, qual corresponde ao palpite.
 *
 * - Só é chamada quando as regras encontram possibilidades, mas nenhuma clara.
 * - Nunca inventa músicas: responde apenas o índice de um candidato ou -1.
 * - Fica desligada se ANTHROPIC_API_KEY não estiver configurada; o jogo funciona sem ela.
 */
import Anthropic from 'npm:@anthropic-ai/sdk@0.128.0';
import { betaZodOutputFormat } from 'npm:@anthropic-ai/sdk@0.128.0/helpers/beta/zod';
import { z } from 'npm:zod@4.6.5';

import type { DisambiguationCandidate, Disambiguator } from '../types.ts';

const Choice = z.object({
  /** Índice do candidato escolhido, ou -1 se nenhum corresponder ao palpite. */
  index: z.number().int(),
});

const SYSTEM = `Você ajuda a arbitrar um jogo musical brasileiro.
Um jogador recebeu uma palavra e digitou um palpite (nome de música, trecho de letra ou os dois).
Você recebe uma lista de músicas REAIS encontradas em um catálogo, cada uma com um índice.
Responda com o índice da música que o palpite claramente identifica.
Responda -1 se nenhuma corresponder com clareza. Nunca considere músicas fora da lista.`;

export type AnthropicDisambiguatorOptions = {
  apiKey: string;
  model?: string;
  timeoutMs?: number;
};

export class AnthropicDisambiguator implements Disambiguator {
  private readonly client: Anthropic;
  private readonly model: string;

  constructor({ apiKey, model, timeoutMs }: AnthropicDisambiguatorOptions) {
    this.client = new Anthropic({ apiKey, timeout: timeoutMs ?? 12_000, maxRetries: 1 });
    this.model = model ?? 'claude-opus-5-5';
  }

  async choose(input: {
    guess: string;
    targetWord: string;
    candidates: DisambiguationCandidate[];
  }): Promise<number | null> {
    const list = input.candidates
      .map((candidate, index) => {
        const excerpt = candidate.excerpt ? ` — trecho: "${candidate.excerpt}"` : '';
        return `${index}. "${candidate.title}" — ${candidate.artist}${excerpt}`;
      })
      .join('\n');

    const message = await this.client.beta.messages.parse({
      model: this.model,
      max_tokens: 4000,
      // Se o modelo recusar por política, a própria API tenta o modelo de reserva recomendado.
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
      // Tarefa simples de classificação: esforço baixo mantém custo e tempo pequenos.
      output_config: { effort: 'low', format: betaZodOutputFormat(Choice) },
      system: SYSTEM,
      messages: [
        {
          role: 'user',
          content: `Palavra da rodada: ${input.targetWord}\nPalpite do jogador: "${input.guess}"\n\nCandidatos:\n${list}`,
        },
      ],
    });

    if (message.stop_reason === 'refusal') return null;
    const index = message.parsed_output?.index;
    if (typeof index !== 'number' || index < 0 || index >= input.candidates.length) return null;
    return index;
  }
}
