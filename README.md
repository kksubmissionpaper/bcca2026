This repository contains the Move smart contracts (sample code of digital product passports)

## Overview

This sample smart contract implements a Digital Product Passport (DPP) on the Sui blockchain.
It represents the full lifecycle of a product — from manufacturing through to end-of-life disposal and recycling.

## Module Structure

**Module name:** `dpp_test::dpp`

| Import | Purpose |
|---|---|
| `std::string::{Self, String}` | Creating and manipulating UTF-8 strings |
| `sui::object` *(implicit)* | Generating UIDs via `object::new` |
| `sui::transfer` *(implicit)* | Transferring object ownership |
| `sui::tx_context` *(implicit)* | Retrieving the sender address and transaction timestamp |

## Data Structures

### 3.1 LifecycleEvent

A struct that records each event occurring on a product. It carries the `store` and `drop` abilities, and is embedded directly within the `ProductPassport`.

### 3.2 ProductPassport

An on-chain object representing the product itself. It carries the `key` and `store` abilities, and follows Sui's object model for ownership and transfer.

| Field | Description |
|---|---|
| `id: UID` | Sui object unique identifier, generated via `object::new` |
| `product_id: String` | A string that uniquely identifies the product |
| `manufacturer: address` | The wallet address of the manufacturer — immutable |
| `material_composition: String` | Information about the product's materials and components |
| `carbon_footprint: u64` | Carbon footprint value (unit: gCO₂e) |
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
| 1. Manufacturing | `mint_passport` → status: `"active"` |
| 2. Supply chain transfer | `transfer_passport` → status: `"transferred"` |
| 3. Repair or modification *(optional, repeatable)* | `record_repair` → status unchanged |
| 4. Disposal or recycling | `recycle_product` → status: `"recycled"` *(terminal state)* |
