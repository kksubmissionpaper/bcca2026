This repository contains the Move smart contracts (sample code of digital product passports)

## Overview
This digital product passport sample smart contract has been developed by Sui Move. It covers the entire lifecycle of the product, starting with raw material issuance, through manufacturing and supply chain transfers, to disposal and recycling at the end of the lifecycle.

## Module Structure
**Module name:** `dpp_test::dpp`
| Import | Purpose |
|---|---|
| `std::string::{Self, String}` | Creating and manipulating UTF-8 strings |
| `sui::object` *(implicit)* | Generating UIDs via `object::new` |
| `sui::transfer` *(implicit)* | Transferring object ownership |
| `sui::tx_context` *(implicit)* | Retrieving the sender address and transaction timestamp |

## Data Structures

### 3.1 RawMaterial
On-chain representation of a raw material issued by a supplier. This has the abilities of `key` and `store`. The `key` ability allows it to exist as a standalone on-chain object before manufacturing; the `store` ability allows it to be embedded (wrapped) into a `ProductPassport` at manufacturing time. Once wrapped, it is no longer accessible as an independent object.

| Field | Description |
|---|---|
| `id: UID` | Sui object unique identifier, generated via `object::new` |
| `material_name: String` | Name of the material (e.g. `"Organic Cotton"`) |
| `origin: String` | Country or region of origin (e.g. `"India"`) |
| `supplier: address` | The wallet address of the supplier — immutable |
| `carbon_footprint: u64` | Carbon footprint of the raw material (unit: gCO₂e) |

### 3.2 LifecycleEvent
Struct representing events happening to the product. This has the abilities of `store` and `drop`, and it forms part of the `ProductPassport` struct directly.

| Field | Description |
|---|---|
| `event_type: String` | One of `"manufactured"`, `"transferred"`, `"repaired"`, or `"recycled"` |
| `actor: address` | The wallet address of the party who triggered the event |
| `timestamp_ms: u64` | Transaction timestamp in milliseconds |
| `metadata: String` | Arbitrary additional information about the event |

### 3.3 ProductPassport
On-chain representation of the actual product itself. This has the abilities of `key` and `store`, following the Sui object structure. At manufacturing time, a `RawMaterial` object is wrapped directly into this struct.

| Field | Description |
|---|---|
| `id: UID` | Sui object unique identifier, generated via `object::new` |
| `product_id: String` | A string that uniquely identifies the product |
| `manufacturer: address` | The wallet address of the manufacturer — immutable |
| `material: RawMaterial` | The raw material object wrapped at manufacturing time |
| `carbon_footprint: u64` | Carbon footprint of the manufacturing process (unit: gCO₂e) |
| `current_owner: address` | The wallet address of the current owner |
| `status: String` | One of `"active"`, `"transferred"`, or `"recycled"` |
| `events: vector<LifecycleEvent>` | A chronological list of all lifecycle events |

## Error Codes
| Constant | Value & Meaning |
|---|---|
| `E_NOT_OWNER` | `1` — Aborts when the caller's address does not match `current_owner` |
| `E_ALREADY_RECYCLED` | `2` — Aborts when attempting to recycle a product that has already been recycled |

## Lifecycle Flow
| Step | Function / State |
|---|---|
| 1. Material issuance | `mint_material` → `RawMaterial` object created, owned by supplier |
| 2. Manufacturing | `manufacture` → `RawMaterial` wrapped into `ProductPassport`; status: `"active"` |
| 3. Supply chain transfer | `transfer_passport` → status: `"transferred"` |
| 4. Repair or modification *(optional, repeatable)* | `record_repair` → status unchanged |
| 5. Disposal or recycling | `recycle_product` → status: `"recycled"` *(terminal state)* |

## Read-only Accessors
| Function | Returns | Description |
|---|---|---|
| `material_name(passport)` | `&String` | Name of the wrapped raw material |
| `material_origin(passport)` | `&String` | Origin of the wrapped raw material |
| `total_carbon(passport)` | `u64` | Sum of raw material and manufacturing carbon footprints |
