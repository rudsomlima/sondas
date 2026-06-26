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
}

export const REGION = 'samer'

export const DEFAULT_STATION: Station = {
  id: '82599', name: 'Natal Aeroporto, Brazil', lat: -5.91, lon: -35.25,
  radiosondyStartplace: 'Barreira do Inferno Launch Center (BR)',
}

export const SOUTH_AMERICA_STATIONS: Station[] = [
  { id: '82965', name: 'Alta Floresta (Aeroporto), Brazil', lat: -9.86, lon: -56.1 },
  { id: '85442', name: 'Antofagasta, Chile', lat: -23.45308, lon: -70.44069 },
  { id: '84754', name: 'Arequipa, Peru', lat: -16.40422, lon: -71.55156 },
  { id: '82193', name: 'Belem (Aeroporto), Brazil', lat: -1.38, lon: -48.48 },
  { id: '83566', name: 'Belo Horizonte (Confins), Brazil', lat: -19.62, lon: -43.57, radiosondyStartplace: 'Confins (BR)' },
  { id: '82022', name: 'Boa Vista, Brazil', lat: 2.83, lon: -60.7 },
  { id: '80222', name: 'Bogota/Eldorado, Colombia', lat: 4.7, lon: -74.15, radiosondyStartplace: 'Bogota (CO)' },
  { id: '83378', name: 'Brasilia (Aeroporto), Brazil', lat: -15.86, lon: -47.93, radiosondyStartplace: 'Brasilia (BR)' },
  { id: '87585', name: 'Buenos Aires, Argentina', lat: -34.59001, lon: -58.48388, radiosondyStartplace: 'Buenos Aires (AR)' },
  { id: '83612', name: 'Campo Grande (Aeroporto), Brazil', lat: -20.46, lon: -54.66 },
  { id: '87860', name: 'Comodoro Rivadavia Aero, Argentina', lat: -45.79245, lon: -67.46261, radiosondyStartplace: 'Comodoro Rivadavia (AR)' },
  { id: '87344', name: 'Cordoba Aero, Argentina', lat: -31.29663, lon: -64.21185, radiosondyStartplace: 'Cordoba (AR)' },
  { id: '83554', name: 'Corumba (Aeroporto), Brazil', lat: -19, lon: -57.67 },
  { id: '82705', name: 'Cruzeiro Do Sul, Brazil', lat: -7.62, lon: -72.67 },
  { id: '83840', name: 'Curitiba (Aeroporto), Brazil', lat: -25.51, lon: -49.16, radiosondyStartplace: 'Curitiba (BR)' },
  { id: '83827', name: 'Foz Do Iguacu (Aeroporto), Brazil', lat: -25.51, lon: -54.58, radiosondyStartplace: 'Foz Do Iguacu (BR)' },
  { id: '83746', name: 'Galeao, Brazil', lat: -22.81, lon: -43.25, radiosondyStartplace: 'Galeão (BR)' },
  { id: '84622', name: 'Junin, Peru', lat: -11.91619, lon: -75.32178 },
  { id: '80398', name: 'Leticia/Vasquez Cobo, Colombia', lat: -4.55, lon: -69.53 },
  { id: '83768', name: 'Londrina (Aeroporto), Brazil', lat: -23.33, lon: -51.13, radiosondyStartplace: 'Londrina (BR)' },
  { id: '82332', name: 'Manaus (Aeroporto), Brazil', lat: -3.15, lon: -59.98 },
  { id: '82532', name: 'Manicore, Brazil', lat: -5.82, lon: -61.28 },
  { id: '83779', name: 'Marte Civ/Mil (São Paulo), Brazil', lat: -23.52, lon: -46.63, radiosondyStartplace: 'Sao Paulo (BR)' },
  { id: '87418', name: 'Mendoza Aero, Argentina', lat: -32.84383, lon: -68.797, radiosondyStartplace: 'El Plumerillo (AR)' },
  { id: '82599', name: 'Natal Aeroporto, Brazil', lat: -5.91, lon: -35.25, radiosondyStartplace: 'Barreira do Inferno Launch Center (BR)' },
  { id: '80094', name: 'Palonegro, Colombia', lat: 7.06, lon: -73.12 },
  { id: '82824', name: 'Porto Velho (Aeroporto), Brazil', lat: -8.76, lon: -63.91 },
  { id: '85799', name: 'Puerto Montt, Chile', lat: -41.4353, lon: -73.1013, radiosondyStartplace: 'Puerto Montt (CL)' },
  { id: '85934', name: 'Punta Arenas, Chile', lat: -53.00632, lon: -70.84086 },
  { id: '81405', name: 'Rochambeau, French Guiana', lat: 4.82218, lon: -52.36553, radiosondyStartplace: 'Cayenne (GF)' },
  { id: '80001', name: 'San Andres (Isla)/Sesquicentenario, Colombia', lat: 12.5882, lon: -81.701 },
  { id: '82107', name: 'San Gabriel Da Cachoeira, Brazil', lat: -1.3, lon: -67.05 },
  { id: '83937', name: 'Santa Maria (Aeroporto), Brazil', lat: -29.72, lon: -53.7, radiosondyStartplace: 'Santa Maria (BR)' },
  { id: '85586', name: 'Santo Domingo, Chile', lat: -33.65394, lon: -71.61269, radiosondyStartplace: 'Santo Domingo (CL)' },
  { id: '82411', name: 'Tabatinga, Brazil', lat: -3.67, lon: -69.67 },
  { id: '82026', name: 'Tirios, Brazil', lat: 2.48, lon: -55.98 },
  { id: '84516', name: 'Trujillo, Peru', lat: -8.04397, lon: -79.05942 },
  { id: '83525', name: 'Uberlandia, Brazil', lat: -18.87, lon: -48.22, radiosondyStartplace: 'Uberlandia (BR)' },
  { id: '83928', name: 'Uruguaiana (Aeroporto), Brazil', lat: -29.78, lon: -57.03, radiosondyStartplace: 'Uruguaiana (BR)' },
  { id: '83208', name: 'Vilhena (Aeroporto), Brazil', lat: -12.7, lon: -60.1 },
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

const SELECTED_STATION_KEY = 'sondas_station'

// Compartilhado entre app/configuracoes (onde é escolhida) e app/historico
// (onde é usada para consultar a API) via localStorage.
export function getSelectedStation(): Station {
  if (typeof window === 'undefined') return DEFAULT_STATION
  try {
    const raw = localStorage.getItem(SELECTED_STATION_KEY)
    if (!raw) return DEFAULT_STATION
    const parsed = JSON.parse(raw)
    return findStation(parsed.id) ?? DEFAULT_STATION
  } catch {
    return DEFAULT_STATION
  }
}

export function setSelectedStation(station: Station): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.setItem(SELECTED_STATION_KEY, JSON.stringify(station))
  } catch {}
}
