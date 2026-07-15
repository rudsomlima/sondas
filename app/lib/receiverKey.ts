/**
 * Converte o mqtt.prefix de um receptor em uma chave segura para uso em
 * localStorage e em caminhos do R2. Exemplos:
 *   "home/rdz01/"  → "home_rdz01"
 *   "pu7iol"       → "pu7iol"
 *   ""             → "default"
 */
export function receiverKey(prefix: string): string {
  const k = prefix.trim().replace(/[^a-zA-Z0-9]+/g, '_').replace(/^_|_$/g, '')
  return k || 'default'
}
