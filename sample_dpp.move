module dpp_test::dpp {

    use std::string::{Self, String};

    /// Struct which is representing a lifecycle event
    public struct LifecycleEvent has store, drop {
        event_type: String,    // "manufactured", "transferred", "repaired", "recycled"
        actor: address,
        timestamp_ms: u64,
        metadata: String,
    }

    /// Digital Product Passport body（key ability = on-chain object）
    public struct ProductPassport has key, store {
        id: UID,
        product_id: String,
        manufacturer: address,
        material_composition: String,
        carbon_footprint: u64,     // gCO2e
        current_owner: address,
        status: String,            // "active", "transferred", "recycled"
        events: vector<LifecycleEvent>,
    }

    // ===== error codes =====
    const E_NOT_OWNER: u64 = 1;
    const E_ALREADY_RECYCLED: u64 = 2;

    /// Issue a passport (called by the manufacturer)
    public fun mint_passport(
        product_id: vector<u8>,
        material_composition: vector<u8>,
        carbon_footprint: u64,
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

        //let passport = ProductPassport 
        ProductPassport{
            id: object::new(ctx),
            product_id: string::utf8(product_id),
            manufacturer,
            material_composition: string::utf8(material_composition),
            carbon_footprint,
            current_owner: manufacturer,
            status: string::utf8(b"active"),
            events,
        }

        //transfer::transfer(passport, manufacturer);
        
    }

    /// Transfer ownership (supply chain movement)
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

    /// Record a repair or modification history
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

    /// Record disposal or recycling history
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
}