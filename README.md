# TxTrace

<p align="center">
  <img src="public/img/logo.jpg" alt="TxTrace Logo" width="120" style="border-radius: 24px;" />
</p>

Sistema pessoal de gerenciamento financeiro com interface web, autenticação de usuários e suporte a deploy via Docker.

## Funcionalidades

- Lancamento de transacoes com tipo de pagamento (debito, credito, pix, dinheiro)
- Selecao de instituicao de pagamento por transacao
- Gestao e acompanhamento de faturas de cartao de credito (fechamento, vencimento, antecipacao e quitacao)
- Categorias customizaveis (alimentacao, transporte, saude, lazer, etc.)
- Parcelamento no cartao de credito com controle de limite
- Transacoes recorrentes com cancelamento granular
- Modulo de emprestimos com historico mensal de entradas/saidas
- Dashboard consolidado com visao geral, filtros por periodo e graficos
- Gestao de contas bancarias com saldo e limite de cartao de credito
- Configuracoes: perfil, categorias e instituicoes de pagamento

## Stack

- **Runtime:** Node.js 22+ com `node:sqlite` (built-in, sem dependencia externa de driver)
- **Framework:** Express.js + EJS (server-side rendering)
- **Banco de dados:** SQLite via API experimental nativa do Node.js
- **Autenticacao:** Sessoes com `express-session` + `connect-sqlite3` + bcrypt
- **Container:** Docker com volume persistente em `/DATA/AppData/tx-trace`

## Requisitos

- Node.js >= 22.0.0
- npm

## Instalacao local

```bash
git clone https://github.com/AnthonyPerotti/tx-trace.git
cd tx-trace
npm install
cp .env.example .env
# Edite o .env com suas configuracoes
npm start
```

Acesse em `http://localhost:3400`.

## Variaveis de ambiente

| Variavel | Descricao | Padrao |
|---|---|---|
| `PORT` | Porta do servidor | `3400` |
| `SESSION_SECRET` | Chave secreta de sessao | - |
| `DB_PATH` | Caminho do arquivo SQLite | `/DATA/AppData/tx-trace/txTrace.db` |
| `NODE_ENV` | Ambiente (`production` ou `development`) | `development` |

## Docker

### docker-compose (recomendado)

```bash
docker compose up -d
```

O banco de dados e persistido automaticamente em `/DATA/AppData/tx-trace/txTrace.db` no host.

### Build manual

```bash
docker build -t tx-trace .
docker run -d \
  -p 3400:3400 \
  -v /DATA/AppData/tx-trace:/DATA/AppData/tx-trace \
  -e SESSION_SECRET=sua-chave-secreta \
  -e DB_PATH=/DATA/AppData/tx-trace/txTrace.db \
  --name tx-trace \
  tx-trace
```

## Estrutura do projeto

```
tx-trace/
├── src/
│   ├── app.js              # Entry point, middlewares e rotas
│   ├── db/
│   │   ├── database.js     # Wrapper do node:sqlite
│   │   └── schema.sql      # Schema e seeds iniciais
│   ├── middleware/
│   │   └── auth.js         # Middleware de autenticacao
│   └── routes/
│       ├── auth.js         # Login e registro
│       ├── dashboard.js    # Dashboard e relatorios
│       ├── transactions.js # CRUD de transacoes
│       ├── loans.js        # Modulo de emprestimos
│       └── settings.js     # Contas, categorias e perfil
├── views/                  # Templates EJS
├── public/                 # Assets estaticos (CSS, JS)
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Logica de negocio importante

- **Cartao de credito:** saidas reduzem o limite do cartao, nao o saldo bancario
- **Recorrencia:** transacoes recorrentes so sao lancadas quando a data de criacao da recorrencia e atingida em cada mes
- **Cancelamento de recorrencia:** cancela a automacao a partir do momento do clique, sem remover lancamentos passados
- **Parcelamento:** cada parcela e registrada individualmente com data calculada a partir da data de compra
