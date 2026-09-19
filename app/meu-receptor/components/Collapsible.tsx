'use client'

import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

/**
 * Painéis recolhíveis da página "Meu receptor", cada um com a escolha
 * guardada no navegador (`sondas_meu_receptor_collapsed`).
 *
 * Uso: a página envolve o painel em <CollapsibleSection id="..."> e o painel
 * troca o seu <h2> por <PanelTitle>. Recolhido, o CSS (globals.css,
 * `[data-collapsed="true"]`) esconde tudo do painel menos o cabeçalho — o
 * painel não precisa saber disso. Fora de um CollapsibleSection, PanelTitle é
 * um título comum.
 */

const STORAGE_KEY = 'sondas_meu_receptor_collapsed'
const listeners = new Set<() => void>()

function readAll(): Record<string, boolean> {
  if (typeof window === 'undefined') return {}
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}') ?? {} } catch { return {} }
}

function writeOne(id: string, collapsed: boolean) {
  try {
    const all = readAll()
    if (collapsed) all[id] = true; else delete all[id]
    localStorage.setItem(STORAGE_KEY, JSON.stringify(all))
  } catch { /* sem localStorage: vale só nesta visita */ }
  for (const l of listeners) l()
}

const CollapseContext = createContext<{ collapsed: boolean; toggle: () => void } | null>(null)

export function CollapsibleSection({ id, children }: { id: string; children: ReactNode }) {
  // Começa aberto (igual ao HTML do servidor) e aplica a escolha salva depois
  // de montar — evita divergência de hidratação.
  const [collapsed, setCollapsed] = useState(false)
  useEffect(() => {
    const sync = () => setCollapsed(!!readAll()[id])
    sync()
    listeners.add(sync)
    return () => { listeners.delete(sync) }
  }, [id])
  const toggle = useCallback(() => writeOne(id, !readAll()[id]), [id])
  return (
    <CollapseContext.Provider value={{ collapsed, toggle }}>
      <div data-collapsed={collapsed ? 'true' : 'false'} className="collapsible-section">
        {children}
      </div>
    </CollapseContext.Provider>
  )
}

export function PanelTitle({ icon, children, className = '' }: { icon?: ReactNode; children: ReactNode; className?: string }) {
  const ctx = useContext(CollapseContext)
  if (!ctx) {
    return <h2 className={`text-sm font-semibold text-white flex items-center gap-2 ${className}`}>{icon}{children}</h2>
  }
  return (
    <h2 className={`panel-title-toggle text-sm font-semibold text-white ${className}`}>
      <button
        type="button"
        onClick={ctx.toggle}
        aria-expanded={!ctx.collapsed}
        title={ctx.collapsed ? 'Expandir' : 'Recolher'}
        className="flex items-center gap-2 text-left hover:text-blue-200 transition-colors group"
      >
        <ChevronDown
          size={14}
          className={`text-gray-500 group-hover:text-gray-300 transition-transform ${ctx.collapsed ? '-rotate-90' : ''}`}
        />
        {icon}
        {children}
      </button>
    </h2>
  )
}
