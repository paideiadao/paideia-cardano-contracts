# Paideia - Building Blocks for DAO Management: Project Close-out Report

## Project Information

| Field | Details |
|-------|---------|
| **Project Name** | Paideia: Building Blocks for DAO Management |
| **Project URL** | https://projectcatalyst.io/funds/11/cardano-open-developers/paideia-building-blocks-for-dao-management |
| **Project Number** | 1100227 |
| **Project Start Date** | March 11, 2024 |
| **Project Completion Date** | September 2025 |

---

## Challenge KPIs and How the Project Addressed Them

The F11 "Cardano Open: Developers" challenge focused on improving the Cardano developer experience through open source technology.

| Challenge KPI | How Addressed |
|---------------|---------------|
| Open source tooling for Cardano developers | Complete smart contract suite and frontend published under GPL-3.0 |
| Improving developer experience | Extensive reusable TypeScript utilities for Plutus data handling, address conversion, CIP-68 metadata, transaction building patterns |
| Reusable components for ecosystem | Modular architecture allows developers to extract and use individual components (caching layer, address parsing, token minting) without adopting the full platform |

---

## Project KPIs and How the Project Addressed Them

| Project KPI | Status | Evidence |
|-------------|--------|----------|
| On-chain proposals | Delivered | TX: `708d920fc071fc3cc3f6fb4f8dc92b3b43d9ff12aa8a7386f568cb594e60b311` |
| Treasury spending execution | Delivered | TX: `2d2cc69bf22e16c6f452e9906e6be6dc45f65c9cfd704523fe2b75d2ce128009` |
| Open source contracts under GPL | Delivered | https://github.com/paideiadao/paideia-cardano-contracts |
| Documentation enabling community use | Delivered | README, setup guides, architecture docs, and inline code documentation |

---

## Key Achievements

### Technical Delivery

**Smart Contracts (Aiken)**
- 6 parameterized validators: DAO, Proposal, Vote, Treasury, Action (Send Funds), and associated minting policies
- CIP-68 compliant vote receipt system preventing double-voting across concurrent proposals
- Unique token identifiers derived from UTXO references using blake2b-256 hashing
- Complete test suite with property-based testing

**Frontend-Driven Reference Script Deployment**

A significant innovation: end users can deploy their own reference scripts directly from the web interface. This is critical because Cardano transactions are limited to 16kb, and without reference scripts, governance transactions exceed this limit. Our solution:

- Scans the burn address for existing script deployments to avoid duplicates
- Builds deployment transactions client-side using Blaze SDK
- Deploys scripts to the burn address (permanently available, unspendable)
- Tracks deployment status with retry capability for failed scripts
- Exports deployment configuration as JSON for application integration

**Complete CIP-68 Token Suite**

Full implementation of the CIP-68 token metadata standard from frontend form to deployed tokens:

- `TokenMintForm` component for creating governance tokens with proper metadata
- Support for all three CIP-68 standards: NFTs (222), Fungible Tokens (333), Rich Fungible Tokens (444)
- `cip68-metadata.ts` utilities for metadata validation, Plutus CBOR conversion, and datum construction
- Reference/user token pair minting patterns (the "0000" reference NFT + "0001" user NFT pattern)
- Token validation endpoint for using existing tokens as governance tokens

**Off-Chain Infrastructure**

*Plutus Data Handling:*
- `address-parsing.ts` — Bidirectional conversion between Cardano addresses and Plutus Data, handling base addresses, enterprise addresses, script credentials, and stake credentials
- `proposal-helpers.ts` — Complete datum parsing for proposals, actions, vote receipts, tally tracking, and proposal status evaluation
- `script-helpers.ts` — Parameterized script creation, policy ID derivation, and script address generation

*Transaction Building:*
- Full integration with **Blaze SDK** for transaction construction
- Reference script usage reducing transaction sizes
- Collateral handling, validity intervals, and redeemer construction
- Complex multi-input/multi-output patterns for governance operations

*Blockchain Data Access:*
- **Maestro API** integration for UTXO queries, transaction history, and chain state
- **PostgreSQL** caching layer via **Prisma ORM** with configurable TTLs
- Transaction-to-address indexing for efficient action discovery
- Automatic cache invalidation and cleanup

