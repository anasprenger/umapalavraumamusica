import 'react-native-url-polyfill/auto';

import AsyncStorage from '@react-native-async-storage/async-storage';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { AppState, Platform } from 'react-native';

/**
 * Cliente Supabase do app. Usa apenas a URL e a chave PÚBLICA (anon/publishable).
 * Chaves secretas (service role, Musixmatch, IA) ficam somente nas Edge Functions.
 */
const url = process.env.EXPO_PUBLIC_SUPABASE_URL;
const anonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

export const isOnlineConfigured = Boolean(url && anonKey);

export const supabase: SupabaseClient | null = isOnlineConfigured
  ? createClient(url as string, anonKey as string, {
      auth: {
        storage: AsyncStorage,
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: false,
      },
      realtime: { params: { eventsPerSecond: 20 } },
    })
  : null;

// Renova o token apenas com o app em primeiro plano (recomendação do Supabase para apps).
if (supabase && Platform.OS !== 'web') {
  AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });
}

let sessionPromise: Promise<string> | null = null;

/**
 * Garante uma sessão (login anônimo). A identidade fica salva no aparelho,
 * então ao reabrir o app o jogador volta como o MESMO participante da sala.
 */
export function ensureSession(): Promise<string> {
  if (!supabase) return Promise.reject(new Error('online_not_configured'));
  sessionPromise ??= (async () => {
    const { data } = await supabase.auth.getSession();
    if (data.session?.user) return data.session.user.id;
    const { data: signIn, error } = await supabase.auth.signInAnonymously();
    if (error || !signIn.user) throw error ?? new Error('auth_failed');
    return signIn.user.id;
  })().catch((error) => {
    sessionPromise = null;
    throw error;
  });
  return sessionPromise;
}
