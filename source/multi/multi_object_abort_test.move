/// Multi-object extension of abort_test::taxonomy.
///
/// Motivation: the original single-object study (355 on-chain trials) identified
/// persistence as the dominant gas cost factor (10–33×) and noted that
/// "multi-object transactions … may exhibit different cost characteristics"
/// as an explicit limitation.  This module isolates multi-object variables
/// so the same benchmark harness can re-run each category with 2, 5, or 10
/// objects simultaneously — for both Owned and Shared ownership models.
///
/// Category mapping vs. original paper:
///   Cat-3  State Rollback      → multi_rollback_{owned|shared}_{2|5|10}
///   Cat-4  Balance-Ops         → multi_balance_{owned|shared}_{2|5|10}
///   Cat-5  Rebate-Trap         → multi_rebate_{owned|shared}_{2|5|10}
///   Cat-7  Payload-Sweep       → multi_payload_{owned|shared}_{2|5|10}
///
/// Object-count tiers mirror Rollback-Depth naming from the original:
///   _2   = shallow  (2 objects)
///   _5   = medium   (5 objects)
///   _10  = deep     (10 objects)

module multi_object_abort_test::taxonomy {

    // === Imports ===

    use sui::balance::{Self, Balance};
    use sui::coin::{Self, Coin};
    use sui::sui::SUI;

    // === Errors ===
    const EINVALIDSTATE: u64 = 102;
    const EREBATE_EXPERIMENT: u64 = 999;

    // === Structs ===

    /// Owned object — identical field layout to the single-object baseline.
    public struct OwnedTestObject has key, store {
        id: UID,
        value: u64,
        balance: Balance<SUI>,
        payload: vector<u8>,
    }

    /// Shared object — identical field layout to the single-object baseline.
    public struct SharedTestObject has key {
        id: UID,
        value: u64,
        balance: Balance<SUI>,
        payload: vector<u8>,
    }

    // =========================================================================
    // === Category 3: Multi-Object State Rollback =============================
    // =========================================================================
    //
    // Research question: does the number of objects created before an abort
    // affect gas cost beyond what a single-object abort already costs?
    // The original Cat-6 (Rollback-Depth) tested this for Owned only and with
    // pre-existing objects.  These functions test *creation + transfer/share +
    // abort* for both ownership models.

    // --- OWNED ---

