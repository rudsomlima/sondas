'use client'

import './globals.css'
import { useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  Radio, History, Settings, Menu, X,
  Wind, ChevronRight, Satellite
} from 'lucide-react'

export default function RootLayout({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()

  const navItems = [
    { href: '/', icon: Radio, label: 'Hoje', desc: 'Status do lançamento atual' },
    { href: '/historico', icon: History, label: 'Histórico Anual', desc: 'Lançamentos por ano' },
    { href: '/configuracoes', icon: Settings, label: 'Configurações', desc: 'Período e estação' },
  ]

  return (
    <html lang="pt-BR">
      <head>
        <title>Sondas Natal · INMET 82599</title>
        <meta name="description" content="Monitoramento de radiossondagens da estação de Natal (82599)" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <link rel="icon" href="/favicon.ico" />
      </head>
      <body className="min-h-screen flex bg-[#111111]">

        {/* Mobile overlay */}
        {sidebarOpen && (
          <div
            className="fixed inset-0 bg-black/60 z-20 lg:hidden"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* Sidebar */}
        <aside className={`
          fixed top-0 left-0 h-full w-64 bg-[#111111] border-r border-[#2a2a2a] z-30
          flex flex-col transition-transform duration-200
          ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
          lg:translate-x-0 lg:static lg:flex
        `}>
          {/* Logo */}
          <div className="flex items-center gap-3 px-4 py-5 border-b border-[#2a2a2a]">
            <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center flex-shrink-0">
              <Satellite size={16} className="text-white" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white leading-tight">Sondas Natal</div>
              <div className="text-xs text-gray-500 mono">INMET · 82599</div>
            </div>
            <button
              onClick={() => setSidebarOpen(false)}
              className="ml-auto lg:hidden text-gray-500 hover:text-white"
            >
              <X size={18} />
            </button>
          </div>

          {/* Nav */}
          <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
            <p className="text-xs text-gray-600 uppercase tracking-wider px-3 mb-3 font-medium">
              Monitoramento
            </p>
            {navItems.map(({ href, icon: Icon, label, desc }) => {
              const active = pathname === href
              return (
                <Link
                  key={href}
                  href={href}
                  onClick={() => setSidebarOpen(false)}
                  className={`sidebar-link ${active ? 'active' : ''}`}
                >
                  <Icon size={16} />
                  <div className="flex-1 min-w-0">
                    <div className="font-medium">{label}</div>
                    <div className="text-xs text-gray-600 truncate">{desc}</div>
                  </div>
                  {active && <ChevronRight size={14} className="text-blue-400" />}
                </Link>
              )
            })}
          </nav>

          {/* Footer */}
          <div className="px-4 py-4 border-t border-[#2a2a2a]">
            <div className="flex items-center gap-2 text-xs text-gray-600">
              <Wind size={12} />
              <span>Dados: University of Wyoming</span>
            </div>
            <div className="text-xs text-gray-700 mt-1 mono">GMT-3 · Natal/RN</div>
          </div>
        </aside>

        {/* Main */}
        <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
          {/* Mobile topbar */}
          <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-[#2a2a2a] bg-[#111111] sticky top-0 z-10">
            <button
              onClick={() => setSidebarOpen(true)}
              className="text-gray-400 hover:text-white"
            >
              <Menu size={20} />
            </button>
            <div className="flex items-center gap-2">
              <Satellite size={16} className="text-blue-400" />
              <span className="text-sm font-semibold text-white">Sondas Natal</span>
            </div>
          </header>

          <main className="flex-1 overflow-auto">
            {children}
          </main>
        </div>
      </body>
    </html>
  )
}
