# Sondas Natal 🛰️

Monitoramento de radiossondagens da estação meteorológica de Natal — INMET 82599.

Dados extraídos em tempo real do servidor da [University of Wyoming](https://weather.uwyo.edu/), com conversão automática para GMT-3.

## Funcionalidades

- ✅ **Status do dia** — verifica se houve lançamento de balão sonda no dia corrente
- 📅 **Histórico anual** — lançamentos agrupados por mês com gráfico de barras
- ⚙️ **Configurações** — ajuste de estação, região e período de extração

## Stack

- **Frontend:** Next.js 14 + TypeScript + Tailwind CSS
- **Backend:** Next.js API Routes (Edge-compatible)
- **Gráficos:** Recharts
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

## Fonte dos dados

Os dados são públicos e disponibilizados pela Universidade de Wyoming:
```
https://weather.uwyo.edu/cgi-bin/sounding?region=naconf&TYPE=TEXT:LIST&YEAR={ANO}&MONTH={MES}&FROM=0100&TO=3123&STNM=82599
```

## Licença

MIT
