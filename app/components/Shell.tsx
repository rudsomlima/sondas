'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  History, Settings, Menu, X, LayoutDashboard, BarChart3,
  Wind, ChevronRight, Satellite, Antenna
} from 'lucide-react'
import { getSelectedStation, DEFAULT_STATION, Station } from '@/app/lib/stations'

// Shell da aplicação: sidebar (colapsável no mobile) + topbar mobile.
export default function Shell({ children }: { children: React.ReactNode }) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [station, setStation] = useState<Station>(DEFAULT_STATION)
  const pathname = usePathname()

  useEffect(() => {
    setStation(getSelectedStation())
    // Reflete troca de estação feita em outra página desta mesma aba.
    const onFocus = () => setStation(getSelectedStation())
    window.addEventListener('focus', onFocus)
    return () => window.removeEventListener('focus', onFocus)
  }, [pathname])

  const navItems = [
    { href: '/painel', icon: LayoutDashboard, label: 'Painel', desc: 'Mission control' },
    { href: '/historico', icon: History, label: 'Histórico Anual', desc: 'Lançamentos por ano' },
    { href: '/analytics', icon: BarChart3, label: 'Análises', desc: 'Métricas e mapas' },
    { href: '/meu-receptor', icon: Antenna, label: 'Meu Receptor', desc: 'Config. e energia do rdzsonde' },
    { href: '/configuracoes', icon: Settings, label: 'Configurações', desc: 'Estação e dados' },
  ]

  const shortName = station.name.split(',')[0]

  return (
    <div className="min-h-screen flex bg-bg">
      {/* Mobile overlay */}
      {sidebarOpen && (
        <div
          className="fixed inset-0 bg-black/60 z-20 lg:hidden"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar */}
      <aside className={`
        fixed top-0 left-0 h-full w-64 bg-bg border-r border-border z-30
        flex flex-col transition-transform duration-200
        ${sidebarOpen ? 'translate-x-0' : '-translate-x-full'}
        lg:translate-x-0 lg:static lg:flex
      `}>
        {/* Logo */}
        <div className="flex items-center gap-3 px-4 py-5 border-b border-border">
          <div className="w-8 h-8 bg-blue-600 rounded-md flex items-center justify-center flex-shrink-0">
            <Satellite size={16} className="text-white" />
          </div>
          <div className="min-w-0">
            <div className="text-sm font-semibold text-white leading-tight truncate">{shortName}</div>
            <div className="text-xs text-dim mono">STNM {station.id}</div>
          </div>
          <button
            onClick={() => setSidebarOpen(false)}
            className="ml-auto lg:hidden text-gray-400 hover:text-white"
          >
            <X size={18} />
          </button>
        </div>

        {/* Nav */}
        <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
          <p className="text-xs text-dim uppercase tracking-wider px-3 mb-3 font-medium">
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
                  <div className="text-xs text-dim truncate">{desc}</div>
                </div>
                {active && <ChevronRight size={14} className="text-blue-400" />}
              </Link>
            )
          })}
        </nav>

        {/* Footer */}
        <div className="px-4 py-4 border-t border-border">
          <div className="flex items-center gap-2 text-xs text-dim">
            <Wind size={12} />
            <span>Wyoming · radiosondy · SondeHub</span>
          </div>
          <div className="text-xs text-dim mt-1 mono">GMT-3</div>
        </div>
      </aside>

      {/* Main */}
      <div className="flex-1 flex flex-col min-w-0 lg:ml-0">
        {/* Mobile topbar */}
        <header className="lg:hidden flex items-center gap-3 px-4 py-3 border-b border-border bg-bg sticky top-0 z-10">
          <button
            onClick={() => setSidebarOpen(true)}
            className="text-gray-400 hover:text-white"
          >
            <Menu size={20} />
          </button>
          <div className="flex items-center gap-2 min-w-0">
            <Satellite size={16} className="text-blue-400 flex-shrink-0" />
            <span className="text-sm font-semibold text-white truncate">{shortName}</span>
          </div>
        </header>

        <main className="flex-1 overflow-auto">
          {children}
        </main>
      </div>
    </div>
  )
}
