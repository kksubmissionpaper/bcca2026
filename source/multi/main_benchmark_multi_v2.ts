import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

// ============================================================
// Multi-object benchmark harness
// Purpose: verify the limitation stated in Paper 2 (Workshop):
//   "multi-object transactions may exhibit different cost characteristics"
//   specifically whether the storage cost term generalises to
//   Σ_i 𝟙_persist_i · Psize_i · R_storage across multiple objects.
//
// Covers the multi-object variant of three hypotheses:
//   H1 (Rollback-Depth)   → multi_rollback_{owned|shared}_{2|5|10}
//   H2 (Payload-Sweep)    → multi_payload_{owned|shared}_{2|5|10}
//   H3 (Rebate-Trap)      → multi_rebate_{owned|shared}_{2|5|10}
//
// Balance-Ops is intentionally excluded (not in Paper 2 scope).
// ============================================================

type ObjectType = 'owned' | 'shared';
type ObjectCount = 2 | 5 | 10;

interface TestResult {
  category: string;
  objectType: ObjectType;
  objectCount: ObjectCount;
  pattern: string;
  iteration: number;

  expectedAbort: boolean;
  actualAbort: boolean;
  abortCode?: number;

  gasUsed: number;
  computationCost: number;
  storageCost: number;
  storageRebate: number;
  netGasCost: number;

  wallClockLatency: number;

  errorMessage?: string;
  errorType?: string;

  timestamp: string;
  transactionDigest?: string;
}

class MultiObjectBenchmark {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;

  private allResults: TestResult[] = [];

  private readonly FIXED_GAS_BUDGET = BigInt(process.env.GAS_BUDGET ?? '100000000');
  private readonly SLEEP_BETWEEN_TX_MS = parseInt(process.env.SLEEP_MS ?? '1200', 10);
  private readonly SLEEP_AFTER_SHARED_MS = parseInt(process.env.SLEEP_SHARED_MS ?? '2500', 10);
  private readonly ITERATIONS_ABORT = parseInt(process.env.ITER_ABORT ?? '10', 10);
  private readonly ITERATIONS_PAYLOAD = parseInt(process.env.ITER_PAYLOAD ?? '5', 10);

  private readonly network: 'testnet' | 'mainnet';

  // Shared object IDs pre-created during setup (used by Rollback-Shared only).
  // key: objectCount, value: array of object IDs of that count
  private sharedObjectIds: Map<ObjectCount, string[]> = new Map();

  constructor() {
    const rawNetwork = (process.env.SUI_NETWORK ?? 'testnet').toLowerCase();
    if (rawNetwork !== 'mainnet' && rawNetwork !== 'testnet') {
      throw new Error(`SUI_NETWORK must be 'testnet' or 'mainnet', got: '${rawNetwork}'`);
    }
    this.network = rawNetwork;

    this.client = new SuiClient({ url: getFullnodeUrl(this.network) });

    this.packageId = process.env.PACKAGE_ID!;
    const privateKey = process.env.SUI_PRIVATE_KEY!;

    if (!this.packageId || !privateKey) {
      throw new Error('PACKAGE_ID and SUI_PRIVATE_KEY must be set');
    }

    if (privateKey.startsWith('suiprivkey')) {
      this.keypair = Ed25519Keypair.fromSecretKey(privateKey as any);
    } else {
      const privateKeyBytes = Uint8Array.from(Buffer.from(privateKey, 'hex'));
      this.keypair = Ed25519Keypair.fromSecretKey(privateKeyBytes);
    }
  }

  private buildTx(): Transaction {
    const tx = new Transaction();
    tx.setGasBudget(this.FIXED_GAS_BUDGET);
    return tx;
  }

  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  // ============================================================
  // Setup: pre-create Shared objects needed by Rollback-Shared
  // (multi_rollback_shared_N receives no object args — it creates
  //  and shares internally — so no pre-creation is needed there.
  //  This method is kept as a no-op placeholder in case future
  //  tests need pre-existing shared objects.)
  // ============================================================

