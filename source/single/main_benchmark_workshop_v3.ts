import { SuiClient, getFullnodeUrl } from '@mysten/sui/client';
import { Ed25519Keypair } from '@mysten/sui/keypairs/ed25519';
import { Transaction } from '@mysten/sui/transactions';
import * as fs from 'fs';
import * as dotenv from 'dotenv';

dotenv.config();

type ObjectType = 'owned' | 'shared' | 'none';
type AbortDepth = 'early' | 'shallow' | 'medium' | 'deep' | 'na';

interface TestResult {
  category: string;
  objectType: ObjectType;
  abortDepth: AbortDepth;
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
  executionTime: number;

  errorMessage?: string;
  errorType?: string;

  timestamp: string;
  transactionDigest?: string;
}

class H1H2H3Benchmark {
  private client: SuiClient;
  private keypair: Ed25519Keypair;
  private packageId: string;

  private allResults: TestResult[] = [];

  private readonly FIXED_GAS_BUDGET = BigInt(process.env.GAS_BUDGET ?? '100000000');

  private readonly SLEEP_BETWEEN_TX_MS = parseInt(process.env.SLEEP_MS ?? '1200', 10);
  private readonly SLEEP_AFTER_SHARED_MS = parseInt(process.env.SLEEP_SHARED_MS ?? '2500', 10);

  private readonly network: 'testnet' | 'mainnet';

