/**
 * Formato do estado da partida devolvido por `get_room_state` (Supabase).
 * O servidor é a fonte oficial; o app apenas exibe.
 */
export type RoomStatus =
  | 'waiting'
  | 'starting'
  | 'playing'
  | 'verifying'
  | 'correct'
  | 'countdown'
  | 'incorrect'
  | 'decision'
  | 'finished';

export type EndReason = 'rounds_completed' | 'majority_finish' | 'host_ended' | 'words_exhausted' | 'abandoned';

export type VoteChoice = 'new_guess' | 'new_word';

export type OnlinePlayer = {
  id: string;
  name: string;
  score: number;
  join_order: number;
  is_active: boolean;
  /** `left`: saiu por conta própria; `timeout`: perdeu a conexão. */
  left_reason: 'left' | 'timeout' | null;
  is_host: boolean;
};

export type OnlineRoom = {
  id: string;
  code: string;
  status: RoomStatus;
  phase_ends_at: string | null;
  configured_rounds: number;
  rounds_played: number;
  host_player_id: string | null;
  decision_origin: 'incorrect_guess' | 'skip_request' | null;
  decision_number: number;
  end_reason: EndReason | null;
  state_version: number;
  started_at: string | null;
  ended_at: string | null;
  is_last_round: boolean;
  final_round_prompt: boolean;
};

export type CurrentWord = {
  id: string;
  sequence: number;
  word: string;
  status: 'active' | 'won' | 'discarded';
  has_attempt: boolean;
  round_number: number | null;
  display_round: number;
  winner_player_id: string | null;
};

export type ActiveGuess = {
  id: string;
  player_id: string;
  player_name: string;
  text: string;
  submitted_at: string;
};

export type GuessResult = {
  id: string;
  player_id: string;
  player_name: string;
  text: string;
  status: 'correct' | 'incorrect' | 'error';
  result_song: string | null;
  result_artist: string | null;
  matched_excerpt: string | null;
  matched_word: string | null;
  failure_reason: string | null;
  verified_at: string | null;
};

export type RoomSnapshot = {
  kicked: false;
  server_time: string;
  me: { player_id: string; is_host: boolean; is_active: boolean; left_reason: string | null };
  room: OnlineRoom;
  players: OnlinePlayer[];
  active_players: number;
  current_word: CurrentWord | null;
  active_guess: ActiveGuess | null;
  last_result: GuessResult | null;
  votes: { new_guess: number; new_word: number; my_choice: VoteChoice | null };
  finish: { count: number; needed: number; i_requested: boolean; requested_by: string[] };
};

export type KickedSnapshot = {
  kicked: true;
  server_time: string;
  room: { id: string; code: string };
};

export type RoomStateResponse = RoomSnapshot | KickedSnapshot;

export type JoinResult = { room_id: string; code: string; player_id: string };

export type SubmitGuessResult =
  | { accepted: true; guessId: string }
  | { accepted: false; reason: 'busy' | 'not_accepting' | string };
