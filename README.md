# Paideia Cardano

A decentralized autonomous organization (DAO) platform built on the Cardano blockchain.

## Prerequisites

You'll need a free Maestro API account to interact with the Cardano network:

1. Sign up at [Maestro](https://docs.gomaestro.org/)
2. Get your free API key from the dashboard

Note: Blockfrost is not currently used in this project (it was included for testing purposes but isn't required).

## Setup

### 1. Environment Variables

Copy the environment example file and configure it:

```bash
cd frontend
cp .env.example .env.local
```

Update the following variables in `.env.local`:

- `MAESTRO_API_KEY`: Your Maestro API key (required)
- `BLOCKFROST_PROJECT_ID`: Not used, can leave as "testtesttest"
- `NETWORK`: Set to "preview" for testnet or "mainnet" for production
- Database settings: Use the provided defaults or customize as needed

### 2. Install Dependencies

```bash
cd frontend
pnpm install
```

### 3. Start Database

```bash
docker compose up -d
```

### 4. Run Development Server

```bash
pnpm dev
```

Navigate to http://localhost:3000

## Environment Variables Reference

```env
MAESTRO_API_KEY="your_maestro_api_key_here"
BLOCKFROST_PROJECT_ID="testtesttest"
NETWORK="preview"
POSTGRES_CONTAINER_NAME=paideia_postgres
POSTGRES_VOLUME_NAME=paideia_postgres_data
POSTGRES_USER=paideia_user
POSTGRES_PASSWORD=testtesttest
POSTGRES_DB=paideia_postgres_db
POSTGRES_PORT=5469
DATABASE_URL="postgresql://paideia_user:testtesttest@localhost:5469/paideia_postgres_db"
```

The database will be accessible on port 5469 to avoid conflicts with other PostgreSQL instances you might have running.
