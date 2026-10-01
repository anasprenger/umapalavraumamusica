import { Redirect } from 'expo-router';

/** Endereço desconhecido (ex.: jogo aberto por outro caminho): volta para a tela inicial. */
export default function NotFound() {
  return <Redirect href="/" />;
}