    #[allow(lint(self_transfer))]
    public fun multi_rollback_owned_2(should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1 = create_owned(ctx);
        let obj2 = create_owned(ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_rollback_owned_5(should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1 = create_owned(ctx);
        let obj2 = create_owned(ctx);
        let obj3 = create_owned(ctx);
        let obj4 = create_owned(ctx);
        let obj5 = create_owned(ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        transfer::transfer(obj3, sender);
        transfer::transfer(obj4, sender);
        transfer::transfer(obj5, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_rollback_owned_10(should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1  = create_owned(ctx);
        let obj2  = create_owned(ctx);
        let obj3  = create_owned(ctx);
        let obj4  = create_owned(ctx);
        let obj5  = create_owned(ctx);
        let obj6  = create_owned(ctx);
        let obj7  = create_owned(ctx);
        let obj8  = create_owned(ctx);
        let obj9  = create_owned(ctx);
        let obj10 = create_owned(ctx);
        transfer::transfer(obj1,  sender);
        transfer::transfer(obj2,  sender);
        transfer::transfer(obj3,  sender);
        transfer::transfer(obj4,  sender);
        transfer::transfer(obj5,  sender);
        transfer::transfer(obj6,  sender);
        transfer::transfer(obj7,  sender);
        transfer::transfer(obj8,  sender);
        transfer::transfer(obj9,  sender);
        transfer::transfer(obj10, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    // --- SHARED ---

    public fun multi_rollback_shared_2(should_abort: bool, ctx: &mut TxContext) {
        let obj1 = create_shared_object(ctx);
        let obj2 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_rollback_shared_5(should_abort: bool, ctx: &mut TxContext) {
        let obj1 = create_shared_object(ctx);
        let obj2 = create_shared_object(ctx);
        let obj3 = create_shared_object(ctx);
        let obj4 = create_shared_object(ctx);
        let obj5 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_rollback_shared_10(should_abort: bool, ctx: &mut TxContext) {
        let obj1  = create_shared_object(ctx);
        let obj2  = create_shared_object(ctx);
        let obj3  = create_shared_object(ctx);
        let obj4  = create_shared_object(ctx);
        let obj5  = create_shared_object(ctx);
        let obj6  = create_shared_object(ctx);
        let obj7  = create_shared_object(ctx);
        let obj8  = create_shared_object(ctx);
        let obj9  = create_shared_object(ctx);
        let obj10 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        transfer::share_object(obj6);
        transfer::share_object(obj7);
        transfer::share_object(obj8);
        transfer::share_object(obj9);
        transfer::share_object(obj10);
        assert!(!should_abort, EINVALIDSTATE);
    }

    // =========================================================================
    // === Category 4: Multi-Object Balance Operations =========================
    // =========================================================================
    //
    // Research question: does depositing coins into N objects before an abort
    // change rollback economics compared to a single coin operation?
    // Each function receives one Coin<SUI> per object so the harness can split
    // a larger coin before calling.

    // --- OWNED (each obj gets its own deposit coin) ---

    #[allow(lint(self_transfer))]
    public fun multi_balance_owned_2(
        obj1: OwnedTestObject,
        obj2: OwnedTestObject,
        deposit1: Coin<SUI>,
        deposit2: Coin<SUI>,
        should_abort: bool,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let obj1 = deposit_and_rebuild_owned(obj1, deposit1, ctx);
        let obj2 = deposit_and_rebuild_owned(obj2, deposit2, ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_balance_owned_5(
        obj1: OwnedTestObject,
        obj2: OwnedTestObject,
        obj3: OwnedTestObject,
        obj4: OwnedTestObject,
        obj5: OwnedTestObject,
        deposit1: Coin<SUI>,
        deposit2: Coin<SUI>,
        deposit3: Coin<SUI>,
        deposit4: Coin<SUI>,
        deposit5: Coin<SUI>,
        should_abort: bool,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let obj1 = deposit_and_rebuild_owned(obj1, deposit1, ctx);
        let obj2 = deposit_and_rebuild_owned(obj2, deposit2, ctx);
        let obj3 = deposit_and_rebuild_owned(obj3, deposit3, ctx);
        let obj4 = deposit_and_rebuild_owned(obj4, deposit4, ctx);
        let obj5 = deposit_and_rebuild_owned(obj5, deposit5, ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        transfer::transfer(obj3, sender);
        transfer::transfer(obj4, sender);
        transfer::transfer(obj5, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_balance_owned_10(
        obj1:  OwnedTestObject,
        obj2:  OwnedTestObject,
        obj3:  OwnedTestObject,
        obj4:  OwnedTestObject,
        obj5:  OwnedTestObject,
        obj6:  OwnedTestObject,
        obj7:  OwnedTestObject,
        obj8:  OwnedTestObject,
        obj9:  OwnedTestObject,
        obj10: OwnedTestObject,
        deposit1:  Coin<SUI>,
        deposit2:  Coin<SUI>,
        deposit3:  Coin<SUI>,
        deposit4:  Coin<SUI>,
        deposit5:  Coin<SUI>,
        deposit6:  Coin<SUI>,
        deposit7:  Coin<SUI>,
        deposit8:  Coin<SUI>,
        deposit9:  Coin<SUI>,
        deposit10: Coin<SUI>,
        should_abort: bool,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        let obj1  = deposit_and_rebuild_owned(obj1,  deposit1,  ctx);
        let obj2  = deposit_and_rebuild_owned(obj2,  deposit2,  ctx);
        let obj3  = deposit_and_rebuild_owned(obj3,  deposit3,  ctx);
        let obj4  = deposit_and_rebuild_owned(obj4,  deposit4,  ctx);
        let obj5  = deposit_and_rebuild_owned(obj5,  deposit5,  ctx);
        let obj6  = deposit_and_rebuild_owned(obj6,  deposit6,  ctx);
        let obj7  = deposit_and_rebuild_owned(obj7,  deposit7,  ctx);
        let obj8  = deposit_and_rebuild_owned(obj8,  deposit8,  ctx);
        let obj9  = deposit_and_rebuild_owned(obj9,  deposit9,  ctx);
        let obj10 = deposit_and_rebuild_owned(obj10, deposit10, ctx);
        transfer::transfer(obj1,  sender);
        transfer::transfer(obj2,  sender);
        transfer::transfer(obj3,  sender);
        transfer::transfer(obj4,  sender);
        transfer::transfer(obj5,  sender);
        transfer::transfer(obj6,  sender);
        transfer::transfer(obj7,  sender);
        transfer::transfer(obj8,  sender);
        transfer::transfer(obj9,  sender);
        transfer::transfer(obj10, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    // --- SHARED (mutable borrow; no rebuild needed) ---

    public fun multi_balance_shared_2(
        obj1: &mut SharedTestObject,
        obj2: &mut SharedTestObject,
        deposit1: Coin<SUI>,
        deposit2: Coin<SUI>,
        should_abort: bool,
    ) {
        balance::join(&mut obj1.balance, coin::into_balance(deposit1));
        balance::join(&mut obj2.balance, coin::into_balance(deposit2));
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_balance_shared_5(
        obj1: &mut SharedTestObject,
        obj2: &mut SharedTestObject,
        obj3: &mut SharedTestObject,
        obj4: &mut SharedTestObject,
        obj5: &mut SharedTestObject,
        deposit1: Coin<SUI>,
        deposit2: Coin<SUI>,
        deposit3: Coin<SUI>,
        deposit4: Coin<SUI>,
        deposit5: Coin<SUI>,
        should_abort: bool,
    ) {
        balance::join(&mut obj1.balance, coin::into_balance(deposit1));
        balance::join(&mut obj2.balance, coin::into_balance(deposit2));
        balance::join(&mut obj3.balance, coin::into_balance(deposit3));
        balance::join(&mut obj4.balance, coin::into_balance(deposit4));
        balance::join(&mut obj5.balance, coin::into_balance(deposit5));
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_balance_shared_10(
        obj1:  &mut SharedTestObject,
        obj2:  &mut SharedTestObject,
        obj3:  &mut SharedTestObject,
        obj4:  &mut SharedTestObject,
        obj5:  &mut SharedTestObject,
        obj6:  &mut SharedTestObject,
        obj7:  &mut SharedTestObject,
        obj8:  &mut SharedTestObject,
        obj9:  &mut SharedTestObject,
        obj10: &mut SharedTestObject,
        deposit1:  Coin<SUI>,
        deposit2:  Coin<SUI>,
        deposit3:  Coin<SUI>,
        deposit4:  Coin<SUI>,
        deposit5:  Coin<SUI>,
        deposit6:  Coin<SUI>,
        deposit7:  Coin<SUI>,
        deposit8:  Coin<SUI>,
        deposit9:  Coin<SUI>,
        deposit10: Coin<SUI>,
        should_abort: bool,
    ) {
        balance::join(&mut obj1.balance,  coin::into_balance(deposit1));
        balance::join(&mut obj2.balance,  coin::into_balance(deposit2));
        balance::join(&mut obj3.balance,  coin::into_balance(deposit3));
        balance::join(&mut obj4.balance,  coin::into_balance(deposit4));
        balance::join(&mut obj5.balance,  coin::into_balance(deposit5));
        balance::join(&mut obj6.balance,  coin::into_balance(deposit6));
        balance::join(&mut obj7.balance,  coin::into_balance(deposit7));
        balance::join(&mut obj8.balance,  coin::into_balance(deposit8));
        balance::join(&mut obj9.balance,  coin::into_balance(deposit9));
        balance::join(&mut obj10.balance, coin::into_balance(deposit10));
        assert!(!should_abort, EINVALIDSTATE);
    }

    // =========================================================================
    // === Category 5: Multi-Object Rebate Trap ================================
    // =========================================================================
    //
    // Research question: if N objects are destroyed before an intentional abort,
    // are *all* N rebates forfeited?  The original study confirmed forfeiture for
    // a single owned object.  These functions extend the pattern to N objects.

    // --- OWNED ---

    public fun multi_rebate_owned_2(ctx: &mut TxContext) {
        let obj1 = create_owned(ctx);
        let obj2 = create_owned(ctx);
        destroy_owned(obj1);
        destroy_owned(obj2);
        // Intentional abort — expect all rebates to be forfeited.
        assert!(false, EREBATE_EXPERIMENT);
    }

    public fun multi_rebate_owned_5(ctx: &mut TxContext) {
        let obj1 = create_owned(ctx);
        let obj2 = create_owned(ctx);
        let obj3 = create_owned(ctx);
        let obj4 = create_owned(ctx);
        let obj5 = create_owned(ctx);
        destroy_owned(obj1);
        destroy_owned(obj2);
        destroy_owned(obj3);
        destroy_owned(obj4);
        destroy_owned(obj5);
        assert!(false, EREBATE_EXPERIMENT);
    }

    public fun multi_rebate_owned_10(ctx: &mut TxContext) {
        let obj1  = create_owned(ctx);
        let obj2  = create_owned(ctx);
        let obj3  = create_owned(ctx);
        let obj4  = create_owned(ctx);
        let obj5  = create_owned(ctx);
        let obj6  = create_owned(ctx);
        let obj7  = create_owned(ctx);
        let obj8  = create_owned(ctx);
        let obj9  = create_owned(ctx);
        let obj10 = create_owned(ctx);
        destroy_owned(obj1);
        destroy_owned(obj2);
        destroy_owned(obj3);
        destroy_owned(obj4);
        destroy_owned(obj5);
        destroy_owned(obj6);
        destroy_owned(obj7);
        destroy_owned(obj8);
        destroy_owned(obj9);
        destroy_owned(obj10);
        assert!(false, EREBATE_EXPERIMENT);
    }

    // --- SHARED (create-then-share in same tx; share_object consumes the value) ---
    // Note: shared objects cannot be destroyed in the same transaction they are
    // shared, so the rebate-trap pattern here tests *creation + share + abort*
    // rather than *creation + delete + abort*.

    public fun multi_rebate_shared_2(ctx: &mut TxContext) {
        let obj1 = create_shared_object(ctx);
        let obj2 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        assert!(false, EREBATE_EXPERIMENT);
    }

    public fun multi_rebate_shared_5(ctx: &mut TxContext) {
        let obj1 = create_shared_object(ctx);
        let obj2 = create_shared_object(ctx);
        let obj3 = create_shared_object(ctx);
        let obj4 = create_shared_object(ctx);
        let obj5 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        assert!(false, EREBATE_EXPERIMENT);
    }

    public fun multi_rebate_shared_10(ctx: &mut TxContext) {
        let obj1  = create_shared_object(ctx);
        let obj2  = create_shared_object(ctx);
        let obj3  = create_shared_object(ctx);
        let obj4  = create_shared_object(ctx);
        let obj5  = create_shared_object(ctx);
        let obj6  = create_shared_object(ctx);
        let obj7  = create_shared_object(ctx);
        let obj8  = create_shared_object(ctx);
        let obj9  = create_shared_object(ctx);
        let obj10 = create_shared_object(ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        transfer::share_object(obj6);
        transfer::share_object(obj7);
        transfer::share_object(obj8);
        transfer::share_object(obj9);
        transfer::share_object(obj10);
        assert!(false, EREBATE_EXPERIMENT);
    }

    // =========================================================================
    // === Category 7: Multi-Object Payload Sweep ==============================
    // =========================================================================
    //
    // Research question: does storage cost scale linearly with N * payload_len,
    // consistent with the ~7.79 MIST/byte rate measured for single objects?

    // --- OWNED: create N objects each with `len` bytes, transfer, optionally abort ---

    #[allow(lint(self_transfer))]
    public fun multi_payload_owned_2(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1 = create_owned_with_payload(len, ctx);
        let obj2 = create_owned_with_payload(len, ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_payload_owned_5(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1 = create_owned_with_payload(len, ctx);
        let obj2 = create_owned_with_payload(len, ctx);
        let obj3 = create_owned_with_payload(len, ctx);
        let obj4 = create_owned_with_payload(len, ctx);
        let obj5 = create_owned_with_payload(len, ctx);
        transfer::transfer(obj1, sender);
        transfer::transfer(obj2, sender);
        transfer::transfer(obj3, sender);
        transfer::transfer(obj4, sender);
        transfer::transfer(obj5, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    #[allow(lint(self_transfer))]
    public fun multi_payload_owned_10(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let sender = tx_context::sender(ctx);
        let obj1  = create_owned_with_payload(len, ctx);
        let obj2  = create_owned_with_payload(len, ctx);
        let obj3  = create_owned_with_payload(len, ctx);
        let obj4  = create_owned_with_payload(len, ctx);
        let obj5  = create_owned_with_payload(len, ctx);
        let obj6  = create_owned_with_payload(len, ctx);
        let obj7  = create_owned_with_payload(len, ctx);
        let obj8  = create_owned_with_payload(len, ctx);
        let obj9  = create_owned_with_payload(len, ctx);
        let obj10 = create_owned_with_payload(len, ctx);
        transfer::transfer(obj1,  sender);
        transfer::transfer(obj2,  sender);
        transfer::transfer(obj3,  sender);
        transfer::transfer(obj4,  sender);
        transfer::transfer(obj5,  sender);
        transfer::transfer(obj6,  sender);
        transfer::transfer(obj7,  sender);
        transfer::transfer(obj8,  sender);
        transfer::transfer(obj9,  sender);
        transfer::transfer(obj10, sender);
        assert!(!should_abort, EINVALIDSTATE);
    }

    // --- SHARED: create N shared objects each with `len` bytes, optionally abort ---

    public fun multi_payload_shared_2(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let obj1 = create_shared_with_payload(len, ctx);
        let obj2 = create_shared_with_payload(len, ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_payload_shared_5(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let obj1 = create_shared_with_payload(len, ctx);
        let obj2 = create_shared_with_payload(len, ctx);
        let obj3 = create_shared_with_payload(len, ctx);
        let obj4 = create_shared_with_payload(len, ctx);
        let obj5 = create_shared_with_payload(len, ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        assert!(!should_abort, EINVALIDSTATE);
    }

    public fun multi_payload_shared_10(len: u64, should_abort: bool, ctx: &mut TxContext) {
        let obj1  = create_shared_with_payload(len, ctx);
        let obj2  = create_shared_with_payload(len, ctx);
        let obj3  = create_shared_with_payload(len, ctx);
        let obj4  = create_shared_with_payload(len, ctx);
        let obj5  = create_shared_with_payload(len, ctx);
        let obj6  = create_shared_with_payload(len, ctx);
        let obj7  = create_shared_with_payload(len, ctx);
        let obj8  = create_shared_with_payload(len, ctx);
        let obj9  = create_shared_with_payload(len, ctx);
        let obj10 = create_shared_with_payload(len, ctx);
        transfer::share_object(obj1);
        transfer::share_object(obj2);
        transfer::share_object(obj3);
        transfer::share_object(obj4);
        transfer::share_object(obj5);
        transfer::share_object(obj6);
        transfer::share_object(obj7);
        transfer::share_object(obj8);
        transfer::share_object(obj9);
        transfer::share_object(obj10);
        assert!(!should_abort, EINVALIDSTATE);
    }

    // =========================================================================
    // === Setup Helpers (public so TypeScript harness can call them) ===========
    // =========================================================================

    /// Creates and transfers a single OwnedTestObject (used by harness setup).
    #[allow(lint(self_transfer))]
    public fun create_and_transfer_owned(ctx: &mut TxContext) {
        let obj = create_owned(ctx);
        transfer::transfer(obj, tx_context::sender(ctx));
    }

    /// Creates and shares a single SharedTestObject (used by harness setup).
    public fun create_and_share_shared(ctx: &mut TxContext) {
        let obj = create_shared_object(ctx);
        transfer::share_object(obj);
    }

    // =========================================================================
    // === Private Helpers ======================================================
    // =========================================================================

    /// Creates an OwnedTestObject with empty payload.
    fun create_owned(ctx: &mut TxContext): OwnedTestObject {
        OwnedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        }
    }

    /// Creates a SharedTestObject value (caller must share_object it).
    fun create_shared_object(ctx: &mut TxContext): SharedTestObject {
        SharedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: vector::empty<u8>(),
        }
    }

    /// Destroys an OwnedTestObject.
    fun destroy_owned(obj: OwnedTestObject) {
        let OwnedTestObject { id, value: _, balance, payload: _ } = obj;
        object::delete(id);
        balance::destroy_zero(balance);
    }

    /// Destructs an OwnedTestObject, joins `deposit`, rebuilds and returns it.
    fun deposit_and_rebuild_owned(
        obj: OwnedTestObject,
        deposit: Coin<SUI>,
        ctx: &mut TxContext
    ): OwnedTestObject {
        let OwnedTestObject { id, value, mut balance, payload } = obj;
        object::delete(id);
        balance::join(&mut balance, coin::into_balance(deposit));
        OwnedTestObject {
            id: object::new(ctx),
            value,
            balance,
            payload,
        }
    }

    /// Creates an OwnedTestObject with a payload of `len` zero-bytes.
    fun create_owned_with_payload(len: u64, ctx: &mut TxContext): OwnedTestObject {
        OwnedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: build_payload(len),
        }
    }

    /// Creates a SharedTestObject value with a payload of `len` zero-bytes.
    fun create_shared_with_payload(len: u64, ctx: &mut TxContext): SharedTestObject {
        SharedTestObject {
            id: object::new(ctx),
            value: 0,
            balance: balance::zero(),
            payload: build_payload(len),
        }
    }

    /// Builds a zero-filled byte vector of length `len`.
    fun build_payload(len: u64): vector<u8> {
        let mut payload = vector::empty<u8>();
        let mut i: u64 = 0;
        while (i < len) {
            vector::push_back(&mut payload, 0u8);
            i = i + 1;
        };
        payload
    }
}