  constructor() {
    // SUI_NETWORK=mainnet or testnet (default: testnet)
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
  // H1: Rollback-Depth
  // Hypothesis: deeper aborts (more objects rolled back before abort)
  // incur higher gas costs.
  // Expected result: gas is constant regardless of rollback depth
  // (gas bucketing masks object-count differences).
  // ============================================================

  private async testH1_RollbackDepth(): Promise<void> {
    console.log('\n========================================');
    console.log('H1: Rollback-Depth (Object Rollback Depth)');
    console.log('========================================');

    const depths: AbortDepth[] = ['shallow', 'medium', 'deep'];

    for (const depth of depths) {
      console.log(`\n--- Depth: ${depth} ---`);

      for (let iteration = 1; iteration <= 20; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::test_rollback_${depth}_owned`,
          arguments: [],
        });

        const r = await this.executeAndMeasure(
          'Rollback-Depth',
          'owned',
          depth,
          `rollback_${depth}`,
          iteration,
          true,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }
  }

  // ============================================================
  // H2: Persistence Dominance (Payload-Sweep)
  // Hypothesis: storage cost dominates by >10× over computation.
  // Compares ephemeral (create+destroy) vs. persistent (create+transfer)
  // patterns across payload sizes 0–4KB (owned) and 0–4KB (shared).
  // ============================================================

  private async testH2_PayloadSweep(): Promise<void> {
    console.log('\n========================================');
    console.log('H2: Payload-Sweep (Persistence Dominance)');
    console.log('========================================');

    // 0–4KB range used in the paper; include 16KB to trigger InsufficientGas (H2 boundary)
    const sizes = [0n, 1024n, 4096n, 16384n, 65536n];

    // --- Owned: persist (create + transfer to self) ---
    console.log('\n--- Owned: payload_create_owned (persist) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 5; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_owned`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'owned',
          'na',
          `payload_create_owned_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // --- Owned: ephemeral (create + destroy, rebate path) ---
    console.log('\n--- Owned: payload_create_destroy_owned (ephemeral/rebate) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 5; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_destroy_owned`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'owned',
          'na',
          `payload_create_destroy_owned_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_BETWEEN_TX_MS);
      }
    }

    // --- Shared: persist (create + share) ---
    console.log('\n--- Shared: payload_create_shared (persist) ---');
    for (const sz of sizes) {
      for (let iteration = 1; iteration <= 3; iteration++) {
        const tx = this.buildTx();

        tx.moveCall({
          target: `${this.packageId}::taxonomy::payload_create_shared`,
          arguments: [tx.pure.u64(sz)],
        });

        const r = await this.executeAndMeasure(
          'Payload-Sweep',
          'shared',
          'na',
          `payload_create_shared_${sz}`,
          iteration,
          false,
          tx,
        );

        this.allResults.push(r);
        await this.sleep(this.SLEEP_AFTER_SHARED_MS);
      }
    }
  }

  // ============================================================
  // H3: Rebate-Trap
  // Hypothesis: aborting after explicit object destruction forfeits
  // the pending storage rebate (atomicity nullifies rebate).
  // Three sub-cases:
  //   (a) success:              create -> destroy            → rebate credited
  //   (b) abort_before_destroy: create -> abort              → no rebate
  //   (c) destroy_then_abort:   create -> destroy -> abort   → rebate forfeited
  // ============================================================

  private async testH3_RebateTrap(): Promise<void> {
    console.log('\n========================================');
    console.log('H3: Rebate-Trap (Atomicity Nullifies Rebate)');
    console.log('========================================');

    // (a) Success: create -> destroy (rebate credited, net cost ~0)
    console.log('\n--- (a) Success Case: create -> destroy (with rebate) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_success_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure(
        'Rebate-Trap',
        'owned',
        'na',
        'rebate_success',
        iteration,
        false,
        tx,
      );

      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // (b) Abort before destroy: create -> abort (no rebate, no destroy)
    console.log('\n--- (b) Abort Case: abort before destroy ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_abort_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure(
        'Rebate-Trap',
        'owned',
        'na',
        'abort_before_destroy',
        iteration,
        true,
        tx,
      );

      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }

    // (c) Destroy then abort: create -> destroy -> abort (rebate forfeited)
    console.log('\n--- (c) Abort Case: destroy then abort (rebate trap) ---');
    for (let iteration = 1; iteration <= 10; iteration++) {
      const tx = this.buildTx();

      tx.moveCall({
        target: `${this.packageId}::taxonomy::test_rebate_destroy_then_abort_owned`,
        arguments: [],
      });

      const r = await this.executeAndMeasure(
        'Rebate-Trap',
        'owned',
        'na',
        'destroy_then_abort',
        iteration,
        true,
        tx,
      );

      this.allResults.push(r);
      await this.sleep(this.SLEEP_BETWEEN_TX_MS);
    }
  }

  // ==================
  // Execution + Measure
  // ==================

  private async executeAndMeasure(
    category: string,
    objectType: ObjectType,
    abortDepth: AbortDepth,
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
          category, objectType, abortDepth, pattern, iteration,
          expectedAbort, actualAbort: true, abortCode,
          gasUsed: net, computationCost: computation,
          storageCost: storage, storageRebate: rebate, netGasCost: net,
          wallClockLatency: end - start, executionTime: end - start,
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
        category, objectType, abortDepth, pattern, iteration,
        expectedAbort, actualAbort: false, abortCode: undefined,
        gasUsed: net, computationCost: computation,
        storageCost: storage, storageRebate: rebate, netGasCost: net,
        wallClockLatency: end - start, executionTime: end - start,
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
        `[${category}/${pattern}] #${iteration} FAIL`
        + ` | expectedAbort=${expectedAbort}`
        + ` | type=${errorType}`
        + ` | code=${abortCode ?? 'n/a'}`
        + ` | netGas=${net}`
        + ` | latency=${(end - start).toFixed(0)}ms`,
      );

      return {
        category, objectType, abortDepth, pattern, iteration,
        expectedAbort, actualAbort: true, abortCode,
        gasUsed: net, computationCost: computation,
        storageCost: storage, storageRebate: rebate, netGasCost: net,
        wallClockLatency: end - start, executionTime: end - start,
        errorMessage: errorMsg.substring(0, 500), errorType,
        timestamp,
      };
    }
  }

  // ==================
  // Error helpers
  // ==================

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

  // ==================
  // Export
  // ==================

  private exportResults(): void {
    const ts = new Date().toISOString().replace(/[:.]/g, '-').substring(0, 19);
    const filename = `workshop_benchmark_${this.network}_${ts}.csv`;

    const headers = [
      'category', 'objectType', 'abortDepth', 'pattern', 'iteration',
      'expectedAbort', 'actualAbort', 'abortCode',
      'gasUsed', 'computationCost', 'storageCost', 'storageRebate', 'netGasCost',
      'wallClockLatency', 'executionTime',
      'errorMessage', 'errorType',
      'timestamp', 'transactionDigest',
    ].join(',');

    const rows = this.allResults
      .map(r => [
        r.category, r.objectType, r.abortDepth, r.pattern, r.iteration,
        r.expectedAbort, r.actualAbort, r.abortCode ?? '',
        r.gasUsed, r.computationCost, r.storageCost, r.storageRebate, r.netGasCost,
        r.wallClockLatency.toFixed(2), r.executionTime.toFixed(2),
        r.errorMessage ? `"${r.errorMessage.replace(/\"/g, '""')}"` : '',
        r.errorType ?? '',
        r.timestamp, r.transactionDigest ?? '',
      ].join(','))
      .join('\n');

    fs.writeFileSync(filename, `${headers}\n${rows}`);
    console.log(`\n✓ Results exported: ${filename}`);
  }

  // ==================
  // Summary
  // ==================

  private printSummary(): void {
    console.log('\n========================================');
    console.log('H1/H2/H3 BENCHMARK SUMMARY');
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
          `  - ${r.category}/${r.pattern}/${r.objectType}/${r.abortDepth}`
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
    const key = (r: TestResult): Key => `${r.category}||${r.pattern}||${r.objectType}||${r.abortDepth}`;

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
      const [category, pattern, objectType, abortDepth] = k.split('||');
      const count = rs.length;
      const fail = rs.filter(x => x.actualAbort).length;
      const ok = count - fail;

      return {
        category, pattern, objectType, abortDepth,
        count, ok, fail,
        okRate: count ? ok / count : 0,
        avgGas: avg(rs.map(x => x.netGasCost)),
        avgStorageCost: avg(rs.map(x => x.storageCost)),
        avgRebate: avg(rs.map(x => x.storageRebate)),
        avgLat: avg(rs.map(x => x.wallClockLatency)),
      };
    });

