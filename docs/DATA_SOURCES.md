# Fontes de dados e estratégia de redundância

Revisão: 2026-09-13.

## Ordem de consulta

O app não trata uma fonte isolada como verdade absoluta. Para o estado atual,
usa o primeiro resultado útil nesta sequência e preserva o último resultado
válido durante falhas transitórias:

1. cache local do navegador;
2. snapshot pré-calculado em R2 por `/api/poll`;
3. SondeHub por estação (`/sondes/site/{STNM}`);
4. SondeHub por área (`/sondes?lat=&lon=&distance=&last=`), marcado como
   associação geográfica aproximada;
5. radiosondy.info por local de lançamento e posição de recuperação;
6. inventário/sondagem da University of Wyoming.

No histórico, horários oficiais da Wyoming têm precedência. Posição, serial,
estatísticas de trajetória e confirmações positivas de outras fontes são
mesclados sem empobrecer um registro já enriquecido.

## SondeHub v2 — API pública documentada

Base: `https://api.v2.sondehub.org`.

- `GET /sondes/site/{site}?last={segundos}`: melhor vínculo entre voo e STNM;
- `GET /sondes?lat={lat}&lon={lon}&distance={m}&last={segundos}`: fallback por
  área, sem baixar telemetria mundial;
- `GET /sonde/{serial}`: trajetória recente de uma sonda conhecida;
- `GET /sites`: catálogo, coordenadas, tipos e agenda conhecida dos locais;
- bucket `https://sondehub-history.s3.amazonaws.com/launchsites/...`: arquivo
  histórico por estação/data/serial.

O endpoint de telemetria global em alta resolução é rate-limited e a própria
especificação recomenda não fazer polling frequente. O app passou a usar os
endpoints filtrados; o arquivo S3 permanece fallback para voos antigos.

Observação verificada: a resposta real de `/sites` representa `position` como
`[longitude, latitude]`, apesar de descrições antigas indicarem a ordem oposta.
As coordenadas estáticas já validadas do app continuam sendo a referência.

## University of Wyoming

Base atual: `https://weather.uwyo.edu/wsgi/sounding`.

- `type=INVENTORY&src=FM35&id={STNM}&datetime=...`: inventário anual;
- `type=TEXT:LIST&src=FM35&id={STNM}&datetime=...`: perfil individual.

É uma interface HTML, não uma API JSON contratual. Inventário e perfil podem
divergir temporariamente; por isso o app valida o perfil, faz retry com timeout,
mantém cache em memória/R2/localStorage e consulta fontes complementares.

## radiosondy.info

- `export/export_map.php?live_map=1`: mapa global em voo;
- `export/export_search.php?...`: recuperações filtradas por local/período.

Esses exports são úteis e aceitam leitura pública, mas não possuem contrato
público estável. O parsing é defensivo (corpo vazio, validação de coordenadas e
datas) e falhas nunca apagam dados das outras fontes. A API v1 encontrada exige
token e não foi adotada sem credenciais e termos operacionais explícitos.

## NOAA/NCEI IGRA 2.2 — próximo fallback recomendado

O IGRA é um arquivo oficial, com controle de qualidade, atualizado diariamente
e com dados recentes e de período completo por estação. O STNM 82599 aparece
como `BRM00082599`. É excelente para confirmar lançamentos e analisar perfis
atmosféricos quando a Wyoming estiver indisponível, mas não fornece a posição
de pouso/telemetria da sonda.

Integração recomendada para a próxima etapa: job server-side diário que baixa o
ZIP recente de cada estação ativa, extrai somente cabeçalhos de sondagem e
persiste um índice normalizado no R2. Não deve ser feito no navegador nem a cada
poll, pois os arquivos são orientados a download em lote.

## Semântica de falha

- `0 registros` com uma fonte respondendo é ausência observada;
- erro/timeout de todas as fontes é estado **indeterminado**, nunca “zero”;
- resposta parcial mantém os dados conhecidos e informa a degradação na UI;
- dados por proximidade ou horário arredondado são exibidos como aproximados;
- coordenadas inválidas são descartadas antes de chegar ao Leaflet.
