'use client'

import { useCallback, useEffect, useState, type RefObject } from 'react'

/**
 * Tela cheia de um bloco (usado pelos mapas do histórico). Usa a Fullscreen
 * API quando existe; no iPhone (Safari não deixa elemento comum entrar em tela
 * cheia) cai pra um modo "fixo cobrindo a janela" por CSS — `pseudo` = true
 * nesse caso, pra quem chama aplicar a classe. Esc sai nos dois modos.
 *
 * `onChange` roda depois de entrar/sair (ex.: `map.invalidateSize()`, senão o
 * Leaflet continua desenhando no tamanho antigo).
 */
export function useFullscreen(ref: RefObject<HTMLElement | null>, onChange?: () => void) {
  const [native, setNative] = useState(false)
  const [pseudo, setPseudo] = useState(false)

  useEffect(() => {
    const sync = () => {
      setNative(!!ref.current && document.fullscreenElement === ref.current)
      setTimeout(() => onChange?.(), 80)
    }
    document.addEventListener('fullscreenchange', sync)
    return () => document.removeEventListener('fullscreenchange', sync)
  }, [ref, onChange])

  // Modo CSS: Esc sai, e trava a rolagem da página por trás.
  useEffect(() => {
    if (!pseudo) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setPseudo(false) }
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    window.addEventListener('keydown', onKey)
    setTimeout(() => onChange?.(), 80)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', onKey)
      setTimeout(() => onChange?.(), 80)
    }
  }, [pseudo, onChange])

  const toggle = useCallback(async () => {
    const el = ref.current
    if (!el) return
    if (document.fullscreenElement) { await document.exitFullscreen().catch(() => {}); return }
    if (pseudo) { setPseudo(false); return }
    if (el.requestFullscreen && document.fullscreenEnabled) {
      try { await el.requestFullscreen(); return } catch { /* cai no modo CSS */ }
    }
    setPseudo(true)
  }, [ref, pseudo])

  return { isFullscreen: native || pseudo, pseudo, toggle }
}
