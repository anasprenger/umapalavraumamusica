import AsyncStorage from '@react-native-async-storage/async-storage';
import { type FirebaseApp, getApps, initializeApp } from 'firebase/app';
import {
  type Auth,
  connectAuthEmulator,
  getAuth,
  initializeAuth,
  type Persistence,
  signInAnonymously,
} from 'firebase/auth';
import * as firebaseAuth from 'firebase/auth';
import { connectFirestoreEmulator, type Firestore, initializeFirestore } from 'firebase/firestore';
import { Platform } from 'react-native';

/**
 * Projeto Firebase do modo online (Firestore para as salas, login anônimo e o Gemini pelo
 * Firebase AI Logic para verificar as músicas). A configuração web do Firebase é pública:
 * ela identifica o projeto, e quem protege os dados são as regras do Firestore.
 */
const PROJECT = {
  apiKey: 'AIzaSyA5hij-Oy4J2DsvqQ9GPHUgNkbufQ_WZXA',
  authDomain: 'uma-palavra-uma-musica-e3835.firebaseapp.com',
  projectId: 'uma-palavra-uma-musica-e3835',
  storageBucket: 'uma-palavra-uma-musica-e3835.firebasestorage.app',
  messagingSenderId: '153352294699',
  appId: '1:153352294699:web:70b24e4e4553743548f56e',
};

/**
 * Por padrão, o projeto Firebase do jogo. As variáveis EXPO_PUBLIC_FIREBASE_* trocam de projeto
 * (por exemplo, nos testes com os emuladores); EXPO_PUBLIC_ONLINE_BACKEND=supabase desliga o Firebase.
 */
const config = {
  apiKey: process.env.EXPO_PUBLIC_FIREBASE_API_KEY || PROJECT.apiKey,
  authDomain: process.env.EXPO_PUBLIC_FIREBASE_AUTH_DOMAIN || PROJECT.authDomain,
  projectId: process.env.EXPO_PUBLIC_FIREBASE_PROJECT_ID || PROJECT.projectId,
  storageBucket: process.env.EXPO_PUBLIC_FIREBASE_STORAGE_BUCKET || PROJECT.storageBucket,
  messagingSenderId: process.env.EXPO_PUBLIC_FIREBASE_MESSAGING_SENDER_ID || PROJECT.messagingSenderId,
  appId: process.env.EXPO_PUBLIC_FIREBASE_APP_ID || PROJECT.appId,
};

/** Só para testes locais: aponta para os emuladores do Firebase (ex.: 127.0.0.1). */
const emulatorHost = process.env.EXPO_PUBLIC_FIREBASE_EMULATOR_HOST;

export const isFirebaseConfigured =
  process.env.EXPO_PUBLIC_ONLINE_BACKEND !== 'supabase' && Boolean(config.apiKey && config.projectId && config.appId);
export const usesFirebaseEmulator = Boolean(emulatorHost);

/** Modelo do Gemini usado na verificação (os "Flash-Lite" têm a maior cota gratuita). */
export const geminiModel = process.env.EXPO_PUBLIC_GEMINI_MODEL || 'gemini-3.1-flash-lite';

type FirebaseServices = { app: FirebaseApp; auth: Auth; db: Firestore };

let services: FirebaseServices | null = null;

function createAuth(app: FirebaseApp): Auth {
  if (Platform.OS === 'web') return getAuth(app);
  // No celular, a identidade anônima fica salva no aparelho (mesmo jogador ao reabrir o app).
  // `getReactNativePersistence` só existe na versão do SDK para React Native (fora dos tipos da web).
  const rn = firebaseAuth as unknown as { getReactNativePersistence?: (storage: unknown) => Persistence };
  if (!rn.getReactNativePersistence) return getAuth(app);
  try {
    return initializeAuth(app, { persistence: rn.getReactNativePersistence(AsyncStorage) });
  } catch {
    return getAuth(app);
  }
}

export function getFirebase(): FirebaseServices {
  if (services) return services;
  if (!isFirebaseConfigured) throw new Error('online_not_configured');
  const app = getApps()[0] ?? initializeApp(config);
  const auth = createAuth(app);
  // Detecta redes que bloqueiam o canal de tempo real e troca por "long polling" sozinho.
  const db = initializeFirestore(app, { experimentalAutoDetectLongPolling: true, ignoreUndefinedProperties: true });
  if (emulatorHost) {
    connectAuthEmulator(auth, `http://${emulatorHost}:9099`, { disableWarnings: true });
    connectFirestoreEmulator(db, emulatorHost, 8080);
  }
  services = { app, auth, db };
  return services;
}

let signingIn: Promise<string> | null = null;

/**
 * Garante um login anônimo. A identidade fica salva no aparelho/navegador, então ao
 * reabrir o jogo a pessoa volta como o MESMO jogador da sala.
 */
export function ensureFirebaseUser(): Promise<string> {
  const { auth } = getFirebase();
  if (auth.currentUser) return Promise.resolve(auth.currentUser.uid);
  signingIn ??= (async () => {
    await auth.authStateReady();
    if (auth.currentUser) return auth.currentUser.uid;
    const credential = await signInAnonymously(auth);
    return credential.user.uid;
  })().finally(() => {
    signingIn = null;
  });
  return signingIn;
}
