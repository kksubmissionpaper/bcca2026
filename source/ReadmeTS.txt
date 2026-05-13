## Overview
Benchmarking suite for Sui Move smart contract gas consumption, rollback behavior, and storage rebate mechanisms using TypeScript SDK.
Implements the three empirical hypotheses (H1 / H2 / H3) from the paper "Abort Economics in Sui Move: Gas Bucketing, Persistence Dominance, and the Rebate Trap".

## Purpose
Measures gas costs, rollback behavior and rebate mechanics across varying abort depths, object payload sizes, and storage-rebate edge cases on Sui mainnet.
155 on-chain trials in each mainnet envs, total 310 on-chain trials.

## Test Categories

### H1: Rollback-Depth — Computation-Proportional Costs (abort_test::taxonomy::test_rollback_shallow/medium/deep_owned/ multi_object_abort_test::taxonomy::multi_rollback_owned_N)
Hypothesis: deeper aborts (more instructions before failure) incur higher gas costs, borrowing from Ethereum's computation-centric model.
Expected result (confirmed): gas cost is flat regardless of abort depth due to Sui's gas bucketing mechanism.

All failed transactions converge to a fixed baseline fee — 0.20M MIST on Mainnet — regardless of execution depth or error type.

Tests abort behavior at 3 depth levels (shallow / medium / deep) using owned objects only.
- 20 iterations per depth (all abort cases)
- Shared Objects are intentionally excluded to avoid consensus delay or lock contention

Depth levels:
- Shallow: An error occurs after performing simple calculations or calling another function once or twice.
- Medium: An error occurs within a chain of function calls spanning 3–5 layers.
- Deep: An error occurs after a sequence of 6 or more nested function calls.

### H2: Payload-Sweep — Persistence Dominance (abort_test::taxonomy::payload_create_owned, payload_create_destroy_owned, payload_create_shared / multi_object_abort_test::taxonomy::multi_payload_owned_N, multi_payload_shared_N)
Hypothesis: persistence choices are the dominant cost factor, surpassing computation by more than one order of magnitude (10–30×).
Expected result (confirmed): at 4 KB, a persistent object costs 163× more than ephemeral on Mainnet (single object).

Compares ephemeral (create + destroy, rebate path) vs. persistent (create + transfer/share) patterns across varying payload sizes.

Payload sizes tested: 0, 1 KB, 4 KB, 16 KB, 64 KB

Note: 16 KB and 64 KB cases exceeded the gas budget and resulted in InsufficientGas errors; these are excluded from the paper's analysis.

Sub-patterns:
- Owned persist: payload_create_owned — create + transfer to self (5 iterations per size)
- Owned ephemeral: payload_create_destroy_owned — create + destroy, rebate path (5 iterations per size)
- Shared persist: payload_create_shared — create + share (3 iterations per size)
- Owned persist-then-abort: 'multi_payload_owned_N' (shouldAbort=true) — create N objects + transfer, then abort; measures whether N pending storage writes before abort incur additional cost beyond the fixed baseline (5 iterations per size × N)
- Shared persist-then-abort: 'multi_payload_shared_N' (shouldAbort=true) — create N objects + share, then abort; same measurement for shared ownership type (5 iterations per size × N)

Expected result (confirmed): net gas cost converges to the fixed baseline (0.20 M MIST) regardless of N or payload size, consistent with gas bucketing (H1).

### H3: Rebate-Trap — Rebate Forfeiture on Abort (abort_test::taxonomy::test_rebate_success_owned, test_rebate_abort_owned, test_rebate_destroy_then_abort_owned / multi_object_abort_test::taxonomy::multi_rebate_owned_N, multi_object_abort_test::taxonomy::multi_rebate_shared_N)
Hypothesis: transaction abort forfeits pending storage rebates even after explicit object destruction. Sui's transaction atomicity supersedes cleanup operations, creating a "rebate trap".
Expected result (confirmed): no rebate is credited on any aborted transaction, even when an object is explicitly destroyed before the abort.

Three sub-cases (10 iterations each, all owned):
1. Success case (rebate_success): create → destroy → commit — rebate is credited
2. Abort before destroy (abort_before_destroy): create → abort — no destruction, no rebate
3. Destroy then abort (destroy_then_abort): create → destroy → abort — rebate is forfeited despite destruction having occurred

Net gas cost is identical across all three abort patterns (baseline fee only), confirming rebate forfeiture.


## Setup

### Prerequisites
- Node.js
- Sui TypeScript SDK (@mysten/sui)
- Deployed Sui Move contract (`taxonomy` module) on Sui mainnet, in the case we built separated two different envs, one is for single object, the other is for multi objects

### Environment Variables (.env)

| Variable | Description |
|---|---|
| PACKAGE_ID | The unique identifier of the deployed Sui Move package. |
| SUI_PRIVATE_KEY | The secret key for the test wallet (suiprivkey… format or raw hex). Keep this secure and never share it. |
| SUI_ADDRESS | The test wallet address used for signing transactions and paying gas fees. |
| SUI_NETWORK | Target network: 'testnet' (default) and 'mainnet'. |
| GAS_BUDGET | Fixed gas budget per transaction in MIST (default: 100000000). |
| SLEEP_MS | Sleep duration between transactions in ms (default: 1200). |
| SLEEP_SHARED_MS | Sleep duration after shared object transactions in ms (default: 2500). |

Note: UPGRADE_CAP is not required for running this benchmark.

## Execution (in powershell)
```
(mainnet - single)
$env:SUI_NETWORK="mainnet"
$env:PACKAGE_ID="0xYOUR_PACKAGE_ID_HERE"
$env:SUI_PRIVATE_KEY="YOUR_PRIVATE_KEY"
npx ts-node main_benchmark_workshop_v3.ts

(mainnet - multi)
$env:SUI_NETWORK="mainnet"
$env:PACKAGE_ID="0xYOUR_PACKAGE_ID_HERE"
$env:SUI_PRIVATE_KEY="YOUR_PRIVATE_KEY"
npx ts-node main_benchmark_multi_v2.ts


```

## Output
- CSV file: 'workshop_benchmark_mainnet_YYYY-MM-DDTHH-MM-SS.csv' (single object), 'multi_object_bentimark_mainnet_YYYY-MM-DDTHH-MM-SS.csv' (multi object)
- Console: Per-transaction log, summary statistics, and breakdown by category/pattern/objectType/depth

### CSV columns 
category, objectType, abortDepth, pattern, iteration,
expectedAbort, actualAbort, abortCode,
gasUsed, computationCost, storageCost, storageRebate, netGasCost,
wallClockLatency, executionTime,
errorMessage, errorType,
timestamp, transactionDigest

## Notes
- All tests run on Sui mainnet (controlled by SUI_NETWORK)
- Fixed gas budget is applied to every transaction (default 100,000,000 MIST)
- H1 (Rollback-Depth) uses only owned objects to minimize consensus-related variance
- H2 (Payload-Sweep) shared pattern uses a longer sleep (SLEEP_SHARED_MS) between transactions
- Persist-then-abort patterns are measured in 'main_benchmark_multi_v2.ts' only.
- If the benchmark fails mid-run, partial results are automatically exported
- wallClockLatency, executionTime columns on csv - captured but excluded from paper analysis
