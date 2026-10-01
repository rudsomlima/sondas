/**
 * Estações de radiossondagem da América do Sul, extraídas em 2026-06-25 do
 * feed de estações ativas da University of Wyoming
 * (https://weather.uwyo.edu/wsgi/sounding_json, o mesmo usado pelo mapa
 * oficial em https://weather.uwyo.edu/upperair/sounding.shtml). Cobre tanto
 * estações tradicionais (TEMP/FM35) quanto BUFR — ambas funcionam no mesmo
 * endpoint `cgi-bin/sounding` usado por app/api/sounding/route.ts, com
 * region=samer (confirmado por teste real contra a Wyoming para estações de
 * cada tipo, ex.: 82599 Natal/FM35 e 87585 Buenos Aires/BUFR).
 */

export interface Station {
  id: string // STNM, usado como STNM= na Wyoming
  name: string
  lat: number
  lon: number
  // "startplace" correspondente no radiosondy.info, quando há um local de
  // lançamento conhecido na mesma cidade/aeroporto (nomes não correspondem
  // 1:1 — relacionados por geografia, não por nome; ver app/lib/radiosondy.ts).
  // Ausente = sem cobertura conhecida de recuperação via radiosondy.info.
  radiosondyStartplace?: string
  // false = estação sem radiossondagem ativa publicada na Wyoming (confirmado
  // por teste real: STNM válido mas sem nenhuma linha "Observations at" no
  // arquivo da Wyoming). Ausente/true = comportamento normal (Wyoming é a
  // fonte do histórico). Quando false, app/api/sounding/route.ts usa o
  // radiosondy.info como fonte aproximada do histórico (ver fetchRadiosondyLaunches
  // em app/lib/radiosondy.ts) em vez de consultar a Wyoming.
  wyomingSupported?: boolean
  // Código IATA do aeroporto da estação (ou o mais próximo / da cidade:
  // BUE = Buenos Aires, JAU = Jauja pra Junín/Huayao, PLL = Ponta Pelada pra
  // Manaus, RTE = Campo de Marte). Rótulo curto quando várias estações
  // aparecem juntas (histórico). Ausente = sem aeroporto com IATA conhecido.
  iata?: string
}

export const DEFAULT_STATION: Station = {
  id: '82599', iata: 'NAT', name: 'Natal Aeroporto, Brazil', lat: -5.91, lon: -35.25,
  radiosondyStartplace: 'Barreira do Inferno Launch Center (BR)',
}

