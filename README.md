# Sondas Natal 🛰️

Monitoramento de radiossondagens da estação meteorológica de Natal — INMET 82599.

Dados extraídos em tempo real do servidor da [University of Wyoming](https://weather.uwyo.edu/), com conversão automática para GMT-3.

## Funcionalidades

- ✅ **Status do dia** — verifica se houve lançamento de balão sonda no dia corrente
- 📅 **Histórico anual** — lançamentos agrupados por mês com gráfico de barras
- ⚙️ **Configurações** — ajuste de estação, região e período de extração
- 💾 **Cache persistente** — dados armazenados localmente (localStorage) e em memória do servidor
- 🗑️ **Exclusão por mês/ano** — remova dados do histórico como desejar

## Estratégia de Cache

### Servidor (Vercel)
- **Mês atual**: cache em memória válido por **1 hora** (sempre consulta Wyoming após 1h)
- **Meses anteriores**: cache em memória **permanente** (nunca expira durante sessão)
- Reduz latência e custos de requisições à Wyoming

### Cliente (Browser)
- **localStorage**: armazena histórico anual completo
- Sobrevive a recargas, closes, mudança de aba
- Exportável como JSON para backup
- Pode ser deletado por mês ou ano inteiro

## Stack

- **Frontend:** Next.js 15 + TypeScript + Tailwind CSS + Recharts
- **Backend:** Next.js API Routes com cache em memória
- **Persistência:** localStorage (browser) + memoryCache (servidor)
- **Deploy:** Vercel
- **Dados:** University of Wyoming Radiosonde Archive

## Deploy no Vercel

1. Faça fork ou clone deste repositório
2. Importe o projeto no [Vercel](https://vercel.com)
3. Nenhuma variável de ambiente necessária
4. Deploy automático a cada push na `main`

## Desenvolvimento local

```bash
npm install
npm run dev
```

Acesse em: http://localhost:3000

## Estação padrão

| Campo   | Valor  |
|---------|--------|
| STNM    | 82599  |
| Nome    | Natal Aeroporto |
| Região  | naconf |
| Fuso    | GMT-3  |

## Robustez

- ✅ **Timeout de 15s** — requisições longas são abortadas
- ✅ **Validação de dados** — verifica datas, horas, estrutura
- ✅ **Remoção de duplicatas** — compara por `date + time_utc`
- ✅ **Erro parcial** — falha em um mês não quebra o ano inteiro
- ✅ **Confirmação de exclusão** — aviso antes de deletar dados

## Fonte dos dados

Os dados são públicos e disponibilizados pela Universidade de Wyoming:
```
https://weather.uwyo.edu/cgi-bin/sounding?region=naconf&TYPE=TEXT:LIST&YEAR={ANO}&MONTH={MES}&FROM=0100&TO=3123&STNM=82599
```

## Licença

MIT
