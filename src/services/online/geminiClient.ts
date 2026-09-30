import { getAI, getGenerativeModel, GoogleAIBackend, type GenerativeModel } from 'firebase/ai';

import { geminiModel, getFirebase, usesFirebaseEmulator } from '../firebase';
import { type Grounding, readGrounding } from './geminiJudge';

export type GeminiAnswer = { text: string; grounding: Grounding };

type TestGemini = (prompt: string) => Promise<GeminiAnswer>;

let model: GenerativeModel | null = null;

/**
 * Pergunta ao Gemini (Firebase AI Logic, plano gratuito "Gemini Developer API") com a busca
 * do Google ligada. Nos testes com os emuladores, uma resposta simulada pode substituir o Gemini.
 */
export async function askGemini(prompt: string): Promise<GeminiAnswer> {
  const fake = (globalThis as { __UPUM_TEST_GEMINI__?: TestGemini }).__UPUM_TEST_GEMINI__;
  if (usesFirebaseEmulator && typeof fake === 'function') return fake(prompt);

  model ??= getGenerativeModel(getAI(getFirebase().app, { backend: new GoogleAIBackend() }), {
    model: geminiModel,
    tools: [{ googleSearch: {} }],
  });
  const result = await model.generateContent(prompt);
  const response = result.response;
  return { text: response.text(), grounding: readGrounding(response.candidates?.[0]?.groundingMetadata) };
}
