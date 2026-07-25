// Autenticação do canal de config remota completa (ver conn-cfg.cpp/
// cfgchannel.cpp no firmware) — prova de posse do mqtt.cfgsecret configurado
// localmente no firmware (Config → mqtt via HTTP na LAN), sem nunca colocar
// o segredo em si no wire. Web Crypto (SubtleCrypto) só existe em contexto
// seguro (https/localhost).

export function randomReqId(): string {
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0')
}

// HMAC-SHA256(cfgsecret, reqId+"|"+changesJson) truncado a 16 hex (8 bytes).
export async function computeCfgAuth(secret: string, reqId: string, changesJson: string): Promise<string> {
  const enc = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(`${reqId}|${changesJson}`))
  return [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join('').slice(0, 16)
}
