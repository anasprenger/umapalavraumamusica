/**
 * Acesso aos recursos do Claude quando o jogo roda como artefato publicado
 * (`window.claude.use`). Só os pedaços usados pelo jogo estão tipados aqui.
 */

export type DbFailure = { code?: string; message?: string };

export type DocSnapshot = {
  id: string;
  exists: boolean;
  data(): Record<string, unknown> | undefined;
};

export type DocRef = {
  get(): Promise<DocSnapshot>;
  set(data: Record<string, unknown>): Promise<void>;
  acquire(options: { holder: string; ttlMs?: number }): Promise<{ acquired: boolean; expiresAt?: string }>;
  onSnapshot(next: (snap: DocSnapshot) => void, error?: (e: DbFailure) => void): () => void;
};

export type CollectionRef = {
  get(): Promise<{ docs: DocSnapshot[] }>;
  onSnapshot(next: (snap: { docs: DocSnapshot[] }) => void, error?: (e: DbFailure) => void): () => void;
};

export type ArtifactDb = {
  doc(path: string): DocRef;
  collection(path: string): CollectionRef;
};

export type ArtifactUser = {
  id(): Promise<string | null>;
  can(capability: string): Promise<boolean | null>;
};

export type RoomPeer = {
  by: string | null;
  presence: Readonly<Record<string, unknown>>;
};

export type NamedRoom = {
  presence(patch: Record<string, unknown>): Promise<void>;
  peers(): readonly RoomPeer[];
  onPeers(handler: () => void, onError?: (e: DbFailure) => void): () => void;
  connected(): boolean;
  onConnection(handler: (connected: boolean) => void, onError?: (e: DbFailure) => void): () => void;
  leave(): Promise<void>;
};

export type ArtifactRoom = { join(name: string): Promise<NamedRoom> };

export type SampleFailure = { code?: string; message?: string };

type SampleOptions = { modelTier?: 'quick' | 'default' | 'complex' };

/** `sample(texto)` pede uma resposta ao Claude; `json` já devolve o JSON lido (pode faltar em apps antigos). */
export type ArtifactSample = ((input: string, options?: SampleOptions) => Promise<{ text: string }>) & {
  json?: <T = unknown>(input: string, options?: SampleOptions) => Promise<T>;
};

export type PermissionState = 'granted' | 'prompt' | 'denied' | 'unavailable';

export type ArtifactPermissions = {
  state(name: string): Promise<PermissionState>;
  request(names?: readonly string[]): Promise<Record<string, PermissionState>>;
};

export type ArtifactRuntime = {
  db: ArtifactDb;
  userId: string;
  room: ArtifactRoom | null;
  sample: ArtifactSample | null;
  permissions: ArtifactPermissions | null;
};

/** `null`: o app não está dentro do Claude. Caso contrário, o ambiente pronto ou o motivo de não estar. */
export type ArtifactProbe = { runtime: ArtifactRuntime } | { unavailable: 'claude_unavailable' | 'no_identity' | 'no_write_access' };

type ClaudeHost = { use(name: string): Promise<unknown> };

function claudeHost(): ClaudeHost | null {
  if (typeof window === 'undefined') return null;
  const host = (window as unknown as { claude?: Partial<ClaudeHost> }).claude;
  return host && typeof host.use === 'function' ? (host as ClaudeHost) : null;
}

export async function loadArtifactRuntime(): Promise<ArtifactProbe | null> {
  const host = claudeHost();
  if (!host) return null;
  const capability = <T>(name: string) => host.use(name).then((value) => (value ?? null) as T | null, () => null);
  const [db, user, room, sample, permissions] = await Promise.all([
    capability<ArtifactDb>('db'),
    capability<ArtifactUser>('user'),
    capability<ArtifactRoom>('room'),
    capability<ArtifactSample>('sample'),
    capability<ArtifactPermissions>('permissions'),
  ]);
  if (!db || !user) return { unavailable: 'claude_unavailable' };
  const userId = await user.id().catch(() => null);
  if (!userId) return { unavailable: 'no_identity' };
  // `null` = o Claude não informou; nesse caso deixa tentar e a gravação recusada decide.
  const canWrite = await user.can('data.write').catch(() => null);
  if (canWrite === false) return { unavailable: 'no_write_access' };
  return { runtime: { db, userId, room, sample, permissions } };
}