export const SOUTH_AMERICA_STATIONS: Station[] = [
  { id: '82965', iata: 'AFL', name: 'Alta Floresta (Aeroporto), Brazil', lat: -9.86, lon: -56.1 },
  { id: '85442', iata: 'ANF', name: 'Antofagasta, Chile', lat: -23.45308, lon: -70.44069 },
  { id: '84754', iata: 'AQP', name: 'Arequipa, Peru', lat: -16.40422, lon: -71.55156 },
  { id: '82193', iata: 'BEL', name: 'Belem (Aeroporto), Brazil', lat: -1.38, lon: -48.48 },
  {
    id: '82400', iata: 'FEN', name: 'Fernando de Noronha (Aeroporto), Brazil', lat: -3.85, lon: -32.42,
    radiosondyStartplace: 'Fernando De Noronha (BR)', wyomingSupported: false,
  },
  { id: '83566', iata: 'CNF', name: 'Belo Horizonte (Confins), Brazil', lat: -19.62, lon: -43.57, radiosondyStartplace: 'Confins (BR)' },
  { id: '82022', iata: 'BVB', name: 'Boa Vista, Brazil', lat: 2.83, lon: -60.7 },
  { id: '80222', iata: 'BOG', name: 'Bogota/Eldorado, Colombia', lat: 4.7, lon: -74.15, radiosondyStartplace: 'Bogota (CO)' },
  { id: '83378', iata: 'BSB', name: 'Brasilia (Aeroporto), Brazil', lat: -15.86, lon: -47.93, radiosondyStartplace: 'Brasilia (BR)' },
  { id: '87585', iata: 'BUE', name: 'Buenos Aires, Argentina', lat: -34.59001, lon: -58.48388, radiosondyStartplace: 'Buenos Aires (AR)' },
  { id: '83612', iata: 'CGR', name: 'Campo Grande (Aeroporto), Brazil', lat: -20.46, lon: -54.66 },
  { id: '87860', iata: 'CRD', name: 'Comodoro Rivadavia Aero, Argentina', lat: -45.79245, lon: -67.46261, radiosondyStartplace: 'Comodoro Rivadavia (AR)' },
  { id: '87344', iata: 'COR', name: 'Cordoba Aero, Argentina', lat: -31.29663, lon: -64.21185, radiosondyStartplace: 'Cordoba (AR)' },
  { id: '83554', iata: 'CMG', name: 'Corumba (Aeroporto), Brazil', lat: -19, lon: -57.67 },
  { id: '82705', iata: 'CZS', name: 'Cruzeiro Do Sul, Brazil', lat: -7.62, lon: -72.67 },
  { id: '83840', iata: 'CWB', name: 'Curitiba (Aeroporto), Brazil', lat: -25.51, lon: -49.16, radiosondyStartplace: 'Curitiba (BR)' },
  { id: '83827', iata: 'IGU', name: 'Foz Do Iguacu (Aeroporto), Brazil', lat: -25.51, lon: -54.58, radiosondyStartplace: 'Foz Do Iguacu (BR)' },
  { id: '83746', iata: 'GIG', name: 'Galeao, Brazil', lat: -22.81, lon: -43.25, radiosondyStartplace: 'Galeão (BR)' },
  { id: '84622', iata: 'JAU', name: 'Junin, Peru', lat: -11.91619, lon: -75.32178 },
  { id: '80398', iata: 'LET', name: 'Leticia/Vasquez Cobo, Colombia', lat: -4.55, lon: -69.53 },
  { id: '83768', iata: 'LDB', name: 'Londrina (Aeroporto), Brazil', lat: -23.33, lon: -51.13, radiosondyStartplace: 'Londrina (BR)' },
  { id: '82332', iata: 'PLL', name: 'Manaus (Aeroporto), Brazil', lat: -3.15, lon: -59.98 },
  { id: '82532', iata: 'MNX', name: 'Manicore, Brazil', lat: -5.82, lon: -61.28 },
  { id: '83779', iata: 'RTE', name: 'Marte Civ/Mil (São Paulo), Brazil', lat: -23.52, lon: -46.63, radiosondyStartplace: 'Sao Paulo (BR)' },
  { id: '87418', iata: 'MDZ', name: 'Mendoza Aero, Argentina', lat: -32.84383, lon: -68.797, radiosondyStartplace: 'El Plumerillo (AR)' },
  { id: '82599', iata: 'NAT', name: 'Natal Aeroporto, Brazil', lat: -5.91, lon: -35.25, radiosondyStartplace: 'Barreira do Inferno Launch Center (BR)' },
  { id: '80094', iata: 'BGA', name: 'Palonegro, Colombia', lat: 7.06, lon: -73.12 },
  { id: '82824', iata: 'PVH', name: 'Porto Velho (Aeroporto), Brazil', lat: -8.76, lon: -63.91 },
  { id: '85799', iata: 'PMC', name: 'Puerto Montt, Chile', lat: -41.4353, lon: -73.1013, radiosondyStartplace: 'Puerto Montt (CL)' },
  { id: '85934', iata: 'PUQ', name: 'Punta Arenas, Chile', lat: -53.00632, lon: -70.84086 },
  { id: '81405', iata: 'CAY', name: 'Rochambeau, French Guiana', lat: 4.82218, lon: -52.36553, radiosondyStartplace: 'Cayenne (GF)' },
  { id: '80001', iata: 'ADZ', name: 'San Andres (Isla)/Sesquicentenario, Colombia', lat: 12.5882, lon: -81.701 },
  { id: '82107', iata: 'SJL', name: 'San Gabriel Da Cachoeira, Brazil', lat: -1.3, lon: -67.05 },
  { id: '83937', iata: 'RIA', name: 'Santa Maria (Aeroporto), Brazil', lat: -29.72, lon: -53.7, radiosondyStartplace: 'Santa Maria (BR)' },
  { id: '85586', name: 'Santo Domingo, Chile', lat: -33.65394, lon: -71.61269, radiosondyStartplace: 'Santo Domingo (CL)' },
  { id: '82411', iata: 'TBT', name: 'Tabatinga, Brazil', lat: -3.67, lon: -69.67 },
  { id: '82026', name: 'Tirios, Brazil', lat: 2.48, lon: -55.98 },
  { id: '84516', iata: 'TRU', name: 'Trujillo, Peru', lat: -8.04397, lon: -79.05942 },
  { id: '83525', iata: 'UDI', name: 'Uberlandia, Brazil', lat: -18.87, lon: -48.22, radiosondyStartplace: 'Uberlandia (BR)' },
  { id: '83928', iata: 'URG', name: 'Uruguaiana (Aeroporto), Brazil', lat: -29.78, lon: -57.03, radiosondyStartplace: 'Uruguaiana (BR)' },
  { id: '83208', iata: 'BVH', name: 'Vilhena (Aeroporto), Brazil', lat: -12.7, lon: -60.1 },
].sort((a, b) => a.name.localeCompare(b.name))

