/* @ts-self-types="./stellar_private_payments_web.d.ts" */

export class Account {
    static __wrap(ptr) {
        const obj = Object.create(Account.prototype);
        obj.__wbg_ptr = ptr;
        AccountFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AccountFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_account_free(ptr, 0);
    }
    /**
     * Locally derived ASP membership blinding for this account.
     * @returns {Promise<string>}
     */
    aspSecret() {
        const ret = wasm.account_aspSecret(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Derive the ASP membership tree leaf for this account's stored keys.
     *
     * For explicit inputs without a session, use the free
     * [`derive_asp_user_leaf`](super::derive_asp_user_leaf) export.
     * @returns {Promise<string>}
     */
    deriveAspUserLeaf() {
        const ret = wasm.account_deriveAspUserLeaf(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Derive and persist this account's privacy keys. Idempotent.
     * @returns {Promise<UserPublicKeys>}
     */
    derivePrivacyKeys() {
        const ret = wasm.account_derivePrivacyKeys(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Whether this account's public keys are registered on-chain.
     * @returns {Promise<boolean>}
     */
    isRegistered() {
        const ret = wasm.account_isRegistered(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Open a private pool session for this account.
     * @param {any} options
     * @returns {Promise<PrivatePool>}
     */
    pool(options) {
        const ret = wasm.account_pool(this.__wbg_ptr, addHeapObject(options));
        return takeObject(ret);
    }
    /**
     * Portfolio balances across all enabled pools in the deployment.
     * @returns {Promise<PortfolioBalance[]>}
     */
    portfolio() {
        const ret = wasm.account_portfolio(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Locally derived note and encryption public keys for this account.
     * @returns {Promise<UserPublicKeys>}
     */
    privacyKeys() {
        const ret = wasm.account_privacyKeys(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Register this account's public keys on the deployment-wide registry.
     * @returns {Promise<string>}
     */
    registerPublicKeys() {
        const ret = wasm.account_registerPublicKeys(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * The account that signs and pays. May differ from [`Self::user_address`]
     * when the note owner delegates signing to another account.
     * @returns {string}
     */
    get signerAddress() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.account_signerAddress(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * The account that owns the notes.
     * @returns {string}
     */
    get userAddress() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.account_userAddress(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Notes for this account across all pools (newest first).
     * @param {number} limit
     * @returns {Promise<UserNoteSummary[]>}
     */
    userNotes(limit) {
        const ret = wasm.account_userNotes(this.__wbg_ptr, limit);
        return takeObject(ret);
    }
}
if (Symbol.dispose) Account.prototype[Symbol.dispose] = Account.prototype.free;

export class AspMembership {
    static __wrap(ptr) {
        const obj = Object.create(AspMembership.prototype);
        obj.__wbg_ptr = ptr;
        AspMembershipFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AspMembershipFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_aspmembership_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get admin() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_admin(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {bigint}
     */
    get capacity() {
        const ret = wasm.aspmembership_capacity(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {string}
     */
    get contractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_contractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contractType() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_contractType(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get ledger() {
        const ret = wasm.aspmembership_ledger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get levels() {
        const ret = wasm.aspmembership_levels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get nextIndex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_nextIndex(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get root() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_root(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get usedSlots() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspmembership_usedSlots(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) AspMembership.prototype[Symbol.dispose] = AspMembership.prototype.free;

export class AspNonMembership {
    static __wrap(ptr) {
        const obj = Object.create(AspNonMembership.prototype);
        obj.__wbg_ptr = ptr;
        AspNonMembershipFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AspNonMembershipFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_aspnonmembership_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get admin() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspnonmembership_admin(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspnonmembership_contractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contractType() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspnonmembership_contractType(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    get isEmpty() {
        const ret = wasm.aspnonmembership_isEmpty(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get ledger() {
        const ret = wasm.aspnonmembership_ledger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get root() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.aspnonmembership_root(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) AspNonMembership.prototype[Symbol.dispose] = AspNonMembership.prototype.free;

export class AssetDescriptor {
    static __wrap(ptr) {
        const obj = Object.create(AssetDescriptor.prototype);
        obj.__wbg_ptr = ptr;
        AssetDescriptorFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        AssetDescriptorFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_assetdescriptor_free(ptr, 0);
    }
    /**
     * @returns {string | undefined}
     */
    get code() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.assetdescriptor_code(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get contractId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.assetdescriptor_contractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get issuer() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.assetdescriptor_issuer(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get kind() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.assetdescriptor_kind(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get symbol() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.assetdescriptor_symbol(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) AssetDescriptor.prototype[Symbol.dispose] = AssetDescriptor.prototype.free;

/**
 * Baby JubJub curve point (BN254 field coordinates).
 */
export class BabyJubJubPoint {
    static __wrap(ptr) {
        const obj = Object.create(BabyJubJubPoint.prototype);
        obj.__wbg_ptr = ptr;
        BabyJubJubPointFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        BabyJubJubPointFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_babyjubjubpoint_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get x() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.babyjubjubpoint_x(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get y() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.babyjubjubpoint_y(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) BabyJubJubPoint.prototype[Symbol.dispose] = BabyJubJubPoint.prototype.free;

/**
 * Deployment-scoped browser SDK runtime: native [`NativeClient`] plus worker
 * handles.
 */
export class Client {
    static __wrap(ptr) {
        const obj = Object.create(Client.prototype);
        obj.__wbg_ptr = ptr;
        ClientFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ClientFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_client_free(ptr, 0);
    }
    /**
     * Bind a wallet signer and return an [`Account`] session.
     *
     * `signer` may sign for an account other than the note owner
     * (`user_address`); that session signs and pays while the owner holds
     * the notes — build it with the desired `signerAddress` beforehand.
     * Call [`Account::derive_privacy_keys`] to derive and store the owner's
     * privacy keys.
     * @param {string} user_address
     * @param {SignerHandle} signer
     * @returns {Promise<Account>}
     */
    account(user_address, signer) {
        const ptr0 = passStringToWasm0(user_address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(signer, SignerHandle);
        const ret = wasm.client_account(this.__wbg_ptr, ptr0, len0, signer.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * On-chain state for all enabled pools plus shared ASP contracts.
     * @returns {Promise<ContractsStateData>}
     */
    allContractsData() {
        const ret = wasm.client_allContractsData(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * On-chain ASP membership and non-membership state.
     * @returns {Promise<ContractsStateData>}
     */
    aspState() {
        const ret = wasm.client_aspState(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Start background contract-event sync into local storage.
     *
     * No-op if already started on this instance. After
     * [`Self::stop_background_sync`], call again to respawn. A fatal indexer
     * exit leaves the slot set — use a new [`Client`] to recover.
     * @returns {Promise<void>}
     */
    backgroundSync() {
        const ret = wasm.client_backgroundSync(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Deployment config used by this client (contract addresses, pools,
     * network).
     * @returns {ContractConfig}
     */
    contractConfig() {
        const ret = wasm.client_contractConfig(this.__wbg_ptr);
        return ContractConfig.__wrap(ret);
    }
    /**
     * Build the client from an already spawned, configured and pinged
     * prover, and a storage handle.
     * @param {string} rpc_url
     * @param {StorageHandle} storage
     * @param {ProverHandle} prover
     * @param {any} contract_config
     * @param {string | null} [bootnode_url]
     * @returns {Promise<Client>}
     */
    static new(rpc_url, storage, prover, contract_config, bootnode_url) {
        const ptr0 = passStringToWasm0(rpc_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        _assertClass(storage, StorageHandle);
        _assertClass(prover, ProverHandle);
        var ptr1 = isLikeNone(bootnode_url) ? 0 : passStringToWasm0(bootnode_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len1 = WASM_VECTOR_LEN;
        const ret = wasm.client_new(ptr0, len0, storage.__wbg_ptr, prover.__wbg_ptr, addHeapObject(contract_config), ptr1, len1);
        return takeObject(ret);
    }
    /**
     * Recent deployment activity (pool events, registry registrations, ASP
     * updates).
     * @param {number} limit
     * @returns {Promise<OperationalFeedItem[]>}
     */
    operationalFeed(limit) {
        const ret = wasm.client_operationalFeed(this.__wbg_ptr, limit);
        return takeObject(ret);
    }
    /**
     * Look up a recipient's registered note and encryption public keys.
     * @param {string} address
     * @returns {Promise<RecipientLookup>}
     */
    recipientLookup(address) {
        const ptr0 = passStringToWasm0(address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.client_recipientLookup(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Request the background indexer to exit (wakes its idle wait).
     *
     * Call before rebuilding this [`Client`] so a new instance does not race
     * the old loop on the same storage DB. Also runs from [`Drop`].
     */
    stopBackgroundSync() {
        wasm.client_stopBackgroundSync(this.__wbg_ptr);
    }
    /**
     * Catch local storage up to the current chain tip for the deployment.
     * @returns {Promise<void>}
     */
    sync() {
        const ret = wasm.client_sync(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Verify a selective-disclosure receipt without a wallet session.
     * @param {string} receipt_json
     * @param {string} expected_vk_hash
     * @returns {Promise<DisclosureVerificationReport>}
     */
    verifySelectiveDisclosure(receipt_json, expected_vk_hash) {
        const ptr0 = passStringToWasm0(receipt_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(expected_vk_hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.client_verifySelectiveDisclosure(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
}
if (Symbol.dispose) Client.prototype[Symbol.dispose] = Client.prototype.free;

export class ContractConfig {
    static __wrap(ptr) {
        const obj = Object.create(ContractConfig.prototype);
        obj.__wbg_ptr = ptr;
        ContractConfigFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ContractConfigFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_contractconfig_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get admin() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_admin(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get asp_membership() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_asp_membership(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get asp_non_membership() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_asp_non_membership(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get deployer() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_deployer(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get kdf_domain() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_kdf_domain(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get networkPassphrase() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_networkPassphrase(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get network() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_network(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @param {any} value
     */
    constructor(value) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_new(retptr, addHeapObject(value));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            ContractConfigFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {PoolConfigEntry[]}
     */
    get pools() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_pools(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get public_key_registry() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_public_key_registry(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get rpcUrl() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_rpcUrl(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * Plain JSON object matching `deployments.json` (for round-trip input).
     * @returns {any}
     */
    toJSON() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_toJSON(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {VerifierEntry[]}
     */
    get verifiers() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractconfig_verifiers(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) ContractConfig.prototype[Symbol.dispose] = ContractConfig.prototype.free;

export class ContractsStateData {
    static __wrap(ptr) {
        const obj = Object.create(ContractsStateData.prototype);
        obj.__wbg_ptr = ptr;
        ContractsStateDataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ContractsStateDataFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_contractsstatedata_free(ptr, 0);
    }
    /**
     * @returns {AspMembership}
     */
    get aspMembership() {
        const ret = wasm.contractsstatedata_aspMembership(this.__wbg_ptr);
        return AspMembership.__wrap(ret);
    }
    /**
     * @returns {AspNonMembership}
     */
    get aspNonMembership() {
        const ret = wasm.contractsstatedata_aspNonMembership(this.__wbg_ptr);
        return AspNonMembership.__wrap(ret);
    }
    /**
     * @returns {PoolInfo[]}
     */
    get pools() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.contractsstatedata_pools(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) ContractsStateData.prototype[Symbol.dispose] = ContractsStateData.prototype.free;

export class DisclosureCircuitMetadata {
    static __wrap(ptr) {
        const obj = Object.create(DisclosureCircuitMetadata.prototype);
        obj.__wbg_ptr = ptr;
        DisclosureCircuitMetadataFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosureCircuitMetadataFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosurecircuitmetadata_free(ptr, 0);
    }
    /**
     * @returns {number}
     */
    get levels() {
        const ret = wasm.disclosurecircuitmetadata_levels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {number}
     */
    get nNotes() {
        const ret = wasm.disclosurecircuitmetadata_nNotes(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get name() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecircuitmetadata_name(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get vkHash() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecircuitmetadata_vkHash(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) DisclosureCircuitMetadata.prototype[Symbol.dispose] = DisclosureCircuitMetadata.prototype.free;

export class DisclosureContext {
    static __wrap(ptr) {
        const obj = Object.create(DisclosureContext.prototype);
        obj.__wbg_ptr = ptr;
        DisclosureContextFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosureContextFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosurecontext_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get authorityIdentityPayloadHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_authorityIdentityPayloadHex(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get authorityLabel() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_authorityLabel(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contextNonce() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_contextNonce(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get network() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_network(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get poolAddress() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_poolAddress(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get purpose() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurecontext_purpose(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) DisclosureContext.prototype[Symbol.dispose] = DisclosureContext.prototype.free;

export class DisclosurePublicInputs {
    static __wrap(ptr) {
        const obj = Object.create(DisclosurePublicInputs.prototype);
        obj.__wbg_ptr = ptr;
        DisclosurePublicInputsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosurePublicInputsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosurepublicinputs_free(ptr, 0);
    }
    /**
     * Decimal strings, matching the receipt's `toJSON` amount format.
     * @returns {string[]}
     */
    get amounts() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurepublicinputs_amounts(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get extContextHash() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurepublicinputs_extContextHash(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string[]}
     */
    get noteCommitments() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurepublicinputs_noteCommitments(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string[]}
     */
    get nullifiers() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurepublicinputs_nullifiers(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string[]}
     */
    get roots() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurepublicinputs_roots(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) DisclosurePublicInputs.prototype[Symbol.dispose] = DisclosurePublicInputs.prototype.free;

export class DisclosureReceipt {
    static __wrap(ptr) {
        const obj = Object.create(DisclosureReceipt.prototype);
        obj.__wbg_ptr = ptr;
        DisclosureReceiptFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosureReceiptFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosurereceipt_free(ptr, 0);
    }
    /**
     * @returns {DisclosureCircuitMetadata}
     */
    get circuit() {
        const ret = wasm.disclosurereceipt_circuit(this.__wbg_ptr);
        return DisclosureCircuitMetadata.__wrap(ret);
    }
    /**
     * @returns {DisclosureContext}
     */
    get context() {
        const ret = wasm.disclosurereceipt_context(this.__wbg_ptr);
        return DisclosureContext.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get issuedAt() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurereceipt_issuedAt(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get proofCompressedHex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurereceipt_proofCompressedHex(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {DisclosurePublicInputs}
     */
    get publicInputs() {
        const ret = wasm.disclosurereceipt_publicInputs(this.__wbg_ptr);
        return DisclosurePublicInputs.__wrap(ret);
    }
    /**
     * Plain JSON object for `JSON.stringify` / receipt export and
     * verification.
     * @returns {any}
     */
    toJSON() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurereceipt_toJSON(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {number}
     */
    get version() {
        const ret = wasm.disclosurereceipt_version(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) DisclosureReceipt.prototype[Symbol.dispose] = DisclosureReceipt.prototype.free;

export class DisclosureRequest {
    static __wrap(ptr) {
        const obj = Object.create(DisclosureRequest.prototype);
        obj.__wbg_ptr = ptr;
        DisclosureRequestFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosureRequestFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosurerequest_free(ptr, 0);
    }
    /**
     * @param {any} value
     * @returns {DisclosureRequest}
     */
    static fromValue(value) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.disclosurerequest_fromValue(retptr, addHeapObject(value));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return DisclosureRequest.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string[]} selected_commitments
     * @param {string} authority_label
     * @param {string} authority_identity_payload_hex
     * @param {string} purpose
     * @param {string} context_nonce
     */
    constructor(selected_commitments, authority_label, authority_identity_payload_hex, purpose, context_nonce) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passArrayJsValueToWasm0(selected_commitments, wasm.__wbindgen_export);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(authority_label, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            const ptr2 = passStringToWasm0(authority_identity_payload_hex, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len2 = WASM_VECTOR_LEN;
            const ptr3 = passStringToWasm0(purpose, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len3 = WASM_VECTOR_LEN;
            const ptr4 = passStringToWasm0(context_nonce, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len4 = WASM_VECTOR_LEN;
            wasm.disclosurerequest_new(retptr, ptr0, len0, ptr1, len1, ptr2, len2, ptr3, len3, ptr4, len4);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            DisclosureRequestFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) DisclosureRequest.prototype[Symbol.dispose] = DisclosureRequest.prototype.free;

export class DisclosureVerificationReport {
    static __wrap(ptr) {
        const obj = Object.create(DisclosureVerificationReport.prototype);
        obj.__wbg_ptr = ptr;
        DisclosureVerificationReportFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        DisclosureVerificationReportFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_disclosureverificationreport_free(ptr, 0);
    }
    /**
     * @returns {boolean}
     */
    get contextVerified() {
        const ret = wasm.disclosureverificationreport_contextVerified(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get knownRootStatus() {
        const ret = wasm.disclosureverificationreport_knownRootStatus(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get nullifiersUnspent() {
        const ret = wasm.disclosureverificationreport_nullifiersUnspent(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {boolean}
     */
    get proofVerified() {
        const ret = wasm.disclosureverificationreport_proofVerified(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {Array<any>}
     */
    get spentNullifierIndices() {
        const ret = wasm.disclosureverificationreport_spentNullifierIndices(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) DisclosureVerificationReport.prototype[Symbol.dispose] = DisclosureVerificationReport.prototype.free;

/**
 * GVK ciphertext attached to a note commitment event.
 */
export class GlobalViewKeyCiphertext {
    static __wrap(ptr) {
        const obj = Object.create(GlobalViewKeyCiphertext.prototype);
        obj.__wbg_ptr = ptr;
        GlobalViewKeyCiphertextFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GlobalViewKeyCiphertextFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_globalviewkeyciphertext_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get c1() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.globalviewkeyciphertext_c1(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get c2() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.globalviewkeyciphertext_c2(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get c3() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.globalviewkeyciphertext_c3(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {BabyJubJubPoint}
     */
    get r() {
        const ret = wasm.globalviewkeyciphertext_r(this.__wbg_ptr);
        return BabyJubJubPoint.__wrap(ret);
    }
}
if (Symbol.dispose) GlobalViewKeyCiphertext.prototype[Symbol.dispose] = GlobalViewKeyCiphertext.prototype.free;

/**
 * Cursor over decrypted pool transacts for admin audit.
 *
 * Holds the admin view private key for its lifetime; drop the cursor when
 * finished rather than retaining it longer than needed.
 */
export class GvkAudit {
    static __wrap(ptr) {
        const obj = Object.create(GvkAudit.prototype);
        obj.__wbg_ptr = ptr;
        GvkAuditFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        GvkAuditFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_gvkaudit_free(ptr, 0);
    }
    /**
     * Fetch and audit the next transaction, or `null` when exhausted.
     * @returns {Promise<any>}
     */
    nextTx() {
        const ret = wasm.gvkaudit_nextTx(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) GvkAudit.prototype[Symbol.dispose] = GvkAudit.prototype.free;

export class OperationalFeedItem {
    static __wrap(ptr) {
        const obj = Object.create(OperationalFeedItem.prototype);
        obj.__wbg_ptr = ptr;
        OperationalFeedItemFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        OperationalFeedItemFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_operationalfeeditem_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get body() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_body(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get contractId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_contractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get kind() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_kind(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get ledger() {
        const ret = wasm.operationalfeeditem_ledger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string | undefined}
     */
    get poolContractId() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_poolContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get title() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_title(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get txType() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.operationalfeeditem_txType(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) OperationalFeedItem.prototype[Symbol.dispose] = OperationalFeedItem.prototype.free;

export class PoolConfigEntry {
    static __wrap(ptr) {
        const obj = Object.create(PoolConfigEntry.prototype);
        obj.__wbg_ptr = ptr;
        PoolConfigEntryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoolConfigEntryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_poolconfigentry_free(ptr, 0);
    }
    /**
     * @returns {AssetDescriptor}
     */
    get asset() {
        const ret = wasm.poolconfigentry_asset(this.__wbg_ptr);
        return AssetDescriptor.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get deploymentLedger() {
        const ret = wasm.poolconfigentry_deploymentLedger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get enabled() {
        const ret = wasm.poolconfigentry_enabled(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {BabyJubJubPoint | undefined}
     */
    get gvkAuthorityPubKey() {
        const ret = wasm.poolconfigentry_gvkAuthorityPubKey(this.__wbg_ptr);
        return ret === 0 ? undefined : BabyJubJubPoint.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get gvkMode() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolconfigentry_gvkMode(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string[]}
     */
    get policyFlags() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolconfigentry_policyFlags(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get poolContractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolconfigentry_poolContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get tokenContractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolconfigentry_tokenContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PoolConfigEntry.prototype[Symbol.dispose] = PoolConfigEntry.prototype.free;

/**
 * Estimate returned by [`crate::PrivatePool::estimate`].
 */
export class PoolEstimate {
    static __wrap(ptr) {
        const obj = Object.create(PoolEstimate.prototype);
        obj.__wbg_ptr = ptr;
        PoolEstimateFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoolEstimateFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_poolestimate_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get fees() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolestimate_fees(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get txCount() {
        const ret = wasm.poolestimate_txCount(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) PoolEstimate.prototype[Symbol.dispose] = PoolEstimate.prototype.free;

/**
 * Result of pool transact flows (`deposit`, `transfer`, `withdraw`, …).
 */
export class PoolExecuteResult {
    static __wrap(ptr) {
        const obj = Object.create(PoolExecuteResult.prototype);
        obj.__wbg_ptr = ptr;
        PoolExecuteResultFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoolExecuteResultFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_poolexecuteresult_free(ptr, 0);
    }
    /**
     * @returns {number | undefined}
     */
    get code() {
        const ret = wasm.poolexecuteresult_code(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * @returns {string[]}
     */
    get hashes() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolexecuteresult_hashes(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get message() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolexecuteresult_message(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * `"ok"`, `"failed"`, or `"aspNotReady"`.
     * @returns {string}
     */
    get status() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolexecuteresult_status(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * Plain JSON object with `message`/`code` omitted when absent.
     * @returns {any}
     */
    toJSON() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolexecuteresult_toJSON(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return takeObject(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) PoolExecuteResult.prototype[Symbol.dispose] = PoolExecuteResult.prototype.free;

export class PoolInfo {
    static __wrap(ptr) {
        const obj = Object.create(PoolInfo.prototype);
        obj.__wbg_ptr = ptr;
        PoolInfoFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoolInfoFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_poolinfo_free(ptr, 0);
    }
    /**
     * @returns {BabyJubJubPoint | undefined}
     */
    get adminViewKey() {
        const ret = wasm.poolinfo_adminViewKey(this.__wbg_ptr);
        return ret === 0 ? undefined : BabyJubJubPoint.__wrap(ret);
    }
    /**
     * @returns {string}
     */
    get admin() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_admin(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get aspMembership() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_aspMembership(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get aspNonMembership() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_aspNonMembership(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_contractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get contractType() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_contractType(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    get depositsPaused() {
        const ret = wasm.poolinfo_depositsPaused(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {string}
     */
    get fee() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_fee(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number | undefined}
     */
    get gvkMode() {
        const ret = wasm.poolinfo_gvkMode(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * @returns {number}
     */
    get ledger() {
        const ret = wasm.poolinfo_ledger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get maximumDepositAmount() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_maximumDepositAmount(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {bigint}
     */
    get merkleCapacity() {
        const ret = wasm.poolinfo_merkleCapacity(this.__wbg_ptr);
        return BigInt.asUintN(64, ret);
    }
    /**
     * @returns {number | undefined}
     */
    get merkleCurrentRootIndex() {
        const ret = wasm.poolinfo_merkleCurrentRootIndex(this.__wbg_ptr);
        return ret === Number.MAX_SAFE_INTEGER ? undefined : ret;
    }
    /**
     * @returns {number}
     */
    get merkleLevels() {
        const ret = wasm.poolinfo_merkleLevels(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get merkleNextIndex() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_merkleNextIndex(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string | undefined}
     */
    get merkleRoot() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_merkleRoot(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            let v1;
            if (r0 !== 0) {
                v1 = getStringFromWasm0(r0, r1);
                wasm.__wbindgen_export4(r0, r1 * 1, 1);
            }
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get minimumDepositAmount() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_minimumDepositAmount(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string[]}
     */
    get policyFlags() {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_policyFlags(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var v1 = getArrayJsValueFromWasm0(r0, r1);
            wasm.__wbindgen_export4(r0, r1 * 4, 4);
            return v1;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {string}
     */
    get token() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_token(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get totalCommitments() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_totalCommitments(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get verifier() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.poolinfo_verifier(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PoolInfo.prototype[Symbol.dispose] = PoolInfo.prototype.free;

export class PoolOptions {
    static __wrap(ptr) {
        const obj = Object.create(PoolOptions.prototype);
        obj.__wbg_ptr = ptr;
        PoolOptionsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PoolOptionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_pooloptions_free(ptr, 0);
    }
    /**
     * @param {any} value
     * @returns {PoolOptions}
     */
    static fromValue(value) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.pooloptions_fromValue(retptr, addHeapObject(value));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return PoolOptions.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @param {string} pool_contract
     */
    constructor(pool_contract) {
        const ptr0 = passStringToWasm0(pool_contract, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.pooloptions_new(ptr0, len0);
        this.__wbg_ptr = ret;
        PoolOptionsFinalization.register(this, this.__wbg_ptr, this);
        return this;
    }
    /**
     * @returns {string}
     */
    get poolContract() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.pooloptions_poolContract(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PoolOptions.prototype[Symbol.dispose] = PoolOptions.prototype.free;

/**
 * One pool balance row from [`crate::Account::portfolio`].
 */
export class PortfolioBalance {
    static __wrap(ptr) {
        const obj = Object.create(PortfolioBalance.prototype);
        obj.__wbg_ptr = ptr;
        PortfolioBalanceFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PortfolioBalanceFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_portfoliobalance_free(ptr, 0);
    }
    /**
     * Stroops as a decimal string.
     * @returns {string}
     */
    get amount() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.portfoliobalance_amount(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get noteCount() {
        const ret = wasm.portfoliobalance_noteCount(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get poolContractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.portfoliobalance_poolContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get tokenContractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.portfoliobalance_tokenContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get tokenLabel() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.portfoliobalance_tokenLabel(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PortfolioBalance.prototype[Symbol.dispose] = PortfolioBalance.prototype.free;

/**
 * Per-pool session for deposits, transfers, and withdrawals.
 */
export class PrivatePool {
    static __wrap(ptr) {
        const obj = Object.create(PrivatePool.prototype);
        obj.__wbg_ptr = ptr;
        PrivatePoolFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PrivatePoolFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_privatepool_free(ptr, 0);
    }
    /**
     * Open an admin audit cursor for this pool.
     *
     * `globalViewPrivateKeyHex` is the admin authority scalar as a
     * `0x`-prefixed field hex string. Requires a pool-gvk deployment with
     * GVK enabled.
     * @param {string} global_view_private_key_hex
     * @returns {Promise<GvkAudit>}
     */
    audit(global_view_private_key_hex) {
        const ptr0 = passStringToWasm0(global_view_private_key_hex, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.privatepool_audit(this.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Balance in stroops (`bigint` in JS).
     * @returns {Promise<bigint>}
     */
    balance() {
        const ret = wasm.privatepool_balance(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Deposit tokens. `amount` is stroops (`bigint` in JS).
     * @param {bigint} amount
     * @returns {Promise<PoolExecuteResult>}
     */
    deposit(amount) {
        const ret = wasm.privatepool_deposit(this.__wbg_ptr, amount, amount >> BigInt(64));
        return takeObject(ret);
    }
    /**
     * Generate a selective-disclosure proof for a note commitment.
     *
     * Returns `undefined` when the account must register at the ASP before
     * disclosing; check with `== null`.
     * @param {DisclosureRequest} req
     * @returns {Promise<DisclosureReceipt | undefined>}
     */
    disclose(req) {
        _assertClass(req, DisclosureRequest);
        const ret = wasm.privatepool_disclose(this.__wbg_ptr, req.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Estimate how many on-chain transactions a spend of `amount` stroops
     * would require, and the pool fees they pay.
     * @param {bigint} amount
     * @returns {Promise<PoolEstimate>}
     */
    estimate(amount) {
        const ret = wasm.privatepool_estimate(this.__wbg_ptr, amount, amount >> BigInt(64));
        return takeObject(ret);
    }
    /**
     * Fee the pool charges on every transaction, in stroops (`bigint` in JS).
     * @returns {Promise<bigint>}
     */
    fee() {
        const ret = wasm.privatepool_fee(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Most one spend can send after paying the pool fee on every step, in
     * stroops (`bigint` in JS).
     * @returns {Promise<bigint>}
     */
    maxSpend() {
        const ret = wasm.privatepool_maxSpend(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * User notes for this pool (commitments, amounts, spent status).
     * @returns {Promise<UserNoteSummary[]>}
     */
    notes() {
        const ret = wasm.privatepool_notes(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * @returns {Promise<number>}
     */
    tokenDecimals() {
        const ret = wasm.privatepool_tokenDecimals(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Low-level pool `transact` call. See SDK [`Transact`] for field
     * semantics.
     * @param {any} config
     * @returns {Promise<PoolExecuteResult>}
     */
    transact(config) {
        const ret = wasm.privatepool_transact(this.__wbg_ptr, addHeapObject(config));
        return takeObject(ret);
    }
    /**
     * Transfer privately to explicit recipient keys (note + encryption hex).
     * @param {string} note_public_key_hex
     * @param {string} encryption_public_key_hex
     * @param {bigint} amount
     * @returns {Promise<PoolExecuteResult>}
     */
    transferToKeys(note_public_key_hex, encryption_public_key_hex, amount) {
        const ptr0 = passStringToWasm0(note_public_key_hex, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(encryption_public_key_hex, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.privatepool_transferToKeys(this.__wbg_ptr, ptr0, len0, ptr1, len1, amount, amount >> BigInt(64));
        return takeObject(ret);
    }
    /**
     * Transfer privately. `recipient` is a Stellar `G...` address.
     * @param {string} recipient
     * @param {bigint} amount
     * @returns {Promise<PoolExecuteResult>}
     */
    transfer(recipient, amount) {
        const ptr0 = passStringToWasm0(recipient, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.privatepool_transfer(this.__wbg_ptr, ptr0, len0, amount, amount >> BigInt(64));
        return takeObject(ret);
    }
    /**
     * @param {DisclosureReceipt} receipt
     * @param {string} expected_vk_hash
     * @returns {Promise<DisclosureVerificationReport>}
     */
    verifyDisclosure(receipt, expected_vk_hash) {
        _assertClass(receipt, DisclosureReceipt);
        const ptr0 = passStringToWasm0(expected_vk_hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.privatepool_verifyDisclosure(this.__wbg_ptr, receipt.__wbg_ptr, ptr0, len0);
        return takeObject(ret);
    }
    /**
     * Withdraw to `recipient`, or the connected wallet when omitted.
     * @param {bigint} amount
     * @param {string | null} [recipient]
     * @returns {Promise<PoolExecuteResult>}
     */
    withdraw(amount, recipient) {
        var ptr0 = isLikeNone(recipient) ? 0 : passStringToWasm0(recipient, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        var len0 = WASM_VECTOR_LEN;
        const ret = wasm.privatepool_withdraw(this.__wbg_ptr, amount, amount >> BigInt(64), ptr0, len0);
        return takeObject(ret);
    }
}
if (Symbol.dispose) PrivatePool.prototype[Symbol.dispose] = PrivatePool.prototype.free;

/**
 * Prover worker bridge — main-thread ↔ worker I/O for Groth16 proving.
 */
export class ProverBridge {
    static __wrap(ptr) {
        const obj = Object.create(ProverBridge.prototype);
        obj.__wbg_ptr = ptr;
        ProverBridgeFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProverBridgeFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_proverbridge_free(ptr, 0);
    }
    /**
     * @param {string} base_url
     * @param {string} lock_json
     * @returns {Promise<void>}
     */
    configureCircuitsBase(base_url, lock_json) {
        const ptr0 = passStringToWasm0(base_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(lock_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        const ret = wasm.proverbridge_configureCircuitsBase(this.__wbg_ptr, ptr0, len0, ptr1, len1);
        return takeObject(ret);
    }
    /**
     * New handle to the same prover worker.
     * @returns {ProverBridge}
     */
    fork() {
        const ret = wasm.proverbridge_fork(this.__wbg_ptr);
        return ProverBridge.__wrap(ret);
    }
    /**
     * @returns {Promise<void>}
     */
    ping() {
        const ret = wasm.proverbridge_ping(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * @param {string} prover_worker_url
     * @returns {ProverBridge}
     */
    static spawn(prover_worker_url) {
        const ptr0 = passStringToWasm0(prover_worker_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ret = wasm.proverbridge_spawn(ptr0, len0);
        return ProverBridge.__wrap(ret);
    }
    /**
     * @returns {ProverHandle}
     */
    toHandle() {
        const ret = wasm.proverbridge_toHandle(this.__wbg_ptr);
        return ProverHandle.__wrap(ret);
    }
}
if (Symbol.dispose) ProverBridge.prototype[Symbol.dispose] = ProverBridge.prototype.free;

/**
 * Handle [`crate::client::Client::new`] takes.
 */
export class ProverHandle {
    static __wrap(ptr) {
        const obj = Object.create(ProverHandle.prototype);
        obj.__wbg_ptr = ptr;
        ProverHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        ProverHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_proverhandle_free(ptr, 0);
    }
}
if (Symbol.dispose) ProverHandle.prototype[Symbol.dispose] = ProverHandle.prototype.free;

export class PublicKeyEntry {
    static __wrap(ptr) {
        const obj = Object.create(PublicKeyEntry.prototype);
        obj.__wbg_ptr = ptr;
        PublicKeyEntryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        PublicKeyEntryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_publickeyentry_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get address() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.publickeyentry_address(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get encryptionKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.publickeyentry_encryptionKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get ledger() {
        const ret = wasm.publickeyentry_ledger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get noteKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.publickeyentry_noteKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) PublicKeyEntry.prototype[Symbol.dispose] = PublicKeyEntry.prototype.free;

export class RecipientLookup {
    static __wrap(ptr) {
        const obj = Object.create(RecipientLookup.prototype);
        obj.__wbg_ptr = ptr;
        RecipientLookupFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        RecipientLookupFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_recipientlookup_free(ptr, 0);
    }
    /**
     * @returns {PublicKeyEntry | undefined}
     */
    get entry() {
        const ret = wasm.recipientlookup_entry(this.__wbg_ptr);
        return ret === 0 ? undefined : PublicKeyEntry.__wrap(ret);
    }
    /**
     * @returns {number}
     */
    get networkTipLedger() {
        const ret = wasm.recipientlookup_networkTipLedger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {boolean}
     */
    get registryFullySynced() {
        const ret = wasm.recipientlookup_registryFullySynced(this.__wbg_ptr);
        return ret !== 0;
    }
    /**
     * @returns {number}
     */
    get registryLastFullyIndexedLedger() {
        const ret = wasm.recipientlookup_registryLastFullyIndexedLedger(this.__wbg_ptr);
        return ret >>> 0;
    }
}
if (Symbol.dispose) RecipientLookup.prototype[Symbol.dispose] = RecipientLookup.prototype.free;

/**
 * Handle [`crate::client::Client::account`] takes.
 */
export class SignerHandle {
    static __wrap(ptr) {
        const obj = Object.create(SignerHandle.prototype);
        obj.__wbg_ptr = ptr;
        SignerHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SignerHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_signerhandle_free(ptr, 0);
    }
}
if (Symbol.dispose) SignerHandle.prototype[Symbol.dispose] = SignerHandle.prototype.free;

/**
 * Owns a set of registered worker sinks; unregisters them on drop.
 */
export class SinkRegistration {
    static __wrap(ptr) {
        const obj = Object.create(SinkRegistration.prototype);
        obj.__wbg_ptr = ptr;
        SinkRegistrationFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        SinkRegistrationFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_sinkregistration_free(ptr, 0);
    }
}
if (Symbol.dispose) SinkRegistration.prototype[Symbol.dispose] = SinkRegistration.prototype.free;

/**
 * Storage worker bridge — main-thread ↔ worker I/O for local persistence.
 * Open once per page, [`StorageBridge::fork`] for extra handles.
 */
export class Storage {
    static __wrap(ptr) {
        const obj = Object.create(Storage.prototype);
        obj.__wbg_ptr = ptr;
        StorageFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StorageFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_storage_free(ptr, 0);
    }
    /**
     * Raw storage-worker RPC. Request/response shapes match the worker
     * protocol (externally tagged enums, e.g. `{ "DisclaimerState": "G..."
     * }`).
     * @param {any} request
     * @param {number | null} [timeout_ms]
     * @returns {Promise<any>}
     */
    call(request, timeout_ms) {
        const ret = wasm.storage_call(this.__wbg_ptr, addHeapObject(request), isLikeNone(timeout_ms) ? Number.MAX_SAFE_INTEGER : (timeout_ms) >>> 0);
        return takeObject(ret);
    }
    /**
     * Close storage and all forks before releasing OPFS handles.
     * @returns {Promise<void>}
     */
    close() {
        const ret = wasm.storage_close(this.__wbg_ptr);
        return takeObject(ret);
    }
    /**
     * Whether this build was compiled with the `encrypted-storage` feature.
     * @returns {boolean}
     */
    static encryptedStorageEnabled() {
        const ret = wasm.storage_encryptedStorageEnabled();
        return ret !== 0;
    }
    /**
     * New handle to the same storage worker (shared database).
     * @returns {Storage}
     */
    fork() {
        const ret = wasm.storage_fork(this.__wbg_ptr);
        return Storage.__wrap(ret);
    }
    /**
     * Spawn the storage worker and verify it is ready.
     *
     * Call once per page session. Use [`StorageBridge::fork`] for additional
     * handles (e.g. app code alongside [`crate::Client`]).
     *
     * Opens encrypted storage with a 32-byte `key`. A build with only the
     * `unencrypted-storage` feature opens plaintext storage instead and
     * rejects a `key`.
     * @param {any} options
     * @returns {Promise<Storage>}
     */
    static open(options) {
        const ret = wasm.storage_open(addHeapObject(options));
        return takeObject(ret);
    }
    /**
     * Forks and pings before converting to a [`StorageHandle`].
     * @returns {Promise<StorageHandle>}
     */
    toHandle() {
        const ret = wasm.storage_toHandle(this.__wbg_ptr);
        return takeObject(ret);
    }
}
if (Symbol.dispose) Storage.prototype[Symbol.dispose] = Storage.prototype.free;

/**
 * Handle [`crate::client::Client::new`] takes.
 */
export class StorageHandle {
    static __wrap(ptr) {
        const obj = Object.create(StorageHandle.prototype);
        obj.__wbg_ptr = ptr;
        StorageHandleFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        StorageHandleFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_storagehandle_free(ptr, 0);
    }
}
if (Symbol.dispose) StorageHandle.prototype[Symbol.dispose] = StorageHandle.prototype.free;

/**
 * Compact note view returned by [`crate::Account::user_notes`] and
 * [`crate::PrivatePool::notes`].
 */
export class UserNoteSummary {
    static __wrap(ptr) {
        const obj = Object.create(UserNoteSummary.prototype);
        obj.__wbg_ptr = ptr;
        UserNoteSummaryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UserNoteSummaryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_usernotesummary_free(ptr, 0);
    }
    /**
     * Stroops as a decimal string.
     * @returns {string}
     */
    get amount() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.usernotesummary_amount(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get createdAtLedger() {
        const ret = wasm.usernotesummary_createdAtLedger(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {GlobalViewKeyCiphertext | undefined}
     */
    get gvkCiphertext() {
        const ret = wasm.usernotesummary_gvkCiphertext(this.__wbg_ptr);
        return ret === 0 ? undefined : GlobalViewKeyCiphertext.__wrap(ret);
    }
    /**
     * Pool commitment (`0x` field hex). Copies of a commitment share it; the
     * pool and `leafIndex` tell them apart.
     * @returns {string}
     */
    get id() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.usernotesummary_id(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {number}
     */
    get leafIndex() {
        const ret = wasm.usernotesummary_leafIndex(this.__wbg_ptr);
        return ret >>> 0;
    }
    /**
     * @returns {string}
     */
    get poolContractId() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.usernotesummary_poolContractId(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {boolean}
     */
    get spent() {
        const ret = wasm.usernotesummary_spent(this.__wbg_ptr);
        return ret !== 0;
    }
}
if (Symbol.dispose) UserNoteSummary.prototype[Symbol.dispose] = UserNoteSummary.prototype.free;

/**
 * Locally derived note and encryption public keys for an account.
 */
export class UserPublicKeys {
    static __wrap(ptr) {
        const obj = Object.create(UserPublicKeys.prototype);
        obj.__wbg_ptr = ptr;
        UserPublicKeysFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        UserPublicKeysFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_userpublickeys_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get encryptionPublicKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.userpublickeys_encryptionPublicKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get notePublicKey() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.userpublickeys_notePublicKey(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) UserPublicKeys.prototype[Symbol.dispose] = UserPublicKeys.prototype.free;

export class VerifierEntry {
    static __wrap(ptr) {
        const obj = Object.create(VerifierEntry.prototype);
        obj.__wbg_ptr = ptr;
        VerifierEntryFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VerifierEntryFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_verifierentry_free(ptr, 0);
    }
    /**
     * @returns {string}
     */
    get address() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.verifierentry_address(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
    /**
     * @returns {string}
     */
    get suffix() {
        let deferred1_0;
        let deferred1_1;
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.verifierentry_suffix(retptr, this.__wbg_ptr);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            deferred1_0 = r0;
            deferred1_1 = r1;
            return getStringFromWasm0(r0, r1);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
            wasm.__wbindgen_export4(deferred1_0, deferred1_1, 1);
        }
    }
}
if (Symbol.dispose) VerifierEntry.prototype[Symbol.dispose] = VerifierEntry.prototype.free;

export class VerifyDisclosureOptions {
    static __wrap(ptr) {
        const obj = Object.create(VerifyDisclosureOptions.prototype);
        obj.__wbg_ptr = ptr;
        VerifyDisclosureOptionsFinalization.register(obj, obj.__wbg_ptr, obj);
        return obj;
    }
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        VerifyDisclosureOptionsFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_verifydisclosureoptions_free(ptr, 0);
    }
    /**
     * @param {any} value
     * @returns {VerifyDisclosureOptions}
     */
    static fromValue(value) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            wasm.verifydisclosureoptions_fromValue(retptr, addHeapObject(value));
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            return VerifyDisclosureOptions.__wrap(r0);
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
}
if (Symbol.dispose) VerifyDisclosureOptions.prototype[Symbol.dispose] = VerifyDisclosureOptions.prototype.free;

/**
 * Wallet adapter invoked from WASM (`FreighterSigner` or any object with the
 * three sign methods).
 */
export class WalletSigner {
    __destroy_into_raw() {
        const ptr = this.__wbg_ptr;
        this.__wbg_ptr = 0;
        WalletSignerFinalization.unregister(this);
        return ptr;
    }
    free() {
        const ptr = this.__destroy_into_raw();
        wasm.__wbg_walletsigner_free(ptr, 0);
    }
    /**
     * @param {any} signer
     * @param {string} network_passphrase
     * @param {string} signer_address
     */
    constructor(signer, network_passphrase, signer_address) {
        try {
            const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
            const ptr0 = passStringToWasm0(network_passphrase, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len0 = WASM_VECTOR_LEN;
            const ptr1 = passStringToWasm0(signer_address, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            wasm.walletsigner_new(retptr, addHeapObject(signer), ptr0, len0, ptr1, len1);
            var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
            var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
            var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
            if (r2) {
                throw takeObject(r1);
            }
            this.__wbg_ptr = r0;
            WalletSignerFinalization.register(this, this.__wbg_ptr, this);
            return this;
        } finally {
            wasm.__wbindgen_add_to_stack_pointer(16);
        }
    }
    /**
     * @returns {SignerHandle}
     */
    toHandle() {
        const ret = wasm.walletsigner_toHandle(this.__wbg_ptr);
        return SignerHandle.__wrap(ret);
    }
}
if (Symbol.dispose) WalletSigner.prototype[Symbol.dispose] = WalletSigner.prototype.free;

/**
 * Probe whether the wallet RPC needs a historical-sync bootnode.
 *
 * Does not take or resolve a bootnode URL — callers supply that via
 * [`crate::Client::new`] after checking storage / prompting the user.
 * @param {string} rpc_url
 * @param {StorageHandle} storage
 * @param {any} contract_config
 * @returns {Promise<boolean>}
 */
export function bootnodeRequired(rpc_url, storage, contract_config) {
    const ptr0 = passStringToWasm0(rpc_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(storage, StorageHandle);
    const ret = wasm.bootnodeRequired(ptr0, len0, storage.__wbg_ptr, addHeapObject(contract_config));
    return takeObject(ret);
}

/**
 * Configure the SDK telemetry settings (log level, sink targets, buffer sizes,
 * etc.).
 *
 * If telemetry has not been initialized yet, this function will initialize it
 * with the specified config (or defaults). If telemetry has already been
 * initialized, this will dynamically update runtime settings (log level and
 * sensitive log reveal).
 *
 * TS signature:
 * ```typescript
 * export function configureTelemetry(config?: {
 *   level?: string;
 *   sink?: "console" | "ringBuffer" | "both";
 *   ringBufferBytes?: number;
 *   revealSensitive?: boolean;
 * }): void;
 * ```
 * @param {any} config
 */
export function configureTelemetry(config) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.configureTelemetry(retptr, addHeapObject(config));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Whether this build supports debug/trace logging and Tier-1 sensitive
 * reveal. Both are compiled out when `debug_assertions` is off (the
 * production `release` profile); the UI should hide or disable the
 * corresponding settings in that case.
 * @returns {boolean}
 */
export function debugLogsEnabled() {
    const ret = wasm.debugLogsEnabled();
    return ret !== 0;
}

/**
 * Derive the ASP membership tree leaf from explicit public inputs.
 * @param {string} note_public_key
 * @param {string} membership_blinding
 * @returns {string}
 */
export function deriveAspUserLeaf(note_public_key, membership_blinding) {
    let deferred4_0;
    let deferred4_1;
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(note_public_key, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        const ptr1 = passStringToWasm0(membership_blinding, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len1 = WASM_VECTOR_LEN;
        wasm.deriveAspUserLeaf(retptr, ptr0, len0, ptr1, len1);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        var r2 = getDataViewMemory0().getInt32(retptr + 4 * 2, true);
        var r3 = getDataViewMemory0().getInt32(retptr + 4 * 3, true);
        var ptr3 = r0;
        var len3 = r1;
        if (r3) {
            ptr3 = 0; len3 = 0;
            throw takeObject(r2);
        }
        deferred4_0 = ptr3;
        deferred4_1 = len3;
        return getStringFromWasm0(ptr3, len3);
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
        wasm.__wbindgen_export4(deferred4_0, deferred4_1, 1);
    }
}

/**
 * Return recent formatted log output aggregated from the in-memory ring
 * buffers of the main thread and the storage/prover worker isolates.
 * @returns {Promise<string>}
 */
export function dump_recent_logs() {
    const ret = wasm.dump_recent_logs();
    return takeObject(ret);
}

/**
 * Parse token units into unsigned base units without rounding.
 * @param {string} value
 * @param {number} decimals
 * @returns {bigint}
 */
export function parseTokenAmount(value, decimals) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-32);
        const ptr0 = passStringToWasm0(value, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.parseTokenAmount(retptr, ptr0, len0, decimals);
        var r0 = getDataViewMemory0().getBigInt64(retptr + 8 * 0, true);
        var r2 = getDataViewMemory0().getBigInt64(retptr + 8 * 1, true);
        var r4 = getDataViewMemory0().getInt32(retptr + 4 * 4, true);
        var r5 = getDataViewMemory0().getInt32(retptr + 4 * 5, true);
        if (r5) {
            throw takeObject(r4);
        }
        return (BigInt.asUintN(64, r0) | (BigInt.asUintN(64, r2) << BigInt(64)));
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(32);
    }
}

/**
 * Read token precision without opening a wallet session.
 * @param {string} rpc_url
 * @param {string} token_contract
 * @returns {Promise<number>}
 */
export function readTokenDecimals(rpc_url, token_contract) {
    const ptr0 = passStringToWasm0(rpc_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    const ptr1 = passStringToWasm0(token_contract, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ret = wasm.readTokenDecimals(ptr0, len0, ptr1, len1);
    return takeObject(ret);
}

/**
 * Register a storage and/or prover bridge as a telemetry sink. Consumes the
 * bridges — call `.toHandle()` first if you still need them afterward.
 *
 * Returns a handle that owns the registration: call `.free()` on it (or let
 * it be garbage-collected) once the corresponding client is done, so the
 * sink is unregistered instead of lingering forever.
 * @param {Storage | null} [storage]
 * @param {ProverBridge | null} [prover]
 * @returns {SinkRegistration}
 */
export function registerTelemetrySinks(storage, prover) {
    let ptr0 = 0;
    if (!isLikeNone(storage)) {
        _assertClass(storage, Storage);
        ptr0 = storage.__destroy_into_raw();
    }
    let ptr1 = 0;
    if (!isLikeNone(prover)) {
        _assertClass(prover, ProverBridge);
        ptr1 = prover.__destroy_into_raw();
    }
    const ret = wasm.registerTelemetrySinks(ptr0, ptr1);
    return SinkRegistration.__wrap(ret);
}

/**
 * Replace the active log level filter with `level`.
 *
 * `level` must be a bare level name such as `"info"`, `"debug"`, or
 * `"trace"` (target directives like `"crate=debug"` are not supported).
 * @param {string} level
 */
export function set_log_level(level) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        const ptr0 = passStringToWasm0(level, wasm.__wbindgen_export, wasm.__wbindgen_export2);
        const len0 = WASM_VECTOR_LEN;
        wasm.set_log_level(retptr, ptr0, len0);
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}

/**
 * Verify a selective-disclosure receipt with no wallet, no local storage,
 * and no [`Client`] instance — just an RPC URL and an already-configured
 * [`ProverHandle`]. Skips the OPFS/SQLite storage worker entirely, since
 * verification never reads local state.
 * @param {string} rpc_url
 * @param {ProverHandle} prover
 * @param {string} receipt_json
 * @param {string} expected_vk_hash
 * @param {any} options
 * @returns {Promise<DisclosureVerificationReport>}
 */
export function verifySelectiveDisclosure(rpc_url, prover, receipt_json, expected_vk_hash, options) {
    const ptr0 = passStringToWasm0(rpc_url, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len0 = WASM_VECTOR_LEN;
    _assertClass(prover, ProverHandle);
    const ptr1 = passStringToWasm0(receipt_json, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len1 = WASM_VECTOR_LEN;
    const ptr2 = passStringToWasm0(expected_vk_hash, wasm.__wbindgen_export, wasm.__wbindgen_export2);
    const len2 = WASM_VECTOR_LEN;
    const ret = wasm.verifySelectiveDisclosure(ptr0, len0, prover.__wbg_ptr, ptr1, len1, ptr2, len2, addHeapObject(options));
    return takeObject(ret);
}
function __wbg_get_imports() {
    const import0 = {
        __proto__: null,
        __wbg_Error_67e7344beaa85059: function(arg0, arg1) {
            const ret = Error(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_Number_c54e7112a3fa7e3e: function(arg0) {
            const ret = Number(getObject(arg0));
            return ret;
        },
        __wbg_String_8564e559799eccda: function(arg0, arg1) {
            const ret = String(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_bigint_get_as_i64_b482365c149396c8: function(arg0, arg1) {
            const v = getObject(arg1);
            const ret = typeof(v) === 'bigint' ? v : undefined;
            getDataViewMemory0().setBigInt64(arg0 + 8 * 1, isLikeNone(ret) ? BigInt(0) : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_boolean_get_7a12af2b3f899c5a: function(arg0) {
            const v = getObject(arg0);
            const ret = typeof(v) === 'boolean' ? v : undefined;
            return isLikeNone(ret) ? 0xFFFFFF : ret ? 1 : 0;
        },
        __wbg___wbindgen_debug_string_0e68cf47c9cbd9b0: function(arg0, arg1) {
            const ret = debugString(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_in_50072d4d6e45c193: function(arg0, arg1) {
            const ret = getObject(arg0) in getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_is_bigint_60fc0336cb14f5d7: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'bigint';
            return ret;
        },
        __wbg___wbindgen_is_function_fcda5e3902d732fe: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'function';
            return ret;
        },
        __wbg___wbindgen_is_null_5160b3e381865372: function(arg0) {
            const ret = getObject(arg0) === null;
            return ret;
        },
        __wbg___wbindgen_is_object_edb6b15aa3afe12e: function(arg0) {
            const val = getObject(arg0);
            const ret = typeof(val) === 'object' && val !== null;
            return ret;
        },
        __wbg___wbindgen_is_string_c4f7cb494a2a21f1: function(arg0) {
            const ret = typeof(getObject(arg0)) === 'string';
            return ret;
        },
        __wbg___wbindgen_is_undefined_8c687d0b90d5b524: function(arg0) {
            const ret = getObject(arg0) === undefined;
            return ret;
        },
        __wbg___wbindgen_jsval_eq_9fdcd3c0a860dd3b: function(arg0, arg1) {
            const ret = getObject(arg0) === getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_jsval_loose_eq_3c30021c243b64cd: function(arg0, arg1) {
            const ret = getObject(arg0) == getObject(arg1);
            return ret;
        },
        __wbg___wbindgen_memory_3f8442e22540244f: function() {
            const ret = wasm.memory;
            return addHeapObject(ret);
        },
        __wbg___wbindgen_number_get_1dc732b810cb937c: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'number' ? obj : undefined;
            getDataViewMemory0().setFloat64(arg0 + 8 * 1, isLikeNone(ret) ? 0 : ret, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, !isLikeNone(ret), true);
        },
        __wbg___wbindgen_shr_56cae1eadababcab: function(arg0, arg1) {
            const ret = getObject(arg0) >> getObject(arg1);
            return addHeapObject(ret);
        },
        __wbg___wbindgen_string_get_92ab86bb19cbc12f: function(arg0, arg1) {
            const obj = getObject(arg1);
            const ret = typeof(obj) === 'string' ? obj : undefined;
            var ptr1 = isLikeNone(ret) ? 0 : passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            var len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg___wbindgen_throw_5d9e815e6fdf150f: function(arg0, arg1) {
            throw new Error(getStringFromWasm0(arg0, arg1));
        },
        __wbg__wbg_cb_unref_997e73d32238e655: function(arg0) {
            getObject(arg0)._wbg_cb_unref();
        },
        __wbg_abort_03f8c5804715cb9a: function(arg0, arg1) {
            getObject(arg0).abort(getObject(arg1));
        },
        __wbg_abort_76dea11221098ae5: function(arg0) {
            getObject(arg0).abort();
        },
        __wbg_account_new: function(arg0) {
            const ret = Account.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_append_8e87c13f0f08f8cd: function() { return handleError(function (arg0, arg1, arg2, arg3, arg4) {
            getObject(arg0).append(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
        }, arguments); },
        __wbg_apply_5d9aa7604c2490a8: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).apply(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_arrayBuffer_06f3da76f071d37f: function() { return handleError(function (arg0) {
            const ret = getObject(arg0).arrayBuffer();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_buffer_60eec204070b2802: function(arg0) {
            const ret = getObject(arg0).buffer;
            return addHeapObject(ret);
        },
        __wbg_call_269c5566fbede3eb: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg0).call(getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_call_6bcf8d3e20937e46: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = getObject(arg0).call(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_clearTimeout_1daad5c6ee4fcd3b: function(arg0) {
            const ret = clearTimeout(takeObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_clearTimeout_3629d6209dfcc46e: function(arg0) {
            const ret = clearTimeout(takeObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_client_new: function(arg0) {
            const ret = Client.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_construct_69525de4bcbd615c: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.construct(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_contractsstatedata_new: function(arg0) {
            const ret = ContractsStateData.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_createObjectURL_7dadebfd232e594a: function() { return handleError(function (arg0, arg1) {
            const ret = URL.createObjectURL(getObject(arg1));
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_crypto_38df2bab126b63dc: function(arg0) {
            const ret = getObject(arg0).crypto;
            return addHeapObject(ret);
        },
        __wbg_data_aa7ba49b34c0d883: function(arg0) {
            const ret = getObject(arg0).data;
            return addHeapObject(ret);
        },
        __wbg_debug_eb092a10b3338acb: function(arg0) {
            console.debug(getObject(arg0));
        },
        __wbg_disclosurereceipt_new: function(arg0) {
            const ret = DisclosureReceipt.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_disclosureverificationreport_new: function(arg0) {
            const ret = DisclosureVerificationReport.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_dispatchEvent_67aab71ae1deb26a: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg0).dispatchEvent(getObject(arg1));
            return ret;
        }, arguments); },
        __wbg_done_cffed884d87aa22e: function(arg0) {
            const ret = getObject(arg0).done;
            return ret;
        },
        __wbg_entries_972a87586902cf87: function(arg0) {
            const ret = Object.entries(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_entries_f9de04c09a57314e: function(arg0) {
            const ret = getObject(arg0).entries();
            return addHeapObject(ret);
        },
        __wbg_error_756c5934221e6fee: function(arg0) {
            console.error(getObject(arg0));
        },
        __wbg_error_757e9472f8410341: function(arg0, arg1) {
            let deferred0_0;
            let deferred0_1;
            try {
                deferred0_0 = arg0;
                deferred0_1 = arg1;
                console.error(getStringFromWasm0(arg0, arg1));
            } finally {
                wasm.__wbindgen_export4(deferred0_0, deferred0_1, 1);
            }
        },
        __wbg_fetch_7a37768ab67c5bd8: function(arg0) {
            const ret = fetch(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_fetch_920242d59bac2026: function(arg0, arg1) {
            const ret = getObject(arg0).fetch(getObject(arg1));
            return addHeapObject(ret);
        },
        __wbg_getDate_8e7807f062ade36a: function(arg0) {
            const ret = getObject(arg0).getDate();
            return ret;
        },
        __wbg_getDay_4806d3f91116db40: function(arg0) {
            const ret = getObject(arg0).getDay();
            return ret;
        },
        __wbg_getFullYear_0cfd5a75cf3d5856: function(arg0) {
            const ret = getObject(arg0).getFullYear();
            return ret;
        },
        __wbg_getHours_a9938d9b8972574f: function(arg0) {
            const ret = getObject(arg0).getHours();
            return ret;
        },
        __wbg_getMinutes_1fabf71af7d9c8e2: function(arg0) {
            const ret = getObject(arg0).getMinutes();
            return ret;
        },
        __wbg_getMonth_01ce17d889ed7e5e: function(arg0) {
            const ret = getObject(arg0).getMonth();
            return ret;
        },
        __wbg_getRandomValues_980c94215a82aa89: function() { return handleError(function (arg0) {
            globalThis.crypto.getRandomValues(getObject(arg0));
        }, arguments); },
        __wbg_getRandomValues_c44a50d8cfdaebeb: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).getRandomValues(getObject(arg1));
        }, arguments); },
        __wbg_getSeconds_44cc4c4b366119da: function(arg0) {
            const ret = getObject(arg0).getSeconds();
            return ret;
        },
        __wbg_getTime_65922ba0b59d55a7: function(arg0) {
            const ret = getObject(arg0).getTime();
            return ret;
        },
        __wbg_getTimezoneOffset_6e4850ad528ac37d: function(arg0) {
            const ret = getObject(arg0).getTimezoneOffset();
            return ret;
        },
        __wbg_get_6cf5a4d4d8ad3c5a: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_989d0a1309644f2b: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.get(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_get_b1f0ab13c737f856: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_unchecked_363572bdd397d473: function(arg0, arg1) {
            const ret = getObject(arg0)[arg1 >>> 0];
            return addHeapObject(ret);
        },
        __wbg_get_with_ref_key_6412cf3094599694: function(arg0, arg1) {
            const ret = getObject(arg0)[getObject(arg1)];
            return addHeapObject(ret);
        },
        __wbg_gvkaudit_new: function(arg0) {
            const ret = GvkAudit.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_has_464f8b9416279d65: function() { return handleError(function (arg0, arg1) {
            const ret = Reflect.has(getObject(arg0), getObject(arg1));
            return ret;
        }, arguments); },
        __wbg_headers_2594464ff62969f3: function(arg0) {
            const ret = getObject(arg0).headers;
            return addHeapObject(ret);
        },
        __wbg_href_de709e84ed5de5d2: function() { return handleError(function (arg0, arg1) {
            const ret = getObject(arg1).href;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        }, arguments); },
        __wbg_info_f25c01bee103395d: function(arg0) {
            console.info(getObject(arg0));
        },
        __wbg_instanceof_ArrayBuffer_d4ff01f8247925ae: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof ArrayBuffer;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Error_fe6fa771c78ee4cf: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Error;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Event_a4e4dbe20b01838b: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Event;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Map_1ff6a2b54c899f0d: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Map;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Promise_f6320f682f582ddf: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Promise;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Response_6366a785e400039b: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Response;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Uint8Array_598adc0fef426aa8: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Uint8Array;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_instanceof_Window_a3b8566f0a9c5d1a: function(arg0) {
            let result;
            try {
                result = getObject(arg0) instanceof Window;
            } catch (_) {
                result = false;
            }
            const ret = result;
            return ret;
        },
        __wbg_isArray_5674713bb7b79043: function(arg0) {
            const ret = Array.isArray(getObject(arg0));
            return ret;
        },
        __wbg_isSafeInteger_8f51c743827d1ec5: function(arg0) {
            const ret = Number.isSafeInteger(getObject(arg0));
            return ret;
        },
        __wbg_iterator_22ddeb808cf55a6f: function() {
            const ret = Symbol.iterator;
            return addHeapObject(ret);
        },
        __wbg_length_31bdaf014f5fbde2: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_length_4e1adc0d42e23620: function(arg0) {
            const ret = getObject(arg0).length;
            return ret;
        },
        __wbg_location_382075cf6a393ad4: function(arg0) {
            const ret = getObject(arg0).location;
            return addHeapObject(ret);
        },
        __wbg_message_1cbc5bc03dcf1dee: function(arg0) {
            const ret = getObject(arg0).message;
            return addHeapObject(ret);
        },
        __wbg_msCrypto_bd5a034af96bcba6: function(arg0) {
            const ret = getObject(arg0).msCrypto;
            return addHeapObject(ret);
        },
        __wbg_new_0700aaf827082758: function(arg0) {
            const ret = new Int32Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_0_35540e542ba689d2: function() {
            const ret = new Date();
            return addHeapObject(ret);
        },
        __wbg_new_0afe64b4dc16ab74: function() { return handleError(function () {
            const ret = new Headers();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_180f1022bb6ee517: function(arg0) {
            const ret = new Date(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_1da3429bc3c4541c: function(arg0) {
            const ret = new Uint8Array(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_new_227d7c05414eb861: function() {
            const ret = new Error();
            return addHeapObject(ret);
        },
        __wbg_new_8d36e20aa758e411: function() {
            const ret = new Map();
            return addHeapObject(ret);
        },
        __wbg_new_a313bf260f9bdcc3: function() { return handleError(function (arg0, arg1) {
            const ret = new Worker(getStringFromWasm0(arg0, arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_baa0a0207935dd43: function() { return handleError(function () {
            const ret = new AbortController();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_bebc3f4757acf305: function() {
            const ret = new Object();
            return addHeapObject(ret);
        },
        __wbg_new_ffa92086ea89f79c: function() {
            const ret = new Array();
            return addHeapObject(ret);
        },
        __wbg_new_from_slice_4ee02165f9de919e: function(arg0, arg1) {
            const ret = new Uint8Array(getArrayU8FromWasm0(arg0, arg1));
            return addHeapObject(ret);
        },
        __wbg_new_typed_6f8b0d724fe26c07: function(arg0, arg1) {
            try {
                var state0 = {a: arg0, b: arg1};
                var cb0 = (arg0, arg1) => {
                    const a = state0.a;
                    state0.a = 0;
                    try {
                        return __wasm_bindgen_func_elem_10516(a, state0.b, arg0, arg1);
                    } finally {
                        state0.a = a;
                    }
                };
                const ret = new Promise(cb0);
                return addHeapObject(ret);
            } finally {
                state0.a = 0;
            }
        },
        __wbg_new_with_base_15feba63f6973577: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = new URL(getStringFromWasm0(arg0, arg1), getStringFromWasm0(arg2, arg3));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_with_length_5ffeddb9d9fbb96f: function(arg0) {
            const ret = new Uint8Array(arg0 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_new_with_options_695bfde16ea544ed: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Worker(getStringFromWasm0(arg0, arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_with_str_and_init_2f31a77deda127fd: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = new Request(getStringFromWasm0(arg0, arg1), getObject(arg2));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_with_str_sequence_and_options_01ed9e0eee2dee62: function() { return handleError(function (arg0, arg1) {
            const ret = new Blob(getObject(arg0), getObject(arg1));
            return addHeapObject(ret);
        }, arguments); },
        __wbg_new_with_year_month_day_1111ae617c8e9c90: function(arg0, arg1, arg2) {
            const ret = new Date(arg0 >>> 0, arg1, arg2);
            return addHeapObject(ret);
        },
        __wbg_next_95053e306b1c3aed: function(arg0) {
            const ret = getObject(arg0).next;
            return addHeapObject(ret);
        },
        __wbg_next_f31ecb8646d2c605: function() { return handleError(function (arg0) {
            const ret = getObject(arg0).next();
            return addHeapObject(ret);
        }, arguments); },
        __wbg_node_84ea875411254db1: function(arg0) {
            const ret = getObject(arg0).node;
            return addHeapObject(ret);
        },
        __wbg_of_1a3f47170341cefe: function(arg0) {
            const ret = Array.of(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_operationalfeeditem_new: function(arg0) {
            const ret = OperationalFeedItem.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_poolconfigentry_new: function(arg0) {
            const ret = PoolConfigEntry.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_poolestimate_new: function(arg0) {
            const ret = PoolEstimate.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_poolexecuteresult_new: function(arg0) {
            const ret = PoolExecuteResult.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_poolinfo_new: function(arg0) {
            const ret = PoolInfo.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_portfoliobalance_new: function(arg0) {
            const ret = PortfolioBalance.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_postMessage_14c07434f6b7e150: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).postMessage(getObject(arg1));
        }, arguments); },
        __wbg_privatepool_new: function(arg0) {
            const ret = PrivatePool.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_process_44c7a14e11e9f69e: function(arg0) {
            const ret = getObject(arg0).process;
            return addHeapObject(ret);
        },
        __wbg_prototypesetcall_ae9f5e7459250748: function(arg0, arg1, arg2) {
            Uint8Array.prototype.set.call(getArrayU8FromWasm0(arg0, arg1), getObject(arg2));
        },
        __wbg_push_bfdf956ba476f65b: function(arg0, arg1) {
            const ret = getObject(arg0).push(getObject(arg1));
            return ret;
        },
        __wbg_queueMicrotask_85c90f6987555d65: function(arg0) {
            const ret = getObject(arg0).queueMicrotask;
            return addHeapObject(ret);
        },
        __wbg_queueMicrotask_f6a1fa10b81d1fc0: function(arg0) {
            queueMicrotask(getObject(arg0));
        },
        __wbg_randomFillSync_6c25eac9869eb53c: function() { return handleError(function (arg0, arg1) {
            getObject(arg0).randomFillSync(takeObject(arg1));
        }, arguments); },
        __wbg_random_7bce4e9e78e2e0d0: function() {
            const ret = Math.random();
            return ret;
        },
        __wbg_recipientlookup_new: function(arg0) {
            const ret = RecipientLookup.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_replace_853433aa9358820c: function(arg0, arg1, arg2, arg3, arg4) {
            const ret = getObject(arg0).replace(getStringFromWasm0(arg1, arg2), getStringFromWasm0(arg3, arg4));
            return addHeapObject(ret);
        },
        __wbg_require_b4edbdcf3e2a1ef0: function() { return handleError(function () {
            const ret = module.require;
            return addHeapObject(ret);
        }, arguments); },
        __wbg_resolve_35ec7e0c6af4c82c: function(arg0) {
            const ret = Promise.resolve(getObject(arg0));
            return addHeapObject(ret);
        },
        __wbg_setTimeout_56bcdccbad22fd44: function() { return handleError(function (arg0, arg1) {
            const ret = setTimeout(getObject(arg0), arg1);
            return addHeapObject(ret);
        }, arguments); },
        __wbg_setTimeout_b4a9096784635514: function(arg0, arg1) {
            const ret = setTimeout(getObject(arg0), arg1);
            return addHeapObject(ret);
        },
        __wbg_set_13d25b81ab403f5e: function(arg0, arg1, arg2) {
            getObject(arg0)[arg1 >>> 0] = takeObject(arg2);
        },
        __wbg_set_6be42768c690e380: function(arg0, arg1, arg2) {
            getObject(arg0)[takeObject(arg1)] = takeObject(arg2);
        },
        __wbg_set_a377297433dfea63: function() { return handleError(function (arg0, arg1, arg2) {
            const ret = Reflect.set(getObject(arg0), getObject(arg1), getObject(arg2));
            return ret;
        }, arguments); },
        __wbg_set_bf6dde4923b9b059: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).set(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_set_body_f39cee72c74a5b02: function(arg0, arg1) {
            getObject(arg0).body = getObject(arg1);
        },
        __wbg_set_cache_6e8c35a5ed76edb1: function(arg0, arg1) {
            getObject(arg0).cache = __wbindgen_enum_RequestCache[arg1];
        },
        __wbg_set_credentials_bf1d3e014213a571: function(arg0, arg1) {
            getObject(arg0).credentials = __wbindgen_enum_RequestCredentials[arg1];
        },
        __wbg_set_headers_31d373f68f28bf76: function(arg0, arg1) {
            getObject(arg0).headers = getObject(arg1);
        },
        __wbg_set_method_82e6c3c083da0734: function(arg0, arg1, arg2) {
            getObject(arg0).method = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_mode_f7e56ed768d0ade0: function(arg0, arg1) {
            getObject(arg0).mode = __wbindgen_enum_RequestMode[arg1];
        },
        __wbg_set_onmessage_d7e69fe35723df1e: function(arg0, arg1) {
            getObject(arg0).onmessage = getObject(arg1);
        },
        __wbg_set_referrer_13cf56bbccbb2ceb: function(arg0, arg1, arg2) {
            getObject(arg0).referrer = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_referrer_policy_dac1caa6e937479a: function(arg0, arg1) {
            getObject(arg0).referrerPolicy = __wbindgen_enum_ReferrerPolicy[arg1];
        },
        __wbg_set_signal_f4b32f40f19786f4: function(arg0, arg1) {
            getObject(arg0).signal = getObject(arg1);
        },
        __wbg_set_type_69954a3c7c11a724: function(arg0, arg1, arg2) {
            getObject(arg0).type = getStringFromWasm0(arg1, arg2);
        },
        __wbg_set_type_f73a726d9729f489: function(arg0, arg1) {
            getObject(arg0).type = __wbindgen_enum_WorkerType[arg1];
        },
        __wbg_signal_45367c6c2255877a: function(arg0) {
            const ret = getObject(arg0).signal;
            return addHeapObject(ret);
        },
        __wbg_stack_3b0d974bbf31e44f: function(arg0, arg1) {
            const ret = getObject(arg1).stack;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_static_accessor_GLOBAL_8eb4cd83130a11a0: function() {
            const ret = typeof global === 'undefined' ? null : global;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_GLOBAL_THIS_1e7044f654e934db: function() {
            const ret = typeof globalThis === 'undefined' ? null : globalThis;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_SELF_d8b50611246a6d92: function() {
            const ret = typeof self === 'undefined' ? null : self;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_static_accessor_WINDOW_fd0bc376bf0f8b42: function() {
            const ret = typeof window === 'undefined' ? null : window;
            return isLikeNone(ret) ? 0 : addHeapObject(ret);
        },
        __wbg_status_88ccc72fe7bea621: function(arg0) {
            const ret = getObject(arg0).status;
            return ret;
        },
        __wbg_storage_new: function(arg0) {
            const ret = Storage.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_storagehandle_new: function(arg0) {
            const ret = StorageHandle.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_subarray_1daff70dde20c145: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).subarray(arg1 >>> 0, arg2 >>> 0);
            return addHeapObject(ret);
        },
        __wbg_then_7a850dae4493f353: function(arg0, arg1, arg2) {
            const ret = getObject(arg0).then(getObject(arg1), getObject(arg2));
            return addHeapObject(ret);
        },
        __wbg_then_b830475380919203: function(arg0, arg1) {
            const ret = getObject(arg0).then(getObject(arg1));
            return addHeapObject(ret);
        },
        __wbg_toISOString_b10dc1c193a89c15: function(arg0) {
            const ret = getObject(arg0).toISOString();
            return addHeapObject(ret);
        },
        __wbg_toString_794a30e85c994f2a: function(arg0) {
            const ret = getObject(arg0).toString();
            return addHeapObject(ret);
        },
        __wbg_url_f1948b0d7f881e02: function(arg0, arg1) {
            const ret = getObject(arg1).url;
            const ptr1 = passStringToWasm0(ret, wasm.__wbindgen_export, wasm.__wbindgen_export2);
            const len1 = WASM_VECTOR_LEN;
            getDataViewMemory0().setInt32(arg0 + 4 * 1, len1, true);
            getDataViewMemory0().setInt32(arg0 + 4 * 0, ptr1, true);
        },
        __wbg_usernotesummary_new: function(arg0) {
            const ret = UserNoteSummary.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_userpublickeys_new: function(arg0) {
            const ret = UserPublicKeys.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_value_c227f843d21da141: function(arg0) {
            const ret = getObject(arg0).value;
            return addHeapObject(ret);
        },
        __wbg_verifierentry_new: function(arg0) {
            const ret = VerifierEntry.__wrap(arg0);
            return addHeapObject(ret);
        },
        __wbg_versions_276b2795b1c6a219: function(arg0) {
            const ret = getObject(arg0).versions;
            return addHeapObject(ret);
        },
        __wbg_wait_31614a78c2a6b7c5: function() { return handleError(function (arg0, arg1, arg2, arg3) {
            const ret = Atomics.wait(getObject(arg0), arg1 >>> 0, arg2, arg3);
            return addHeapObject(ret);
        }, arguments); },
        __wbg_warn_d3544c7814fab534: function(arg0) {
            console.warn(getObject(arg0));
        },
        __wbindgen_generic_0000000000000001: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [Externref], shim_idx: 1689, ret: Result(Unit), inner_ret: Some(Result(Unit)) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_10514);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000002: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [NamedExternref("MessageEvent")], shim_idx: 14, ret: Unit, inner_ret: Some(Unit) }, mutable: false }) -> Externref`.
            const ret = makeClosure(arg0, arg1, __wasm_bindgen_func_elem_1845);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000003: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 1122, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_6720);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000004: function(arg0, arg1) {
            // Cast intrinsic for `Closure(Closure { owned: true, function: Function { arguments: [], shim_idx: 1681, ret: Unit, inner_ret: Some(Unit) }, mutable: true }) -> Externref`.
            const ret = makeMutClosure(arg0, arg1, __wasm_bindgen_func_elem_10433);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000005: function(arg0) {
            // Cast intrinsic for `F64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000006: function(arg0) {
            // Cast intrinsic for `I64 -> Externref`.
            const ret = arg0;
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000007: function(arg0, arg1) {
            // Cast intrinsic for `Ref(Slice(U8)) -> NamedExternref("Uint8Array")`.
            const ret = getArrayU8FromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000008: function(arg0, arg1) {
            // Cast intrinsic for `Ref(String) -> Externref`.
            const ret = getStringFromWasm0(arg0, arg1);
            return addHeapObject(ret);
        },
        __wbindgen_generic_0000000000000009: function(arg0, arg1) {
            // Cast intrinsic for `U128 -> Externref`.
            const ret = (BigInt.asUintN(64, arg0) | (BigInt.asUintN(64, arg1) << BigInt(64)));
            return addHeapObject(ret);
        },
        __wbindgen_generic_000000000000000a: function(arg0) {
            // Cast intrinsic for `U64 -> Externref`.
            const ret = BigInt.asUintN(64, arg0);
            return addHeapObject(ret);
        },
        __wbindgen_generic_000000000000000b: function(arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1);
            wasm.__wbindgen_export4(arg0, arg1 * 4, 4);
            // Cast intrinsic for `Vector(RustStruct { name: "OperationalFeedItem", unique_crate_identifier: "stellar-private-payments-web-61c991257f0875e6" }) -> Externref`.
            const ret = v0;
            return addHeapObject(ret);
        },
        __wbindgen_generic_000000000000000c: function(arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1);
            wasm.__wbindgen_export4(arg0, arg1 * 4, 4);
            // Cast intrinsic for `Vector(RustStruct { name: "PortfolioBalance", unique_crate_identifier: "stellar-private-payments-web-61c991257f0875e6" }) -> Externref`.
            const ret = v0;
            return addHeapObject(ret);
        },
        __wbindgen_generic_000000000000000d: function(arg0, arg1) {
            var v0 = getArrayJsValueFromWasm0(arg0, arg1);
            wasm.__wbindgen_export4(arg0, arg1 * 4, 4);
            // Cast intrinsic for `Vector(RustStruct { name: "UserNoteSummary", unique_crate_identifier: "stellar-private-payments-web-61c991257f0875e6" }) -> Externref`.
            const ret = v0;
            return addHeapObject(ret);
        },
        __wbindgen_object_clone_ref: function(arg0) {
            const ret = getObject(arg0);
            return addHeapObject(ret);
        },
        __wbindgen_object_drop_ref: function(arg0) {
            takeObject(arg0);
        },
    };
    return {
        __proto__: null,
        "./stellar_private_payments_web_bg.js": import0,
    };
}

function __wasm_bindgen_func_elem_6720(arg0, arg1) {
    wasm.__wasm_bindgen_func_elem_6720(arg0, arg1);
}

function __wasm_bindgen_func_elem_10433(arg0, arg1) {
    wasm.__wasm_bindgen_func_elem_10433(arg0, arg1);
}

function __wasm_bindgen_func_elem_1845(arg0, arg1, arg2) {
    wasm.__wasm_bindgen_func_elem_1845(arg0, arg1, addHeapObject(arg2));
}

function __wasm_bindgen_func_elem_10516(arg0, arg1, arg2, arg3) {
    wasm.__wasm_bindgen_func_elem_10516(arg0, arg1, addHeapObject(arg2), addHeapObject(arg3));
}

function __wasm_bindgen_func_elem_10514(arg0, arg1, arg2) {
    try {
        const retptr = wasm.__wbindgen_add_to_stack_pointer(-16);
        wasm.__wasm_bindgen_func_elem_10514(retptr, arg0, arg1, addHeapObject(arg2));
        var r0 = getDataViewMemory0().getInt32(retptr + 4 * 0, true);
        var r1 = getDataViewMemory0().getInt32(retptr + 4 * 1, true);
        if (r1) {
            throw takeObject(r0);
        }
    } finally {
        wasm.__wbindgen_add_to_stack_pointer(16);
    }
}


const __wbindgen_enum_ReferrerPolicy = ["", "no-referrer", "no-referrer-when-downgrade", "origin", "origin-when-cross-origin", "unsafe-url", "same-origin", "strict-origin", "strict-origin-when-cross-origin"];


const __wbindgen_enum_RequestCache = ["default", "no-store", "reload", "no-cache", "force-cache", "only-if-cached"];


const __wbindgen_enum_RequestCredentials = ["omit", "same-origin", "include"];


const __wbindgen_enum_RequestMode = ["same-origin", "no-cors", "cors", "navigate"];


const __wbindgen_enum_WorkerType = ["classic", "module"];
const AccountFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_account_free(ptr, 1));
const AspMembershipFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_aspmembership_free(ptr, 1));
const AspNonMembershipFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_aspnonmembership_free(ptr, 1));
const AssetDescriptorFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_assetdescriptor_free(ptr, 1));
const BabyJubJubPointFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_babyjubjubpoint_free(ptr, 1));
const ClientFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_client_free(ptr, 1));
const ContractConfigFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_contractconfig_free(ptr, 1));
const ContractsStateDataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_contractsstatedata_free(ptr, 1));
const DisclosureCircuitMetadataFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosurecircuitmetadata_free(ptr, 1));
const DisclosureContextFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosurecontext_free(ptr, 1));
const DisclosurePublicInputsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosurepublicinputs_free(ptr, 1));
const DisclosureReceiptFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosurereceipt_free(ptr, 1));
const DisclosureRequestFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosurerequest_free(ptr, 1));
const DisclosureVerificationReportFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_disclosureverificationreport_free(ptr, 1));
const GlobalViewKeyCiphertextFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_globalviewkeyciphertext_free(ptr, 1));
const GvkAuditFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_gvkaudit_free(ptr, 1));
const OperationalFeedItemFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_operationalfeeditem_free(ptr, 1));
const PoolConfigEntryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_poolconfigentry_free(ptr, 1));
const PoolEstimateFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_poolestimate_free(ptr, 1));
const PoolExecuteResultFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_poolexecuteresult_free(ptr, 1));
const PoolInfoFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_poolinfo_free(ptr, 1));
const PoolOptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_pooloptions_free(ptr, 1));
const PortfolioBalanceFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_portfoliobalance_free(ptr, 1));
const PrivatePoolFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_privatepool_free(ptr, 1));
const ProverBridgeFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_proverbridge_free(ptr, 1));
const ProverHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_proverhandle_free(ptr, 1));
const PublicKeyEntryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_publickeyentry_free(ptr, 1));
const RecipientLookupFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_recipientlookup_free(ptr, 1));
const SignerHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_signerhandle_free(ptr, 1));
const SinkRegistrationFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_sinkregistration_free(ptr, 1));
const StorageFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_storage_free(ptr, 1));
const StorageHandleFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_storagehandle_free(ptr, 1));
const UserNoteSummaryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_usernotesummary_free(ptr, 1));
const UserPublicKeysFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_userpublickeys_free(ptr, 1));
const VerifierEntryFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_verifierentry_free(ptr, 1));
const VerifyDisclosureOptionsFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_verifydisclosureoptions_free(ptr, 1));
const WalletSignerFinalization = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(ptr => wasm.__wbg_walletsigner_free(ptr, 1));

function addHeapObject(obj) {
    if (heap_next === heap.length) heap.push(heap.length + 1);
    const idx = heap_next;
    heap_next = heap[idx];

    heap[idx] = obj;
    return idx;
}

function _assertClass(instance, klass) {
    if (!(instance instanceof klass)) {
        throw new Error(`expected instance of ${klass.name}`);
    }
}

const CLOSURE_DTORS = (typeof FinalizationRegistry === 'undefined')
    ? { register: () => {}, unregister: () => {} }
    : new FinalizationRegistry(state => wasm.__wbindgen_export5(state.a, state.b));

function debugString(val) {
    // primitive types
    const type = typeof val;
    if (type == 'number' || type == 'boolean' || val == null) {
        return  `${val}`;
    }
    if (type == 'string') {
        return `"${val}"`;
    }
    if (type == 'symbol') {
        const description = val.description;
        if (description == null) {
            return 'Symbol';
        } else {
            return `Symbol(${description})`;
        }
    }
    if (type == 'function') {
        const name = val.name;
        if (typeof name == 'string' && name.length > 0) {
            return `Function(${name})`;
        } else {
            return 'Function';
        }
    }
    // objects
    if (Array.isArray(val)) {
        const length = val.length;
        let debug = '[';
        if (length > 0) {
            debug += debugString(val[0]);
        }
        for(let i = 1; i < length; i++) {
            debug += ', ' + debugString(val[i]);
        }
        debug += ']';
        return debug;
    }
    // Test for built-in
    const builtInMatches = /\[object ([^\]]+)\]/.exec(toString.call(val));
    let className;
    if (builtInMatches && builtInMatches.length > 1) {
        className = builtInMatches[1];
    } else {
        // Failed to match the standard '[object ClassName]'
        return toString.call(val);
    }
    if (className == 'Object') {
        // we're a user defined class or Object
        // JSON.stringify avoids problems with cycles, and is generally much
        // easier than looping through ownProperties of `val`.
        try {
            return 'Object(' + JSON.stringify(val) + ')';
        } catch (_) {
            return 'Object';
        }
    }
    // errors
    if (val instanceof Error) {
        return `${val.name}: ${val.message}\n${val.stack}`;
    }
    // TODO we could test for more things here, like `Set`s and `Map`s.
    return className;
}

function dropObject(idx) {
    if (idx < 1028) return;
    heap[idx] = heap_next;
    heap_next = idx;
}

function getArrayJsValueFromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    const mem = getDataViewMemory0();
    const result = [];
    for (let i = ptr; i < ptr + 4 * len; i += 4) {
        result.push(takeObject(mem.getUint32(i, true)));
    }
    return result;
}

function getArrayU8FromWasm0(ptr, len) {
    ptr = ptr >>> 0;
    return getUint8ArrayMemory0().subarray(ptr / 1, ptr / 1 + len);
}

let cachedDataViewMemory0 = null;
function getDataViewMemory0() {
    if (cachedDataViewMemory0 === null || cachedDataViewMemory0.buffer.detached === true || (cachedDataViewMemory0.buffer.detached === undefined && cachedDataViewMemory0.buffer !== wasm.memory.buffer)) {
        cachedDataViewMemory0 = new DataView(wasm.memory.buffer);
    }
    return cachedDataViewMemory0;
}

function getStringFromWasm0(ptr, len) {
    return decodeText(ptr >>> 0, len);
}

let cachedUint8ArrayMemory0 = null;
function getUint8ArrayMemory0() {
    if (cachedUint8ArrayMemory0 === null || cachedUint8ArrayMemory0.byteLength === 0) {
        cachedUint8ArrayMemory0 = new Uint8Array(wasm.memory.buffer);
    }
    return cachedUint8ArrayMemory0;
}

function getObject(idx) { return heap[idx]; }

function handleError(f, args) {
    try {
        return f.apply(this, args);
    } catch (e) {
        wasm.__wbindgen_export3(addHeapObject(e));
    }
}

let heap = new Array(1024).fill(undefined);
heap.push(undefined, null, true, false);

let heap_next = heap.length;

function isLikeNone(x) {
    return x === undefined || x === null;
}

function makeClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        try {
            return f(state.a, state.b, ...args);
        } finally {
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_export5(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function makeMutClosure(arg0, arg1, f) {
    const state = { a: arg0, b: arg1, cnt: 1 };
    const real = (...args) => {

        // First up with a closure we increment the internal reference
        // count. This ensures that the Rust closure environment won't
        // be deallocated while we're invoking it.
        state.cnt++;
        const a = state.a;
        state.a = 0;
        try {
            return f(a, state.b, ...args);
        } finally {
            state.a = a;
            real._wbg_cb_unref();
        }
    };
    real._wbg_cb_unref = () => {
        if (--state.cnt === 0) {
            wasm.__wbindgen_export5(state.a, state.b);
            state.a = 0;
            CLOSURE_DTORS.unregister(state);
        }
    };
    CLOSURE_DTORS.register(real, state, state);
    return real;
}

function passArrayJsValueToWasm0(array, malloc) {
    const ptr = malloc(array.length * 4, 4) >>> 0;
    const mem = getDataViewMemory0();
    for (let i = 0; i < array.length; i++) {
        mem.setUint32(ptr + 4 * i, addHeapObject(array[i]), true);
    }
    WASM_VECTOR_LEN = array.length;
    return ptr;
}

function passStringToWasm0(arg, malloc, realloc) {
    if (realloc === undefined) {
        const buf = cachedTextEncoder.encode(arg);
        const ptr = malloc(buf.length, 1) >>> 0;
        getUint8ArrayMemory0().subarray(ptr, ptr + buf.length).set(buf);
        WASM_VECTOR_LEN = buf.length;
        return ptr;
    }

    let len = arg.length;
    let ptr = malloc(len, 1) >>> 0;

    const mem = getUint8ArrayMemory0();

    let offset = 0;

    for (; offset < len; offset++) {
        const code = arg.charCodeAt(offset);
        if (code > 0x7F) break;
        mem[ptr + offset] = code;
    }
    if (offset !== len) {
        if (offset !== 0) {
            arg = arg.slice(offset);
        }
        ptr = realloc(ptr, len, len = offset + arg.length * 3, 1) >>> 0;
        const view = getUint8ArrayMemory0().subarray(ptr + offset, ptr + len);
        const ret = cachedTextEncoder.encodeInto(arg, view);

        offset += ret.written;
        ptr = realloc(ptr, len, offset, 1) >>> 0;
    }

    WASM_VECTOR_LEN = offset;
    return ptr;
}

function takeObject(idx) {
    const ret = getObject(idx);
    dropObject(idx);
    return ret;
}

let cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
cachedTextDecoder.decode();
const MAX_SAFARI_DECODE_BYTES = 2146435072;
let numBytesDecoded = 0;
function decodeText(ptr, len) {
    numBytesDecoded += len;
    if (numBytesDecoded >= MAX_SAFARI_DECODE_BYTES) {
        cachedTextDecoder = new TextDecoder('utf-8', { ignoreBOM: true, fatal: true });
        cachedTextDecoder.decode();
        numBytesDecoded = len;
    }
    return cachedTextDecoder.decode(getUint8ArrayMemory0().subarray(ptr, ptr + len));
}

const cachedTextEncoder = new TextEncoder();

if (!('encodeInto' in cachedTextEncoder)) {
    cachedTextEncoder.encodeInto = function (arg, view) {
        const buf = cachedTextEncoder.encode(arg);
        view.set(buf);
        return {
            read: arg.length,
            written: buf.length
        };
    };
}

let WASM_VECTOR_LEN = 0;

let wasmModule, wasmInstance, wasm;
function __wbg_finalize_init(instance, module) {
    wasmInstance = instance;
    wasm = instance.exports;
    wasmModule = module;
    cachedDataViewMemory0 = null;
    cachedUint8ArrayMemory0 = null;
    return wasm;
}

async function __wbg_load(module, imports) {
    if (typeof Response === 'function' && module instanceof Response) {
        if (!module.ok) {
            throw new Error(`failed to fetch Wasm: ${module.status} ${module.statusText} fetching '${module.url}'`);
        }

        if (typeof WebAssembly.instantiateStreaming === 'function') {
            try {
                return await WebAssembly.instantiateStreaming(module, imports);
            } catch (e) {
                const validResponse = expectedResponseType(module.type);

                if (validResponse && module.headers.get('Content-Type') !== 'application/wasm') {
                    console.warn("`WebAssembly.instantiateStreaming` failed because your server does not serve Wasm with `application/wasm` MIME type. Falling back to `WebAssembly.instantiate` which is slower. Original error:\n", e);

                } else { throw e; }
            }
        }

        const bytes = await module.arrayBuffer();
        return await WebAssembly.instantiate(bytes, imports);
    } else {
        const instance = await WebAssembly.instantiate(module, imports);

        if (instance instanceof WebAssembly.Instance) {
            return { instance, module };
        } else {
            return instance;
        }
    }

    function expectedResponseType(type) {
        switch (type) {
            case 'basic': case 'cors': case 'default': return true;
        }
        return false;
    }
}

function initSync(module) {
    if (wasm !== undefined) return wasm;


    if (module !== undefined) {
        if (Object.getPrototypeOf(module) === Object.prototype) {
            ({module} = module)
        } else {
            console.warn('using deprecated parameters for `initSync()`; pass a single object instead')
        }
    }

    const imports = __wbg_get_imports();
    if (!(module instanceof WebAssembly.Module)) {
        module = new WebAssembly.Module(module);
    }
    const instance = new WebAssembly.Instance(module, imports);
    return __wbg_finalize_init(instance, module);
}

async function __wbg_init(module_or_path) {
    if (wasm !== undefined) return wasm;


    if (module_or_path !== undefined) {
        if (Object.getPrototypeOf(module_or_path) === Object.prototype) {
            ({module_or_path} = module_or_path)
        } else {
            console.warn('using deprecated parameters for the initialization function; pass a single object instead')
        }
    }

    if (module_or_path === undefined) {
        module_or_path = new URL('stellar_private_payments_web_bg.wasm', import.meta.url);
    }
    const imports = __wbg_get_imports();

    if (typeof module_or_path === 'string' || (typeof Request === 'function' && module_or_path instanceof Request) || (typeof URL === 'function' && module_or_path instanceof URL)) {
        module_or_path = fetch(module_or_path);
    }

    const { instance, module } = await __wbg_load(await module_or_path, imports);

    return __wbg_finalize_init(instance, module);
}

export { initSync, __wbg_init as default };