  private async setup(): Promise<void> {
    console.log('\n========================================');
    console.log('SETUP: verifying connectivity');
    console.log('========================================');
    const coins = await this.client.getCoins({ owner: this.keypair.getPublicKey().toSuiAddress() });
    console.log(`Wallet: ${this.keypair.getPublicKey().toSuiAddress()}`);
    console.log(`SUI coins available: ${coins.data.length}`);
    if (coins.data.length === 0) throw new Error('No SUI coins in wallet — fund the address first.');
    console.log('Setup OK\n');
  }

  // ============================================================
  // H1 (multi): Rollback-Depth
  // Research question: does the number of objects created and
  // transferred/shared before an abort change gas cost beyond
  // the fixed 1.01M MIST baseline?
  // Prediction (if Paper 2 generalises): cost stays flat.
  // ============================================================

  private async testH1_RollbackDepth(): Promise<void> {
    console.log('\n========================================');
    console.log('H1 (multi): Rollback-Depth');
    console.log('  Does creating N objects before abort change gas?');
    console.log('========================================');

    const counts: ObjectCount[] = [2, 5, 10];

    // --- Owned ---
    for (const n of counts) {
      console.log(`\n--- Owned x${n} ---`);
      for (let i = 1; i <= this.ITERATIONS_ABORT; i++) {
        const tx = this.buildTx();
        tx.moveCall({
          target: `${this.packageId}::taxonomy::multi_rollback_owned_${n}`,
          arguments: [tx.pure.bool(true)], // should_abort = true
        });
        const r = await this.executeAndMeasure(
          'Rollback-Depth', 'owned', n,
          `rollback_owned_${n}`, i, true, tx,
        );
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // --- Shared ---
    for (const n of counts) {
      console.log(`\n--- Shared x${n} ---`);
      for (let i = 1; i <= this.ITERATIONS_ABORT; i++) {
        const tx = this.buildTx();
        tx.moveCall({
          target: `${this.packageId}::taxonomy::multi_rollback_shared_${n}`,
          arguments: [tx.pure.bool(true)], // should_abort = true
        });
        const r = await this.executeAndMeasure(
          'Rollback-Depth', 'shared', n,
          `rollback_shared_${n}`, i, true, tx,
        );
        this.allResults.push(r);
        await this.sleep(this.SLEEP_AFTER_SHARED_MS);
      }
    }
  }

  // ============================================================
  // H2 (multi): Payload-Sweep (Persistence Dominance)
  // Research question: does storage cost scale as
  //   N × Psize × R_storage  (linear in both N and size)?
  // Two sub-cases per ownership model:
  //   (a) persist  — create N objects + transfer/share  (no abort)
  //   (b) ephemeral — create N objects + destroy all    (no abort, owned only)
  // ============================================================

  private async testH2_PayloadSweep(): Promise<void> {
    console.log('\n========================================');
    console.log('H2 (multi): Payload-Sweep (Persistence Dominance)');
    console.log('  Does storage cost = N × Psize × R_storage?');
    console.log('========================================');

    // Same payload sizes as Paper 2 (0–4KB core; 16KB triggers InsufficientGas)
    const sizes = [0n, 1024n, 4096n, 16384n];
    const counts: ObjectCount[] = [2, 5, 10];

    // --- Owned: persist (create N + transfer) ---
    console.log('\n--- Owned: persist (multi_payload_owned_N, should_abort=false) ---');
    for (const n of counts) {
      for (const sz of sizes) {
        for (let i = 1; i <= this.ITERATIONS_PAYLOAD; i++) {
          const tx = this.buildTx();
          tx.moveCall({
            target: `${this.packageId}::taxonomy::multi_payload_owned_${n}`,
            arguments: [tx.pure.u64(sz), tx.pure.bool(false)],
          });
          const r = await this.executeAndMeasure(
            'Payload-Sweep', 'owned', n,
            `payload_persist_owned_${n}_${sz}B`, i, false, tx,
          );
          this.allResults.push(r);
          await this.sleep(this.SLEEP_BETWEEN_TX_MS);
        }
      }
    }

    // --- Owned: abort after persist (create N + transfer + abort) ---
    // Measures whether N persisted objects before abort costs more than baseline.
    console.log('\n--- Owned: persist then abort (multi_payload_owned_N, should_abort=true) ---');
    for (const n of counts) {
      for (const sz of sizes) {
        for (let i = 1; i <= this.ITERATIONS_PAYLOAD; i++) {
          const tx = this.buildTx();
          tx.moveCall({
            target: `${this.packageId}::taxonomy::multi_payload_owned_${n}`,
            arguments: [tx.pure.u64(sz), tx.pure.bool(true)],
          });
          const r = await this.executeAndMeasure(
            'Payload-Sweep', 'owned', n,
            `payload_abort_owned_${n}_${sz}B`, i, true, tx,
          );
          this.allResults.push(r);
          await this.sleep(this.SLEEP_BETWEEN_TX_MS);
        }
      }
    }

    // --- Shared: persist (create N + share) ---
    console.log('\n--- Shared: persist (multi_payload_shared_N, should_abort=false) ---');
    for (const n of counts) {
      for (const sz of sizes) {
        for (let i = 1; i <= this.ITERATIONS_PAYLOAD; i++) {
          const tx = this.buildTx();
          tx.moveCall({
            target: `${this.packageId}::taxonomy::multi_payload_shared_${n}`,
            arguments: [tx.pure.u64(sz), tx.pure.bool(false)],
          });
          const r = await this.executeAndMeasure(
            'Payload-Sweep', 'shared', n,
            `payload_persist_shared_${n}_${sz}B`, i, false, tx,
          );
          this.allResults.push(r);
          await this.sleep(this.SLEEP_AFTER_SHARED_MS);
        }
      }
    }

    // --- Shared: abort after persist (create N + share + abort) ---
    console.log('\n--- Shared: persist then abort (multi_payload_shared_N, should_abort=true) ---');
    for (const n of counts) {
      for (const sz of sizes) {
        for (let i = 1; i <= this.ITERATIONS_PAYLOAD; i++) {
          const tx = this.buildTx();
          tx.moveCall({
            target: `${this.packageId}::taxonomy::multi_payload_shared_${n}`,
            arguments: [tx.pure.u64(sz), tx.pure.bool(true)],
          });
          const r = await this.executeAndMeasure(
            'Payload-Sweep', 'shared', n,
            `payload_abort_shared_${n}_${sz}B`, i, true, tx,
          );
          this.allResults.push(r);
          await this.sleep(this.SLEEP_AFTER_SHARED_MS);
        }
      }
    }
  }

  // ============================================================
  // H3 (multi): Rebate-Trap
  // Research question: when N objects are destroyed before abort,
  // are all N rebates forfeited (as with single-object case)?
  // Sub-cases:
  //   (a) destroy_then_abort  — N objects deleted, then abort
  //   (b) success             — N objects deleted, no abort (baseline)
  // ============================================================

  private async testH3_RebateTrap(): Promise<void> {
    console.log('\n========================================');
    console.log('H3 (multi): Rebate-Trap');
    console.log('  Are all N rebates forfeited on abort?');
    console.log('========================================');

    const counts: ObjectCount[] = [2, 5, 10];

    // --- Owned: destroy N then abort (expect rebate forfeiture) ---
    console.log('\n--- Owned: destroy N then abort (multi_rebate_owned_N) ---');
    for (const n of counts) {
      console.log(`\n  x${n} objects`);
      for (let i = 1; i <= this.ITERATIONS_ABORT; i++) {
        const tx = this.buildTx();
        tx.moveCall({
          target: `${this.packageId}::taxonomy::multi_rebate_owned_${n}`,
          arguments: [],
        });
        const r = await this.executeAndMeasure(
          'Rebate-Trap', 'owned', n,
          `rebate_destroy_then_abort_owned_${n}`, i, true, tx,
        );
        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // --- Shared: create N + share + abort (rebate-trap variant for shared) ---
    console.log('\n--- Shared: create N + share + abort (multi_rebate_shared_N) ---');
    for (const n of counts) {
      console.log(`\n  x${n} objects`);
      for (let i = 1; i <= this.ITERATIONS_ABORT; i++) {
        const tx = this.buildTx();
        tx.moveCall({
          target: `${this.packageId}::taxonomy::multi_rebate_shared_${n}`,
          arguments: [],
        });
        const r = await this.executeAndMeasure(
          'Rebate-Trap', 'shared', n,
          `rebate_share_then_abort_shared_${n}`, i, true, tx,
        );
        this.allResults.push(r);
        await this.sleep(this.SLEEP_AFTER_SHARED_MS);
      }
    }
  }

  // ============================================================
  // Core: execute transaction and measure gas + latency
  // ============================================================

  private async executeAndMeasure(
    category: string,
    objectType: ObjectType,
    objectCount: ObjectCount,
    pattern: string,
    iteration: number,
    expectedAbort: boolean,
    tx: Transaction,
  ): Promise<TestResult> {
    const start = performance.now();
    const timestamp = new Date().toISOString();

    try {
      const result = await this.client.signAndExecuteTransaction({
        signer: this.keypair,
        transaction: tx,
        options: { showEffects: true, showObjectChanges: true },
      });

      const end = performance.now();

      const status = result?.effects?.status?.status;
      const statusError = (result as any)?.effects?.status?.error;

      const gasUsed = result.effects?.gasUsed;
      const computation = parseInt(gasUsed?.computationCost ?? '0', 10);
      const storage = parseInt(gasUsed?.storageCost ?? '0', 10);
      const rebate = parseInt(gasUsed?.storageRebate ?? '0', 10);
      const net = computation + storage - rebate;

      if (status === 'failure') {
        const errStr = String(statusError ?? '');
        const abortCode = this.extractAbortCode(errStr);
        const errorType = this.classifyError(errStr);

        console.log(
          `[${category}/${pattern}] #${iteration} FAIL`
          + ` | expectedAbort=${expectedAbort}`
          + ` | type=${errorType}`
          + ` | code=${abortCode ?? 'n/a'}`
          + ` | netGas=${net}`
          + ` | latency=${(end - start).toFixed(0)}ms`,
        );

        return {
          category, objectType, objectCount, pattern, iteration,
          expectedAbort, actualAbort: true, abortCode,
          gasUsed: net, computationCost: computation,
          storageCost: storage, storageRebate: rebate, netGasCost: net,
          wallClockLatency: end - start,
          errorMessage: errStr.substring(0, 500), errorType,
          timestamp, transactionDigest: result.digest,
        };
      }

      console.log(
        `[${category}/${pattern}] #${iteration} SUCCESS`
        + ` | expectedAbort=${expectedAbort}`
        + ` | netGas=${net}`
        + ` | latency=${(end - start).toFixed(0)}ms`,
      );

      return {
        category, objectType, objectCount, pattern, iteration,
        expectedAbort, actualAbort: false,
        gasUsed: net, computationCost: computation,
        storageCost: storage, storageRebate: rebate, netGasCost: net,
        wallClockLatency: end - start,
        timestamp, transactionDigest: result.digest,
      };

    } catch (error: any) {
      const end = performance.now();

      const errStrParts: string[] = [];
      if (error?.message) errStrParts.push(String(error.message));
      if (error?.data?.effects?.status?.error) errStrParts.push(String(error.data.effects.status.error));
      if (error?.effects?.status?.error) errStrParts.push(String(error.effects.status.error));
      if (error?.cause?.data?.effects?.status?.error) errStrParts.push(String(error.cause.data.effects.status.error));

      const errorMsg = errStrParts.filter(Boolean).join(' | ') || String(error);

      const effectsGasUsed = error?.data?.effects?.gasUsed ?? error?.effects?.gasUsed ?? error?.cause?.data?.effects?.gasUsed;
      const computation = parseInt(effectsGasUsed?.computationCost ?? '0', 10);
      const storage = parseInt(effectsGasUsed?.storageCost ?? '0', 10);
      const rebate = parseInt(effectsGasUsed?.storageRebate ?? '0', 10);
      const net = computation + storage - rebate;

      const abortCode = this.extractAbortCode(errorMsg);
      const errorType = this.classifyError(errorMsg);

      console.log(
        `[${category}/${pattern}] #${iteration} FAIL(catch)`
        + ` | expectedAbort=${expectedAbort}`
        + ` | type=${errorType}`
        + ` | code=${abortCode ?? 'n/a'}`
        + ` | netGas=${net}`
        + ` | latency=${(end - start).toFixed(0)}ms`,
      );

      return {
        category, objectType, objectCount, pattern, iteration,
        expectedAbort, actualAbort: true, abortCode,
        gasUsed: net, computationCost: computation,
        storageCost: storage, storageRebate: rebate, netGasCost: net,
        wallClockLatency: end - start,
        errorMessage: errorMsg.substring(0, 500), errorType,
        timestamp,
      };
    }
  }

  // ============================================================
  // Error helpers (identical logic to single-object harness)
  // ============================================================

  private extractAbortCode(s: string): number | undefined {
    let m = s.match(/MoveAbort\((?:.|\n)*?\},\s*(\d+)\)/);
    if (m) return parseInt(m[1], 10);

    m = s.match(/MoveAbort.*?(\d{1,6})/);
    if (m) return parseInt(m[1], 10);

    if (/arithmetic|overflow/i.test(s)) return 9001;
    if (/division.*zero/i.test(s)) return 9002;
    if (/out of bounds|index out of range/i.test(s)) return 9003;
    if (/InsufficientGas/i.test(s)) return 9100;

    return undefined;
  }

  private classifyError(s: string): string {
    if (/MoveAbort/i.test(s)) return 'MOVE_ABORT';
    if (/MovePrimitiveRuntimeError/i.test(s)) return 'VM_PRIMITIVE_RUNTIME_ERROR';
    if (/not available for consumption|current version/i.test(s)) return 'INPUT_OBJECT_VERSION_CONFLICT';
    if (/arithmetic|overflow/i.test(s)) return 'ARITHMETIC_ERROR';
    if (/division.*zero/i.test(s)) return 'DIVISION_BY_ZERO';
    if (/out of bounds|index out of range/i.test(s)) return 'OUT_OF_BOUNDS';
    if (/InsufficientGas/i.test(s)) return 'INSUFFICIENT_GAS';
    return 'UNKNOWN';
  }

  // ============================================================
  // Export
  // ============================================================

  private exportResults(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `multi_object_benchmark_${this.network}_${ts}.csv`;

    const headers = [
      'category', 'objectType', 'objectCount', 'pattern', 'iteration',
      'expectedAbort', 'actualAbort', 'abortCode',
      'gasUsed', 'computationCost', 'storageCost', 'storageRebate', 'netGasCost',
      'wallClockLatency',
      'errorMessage', 'errorType',
      'timestamp', 'transactionDigest',
    ].join(',');

    const rows = this.allResults
      .map(r => [
        r.category, r.objectType, r.objectCount, r.pattern, r.iteration,
        r.expectedAbort, r.actualAbort, r.abortCode ?? '',
        r.gasUsed, r.computationCost, r.storageCost, r.storageRebate, r.netGasCost,
        r.wallClockLatency.toFixed(2),
        r.errorMessage ? `"${r.errorMessage.replace(/\"/g, '""')}"` : '',
        r.errorType ?? '',
        r.timestamp, r.transactionDigest ?? '',
      ].join(','))
      .join('\n');

    fs.writeFileSync(filename, `${headers}\n${rows}`);
    console.log(`\n✓ Results exported: ${filename}`);
  }

  // ============================================================
  // Summary
  // ============================================================

  private printSummary(): void {
    console.log('\n========================================');
    console.log('MULTI-OBJECT BENCHMARK SUMMARY');
    console.log('========================================');

    const total = this.allResults.length;
    const failed = this.allResults.filter(r => r.actualAbort).length;
    const ok = total - failed;

    console.log(`\nTotal Transactions: ${total}`);
    console.log(` ✓ Succeeded: ${ok}`);
    console.log(` ✗ Failed/Aborted: ${failed}`);

    const mismatch = this.allResults.filter(r => r.expectedAbort !== r.actualAbort);
    console.log(`\nExpectation mismatches: ${mismatch.length}`);
    if (mismatch.length > 0) {
      for (const r of mismatch.slice(0, 8)) {
        console.log(
          `  - ${r.category}/${r.pattern} x${r.objectCount}`
          + ` #${r.iteration} expectedAbort=${r.expectedAbort} actualAbort=${r.actualAbort}`
          + (r.errorType ? ` type=${r.errorType}` : '')
          + (r.abortCode != null ? ` code=${r.abortCode}` : ''),
        );
      }
      if (mismatch.length > 8) console.log(`  ... and ${mismatch.length - 8} more`);
    }

    this.printBreakdown();
  }

  private printBreakdown(): void {
    type Key = string;
    const key = (r: TestResult): Key =>
      `${r.category}||${r.pattern}||${r.objectType}||${r.objectCount}`;

    const groups = new Map<Key, TestResult[]>();
    for (const r of this.allResults) {
      const k = key(r);
      const arr = groups.get(k);
      if (arr) arr.push(r);
      else groups.set(k, [r]);
    }

    const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : 'n/a');
    const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

    const rows = [...groups.entries()].map(([k, rs]) => {
      const [category, pattern, objectType, objectCountStr] = k.split('||');
      const count = rs.length;
      const fail = rs.filter(x => x.actualAbort).length;
      const okCount = count - fail;

      return {
        category, pattern, objectType, objectCount: objectCountStr,
        count, ok: okCount, fail,
        okRate: count ? okCount / count : 0,
        avgNetGas: avg(rs.map(x => x.netGasCost)),
        avgStorageCost: avg(rs.map(x => x.storageCost)),
        avgRebate: avg(rs.map(x => x.storageRebate)),
        avgLat: avg(rs.map(x => x.wallClockLatency)),
      };
    });

    rows.sort((a, b) =>
      a.category.localeCompare(b.category)
      || a.pattern.localeCompare(b.pattern)
      || a.objectType.localeCompare(b.objectType)
      || parseInt(a.objectCount) - parseInt(b.objectCount),
    );

    console.log('\n========================================');
    console.log('BREAKDOWN (category/pattern/objectType/objectCount)');
    console.log('count ok fail okRate | avgNetGas avgStorageCost avgRebate avgLatencyMs');
    console.log('========================================');

    for (const r of rows) {
      console.log(
        `${r.category}/${r.pattern}/${r.objectType}/x${r.objectCount}`
        + ` | count=${r.count} ok=${r.ok} fail=${r.fail} okRate=${(r.okRate * 100).toFixed(1)}%`
        + ` | avgNetGas=${fmt(r.avgNetGas)} avgStorageCost=${fmt(r.avgStorageCost)}`
        + ` avgRebate=${fmt(r.avgRebate)} avgLatencyMs=${fmt(r.avgLat)}`,
      );
    }
  }

  // ============================================================
  // Runner
  // ============================================================

  async runAllTests(): Promise<void> {
    console.log('========================================');
    console.log('MULTI-OBJECT BENCHMARK (Paper 2 Limitation Verification)');
    console.log('========================================');
    console.log(`Network:    ${this.network}`);
    console.log(`Package ID: ${this.packageId}`);
    console.log(`Gas Budget: ${this.FIXED_GAS_BUDGET.toString()}`);
    console.log(`Start Time: ${new Date().toISOString()}`);
    console.log('========================================');

    try {
      await this.setup();

      // H1: Rollback-Depth (multi)
      await this.testH1_RollbackDepth();

      // H2: Payload-Sweep (multi)
      await this.testH2_PayloadSweep();

      // H3: Rebate-Trap (multi)
      await this.testH3_RebateTrap();

      this.exportResults();
      this.printSummary();
    } catch (e) {
      console.error('\n✗ Benchmark failed:', e);
      if (this.allResults.length > 0) {
        this.exportResults();
        console.log('\n⚠ Partial results exported');
      }
    } finally {
      console.log(`\nEnd Time: ${new Date().toISOString()}`);
    }
  }
}

async function main() {
  if (!process.env.PACKAGE_ID || !process.env.SUI_PRIVATE_KEY) {
    console.error('Error: PACKAGE_ID and SUI_PRIVATE_KEY must be set in .env');
    process.exit(1);
  }

  const network = (process.env.SUI_NETWORK ?? 'testnet').toLowerCase();
  if (network !== 'testnet' && network !== 'mainnet') {
    console.error(`Error: SUI_NETWORK must be 'testnet' or 'mainnet', got: '${network}'`);
    process.exit(1);
  }

  const benchmark = new MultiObjectBenchmark();
  await benchmark.runAllTests();
}

main().catch(console.error);

export { MultiObjectBenchmark };
