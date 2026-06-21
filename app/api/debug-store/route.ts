import { NextRequest, NextResponse } from 'next/server'
import { readYearStore } from '@/app/lib/blobStore'

// Rota de debug temporária — remover depois de diagnosticar o problema de produção
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const year = parseInt(searchParams.get('year') ?? '2026')
  const store = await readYearStore(year)
  return NextResponse.json({
    hasBlobCredentials: !!(process.env.BLOB_READ_WRITE_TOKEN || process.env.BLOB_STORE_ID),
    store,
  })
}
