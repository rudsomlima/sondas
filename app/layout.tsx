import './globals.css'
import type { Metadata, Viewport } from 'next'
import Shell from './components/Shell'

export const metadata: Metadata = {
  title: 'Sondas · Mission Control',
  description: 'Monitoramento de radiossondagens — estações da América do Sul',
}

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="pt-BR">
      <body className="min-h-screen">
        <Shell>{children}</Shell>
      </body>
    </html>
  )
}
