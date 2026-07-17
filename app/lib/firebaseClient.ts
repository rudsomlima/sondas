/**
 * Canal Firebase (Realtime Database) do "meu receptor" — o firmware não fala
 * Firebase (o toolchain ESP32 deste fork não tem cliente TLS disponível, ver
 * useFirmwareConfig.ts); em vez disso o Realtime Database é um ESPELHO:
 * qualquer navegador com uma sessão MQTT ativa grava aqui depois de ler/
 * gravar a config de verdade via MQTT, e outras abas/dispositivos que
 * escolherem o canal Firebase só leem esse espelho (listener nativo do SDK,
 * tempo real de verdade, sem manter a própria conexão MQTT). Modelo de
 * confiança igual ao canal MQTT (broker público, sem auth): as regras do
 * Realtime Database liberam leitura/escrita em `/receivers/{deviceId}` pra
 * qualquer um que já saiba o deviceId (derivado de mqtt.prefix via
 * receiverKey()) — mas gravar aqui só atualiza o que É EXIBIDO, nunca o
 * receptor de verdade (só MQTT alcança o firmware).
 *
 * Módulo client-only (import dinâmico dentro de useFirmwareConfig) pra não
 * inflar o bundle de páginas que não usam o canal Firebase.
 */
import { initializeApp, getApps, type FirebaseApp } from 'firebase/app'
import { getDatabase, type Database } from 'firebase/database'

let app: FirebaseApp | null = null
let db: Database | null = null

export function getFirebaseDb(): Database {
  if (db) return db
  const config = {
    apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
    authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
    databaseURL: process.env.NEXT_PUBLIC_FIREBASE_DATABASE_URL,
    projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
  }
  if (!config.databaseURL) {
    throw new Error('Firebase não configurado (NEXT_PUBLIC_FIREBASE_DATABASE_URL ausente).')
  }
  app = getApps()[0] ?? initializeApp(config)
  db = getDatabase(app)
  return db
}
