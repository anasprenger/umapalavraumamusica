/** Mensagens amigáveis para os códigos de erro do modo online. Nada técnico chega ao jogador. */
const FRIENDLY: Record<string, string> = {
  online_not_configured: 'O modo online ainda não foi configurado neste app.',
  auth_failed: 'Não foi possível conectar. Verifique a internet e tente de novo.',
  network: 'Sem conexão no momento. Tentando reconectar…',
  try_again: 'A sala está ocupada agora. Tente de novo em instantes.',
  room_not_found: 'Sala não encontrada. Confira o código.',
  room_full: 'A sala está cheia (máximo de 10 jogadores).',
  room_finished: 'Esta partida já terminou.',
  kicked: 'Você foi removido desta sala pelo host.',
  not_in_room: 'Você não está nesta sala.',
  not_active: 'Você não está ativo nesta sala. Entre novamente.',
  not_host: 'Apenas o host pode fazer isso.',
  not_enough_players: 'Ainda não há jogadores ativos suficientes para começar.',
  already_started: 'A partida já começou.',
  invalid_name: 'Digite seu nome.',
  invalid_rounds: 'Escolha uma quantidade de rodadas válida.',
  invalid_guess: 'Digite um palpite de até 200 caracteres.',
  vote_closed: 'A votação já terminou.',
  not_playing: 'Aguarde a próxima palavra.',
  not_in_game: 'A partida não está em andamento.',
  not_finished: 'A partida ainda não terminou.',
  cannot_kick_self: 'Você não pode remover a si mesmo.',
  player_not_found: 'Jogador não encontrado.',
  not_authenticated: 'Sua sessão expirou. Abra a sala novamente.',
  // Modo online dentro do Claude
  claude_unavailable: 'O modo online funciona quando o jogo é aberto pelo link do Claude, com a sua conta conectada.',
  no_identity: 'Entre na sua conta Claude para jogar online.',
  no_write_access: 'Seu acesso a este jogo é só de visualização. Peça a quem compartilhou para liberar a edição.',
  storage_full: 'O espaço de salas deste jogo acabou. Peça a quem compartilhou para criar uma cópia nova.',
  ai_unavailable: 'A verificação de músicas pelo Claude não está disponível para você agora.',
};

export class OnlineError extends Error {
  constructor(
    readonly code: string,
    readonly technical?: unknown,
  ) {
    super(FRIENDLY[code] ?? 'Algo deu errado. Tente novamente.');
    this.name = 'OnlineError';
  }
}

export function friendlyMessage(error: unknown): string {
  return error instanceof OnlineError ? error.message : 'Algo deu errado. Tente novamente.';
}

export function logTechnical(context: string, error: unknown) {
  if (__DEV__) console.warn(`[online] ${context}`, error);
}
