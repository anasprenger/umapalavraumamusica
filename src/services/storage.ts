import AsyncStorage from '@react-native-async-storage/async-storage';

const KEYS = {
  localGame: 'upum:local-game:v1',
  profileName: 'upum:profile-name',
  lastRoom: 'upum:last-room',
} as const;

async function readJson<T>(key: string): Promise<T | null> {
  try {
    const raw = await AsyncStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

async function writeJson(key: string, value: unknown): Promise<void> {
  try {
    if (value === null || value === undefined) await AsyncStorage.removeItem(key);
    else await AsyncStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Persistência é apenas uma conveniência; falhas não devem interromper o jogo.
  }
}

export const storage = {
  loadLocalGame: <T>() => readJson<T>(KEYS.localGame),
  saveLocalGame: (state: unknown) => writeJson(KEYS.localGame, state),

  loadProfileName: () => readJson<string>(KEYS.profileName),
  saveProfileName: (name: string) => writeJson(KEYS.profileName, name),

  /** Última sala online, para oferecer "Voltar para a sala" após fechar o app. */
  loadLastRoom: () => readJson<{ code: string; savedAt: number }>(KEYS.lastRoom),
  saveLastRoom: (code: string | null) => writeJson(KEYS.lastRoom, code ? { code, savedAt: Date.now() } : null),
};
