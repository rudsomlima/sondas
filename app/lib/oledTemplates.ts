/**
 * Conteúdo bruto de RX_FSK/data/screens1.txt, copiado do firmware
 * (PlatformIO/Projects/rdz_ttgo_sonde_06_03_2026/rdz_ttgo_sonde) em 2026-07-31.
 *
 * Só esse arquivo é embutido: screens2.txt..screens6.txt são templates para o
 * driver TFT ILI9225 (usam `scale=`/`color=` e coordenadas em pixel fora da
 * grade 8x16 do OLED) — confirmado em Display::initFromFile/getScreenIndex,
 * que resolvem sempre para screens1.txt quando o hardware é OLED SSD1306/SH1106.
 *
 * Precisa ser mantido em sync manualmente se o firmware mudar esse arquivo.
 */
export const SCREENS1_TXT = `
@Scanner
timer=-1,0,0
key1action=D,#,F,W
key2action=D,#,#,#
timeaction=#,D,+
0,0=XScan
0,5=S#:
0,9=T
3,0=F MHz
5,0,16=S
7,0=gV
7,5=n

@Legacy
timer=-1,-1,N
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,0
0,5=f MHz
1,8=c
0,0=t
1,0=is
2,0=L
4,0=O
2,10=a
3,10=h
4,9=v
6,0=R
6,7=Q
7,0=bVV

@Field
timer=-1,-1,N
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
2,0=L
4,0=O
3,10=h
4,9=v
0,0=Is
6,0=A
6,7=Q

@Field2
timer=-1,-1,N
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
2,0=L
4,0=O
1,12=t
0,9=f
3,10=h
4,9=v
0,0=Is
6,0=A
6,7=Q

@GPSDIST
timer=-1,-1,-1
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
0,0=Is
0,9=f
1,12=t
2,0=L
4,0=O
2,10=a
3,10=h
4,9=v
5,9=gC
5,13=gB
6,7=Q
7,0=gV
7,2=xd=
7,4=gD
7,12=gI°

@BatteryOLED
timer=-1,-1,-1
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
fonts=0,1
0,0=xBat.Status:
0,12=bS
1,0=xBatt:
1,6=bVV
2,0=bCmA (charge)
3,0=bDmA (disch.)
4,0=xUSB:
4,5=bUV
5,5=bImA
6,0=xTemp:
6,5=bT C
7,0=xSleep:
7,7=ksm

@Meteo
timer=-1,-1,-1
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
fonts=0,1
0,0=Is
0,9=f
1,12=t
2,0=xSonde
3,0=xData
2,10=A
4,0=Mt°C
4,9=Mh%rH
6,0=MphPa
6,11=MbV

@GPS-Data
timer=-1,-1,-1
key1action=+,0,F,W
key2action=>,#,#,#
timeaction=#,#,#
fonts=0,1
0,0=xGPS-Data
1,0=xLAT :
1,6=gA
2,0=xLONG:
2,6=gO
3,0=xALT :
3,9=gH
4,0=xSonde
5,0=xAlt :
5,6=a
6,0=xDist:
6,6=gD

@ScannerBatt
timer=-1,0,0
key1action=D,#,F,W
key2action=D,#,#,#
timeaction=#,D,+
0,0=XScan
0,5=S#:
0,9=T
2,0,16=s
3,0=F MHz
6,0=bS
6,2=bVVb
6,10=bUVu
7,0=gV
7,5=n
`
