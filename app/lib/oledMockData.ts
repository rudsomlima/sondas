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
  // Contadores do firmware (ver Display::drawKilltimer / sleep.cpp) — 0xffff = "sem valor" (mostra em branco)
  launchKT: 65535,
  burstKT: 30600,
  countKT: 65535,
  sleepS: 754, // segundos até o próximo deep sleep — ver sleepCountdownS em RX_FSK/src/sleep.cpp
}

/**
 * Valores "pior caso" (mais dígitos/caracteres possíveis) para cada campo —
 * usados só para o preview de arraste, pra mostrar o espaço máximo que um
 * item pode ocupar no display real, não o valor mockado "normal" acima.
 */
export const MOCK_TELEMETRY_MAX: typeof MOCK_TELEMETRY = {
  ...MOCK_TELEMETRY,
  freqMHz: 999.999,
  lat: -179.99999,
  lon: -179.99999,
  altM: 99999,
  hsMs: 999.9,
  vsMs: -99.9,
  idDxlapars: 'MWWWWWWWW',
  idShort: 'WWWWWWWWW',
  idSerial: 'MWWWWWWWW',
  type: 'RS41-SGM',
  afcRaw: -99999,
  ip: '255.255.255.255',
  siteName: 'WWWWWWWWWWWWWWWW',
  siteIndex: 99,
  siteTotal: 99,
  siteActive: 99,
  tempC: -99.9,
  pressureHPa: 9999.9,
  humidityPct: 99.9,
  battTelemetryV: -9.99,
  gpsDistM: 9999999,
  gpsDirDeg: 359,
  gpsBearDeg: 359,
  rssiRaw: -999,
  battV: -9.99,
  usbV: -9.99,
  chargeMa: -999.99,
  dischargeMa: -999.99,
  usbMa: -999.99,
  battTempC: -99.99,
  launchKT: 359999,
  burstKT: 359999,
  countKT: 359999,
  sleepS: 359999,
}
