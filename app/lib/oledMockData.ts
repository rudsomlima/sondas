/**
 * Valores fictícios usados só para ilustrar o layout das telas do OLED no
 * preview — não vêm do receptor nem de nenhuma sonde real.
 */
export const MOCK_TELEMETRY = {
  freqMHz: 402.5,
  lat: -22.90642,
  lon: -43.18223,
  altM: 8342,
  hsMs: 4.3, // velocidade horizontal, m/s
  vsMs: -5.2, // velocidade vertical, m/s
  idDxlapars: 'R2340123',
  idShort: '2340123',
  idSerial: 'R2340123',
  type: 'RS41',
  afcRaw: 1230, // *0.001 => +1.23k
  ip: '192.168.4.1',
  siteName: 'Rio de Janeiro',
  siteIndex: 2,
  siteTotal: 6,
  siteActive: 4,
  tempC: -42.3,
  pressureHPa: 23.45,
  humidityPct: 67.2,
  battTelemetryV: 2.94,
  gpsLat: -22.9,
  gpsLon: -43.17,
  gpsAltM: 12,
  gpsCourseDeg: 87,
  gpsSpeedMs: 1.2,
  gpsDistM: 3421,
  gpsDirDeg: 134,
  gpsBearDeg: 47,
  rssiRaw: -168, // firmware desenha rssi/2
  battStatus: 'B' as 'U' | 'N' | 'C' | 'B',
  battV: 3.87,
  usbV: 5.02,
  chargeMa: 320,
  dischargeMa: 150,
  usbMa: 410,
  battTempC: 31.2,
}
