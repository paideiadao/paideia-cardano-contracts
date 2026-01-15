# Paideia - Building Blocks for DAO Management: Project Close-out Report

## Project Information

| Field | Details |
|-------|---------|
| **Name of Project** | Paideia: Building Blocks for DAO Management |
| **Project URL** | https://projectcatalyst.io/funds/11/cardano-open-developers/paideia-building-blocks-for-dao-management |
| **Project Number** | 1100227 |
| **Name of Project Manager** | Martin Morley |
| **Date Project Started** | March 11, 2024 |
| **Date Project Completed** | January 15, 2026 |

---

## List of Challenge KPIs and How the Project Addressed Them

The F11 "Cardano Open: Developers" challenge focused on improving the Cardano developer experience through open source technology.

| Challenge KPI | How Addressed |
|---------------|---------------|
| Open source tooling for Cardano developers | Complete smart contract suite and frontend published under GPL-3.0 |
| Improving developer experience | Extensive reusable TypeScript utilities for Plutus data handling, address conversion, CIP-68 metadata, transaction building patterns |
| Reusable components for ecosystem | Modular architecture allows developers to extract and use individual components (caching layer, address parsing, token minting) without adopting the full platform |

---

## List of Project KPIs and How the Project Addressed Them

| Project KPI | Status | Evidence |
|-------------|--------|----------|
| On-chain proposals | ✅ Delivered | TX: `708d920fc071fc3cc3f6fb4f8dc92b3b43d9ff12aa8a7386f568cb594e60b311` |
| Treasury spending execution | ✅ Delivered | TX: `2d2cc69bf22e16c6f452e9906e6be6dc45f65c9cfd704523fe2b75d2ce128009` |
| Open source contracts under GPL | ✅ Delivered | https://github.com/paideiadao/paideia-cardano-contracts |
| Documentation enabling community use | ✅ Delivered | README, setup guides, architecture docs, and inline code documentation |

---

## Key Achievements

### Technical Delivery

**Smart Contracts (Aiken)**
- 6 parameterized validators: DAO, Proposal, Vote, Treasury, Action (Send Funds), and associated minting policies
- CIP-68 compliant vote receipt system preventing double-voting across concurrent proposals
- Unique token identifiers derived from UTXO references using blake2b-256 hashing
- Complete test suite with property-based testing

**Frontend-Driven Reference Script Deployment**

End users can deploy their own reference scripts directly from the web interface. This is critical because Cardano transactions are limited to 16kb, and without reference scripts, governance transactions exceed this limit. Our solution:

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
- Reference/user token pair minting patterns
- Token validation endpoint for using existing tokens as governance tokens

**Off-Chain Infrastructure**

- `address-parsing.ts` - Bidirectional conversion between Cardano addresses and Plutus Data
- `proposal-helpers.ts` - Complete datum parsing for proposals, actions, vote receipts, and tally tracking
- `script-helpers.ts` - Parameterized script creation, policy ID derivation, and script address generation
- Full integration with Blaze SDK, Maestro API, and PostgreSQL caching via Prisma ORM
- CIP-30 wallet connection via MeshSDK

### Collaboration and Engagement

- Worked with the Blaze SDK for transaction building patterns
- Integrated Maestro API for reliable blockchain data
- Published all learnings and code for ecosystem benefit under GPL-3.0

---

## Key Learnings

1. **Datum parsing requires significant manual work.** When building stateful dApps on Cardano, you must continuously read on-chain state. In our case, that was vote tallies, action targets, proposal status, etc. The Blaze SDK handles transaction building, but when reading existing on-chain data, it returns raw PlutusData. Automated TypeScript codegen from Aiken blueprints didn't exist during our development (though such tooling was funded in later Catalyst rounds). We built extensive custom utilities for parsing nested CBOR structures into usable TypeScript types.

2. **Address handling is more complex than expected.** Converting between bech32 addresses and Plutus Data representations requires handling base addresses, enterprise addresses, script credentials, and stake credentials. We built bidirectional conversion utilities that other developers can reuse.

3. **Transaction size limits require architectural planning.** Cardano's 16kb transaction limit meant we couldn't include validator scripts inline. We designed a reference script deployment system that lets users deploy scripts to the burn address and reference them in transactions, dramatically reducing transaction sizes.

4. **Scope adjustments can add value.** The original proposal specified CLI tooling, but we built a full web frontend instead. This provided faster testing during development and more ecosystem value because non-technical users can now interact with DAOs without command-line knowledge.

5. **Console logging is documentation.** We left extensive console logs in the codebase because debugging Plutus transactions is difficult. These logs serve as implicit documentation for anyone trying to understand the transaction flows.

---

## Next Steps for the Product or Service Developed

The project deliverables are complete and published under GPL license at https://github.com/paideiadao/paideia-cardano-contracts.

**For the Paideia platform:**
- We have requested funding for mainnet deployment in subsequent funds but were unsuccessful
- The system currently only supports "send funds" actions; we'd like to add support for DAOs interacting with arbitrary smart contracts
- A security review would be required before mainnet launch
- If anyone has appetite to continue this work, the team is available

**For the ecosystem:**
- Developers can extract individual utilities without adopting the full platform
- `address-parsing.ts` for Plutus address handling
- `cip68-metadata.ts` for token metadata
- `utxo-cache.ts` caching pattern for Maestro-based applications
- Reference script deployment flow for complex validator deployments

---

## Final Thoughts/Comments

DAOs should be automated. Most DAO behavior in crypto involves some on-chain vote tally followed by manual fund transfers or trusted multisig wallets. We built Paideia to demonstrate what fully decentralized governance looks like: when a DAO votes to spend funds, those funds move automatically with no human intermediary.

Beyond the DAO platform itself, this project produced substantial reusable infrastructure. The Plutus data handling utilities, CIP-68 implementation, caching patterns, and reference script deployment flow can all be extracted and used by other Cardano projects. The GPL license ensures this work benefits the entire ecosystem permanently.

We want to thank the Cardano community for funding this project and trusting us to produce it. It was a great learning experience and we hope the code is useful to others.

---

## Links to Other Relevant Project Sources or Documents

**Repositories:**
- Main Repository: https://github.com/paideiadao/paideia-cardano-contracts
- Smart Contracts: https://github.com/paideiadao/paideia-cardano-contracts/tree/main/dao_contracts
- Frontend Application: https://github.com/paideiadao/paideia-cardano-contracts/tree/main/frontend
- License: GPL-3.0

**Testnet Transaction Evidence:**
- Proposal Creation: https://preview.cardanoscan.io/transaction/708d920fc071fc3cc3f6fb4f8dc92b3b43d9ff12aa8a7386f568cb594e60b311
- Voting: https://preview.cardanoscan.io/transaction/a68887d9e0015f1b79674862519d1b4e8ce7c205904d38e15371a227e0e41148
- Treasury Spending: https://preview.cardanoscan.io/transaction/2d2cc69bf22e16c6f452e9906e6be6dc45f65c9cfd704523fe2b75d2ce128009

**Platform Demo Video:** https://www.youtube.com/watch?v=pM1USHL438A

---

## Link to Close-out Video

https://www.youtube.com/watch?v=azO9lFTHmbc