export function findStation(id: string): Station | undefined {
  return SOUTH_AMERICA_STATIONS.find(s => s.id === id) ?? (id === DEFAULT_STATION.id ? DEFAULT_STATION : undefined)
}

// null = sem "startplace" conhecido no radiosondy.info para essa estação.
export function getRadiosondyStartplace(stationId: string): string | null {
  return findStation(stationId)?.radiosondyStartplace ?? null
}

// Remove acentos para a busca funcionar independente de o usuário digitar
// "sao paulo" ou "São Paulo".
// U+0300-U+036F = marcas diacríticas combinantes isoladas pelo NFD (ex.: "á" -> "a" + acento).
const DIACRITICS_REGEX = new RegExp(`[\\u0300-\\u036f]`, 'g')

function normalize(s: string): string {
  return s.normalize('NFD').replace(DIACRITICS_REGEX, '').toLowerCase()
}

export function searchStations(query: string): Station[] {
  const q = normalize(query.trim())
  if (!q) return SOUTH_AMERICA_STATIONS
  return SOUTH_AMERICA_STATIONS.filter(s => s.id.includes(q) || normalize(s.name).includes(q))
}

// Estações escolhidas em Configurações — pode ser mais de uma. A 1ª da lista
// é a PRINCIPAL: é a que vale onde só cabe uma (Análises, centro do mapa do
// Telegram, cache local em Configurações). O /painel soma todas ao mesmo
// tempo e o /historico mostra uma aba por estação.
//
// `sondas_stations` guarda a lista de ids; `sondas_station` (chave antiga, só
// uma estação) continua sendo gravada com a principal e é lida como ponto de
// partida quando a lista ainda não existe (quem já usava o app não perde a
// escolha).
const SELECTED_STATIONS_KEY = 'sondas_stations'
const SELECTED_STATION_KEY = 'sondas_station'
// Cada estação a mais multiplica as consultas do painel (ao vivo a cada 20 s,
// ano, mês, registro) — o limite evita travar a aba e as fontes.
export const MAX_SELECTED_STATIONS = 6
// Evento interno (mesma aba) disparado quando a lista muda; outras abas
// recebem o `storage` normal do navegador.
export const SELECTED_STATIONS_EVENT = 'sondas-stations-change'

function uniqueStations(ids: unknown[]): Station[] {
  const out: Station[] = []
  for (const id of ids) {
    const st = typeof id === 'string' ? findStation(id) : undefined
    if (st && !out.some(o => o.id === st.id)) out.push(st)
  }
  return out.slice(0, MAX_SELECTED_STATIONS)
}

export function getSelectedStations(): Station[] {
  if (typeof window === 'undefined') return [DEFAULT_STATION]
  try {
    const raw = localStorage.getItem(SELECTED_STATIONS_KEY)
    if (raw) {
      const parsed = JSON.parse(raw)
      const list = Array.isArray(parsed) ? uniqueStations(parsed) : []
      if (list.length > 0) return list
    }
    const legacy = localStorage.getItem(SELECTED_STATION_KEY)
    if (legacy) {
      const st = findStation(JSON.parse(legacy)?.id)
      if (st) return [st]
    }
  } catch {}
  return [DEFAULT_STATION]
}

export function setSelectedStations(stations: Station[]): void {
  if (typeof window === 'undefined') return
  const list = uniqueStations(stations.map(s => s.id))
  if (list.length === 0) return // sempre fica ao menos uma
  try {
    localStorage.setItem(SELECTED_STATIONS_KEY, JSON.stringify(list.map(s => s.id)))
    localStorage.setItem(SELECTED_STATION_KEY, JSON.stringify(list[0]))
  } catch {}
  window.dispatchEvent(new Event(SELECTED_STATIONS_EVENT))
}

// Estação principal (a 1ª da lista).
export function getSelectedStation(): Station {
  return getSelectedStations()[0] ?? DEFAULT_STATION
}

// Nome curto pra rótulos apertados ("Natal Aeroporto, RN" → "Natal Aeroporto").
export function stationShortName(station: Station): string {
  return station.name.split(',')[0]
}

// Código curto da estação: IATA do aeroporto, ou o STNM quando não há.
export function stationCode(station: Station): string {
  return station.iata ?? station.id
}
