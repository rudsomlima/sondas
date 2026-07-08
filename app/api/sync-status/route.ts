import { NextResponse } from 'next/server'
import { readSyncStatus } from '@/app/lib/blobStore'

// Status da última execução do cron radiosondy-sync (app/api/radiosondy-sync)
// — dá visibilidade dos "bastidores" da sincronização multi-fonte ao usuário
// (app/configuracoes/components/SyncStatusPanel.tsx).
export async function GET() {
  const configured = !!(process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY)
  if (!configured) {
    return NextResponse.json({ ok: true, configured: false, status: null })
  }
  const status = await readSyncStatus()
  return NextResponse.json({ ok: true, configured: true, status })
}
