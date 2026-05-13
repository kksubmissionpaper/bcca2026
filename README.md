This repository contains the Move smart contracts, the TypeScript benchmarking suite, test result etc.

Move.toml: The manifest file for the Move package, defining dependencies and named addresses.
abort_test.move: A Sui Move module designed for testing transaction abort scenarios.
This Sui Move module, abort_test::taxonomy, is a test suite designed to benchmark error handling (Abort), gas calculations, and state rollback behavior in Sui Move.

MOVE_multi.toml: Intentionally renamed for same-repo storage from Move.toml.The manifest file for the another Move package, defining dependencies and named addresses. multi_object_abort_test.move: A Sui Move module designed for testing transaction abort scenarios. This Sui Move module, multi_object_abort_test::taxonomy, is a test suite designed to benchmark error handling (Abort), gas calculations, and state rollback behavior in Sui Move for multi objects.

Primary Structures:

The Move module for single object defines two benchmark object types: OwnedTestObject (ownership model) and SharedTestObject (shared object model). 
Also, the Move module for multi objects defines two benchmark object types: OwnedTestObject (ownership model) and SharedTestObject (shared object model). This module extends the single-object baseline to test three abort categories (State Rollback, Rebate Trap, and Payload Sweep) across three object-count tiers (_2, _5, _10) for both ownership models.
See ReadmeTS.txt for details.

Note: On the client-side TypeScript script, create multiple shared objects for each test scenario upfront. This prevents transaction serialization. (Due to Sui's mechanism, transactions writing to a single shared object are queued sequentially.)

EVALUETOOSMALL

Error constant for threshold check failure (100)

EREBATE_EXPERIMENT

Intentional error constant for rebate experiments (999)

Usage:

Deployment: Deploy this package to the Sui blockchain (mainnet).

Execution: Call each function from TypeScript (client side).

Measurement: Analyze transaction results to examine gas consumption (Computation Cost, Storage Cost, Rebate) until errors occur.

workshop_benchmark_mainnet_yyyy-MM-ddTHH-mm-ss.csv: Result CSV file by the tests (single object).
multi_object_benchmark_mainnet_yyyy-MM-ddTHH-mm-ss.csv: Result CSV file by the tests (multi object)
main_benchmark_workshop_v3.ts: The entry point for the TypeScript-based benchmarking script (single object).
main_benchmark_multi_v2.ts: The entry point for the TypeScript-based benchmarking script (multi object).
package.json: Defines Node.js dependencies and scripts for the project.
tsconfig.json: Configuration file for the TypeScript compiler.
ReadmeTS_workshop.txt: A technical notes specifically for the TypeScript test script.
