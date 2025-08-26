![image](https://user-images.githubusercontent.com/42897033/179449545-a06b1046-45d6-488d-9ed5-e55172a9311a.png)

# Paideia Cardano DAO Platform

A decentralized autonomous organization (DAO) platform built on the Cardano blockchain using parameterized smart contracts for complete DAO isolation.

## Architecture Overview

Paideia uses a unique per-DAO contract deployment model where each DAO gets its own isolated set of smart contracts. Unlike platforms with shared contracts, every DAO deploys parameterized validators customized with its unique identifiers (DAO policy ID, governance token, etc.). This provides:

- Complete isolation between DAOs
- No shared state conflicts  
- Individual DAO upgradability
- Enhanced security through separation

### Core Components

**On-Chain (Smart Contracts):**
- DAO validator - Core DAO configuration and governance
- Proposal validator - Proposal creation and voting logic
- Vote validator - Governance token locking and vote receipt management
- Treasury validator - Protected treasury spending
- Action validators - Executable actions (fund transfers, etc.)

**Off-Chain (Frontend):**
- Next.js web application
- Wallet integration for transaction signing
- User interface for all DAO operations
- PostgreSQL database for application state

## Prerequisites

To run your own instance of Paideia you will need: 

- Cardano wallet (Nami, Eternl, etc.) for transaction signing
- Free Maestro API account for blockchain interaction:
  1. Sign up at [Maestro](https://maestro-org.gitbook.io/)
  2. Get your API key from the dashboard
- [Docker Compose](https://docs.docker.com/compose/gettingstarted/) installed on your system

## Setup

### 1. Environment Configuration

```bash
cd frontend
cp .env.example .env.local
```

Update `.env.local` with your settings:

```env
MAESTRO_API_KEY="your_maestro_api_key_here"
BLOCKFROST_PROJECT_ID="testtesttest"  # Not used, legacy field
NETWORK="preview"  # Use "preview" for testnet, "mainnet" for production
POSTGRES_CONTAINER_NAME=paideia_postgres
POSTGRES_VOLUME_NAME=paideia_postgres_data
POSTGRES_USER=paideia_user
POSTGRES_PASSWORD=testtesttest
POSTGRES_DB=paideia_postgres_db
POSTGRES_PORT=5469
DATABASE_URL="postgresql://paideia_user:testtesttest@localhost:5469/paideia_postgres_db"
```

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

## User Guide

### Creating a DAO

<img width="451" height="190" alt="image" src="https://github.com/user-attachments/assets/a7bddbb7-7aeb-4cfc-b5d3-e709f3dd879d" />

1. Navigate to create DAO page
2. Set governance token (create new or use existing)
3. Configure voting parameters
4. Deploy DAO contracts
5. Fund treasury (optional)

### Creating Proposals

#### Prerequisites:
- Must have a connected Cardano wallet
- Must have at least the minimum required governance tokens (configured per DAO)
- Need to meet the DAO's minimum token requirement for proposal creation
- Must be registered as a DAO member with locked governance tokens
<img width="176" height="52" alt="image" src="https://github.com/user-attachments/assets/5557e4a0-c4e0-43a9-802d-ad2b16ea78c6" />

##### Step-by-Step Process:

1. **Navigate to Proposal Creation**
   - Go to the DAO page (`/dao?policyId=X&assetName=Y`). You can find it on the Browse DAOs page. 
   - Click "Create Proposal" button

2. **Fill Proposal Details**
   - **Proposal Title**: Brief, descriptive name
   - **Description**: Detailed explanation of the proposal
   - **Start Time**: When voting begins (must be in the future)
   - **End Time**: When voting ends (must be after start time, within DAO limits)

3. **Configure Treasury Actions (Optional)**
   - Toggle "Include Treasury Action" if you want to spend DAO funds
   - **Action Name**: What the action does
   - **Action Description**: Detailed explanation
   - **Activation Time**: When the action can be executed (after voting ends)
   - **Targets**: Define where funds go:
     - Recipient address
     - ADA amount (in lovelace)
     - Additional tokens (policy ID + asset name + quantity) selected from the dropdown

4. **Review and Submit**
   - Review all details
   - Click "Create Proposal"
   - Sign the transaction with your wallet
   - Wait for blockchain confirmation

**Validation Rules:**
- Start time must be in the future
- End time must be after start time and within DAO's min/max proposal duration
- Must have sufficient governance tokens locked for proposal creation
- Action activation time must be after voting ends
- All addresses and token specifications must be valid

**What Happens Next:**
1. Proposal is created on-chain with unique identifier
2. Community members can vote during the voting period
3. If proposal passes and includes actions, they become executable
4. Actions can be executed by anyone after the activation time

The frontend handles all the complex smart contract interactions automatically - users just fill out the form and sign transactions.

### Voting on Proposals

[**TODO: Add voting process**]
- How to lock governance tokens
- Casting votes on proposals
- Managing vote receipts
- Unlocking tokens after voting

### Treasury Management

[**TODO: Add treasury operations**]
- Funding the treasury
- Executing approved treasury actions
- Treasury spend limits and controls

## Smart Contract Architecture

### Contract Deployment

Each DAO deploys its own parameterized smart contract suite. Contract addresses are deterministically derived from:
- DAO policy ID
- DAO asset name
- Governance token policy ID
- Other DAO-specific parameters

[**TODO: Add contract address derivation examples**]

### Validator Types

**DAO Validator (`dao.ak`)**
- Mints DAO NFT with configuration datum
- Validates DAO parameter updates
- Serves as reference point for other validators

**Proposal Validator (`proposal.ak`)**
- Creates and manages proposal UTXOs
- Tracks vote tallies
- Enforces proposal timing and quorum rules
- Parameterized with: `dao_policy_id`, `dao_key`, `vote_policy_id`

**Vote Validator (`vote.ak`)**
- Manages governance token locking
- Mints/burns vote receipt tokens
- Prevents double voting
- Parameterized with: `dao_policy_id`, `dao_key`

**Treasury Validator (`treasury.ak`)**
- Protects DAO treasury funds
- Requires valid action execution for spending
- Parameterized with: `dao_policy_id`, `dao_key`

**Action Validators**
- `action_send_funds.ak` - Treasury fund transfers
- [**TODO: Document other action types**]
- Parameterized with: `dao_policy_id`, `dao_key`

### Token Standards

**Governance Tokens**
- Standard Cardano native tokens
- Can be existing tokens or newly minted
- Locked in vote UTXOs during active voting

**Vote Receipt Tokens**
- CIP-68 compliant tokens
- Unique per proposal-option combination
- Burned when proposals end or votes are changed

[**TODO: Add token naming conventions and examples**]

## API Reference

[**TODO: Document the backend API endpoints**]
- DAO creation endpoints
- Proposal management
- Voting operations
- Treasury operations

## Development

### Building Smart Contracts

```bash
cd dao_contracts
aiken build
```

### Running Tests

```bash
cd dao_contracts
aiken check
```

### Contract Documentation

```bash
cd dao_contracts
aiken docs
```

## Testnet Examples

[**TODO: Add the testnet transaction IDs mentioned in milestone**]
- Proposal creation transaction: `[TRANSACTION_ID]`
- Voting transaction: `[TRANSACTION_ID]`  
- Treasury spending transaction: `[TRANSACTION_ID]`

## Deployment

[**TODO: Add production deployment instructions**]
- Environment setup for mainnet
- Database configuration
- Smart contract deployment process
- Frontend deployment options

## Troubleshooting

[**TODO: Add common issues and solutions**]
- Wallet connection issues
- Transaction failures
- Network configuration problems
- Database connection errors

## Security Considerations

[**TODO: Add security best practices**]
- Governance token security
- Proposal validation
- Treasury protection mechanisms
- Vote receipt management

## License

All code is published under GPL license as specified in the project milestone.

## Links

- GitHub Repository: [**TODO: Add repository link**]
- Project Documentation: [**TODO: Add docs link if separate**]
- Demo Video: [**TODO: Add YouTube link mentioned in milestone**]
