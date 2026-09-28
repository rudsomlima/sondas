# Reaparecimentos de sondas

Uma sonda recuperada não some: quem a achou leva pra casa, e ela costuma
continuar ligada — transmitindo do chão, às vezes por semanas, e às vezes de
outra cidade. O serial é o mesmo, então sem tratamento o app lê esses reportes
novos como se fossem o voo.

**A regra da casa: o pouso original é a posição e a data da sonda em todo o
app.** Cada reporte posterior e distante é um *reaparecimento* à parte,
marcado de forma própria e sempre ligado ao pouso de onde veio. Nada é
descartado e nada vira pouso novo.

Detalhes de implementação ficam em `CLAUDE.md` (seção "Reaparecimentos");
o código está em `app/lib/reappearance.ts`.

## O caso que originou isto

A **X2932841** (RS41, 402 MHz) foi lançada em **09/09/2026 às 10:04**, voou
106 minutos, pousou e foi recuperada por PS7BL no mesmo dia. Ela nunca foi
desligada: seguiu transmitindo em terra e foi ouvida até **27/09**, a 54 km do
pouso.

Antes do tratamento, isso produzia quatro erros ao mesmo tempo:

| Onde | O que acontecia |
| --- | --- |
| Histórico | O lançamento aparecia em **26/09**, não em 09/09 |
| Painel | Entrava em "Sondas de hoje" como **Pousada** |
| Telegram | Disparava aviso de **pouso** de um voo de 17 dias antes |
| Mapas | O marcador de pouso ficava no lugar do reaparecimento |

## Como um reaparecimento é reconhecido

Duas condições, juntas:

- **Tempo** — mais de 2 h sem nenhum quadro desde o pouso.
- **Distância** — mais de 1 km do pouso.

As duas juntas de propósito. Sonda que não foi recuperada e segue
transmitindo do chão, **no mesmo lugar**, por dias não é reaparecimento: é o
mesmo pouso ainda dando sinal, e continua atualizando a posição normalmente.

Quando a sonda nunca para de transmitir (como a X2932841), não existe
intervalo de silêncio pra separar o voo. Nesse caso quem serve de âncora é a
**posição do relato de recuperação** — quem achou a sonda disse onde ela
estava, e esse dado nunca é contaminado por um reporte posterior.

## Onde isso aparece na tela

| Seção | O que você vê |
| --- | --- |
| Mapas (ano, painel, lançamento) | Alfinete **violeta com ondas de rádio**, ligado ao pouso por uma **linha tracejada violeta** |
| Popup do reaparecimento | Abre dizendo "não é um pouso" e fecha apontando o pouso original: data, coordenada, distância e rumo |
| Popup do pouso | Lista os reaparecimentos e troca "Último reporte" por **"Pouso (fim do voo)"** |
| Histórico → mês | Ícone de rádio violeta ao lado do horário do lançamento, com datas e distâncias na dica |
| Histórico → card Ao vivo | Bloco "Reaparecimento hoje", separado dos voos do dia |
| Painel | Seção "Reaparecimentos de hoje", separada de "Sondas de hoje" |
| Painel → Meu receptor | Selo **REAPARECIMENTO** quando o seu receptor ouve uma sonda que já pousou |
| Telegram | Nenhum aviso. Reaparecimento não é lançamento nem pouso |

O alfinete violeta é de propósito diferente do cilindro (pouso) e do balão com
paraquedas (em voo): ler esse ponto como pouso é justamente o erro que ele
existe pra evitar. A linha tracejada também é essencial — sem ela o marcador
pareceria uma sonda solta em outro lugar.

**Análises** continua sendo mapa e estatística de **pousos**. Reaparecimentos
não entram no mapa de calor nem na rosa de deriva, e isso é o comportamento
correto.

## Quando a Wyoming está desativada

Sem a Wyoming (desligada em Configurações → Fontes de dados, ou estação sem
cobertura), não há horário oficial de lançamento: o app sintetiza um
lançamento a partir da **data em que a sonda foi reportada**. Pra uma sonda
recuperada e ainda transmitindo, isso é dias depois do voo — era daí que vinha
o lançamento falso de 26/09 da X2932841.

O app corrige isso ancorando cada lançamento aproximado no **primeiro quadro
real da sonda**, que o registro permanente conhece, e movendo a posição pro
pouso. Lançamento vindo da Wyoming nunca é alterado: a identidade dele é a
verdade dela.

## Se algo parecer errado

- **A sonda aparece no dia errado** — o registro dela provavelmente ainda não
  tem o primeiro quadro. Abra o mês no histórico: isso dispara a consulta às
  fontes pra aquelas sondas. O cache de mês sem Wyoming dura 10 minutos no
  servidor.
- **O reaparecimento não aparece** — ele depende do registro saber o pouso.
  Sondas sem relato de recuperação e sem intervalo de silêncio não têm como
  ser separadas; o enriquecimento resolve quando reler a fonte.
- **A recepção do voo parece inflada** — quem só ouviu a sonda depois do pouso
  é removido da recepção do voo, e quem já ouvia antes tem o último sinal
  limitado ao pouso. Registros antigos são corrigidos na leitura.
