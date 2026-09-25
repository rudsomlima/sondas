# Avisos do Telegram

Configuração e modelos ficam na página `/telegram`. As configurações são
persistidas em `sondas/telegram-settings.json` no R2; o token do bot não é
enviado de volta ao navegador.

## Configurar o destino

1. Crie um bot pelo BotFather e informe o token em `/telegram`.
2. Para mensagens privadas, abra o bot e envie `/start`. Para um grupo, adicione
   o bot ao grupo e envie uma mensagem nele.
3. Use **Detectar** para localizar a conversa mais recente que enviou uma
   atualização ao bot. Confira o nome e o ID preenchidos e salve.
4. Ative os avisos desejados e salve as configurações.

O destino pode ser uma conversa privada ou um grupo. A detecção usa
`getUpdates` do Telegram (`POST /api/telegram-detect-chat`); se não encontrar
uma conversa, envie uma nova mensagem no chat/grupo e tente outra vez.

## Editar os modelos

São seis modelos editáveis, com os padrões definidos em
`app/lib/telegramMessage.ts`:

| Modelo | Chave |
| --- | --- |
| Lançamento | `launch` |
| Pouso | `landing` |
| Receptor offline | `receiverOffline` |
| Receptor voltou online | `receiverOnline` |
| Bateria baixa | `lowBattery` |
| Bateria normalizada | `batteryOk` |

Na tela, adicione blocos clicando ou arrastando badges, reorganize-os e confira
a prévia preenchida com valores de exemplo. **Salvar modelos** grava as
alterações; **Restaurar todos ao padrão** remove as substituições salvas. Cada
modelo tem seu próprio botão de teste. O teste de lançamento e de pouso envia
uma imagem do mapa quando os tiles estão disponíveis; os testes de receptor e
bateria enviam texto.

A chave geral **Notificações ativas** fica na configuração do bot. A ativação
individual fica dentro de cada cartão de modelo; assim, cada uma das seis
mensagens pode ser pausada separadamente. As opções de escopo do pouso ficam no
modelo **Pouso**; os limites de tempo offline e tensão ficam, respectivamente,
nos modelos **Receptor offline** e **Bateria baixa**. Offline/online compartilham
a detecção do estado do receptor, assim como bateria baixa/normalizada, mas cada
modelo controla separadamente se a mensagem daquela transição é enviada.

Os blocos representam tokens como `{header}`, `{stationLine}`,
`{landingCityLine}`, `{altitudeLine}`, `{linksLine}`, `{offlineHeader}` e
`{lowBatteryBody}`. A lista completa e seus nomes visuais ficam em
`EVENT_TEMPLATE_TOKENS` e `ALERT_TEMPLATE_TOKENS` em `app/telegram/page.tsx`.
É possível incluir HTML aceito pelo Telegram, como `<b>texto</b>`. Os valores
dinâmicos são escapados antes da substituição.

## Imagem de pouso

O mapa estático é montado em `app/lib/staticMap.ts` com tiles do OpenStreetMap.
Para pouso em terra, a busca reversa tenta obter o município e a UF e monta
`município-UF` (por exemplo, `Natal-RN`). No mar, usa o nome da área marítima
quando disponível. A consulta ao Nominatim é de melhor esforço: se falhar, a
mensagem segue com a localidade já fornecida pelo evento, se houver. A busca
tem timeout de 6 segundos e também reconhece o nome do resultado quando ele é
classificado como cidade, vila, município ou condado.

O rótulo aparece no canto inferior direito, em uma linha, sobre fundo
transparente. A fonte diminui para caber na largura da imagem. Para pousos no
mar, o mapa usa zoom 3 para mostrar uma área continental mais ampla.

As requisições dos tiles são limitadas globalmente a duas simultâneas por
processo e fazem até três tentativas, com timeout e alternância de subdomínio.
Se faltar um tile dentro do recorte depois das tentativas, a imagem é omitida
e a notificação segue como texto; não envie mapas com quadros cinza. O envio
real usa `app/lib/telegramEvents.ts`, e o teste por modelo usa
`app/api/telegram-test/route.ts`.
