/// Lifecycle-oriented DPP model with raw material wrapping.
/// RawMaterial is wrapped (embedded) inside ProductPassport at manufacturing time.

module dpp_test::dpp {

    use std::string::{Self, String};

    // ===== Structs =====

    /// Raw material object – issued upstream (e.g., by a fabric supplier).
    /// Has `key` so it lives as a standalone on-chain object before wrapping.
    /// Has `store` so it can be embedded into another object (wrapping).
    public struct RawMaterial has key, store {
        id: UID,
        material_name: String,   // e.g. "Organic Cotton"
        origin: String,          // e.g. "India"
        supplier: address,
        carbon_footprint: u64,   // gCO2e
    }

    /// Lifecycle event – unchanged from original.
    public struct LifecycleEvent has store, drop {
        event_type: String,      // "manufactured" | "transferred" | "repaired" | "recycled"
        actor: address,
        timestamp_ms: u64,
        metadata: String,
    }

    /// a Digital Product Passport Object.
    /// `material: RawMaterial` (wrapped object) - material.
    public struct ProductPassport has key, store {
        id: UID,
        product_id: String,
        manufacturer: address,
        material: RawMaterial,   // RawMaterial wrapped as-is
        carbon_footprint: u64,   // gCO2e (entire product; can be summed with material's footprint if needed)
        current_owner: address,
        status: String,          // status are "active" | "transferred" | "recycled"
        events: vector<LifecycleEvent>,
    }

    // ===== Error codes =====

    const E_NOT_OWNER: u64 = 1;
    const E_ALREADY_RECYCLED: u64 = 2;

    // ===== Functions =====

    /// Mint a raw material object (called by the supplier).
    /// The returned object is owned by the supplier's address.
    public fun mint_material(
        material_name: vector<u8>,
        origin: vector<u8>,
        carbon_footprint: u64,
        ctx: &mut TxContext
    ): RawMaterial {
        RawMaterial {
            id: object::new(ctx),
            material_name: string::utf8(material_name),
            origin: string::utf8(origin),
            supplier: tx_context::sender(ctx),
            carbon_footprint,
        }
    }

    /// Manufacturer receives a RawMaterial and wraps it into a new ProductPassport.
    /// After wrapping, RawMaterial no longer exists as a standalone object (it is embedded in ProductPassport).
    public fun manufacture(
        product_id: vector<u8>,
        material: RawMaterial,       // takes ownership → wrapping occurs
        product_carbon_footprint: u64,
        ctx: &mut TxContext
    ): ProductPassport {
        let manufacturer = tx_context::sender(ctx);
        let mut events = vector::empty<LifecycleEvent>();

        vector::push_back(&mut events, LifecycleEvent {
            event_type: string::utf8(b"manufactured"),
            actor: manufacturer,
            timestamp_ms: tx_context::epoch_timestamp_ms(ctx),
            metadata: string::utf8(b"initial_manufacturing"),
        });

        ProductPassport {
            id: object::new(ctx),
            product_id: string::utf8(product_id),
            manufacturer,
            material,                // wraps RawMaterial into this field
            carbon_footprint: product_carbon_footprint,
            current_owner: manufacturer,
            status: string::utf8(b"active"),
            events,
        }
    }

    /// Transfer ownership (supply chain movement) – unchanged logic.
    public fun transfer_passport(
        passport: ProductPassport,
        new_owner: address,
        metadata: vector<u8>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(passport.current_owner == sender, E_NOT_OWNER);

        let mut updated = passport;
        updated.current_owner = new_owner;
        updated.status = string::utf8(b"transferred");

        vector::push_back(&mut updated.events, LifecycleEvent {
            event_type: string::utf8(b"transferred"),
            actor: sender,
            timestamp_ms: tx_context::epoch_timestamp_ms(ctx),
            metadata: string::utf8(metadata),
        });

        transfer::public_transfer(updated, new_owner);
    }

    /// Record a repair or modification.
    public fun record_repair(
        passport: &mut ProductPassport,
        repair_details: vector<u8>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(passport.current_owner == sender, E_NOT_OWNER);

        vector::push_back(&mut passport.events, LifecycleEvent {
            event_type: string::utf8(b"repaired"),
            actor: sender,
            timestamp_ms: tx_context::epoch_timestamp_ms(ctx),
            metadata: string::utf8(repair_details),
        });
    }

    /// Record disposal or recycling.
    public fun recycle_product(
        passport: &mut ProductPassport,
        recycler_notes: vector<u8>,
        ctx: &mut TxContext
    ) {
        let sender = tx_context::sender(ctx);
        assert!(passport.current_owner == sender, E_NOT_OWNER);
        assert!(passport.status != string::utf8(b"recycled"), E_ALREADY_RECYCLED);

        passport.status = string::utf8(b"recycled");

        vector::push_back(&mut passport.events, LifecycleEvent {
            event_type: string::utf8(b"recycled"),
            actor: sender,
            timestamp_ms: tx_context::epoch_timestamp_ms(ctx),
            metadata: string::utf8(recycler_notes),
        });
    }

    // ===== Read-only accessors =====

    /// Returns the name of the raw material wrapped inside the passport.
    public fun material_name(passport: &ProductPassport): &String {
        &passport.material.material_name
    }

    /// Returns the origin of the raw material wrapped inside the passport.
    public fun material_origin(passport: &ProductPassport): &String {
        &passport.material.origin
    }

    /// Returns the total CO2 footprint: raw material + manufacturing process combined.
    public fun total_carbon(passport: &ProductPassport): u64 {
        passport.material.carbon_footprint + passport.carbon_footprint
    }
}