    rows.sort((a, b) =>
      a.category.localeCompare(b.category)
      || a.pattern.localeCompare(b.pattern)
      || a.objectType.localeCompare(b.objectType)
      || a.abortDepth.localeCompare(b.abortDepth),
    );

    console.log('\n========================================');
    console.log('BREAKDOWN (category/pattern/objectType/depth)');
    console.log('count ok fail okRate | avgNetGas avgStorageCost avgRebate avgLatencyMs');
    console.log('========================================');

    for (const r of rows) {
      console.log(
        `${r.category}/${r.pattern}/${r.objectType}/${r.abortDepth}`
        + ` | count=${r.count} ok=${r.ok} fail=${r.fail} okRate=${(r.okRate * 100).toFixed(1)}%`
        + ` | avgNetGas=${fmt(r.avgGas)} avgStorageCost=${fmt(r.avgStorageCost)}`
        + ` avgRebate=${fmt(r.avgRebate)} avgLatencyMs=${fmt(r.avgLat)}`,
      );
    }
  }

  // ==================
  // Runner
  // ==================

  async runAllTests(): Promise<void> {
    console.log('========================================');
    console.log('H1/H2/H3  BENCHMARK  (Workshop Short Paper)');
    console.log('========================================');
    console.log(`Network:    ${this.network}`);
    console.log(`Package ID: ${this.packageId}`);
    console.log(`Gas Budget (fixed): ${this.FIXED_GAS_BUDGET.toString()}`);
    console.log(`Start Time: ${new Date().toISOString()}`);
    console.log('========================================');

    try {
      // H1: Rollback-Depth
      await this.testH1_RollbackDepth();

      // H2: Payload-Sweep (Persistence Dominance)
      await this.testH2_PayloadSweep();

      // H3: Rebate-Trap
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

  const benchmark = new H1H2H3Benchmark();
  await benchmark.runAllTests();
}

main().catch(console.error);

export { H1H2H3Benchmark };
