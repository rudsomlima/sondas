import type { OledEntry } from './oledScreenParser'
import { MOCK_TELEMETRY as M } from './oledMockData'

/** Tamanho da grade de caracteres do OLED SSD1306 usado pelo firmware (U8x8Display::getDispSize) */
export const OLED_COLS = 16
export const OLED_ROWS = 8
export const CELL_PX = 8 // 128x64 / (16 colunas / 8 linhas)

interface FormattedEntry {
  kind: 'text'
  text: string
}
interface FormattedQBar {
  kind: 'qbar'
  len: number
  size: number
}

type Formatted = FormattedEntry | FormattedQBar

const sign = (v: number) => (v >= 0 ? '+' : '')

/**
 * Formata o conteúdo dinâmico de um item de tela, replicando (de forma
 * aproximada, com dados mock) as funções draw* de RX_FSK/src/Display.cpp.
 */
function formatEntry(entry: OledEntry): Formatted {
  const { code, extra } = entry
  switch (code) {
    case 'l':
      return { kind: 'text', text: M.lat.toFixed(5) }
    case 'o':
      return { kind: 'text', text: M.lon.toFixed(5) }
    case 'a':
      return { kind: 'text', text: M.altM >= 1000 ? `${M.altM.toFixed(0)}m` : `${M.altM.toFixed(1)}m` }
    case 'h': {
      const isMs = extra[0] === 'm'
      const val = isMs ? M.hsMs : M.hsMs * 3.6
      const suffix = extra.length > 1 ? extra.slice(1) : isMs ? ' m/s' : ' km/h'
      return { kind: 'text', text: `${val.toFixed(1)}${suffix}` }
    }
    case 'v': {
      const suffix = extra.length > 0 ? extra : ' m/s'
      return { kind: 'text', text: `${sign(M.vsMs)}${M.vsMs.toFixed(1)}${suffix}` }
    }
    case 'i': {
      const sub = extra[0]
      const text = sub === 'n' ? M.idSerial : sub === 's' ? M.idShort : M.idDxlapars
      return { kind: 'text', text }
    }
    case 'q':
      return { kind: 'qbar', len: 18, size: extra[0] === '4' ? 4 : 3 }
    case 't':
      return { kind: 'text', text: M.type }
    case 'f':
      return { kind: 'text', text: `${M.freqMHz.toFixed(3)}${extra}` }
    case 'c': {
      const val = M.afcRaw * 0.001
      return { kind: 'text', text: `${sign(val)}${val.toFixed(2)}k` }
    }
    case 'n':
      // simplificação: o firmware desenha o IP como tiles bitmap; aqui mostramos como texto
      return { kind: 'text', text: M.ip }
    case 's': {
      const sub = extra[0]
      let text: string
      if (sub === '#') text = ` ${M.siteIndex}`
      else if (sub === 't') text = `${M.siteTotal}`
      else if (sub === 'a') text = `${M.siteActive}`
      else if (sub === '/') text = `${M.siteIndex}/${M.siteTotal}`
      else text = M.siteName.padEnd(16)
      if (sub) text += extra.slice(1)
      return { kind: 'text', text }
    }
    case 'm': {
      const sub = extra[0]
      const suffix = extra.slice(1)
      let val: number
      let decimals = 1
      switch (sub) {
        case 't': val = M.tempC; break
        case 'p': val = M.pressureHPa; decimals = M.pressureHPa >= 1000 ? 1 : 2; break
        case 'h': val = M.humidityPct; break
        case 'b': val = M.battTelemetryV; decimals = 2; break
        default: val = 0
      }
      return { kind: 'text', text: `${val.toFixed(decimals)}${suffix}` }
    }
    case 'g': {
      const sub = extra[0]
      switch (sub) {
        case 'V':
          return { kind: 'text', text: '✓' } // ícone simplificado de "GPS válido"
        case 'O':
          return { kind: 'text', text: M.gpsLon.toFixed(5) }
        case 'A':
          return { kind: 'text', text: M.gpsLat.toFixed(5) }
        case 'H':
          return { kind: 'text', text: `${M.gpsAltM}m` }
        case 'C':
          return { kind: 'text', text: `${M.gpsCourseDeg}` }
        case 'S': {
          const isMs = extra[1] === 'm'
          const speed = isMs ? M.gpsSpeedMs : M.gpsSpeedMs * 3.6
          const suffix = extra.length > 2 ? extra.slice(2) : isMs ? ' m/s' : ' km/h'
          return { kind: 'text', text: `${speed.toFixed(2)}${suffix}` }
        }
        case 'D':
          return { kind: 'text', text: M.gpsDistM > 9999 ? `${(M.gpsDistM / 1000).toFixed(0)}km` : `${M.gpsDistM}m` }
        case 'I':
          return { kind: 'text', text: `${M.gpsDirDeg}${extra[1] === '°' ? '°' : ''}` }
        case 'B':
          return { kind: 'text', text: `${M.gpsBearDeg}${extra[1] === '°' ? '°' : ''}` }
        default:
          return { kind: 'text', text: '' }
      }
    }
    case 'r':
      return { kind: 'text', text: `-${Math.round(Math.abs(M.rssiRaw) / 2)}` }
    case 'b': {
      const sub = extra[0]
      const suffix = extra.slice(1)
      switch (sub) {
        case 'S': return { kind: 'text', text: M.battStatus }
        case 'V': return { kind: 'text', text: `${M.battV.toFixed(2)}${suffix}` }
        case 'U': return { kind: 'text', text: `${M.usbV.toFixed(2)}${suffix}` }
        case 'T': return { kind: 'text', text: `${M.battTempC.toFixed(2)}${suffix}` }
        case 'C': return { kind: 'text', text: `${M.chargeMa.toFixed(2)}${suffix}` }
        case 'D': return { kind: 'text', text: `${M.dischargeMa.toFixed(2)}${suffix}` }
        case 'I': return { kind: 'text', text: `${M.usbMa.toFixed(2)}${suffix}` }
        default: return { kind: 'text', text: '' }
      }
    }
    case 'x':
      return { kind: 'text', text: extra }
    default:
      return { kind: 'text', text: `[${code}]` }
  }
}

const FG = '#7fe7ff'
const FG_DIM = '#3a5a63'

export function drawOledEntry(ctx: CanvasRenderingContext2D, entry: OledEntry) {
  const formatted = formatEntry(entry)
  const x = entry.col * CELL_PX
  const y = entry.line * CELL_PX

  if (formatted.kind === 'qbar') {
    // Barra de qualidade de recepção: len blocos, alternando estilos pra ilustração
    const w = formatted.size
    const glyphs = ['█', '▒', '×', '°'] // ok / sem header / erro / sem posição
    for (let i = 0; i < formatted.len; i++) {
      ctx.fillStyle = i % 4 === 2 ? FG_DIM : FG
      ctx.font = `${w * 2}px monospace`
      ctx.textBaseline = 'top'
      ctx.fillText(glyphs[i % glyphs.length], x + i * (w + 1), y)
    }
    return
  }

  ctx.fillStyle = FG
  ctx.textBaseline = 'top'
  ctx.font = entry.large ? 'bold 13px "Courier New", monospace' : '9px "Courier New", monospace'
  ctx.fillText(formatted.text, x, y)
}