*Wallet Integration:*
- CIP-30 wallet connection via **MeshSDK** (Nami, Eternl, Lace, and others)
- UTXO selection algorithms for governance token aggregation
- Seed UTXO detection avoiding vote NFT conflicts

### Collaboration & Engagement

- Worked with the Blaze SDK for transaction building patterns
- Integrated Maestro API for reliable blockchain data
- Published all learnings and code for ecosystem benefit under GPL-3.0

### Technical Challenges Overcome

- Developed vote receipt cleanup system handling multiple concurrent proposals
- Solved governance token withdrawal issues when users have outstanding votes on unevaluated proposals
- Built proper error detection to inform users when proposals need evaluation before token withdrawal
- Created the reference script deployment flow allowing non-technical users to deploy complex Plutus scripts

---

## Impact

### Deliverables

- Working testnet deployment demonstrating complete DAO lifecycle
- 6 Aiken validators covering all core governance operations
- Full web interface enabling non-technical users to create and manage DAOs
- Extensive TypeScript utilities for Cardano application development
- Complete CIP-68 token minting system
- Reference script deployment tooling

### Ecosystem Contribution

- First complete, open-source DAO management platform built natively for Cardano's UTXO model
- Fills gap left by Summon (shut down) and provides more complete solution than Agora (off-chain voting only)
- Reusable patterns and utilities for other Cardano developers:
  - Plutus Data ↔ TypeScript conversion patterns
  - Maestro caching layer (copy `utxo-cache.ts` directly)
  - CIP-68 metadata utilities
  - Reference script deployment flow
  - Address parsing for complex credential types

---

## Why This Project Matters

Cardano has lacked user-friendly DAO tooling with genuine on-chain execution. Existing solutions either shut down (Summon) or rely on off-chain voting without automated treasury execution (Agora). Paideia delivers what the ecosystem has been missing: a complete governance platform where community votes directly trigger smart contract actions without human intervention.

When a DAO votes to spend funds, those funds move automatically. No multisig signers to trust, no manual execution step where someone could refuse or delay. This is what decentralized governance should look like.

Beyond the DAO platform itself, this project produced substantial reusable infrastructure. The Plutus data handling utilities, CIP-68 implementation, caching patterns, and reference script deployment flow can all be extracted and used by other Cardano projects. The GPL license ensures this work benefits the entire ecosystem permanently.

---

## Relevant Links

**Repositories:**
- Main Repository: https://github.com/paideiadao/paideia-cardano-contracts
- Smart Contracts: https://github.com/paideiadao/paideia-cardano-contracts/tree/main/dao_contracts
- Frontend Application: https://github.com/paideiadao/paideia-cardano-contracts/tree/main/frontend
- License: GPL-3.0

**Testnet Transaction Evidence:**
- Proposal Creation: https://preview.cardanoscan.io/transaction/708d920fc071fc3cc3f6fb4f8dc92b3b43d9ff12aa8a7386f568cb594e60b311
- Voting: https://preview.cardanoscan.io/transaction/a68887d9e0015f1b79674862519d1b4e8ce7c205904d38e15371a227e0e41148
- Treasury Spending: https://preview.cardanoscan.io/transaction/2d2cc69bf22e16c6f452e9906e6be6dc45f65c9cfd704523fe2b75d2ce128009

**Platform Demo:** https://www.youtube.com/watch?v=pM1USHL438A

**Close-out Video:** https://www.youtube.com/watch?v=azO9lFTHmbc

---

## What's Next

The project deliverables are complete and published under GPL license. The codebase is available at https://github.com/paideiadao/paideia-cardano-contracts for any Cardano projects or community members seeking DAO governance infrastructure or reusable off-chain components.

The modular architecture allows developers to integrate individual utilities without adopting the full platform:
- Extract `address-parsing.ts` for Plutus address handling
- Use `cip68-metadata.ts` for token metadata
- Copy the `utxo-cache.ts` caching pattern for any Maestro-based application
- Reference the script deployment flow for other complex validator deployments
