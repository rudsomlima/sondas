import { NextRequest, NextResponse } from 'next/server'

/**
 * API para gerenciar cache de dados históricos
 * GET  /api/cache?action=status
 * POST /api/cache?action=clear&year=2026&month=6
 * POST /api/cache?action=clear&year=2026 (limpa ano inteiro)
 */

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action') ?? 'status'

  if (action === 'status') {
    return NextResponse.json({
      message: 'Cache API online',
      actions: [
        'GET  /api/cache?action=status',
        'POST /api/cache?action=clear&year=2026&month=6 (limpa mês)',
        'POST /api/cache?action=clear&year=2026 (limpa ano)',
      ],
      note: 'Dados são persistidos via localStorage no cliente',
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}

export async function POST(request: NextRequest) {
  const { searchParams } = new URL(request.url)
  const action = searchParams.get('action')

  if (action === 'clear') {
    const year = searchParams.get('year')
    const month = searchParams.get('month')

    if (!year) {
      return NextResponse.json({ error: 'Parâmetro year é obrigatório' }, { status: 400 })
    }

    // A lógica real de exclusão é feita no cliente via localStorage
    // Este endpoint apenas confirma a ação
    return NextResponse.json({
      success: true,
      action: 'clear',
      year: parseInt(year),
      month: month ? parseInt(month) : null,
      message: month
        ? `Cache para ${month}/${year} será limpo no cliente`
        : `Cache para ${year} será limpo no cliente`,
    })
  }

  return NextResponse.json({ error: 'Unknown action' }, { status: 400 })
}
