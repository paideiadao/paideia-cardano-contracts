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

## Voting Process

### Step-by-Step Voting Process:

1. **Register for DAO Governance (First time only)**
   - Navigate to the DAO page and click "Register to Vote". This will lock your governance tokens and allow you to vote. 
   - Receive a Vote NFT that represents your registered tokens
   - You can unlock anytime when not actively voting

2. **Cast Your Vote**
   - Find active proposals on the DAO page
   - Click "Vote" on any proposal during its voting period
   - Select your preferred option (option 0 is always "No Action")
   - Specify voting power (up to your registered token amount)
   - Sign the transaction to mint vote receipt tokens

3. **Managing Vote Receipts**
   - Vote receipt tokens are minted into your Vote UTXO
   - Each receipt is unique to the proposal-option combination
   - You can change votes on active proposals (burns old receipt, mints new one)
   - Receipts are automatically cleaned after proposals end

4. **Unlocking Tokens**
   - You can unregister and retrieve tokens anytime
   - Must not have any active vote receipt tokens
   - Burns your Vote NFT and returns governance tokens

### Validation Rules:
- Cannot vote with more tokens than you have registered
- Cannot double vote on the same proposal
- Can vote on multiple parallel proposals simultaneously
- Vote receipts prevent token unlocking until proposals end

## Treasury Management

### Funding the Treasury

**Initial Funding:**
- Treasury has no datum requirements for easy depositing
- Anyone can send ADA or native tokens to the treasury address
- Treasury address is deterministically derived from DAO parameters

**Ongoing Contributions:**
- Community members can deposit additional funds anytime
- No special permissions required for deposits
- All assets are protected by treasury validator

### Executing Approved Treasury Actions

**Prerequisites:**
- Proposal must have passed with the specific action option
- Action activation time must have elapsed
- Valid action UTXO must exist on-chain

**Execution Process:**
1. Anyone can execute approved actions (permissionless)
2. Action validator ensures proposal passed correctly
3. Treasury validator requires valid action as spending condition
4. Funds are sent to specified targets as defined in action
5. Action token is burned upon successful execution

**Treasury Spend Controls:**
- Only whitelisted action validators can spend treasury funds
- Each action references specific proposal and winning option
- Action execution requires proposal reference input for validation
- Treasury validator enforces these constraints on-chain

**Action Types Currently Supported:**
- **Send Funds**: Transfer ADA and native tokens to specified addresses
- **Future Extensions**: Additional action types will be made if we are able to secure funding from future Catalyst proposals

## Smart Contract Architecture

### Contract Address Derivation

Contract addresses are deterministically derived using parameterized smart contracts:

```
Script Parameters = [dao_policy_id, dao_key, additional_params...]
Script Hash = hash(apply_parameters(base_script, parameters))
Contract Address = payment_credential_from_script_hash(script_hash)
```

**Example Parameters:**
- DAO Validator: `[dao_policy_id, dao_key]`
- Proposal Validator: `[dao_policy_id, dao_key, vote_policy_id]`
- Vote Validator: `[dao_policy_id, dao_key]`
- Treasury Validator: `[dao_policy_id, dao_key]`
- Action Validators: `[dao_policy_id, dao_key]`

### Validator Relationships

**DAO Validator** (`dao.ak`)
- Contains DAO configuration and governance rules
- Serves as reference point for all other validators
- Guards the DAO NFT with immutable parameters

**Proposal Validator** (`proposal.proposal.spend`)
- Manages proposal lifecycle and vote tallies
- Validates proposal timing and quorum requirements
- Parameterized with DAO and vote policy identifiers

**Vote Validator** (`vote.vote.spend`)
- Protects locked governance tokens
- Manages vote receipt token minting/burning
- Prevents double voting and unauthorized token access

**Treasury Validator** (`treasury.treasury.spend`)
- Simple validator requiring valid action execution
- Only spendable with approved action validators

**Action Validators**
- `action_send_funds.action_send_funds.spend` - Treasury fund transfers
- Each action type has its own specialized validator
- All parameterized with DAO identifiers for isolation

## Token Standards and Naming Conventions

### Governance Tokens
- Standard Cardano native tokens (any policy ID + asset name)
- Can be existing tokens or newly minted for the DAO
- Locked in Vote UTXOs during active governance participation

### Vote Receipt Tokens
- **Purpose**: Prevent double voting and track vote history
- **Policy ID**: Same as the proposal's policy ID
- **Asset Name**: Cryptographically derived from proposal ID + vote option
- **Uniqueness**: Each proposal-option combination gets a unique receipt token
- **Lifecycle**: Minted when casting votes, burned when proposals end or votes change

### DAO NFT Tokens
- **DAO Identifier**: Unique NFT that identifies each DAO instance
- **Vote NFT**: Personal NFT given to users when they register for governance
- **Vote Reference NFT**: Technical token locked with governance tokens in smart contract

### Vote System Token Flow
1. **Registration**: User locks governance tokens + receives Vote NFT
2. **Voting**: Vote receipt tokens minted into user's vote UTXO
3. **Vote Changes**: Old receipts burned, new ones minted
4. **Cleanup**: Receipt tokens burned when proposals end
5. **Unregistration**: Vote NFT burned, governance tokens returned

### CIP-68 Metadata Structure
Vote NFTs follow CIP-68 standard for rich metadata:
```json
{
  "metadata": {
    "name": "DAO Membership Token",
    "description": "Voting rights for [DAO Name]",
    "image": "ipfs://...",
    "attributes": {
      "dao": "DAO Policy ID",
      "voting_power": "Locked token amount"
    }
  },
  "version": 1,
  "extra": null
}
```

## API Reference

### Core Endpoints

**DAO Management:**
- `POST /api/dao/deploy/initialize` - Initialize DAO creation plan
- `POST /api/dao/deploy/finalize` - Deploy DAO on-chain
- `POST /api/dao/register` - Register for governance (lock tokens)
- `GET /api/dao/info` - Get DAO configuration and status

**Proposal Operations:**
- `POST /api/dao/proposal/create` - Create new proposal with optional actions
- `GET /api/dao/proposal/details` - Get proposal information and status
- `POST /api/dao/proposal/vote` - Cast vote on active proposal
- `POST /api/dao/proposal/evaluate` - Evaluate ended proposal

**Action Execution:**
- `GET /api/dao/action/details` - Get action information and readiness
- `POST /api/dao/action/execute` - Execute approved treasury action

**Utility Endpoints:**
- `POST /api/validate-token` - Validate governance token on-chain
- `POST /api/scan-deployments` - Scan for existing script deployments
- `POST /api/check-transaction` - Verify transaction confirmation

### Response Formats

All endpoints return JSON with standardized error handling:
```typescript
// Success Response
{
  success: true,
  data: { ... },
  message?: string
}

// Error Response
{
  error: string,
  details?: any,
  code?: string
}
```
