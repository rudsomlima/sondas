# Várias estações ao mesmo tempo

Guia funcional: como escolher mais de uma estação e o que cada tela mostra.
Para a arquitetura (feeds por estação, `stationId`, invariantes), veja
`CLAUDE.md` → "Suporte a múltiplas estações".

## Escolher as estações

Em **Configurações → Estações** (ou no botão de estação do Painel e do
Histórico):

- Marque até **6 estações** na lista; a busca não diferencia acentos e
  aceita o número da estação (ex.: `82599`).
- A estação com a **estrela** é a **principal** (a primeira da lista). Clique
  na estrela de outra para torná-la principal; o **X** remove (sempre fica ao
  menos uma).
- Vale **na hora**, em todo o app — inclusive em outras abas abertas. A
  escolha fica guardada neste navegador.
- O menu lateral mostra a principal e quantas mais estão escolhidas
  (ex.: "Natal Aeroporto +1").

> Cada estação a mais multiplica as consultas (ao vivo a cada 20 s, ano e
> mês). Com muitas estações, a primeira carga fica mais lenta.

## O que cada tela mostra

| Tela | Com várias estações |
|------|---------------------|
| **Painel** | Todas juntas: uma pílula de status por estação no topo, sondas de hoje e últimos lançamentos de todas (com o nome da estação em cada item), mapa com o local de lançamento de cada uma. |
| **Histórico anual** | Aba **Todas** (padrão) soma tudo; cada estação também tem a sua aba. |
| **Análises** | Uma estação por vez (abre na principal), com abas para as demais. |
| **Configurações** | Cache local e download em lote usam a principal; o "Registro de sondas" tem abas por estação. |
| **Telegram** | Configuração própria (no servidor). O botão **"Marcar as do app"** copia as estações escolhidas para as monitoradas. |

## Histórico na aba "Todas"

- **Resumo, cobertura, gráfico mensal e meses** somam as estações; a linha
  **"Por estação"** mostra a contagem de cada uma (clique para abrir só ela).
- Cada horário ganha uma etiqueta com o **código IATA** do aeroporto da
  estação (ex.: `NAT`, `FEN`). Passe o mouse para ver o nome completo.
  Estações sem aeroporto com código IATA conhecido mostram o número da
  estação (ex.: Santo Domingo `85586`, Tiriós `82026`). Alguns códigos são
  do aeroporto mais próximo ou da cidade: Buenos Aires `BUE`, Junín `JAU`,
  Manaus (Ponta Pelada) `PLL`, São Paulo (Campo de Marte) `RTE`.
- **"Ver mapa do ano"** abre **um só mapa** com as sondas de todas as
  estações e o local de lançamento de cada uma; o cabeçalho lista as
  estações (ex.: "NAT + FEN").
- O **mapa de um lançamento** também mostra as sondas do mesmo mês das
  outras estações ("+ N sondas de outras estações" no cabeçalho). Elas são
  só desenho: a sonda do lançamento é procurada apenas entre as da estação
  dele — senão um lançamento de Natal poderia ser ligado a uma sonda de
  Noronha do mesmo horário. Afaste o zoom para ver as mais distantes.
- **"Reverificar" (Wyoming)** roda em todas as estações mostradas.
- **"Deletar mês" e "Deletar ano inteiro" só aparecem na aba de uma
  estação.** Na aba "Todas", um clique apagaria o mês de todas as estações
  no servidor, sem desfazer.

## Diagnóstico rápido

- **Uma estação não aparece** → confira se está marcada em Configurações (o
  limite é 6).
- **Etiqueta com número em vez de código** → a estação não tem `iata`
  cadastrado em `app/lib/stations.ts`.
- **Erro `ENOENT ... .next/...` no navegador** → há mais de um `npm run dev`
  do sondas rodando ao mesmo tempo e eles brigam pela pasta `.next`. Feche
  os extras (Ctrl + C no terminal), apague `.next` e abra um só.
