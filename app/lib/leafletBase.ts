/**
 * Criação do mapa Leaflet base (OSM + satélite Esri + controle de camadas),
 * deduplicando o bloco que se repetia em LaunchMap/YearMap e agora é usado
 * também por MissionMap e LandingHeatmap.
 *
 * IMPORTANTE: só chamar em client components, após `await import('leaflet')`
 * (nunca importar leaflet estaticamente — quebra o SSR).
 */

export interface BaseMap {
  map: any
  markersLayer: any
}

export function createBaseMap(L: any, div: HTMLDivElement): BaseMap {
  const map = L.map(div)
  const streets = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
  })
  const satellite = L.tileLayer(
    'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
    { attribution: 'Esri, Maxar, Earthstar Geographics' }
  )
  streets.addTo(map)
  L.control.layers({ 'Mapa': streets, 'Satélite': satellite }).addTo(map)
  const markersLayer = L.layerGroup().addTo(map)
  return { map, markersLayer }
}
