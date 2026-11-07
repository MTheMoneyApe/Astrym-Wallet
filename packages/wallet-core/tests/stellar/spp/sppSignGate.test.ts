/**
 * Attack cases for the SPP sign gate. No network, no secrets.
 */

import { beforeEach, describe, expect, it } from 'vitest';
import {
  Account,
  Address,
  Asset,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  hash,
  nativeToScVal,
  xdr,
} from '@stellar/stellar-sdk';
import { tokenContractIdForEnabledPool } from '../../../src/stellar/spp/sppContractConfig.js';
import { getNethermindPublicTestnetContractConfig } from '../../../src/stellar/spp/nethermind/nethermindPublicTestnet.js';
import {
  assertSppAssembledFees,
  assertStellarTestnetPassphrase,
  authorizeSppSignature,
  mintSppSignApproval,
  resetSppSignApprovalsForTests,
  signDigestWithSppGate,
  sppKeyDerivationMessage,
  type SppSignIntent,
} from '../../../src/stellar/spp/sppSignGate.js';

const ACCOUNT = 'GDRXE2BQUC3AZNPVFSCEZ76NJ3WWL25FYFK6RGZGIEKWE4SOOHSUJUJ6';
const OTHER = 'GBRPYHIL2CI3FNQ4BXLFMNDLFJUNPU2HY3ZMFSHONUCEOASW7QC7OX2H';
const POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';
const OTHER_POOL = 'CBTA5THUFNLDMFSH54YSHZJPAACLIBTT66ANWX2EPMP5F7ORPI24MXBQ';
const REGISTRY = 'CARXHKOPSGMUMFRDI72KNCRENVOTCJIGXPCPYOW42APDY2NEYF7CLKIL';
const NOTE_KEY = '11'.repeat(32);
const ENC_KEY = '22'.repeat(32);
const XLM_POOL = 'CAMWBUWHYXEGBM3Q7M5DBGW7LLJL3I4QGANQEZFEWLRNTOJMTT2WG24U';

function intent(overrides: Partial<SppSignIntent> = {}): SppSignIntent {
  return {
    operation: 'transfer',
    amountStroops: '25',
    recipient: OTHER,
    networkPassphrase: Networks.TESTNET,
    poolContractId: POOL,
    registryContractId: null,
    tokenContractId: null,
    registerNoteKeyHex: null,
    registerEncryptionKeyHex: null,
    registerNoteKeyProofHex: null,
    maxFeeStroops: '8000000',
    minResourceFeeStroops: null,
    account: ACCOUNT,
    exactMessage: null,
    ...overrides,
  };
}

function transactXdr(args: {
  fee?: string;
  amount?: bigint;
  recipient?: string;
  contract?: string;
  functionName?: string;
  source?: string;
} = {}): string {
  const source = args.source ?? ACCOUNT;
  const recipient = args.recipient ?? OTHER;
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(args.amount ?? 25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(recipient).toScVal(),
    }),
  ]);
  return new TransactionBuilder(new Account(source, '10'), {
    fee: args.fee ?? '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: args.contract ?? POOL,
      function: args.functionName ?? 'transact',
      args: [
        xdr.ScVal.scvBytes(Buffer.from([1])),
        ext,
        Address.fromString(source).toScVal(),
      ],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function paymentXdr(): string {
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.payment({
      destination: OTHER,
      asset: Asset.native(),
      amount: '1',
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function authXdr(args: {
  network?: string;
  contract?: string;
  functionName?: string;
  amount?: bigint;
  recipient?: string;
} = {}): string {
  const network = args.network ?? Networks.TESTNET;
  const recipient = args.recipient ?? OTHER;
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(args.amount ?? 25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(recipient).toScVal(),
    }),
  ]);
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(args.contract ?? POOL).toScAddress(),
        functionName: args.functionName ?? 'transact',
        args: [
          xdr.ScVal.scvBytes(Buffer.from([1])),
          ext,
          Address.fromString(ACCOUNT).toScVal(),
        ],
      }),
    ),
    subInvocations: [],
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(network)),
      nonce: xdr.Int64(3n),
      signatureExpirationLedger: 50,
      invocation,
    }),
  ).toXDR('base64');
}

function registerXdr(noteKeyHex: string, encryptionKeyHex: string, proofHex?: string): string {
  const entries = [
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encryption_key'),
      val: xdr.ScVal.scvBytes(Buffer.from(encryptionKeyHex, 'hex')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('note_key'),
      val: xdr.ScVal.scvBytes(Buffer.from(noteKeyHex, 'hex')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('owner'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ];
  if (proofHex) {
    entries.push(new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('note_key_proof'),
      val: xdr.ScVal.scvBytes(Buffer.from(proofHex, 'hex')),
    }));
  }
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: REGISTRY,
      function: 'register',
      args: [xdr.ScVal.scvMap(entries)],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function registerAccountArgs(noteKeyHex: string, encryptionKeyHex: string): xdr.ScVal[] {
  return [xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encryption_key'),
      val: xdr.ScVal.scvBytes(Buffer.from(encryptionKeyHex, 'hex')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('note_key'),
      val: xdr.ScVal.scvBytes(Buffer.from(noteKeyHex, 'hex')),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('owner'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ])];
}

function registerInvocation(noteKeyHex: string, encryptionKeyHex: string): xdr.SorobanAuthorizedInvocation {
  return new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(REGISTRY).toScAddress(),
        functionName: 'register',
        args: registerAccountArgs(noteKeyHex, encryptionKeyHex),
      }),
    ),
    subInvocations: [],
  });
}

function registerAuthXdr(noteKeyHex: string, encryptionKeyHex: string): string {
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET)),
      nonce: xdr.Int64(4n),
      signatureExpirationLedger: 150,
      invocation: registerInvocation(noteKeyHex, encryptionKeyHex),
    }),
  ).toXDR('base64');
}

function registerTxWithTwoAuth(noteKeyHex: string, encryptionKeyHex: string): string {
  const invocation = registerInvocation(noteKeyHex, encryptionKeyHex);
  const entry = () => new xdr.SorobanAuthorizationEntry({
    credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
    rootInvocation: invocation,
  });
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: REGISTRY,
      function: 'register',
      args: registerAccountArgs(noteKeyHex, encryptionKeyHex),
      auth: [entry(), entry()],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function depositTxXdr(auth: 'none' | 'empty-sub' | 'token', tokenContract: string): string {
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ]);
  const sender = Address.fromString(ACCOUNT).toScVal();
  const subs = auth === 'none'
    ? []
    : [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(auth === 'token' ? tokenContract : OTHER_POOL).toScAddress(),
            functionName: 'transfer',
            args: [sender, Address.fromString(POOL).toScVal(), nativeToScVal(25n, { type: 'i128' })],
          }),
        ),
        subInvocations: [],
      }),
    ];
  if (auth === 'empty-sub') subs.length = 0;
  const root = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(POOL).toScAddress(),
        functionName: 'transact',
        args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      }),
    ),
    subInvocations: subs,
  });
  const authEntries = auth === 'none'
    ? []
    : [
      new xdr.SorobanAuthorizationEntry({
        credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
        rootInvocation: root,
      }),
    ];
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: POOL,
      function: 'transact',
      args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      auth: authEntries,
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function sdkStyleAuthSignature(publicFill: number, signatureFill: number): xdr.ScVal {
  // Dummy bytes. Not a signature of any preimage.
  // sdk-v0.2.1 signer.rs address_credentials_signature returns
  // ScVal::Vec([ScVal::Map { public_key, signature }]), not a bare map.
  return xdr.ScVal.scvVec([
    xdr.ScVal.scvMap([
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('public_key'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(32, publicFill)),
      }),
      new xdr.ScMapEntry({
        key: xdr.ScVal.scvSymbol('signature'),
        val: xdr.ScVal.scvBytes(Buffer.alloc(64, signatureFill)),
      }),
    ]),
  ]);
}

function depositPair(
  tokenContract: string,
  proofByte: number,
  encryptedByte: number,
  options: {
    nonce?: bigint;
    expiration?: number;
    authNonce?: bigint;
    authExpiration?: number;
    authVariant?: 'legacy' | 'withAddress';
    txCredentials?: 'address' | 'source' | 'address-v2';
    txAddress?: string;
    publicFill?: number;
    signatureFill?: number;
  } = {},
): { auth: string; tx: string } {
  const nonce = options.nonce ?? BigInt(proofByte + 10);
  const expiration = options.expiration ?? 150;
  const authNonce = options.authNonce ?? nonce;
  const authExpiration = options.authExpiration ?? expiration;
  const txAddress = options.txAddress ?? ACCOUNT;
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encrypted_output0'),
      val: xdr.ScVal.scvBytes(Buffer.from([encryptedByte])),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('encrypted_output1'),
      val: xdr.ScVal.scvBytes(Buffer.from([2])),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ]);
  const sender = Address.fromString(ACCOUNT).toScVal();
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(POOL).toScAddress(),
        functionName: 'transact',
        args: [xdr.ScVal.scvBytes(Buffer.from([proofByte])), ext, sender],
      }),
    ),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(tokenContract).toScAddress(),
            functionName: 'transfer',
            args: [sender, Address.fromString(POOL).toScVal(), nativeToScVal(25n, { type: 'i128' })],
          }),
        ),
        subInvocations: [],
      }),
    ],
  });
  const authPreimage = options.authVariant === 'withAddress'
    ? xdr.HashIdPreimage.envelopeTypeSorobanAuthorizationWithAddress(
      new xdr.HashIdPreimageSorobanAuthorizationWithAddress({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        nonce: xdr.Int64(authNonce),
        signatureExpirationLedger: authExpiration,
        address: Address.fromString(ACCOUNT).toScAddress(),
        invocation,
      }),
    )
    : xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
      new xdr.HashIdPreimageSorobanAuthorization({
        networkId: hash(Buffer.from(Networks.TESTNET)),
        nonce: xdr.Int64(authNonce),
        signatureExpirationLedger: authExpiration,
        invocation,
      }),
    );
  const auth = authPreimage.toXDR('base64');
  const addressCredentials = new xdr.SorobanAddressCredentials({
    address: Address.fromString(txAddress).toScAddress(),
    nonce: xdr.Int64(nonce),
    signatureExpirationLedger: expiration,
    signature: sdkStyleAuthSignature(options.publicFill ?? 7, options.signatureFill ?? 9),
  });
  const credentials = options.txCredentials === 'source'
    ? xdr.SorobanCredentials.sorobanCredentialsSourceAccount()
    : options.txCredentials === 'address-v2'
      ? xdr.SorobanCredentials.sorobanCredentialsAddressV2(addressCredentials)
      : xdr.SorobanCredentials.sorobanCredentialsAddress(addressCredentials);
  const tx = new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: POOL,
      function: 'transact',
      args: [xdr.ScVal.scvBytes(Buffer.from([proofByte])), ext, sender],
      auth: [
        new xdr.SorobanAuthorizationEntry({
          credentials,
          rootInvocation: invocation,
        }),
      ],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
  return { auth, tx };
}

function depositTxWithSplitProof(tokenContract: string): string {
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ]);
  const sender = Address.fromString(ACCOUNT).toScVal();
  const subs = [
    new xdr.SorobanAuthorizedInvocation({
      function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
        new xdr.InvokeContractArgs({
          contractAddress: Address.fromString(tokenContract).toScAddress(),
          functionName: 'transfer',
          args: [sender, Address.fromString(POOL).toScVal(), nativeToScVal(25n, { type: 'i128' })],
        }),
      ),
      subInvocations: [],
    }),
  ];
  return new TransactionBuilder(new Account(ACCOUNT, '10'), {
    fee: '100',
    networkPassphrase: Networks.TESTNET,
  })
    .addOperation(Operation.invokeContractFunction({
      contract: POOL,
      function: 'transact',
      args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      auth: [
        new xdr.SorobanAuthorizationEntry({
          credentials: xdr.SorobanCredentials.sorobanCredentialsSourceAccount(),
          rootInvocation: new xdr.SorobanAuthorizedInvocation({
            function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
              new xdr.InvokeContractArgs({
                contractAddress: Address.fromString(POOL).toScAddress(),
                functionName: 'transact',
                args: [xdr.ScVal.scvBytes(Buffer.from([2])), ext, sender],
              }),
            ),
            subInvocations: subs,
          }),
        }),
      ],
    }))
    .setTimeout(30)
    .build()
    .toXDR();
}

function depositAuthXdr(tokenContract: string): string {
  const ext = xdr.ScVal.scvMap([
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('ext_amount'),
      val: nativeToScVal(25n, { type: 'i256' }),
    }),
    new xdr.ScMapEntry({
      key: xdr.ScVal.scvSymbol('recipient'),
      val: Address.fromString(ACCOUNT).toScVal(),
    }),
  ]);
  const sender = Address.fromString(ACCOUNT).toScVal();
  const invocation = new xdr.SorobanAuthorizedInvocation({
    function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
      new xdr.InvokeContractArgs({
        contractAddress: Address.fromString(POOL).toScAddress(),
        functionName: 'transact',
        args: [xdr.ScVal.scvBytes(Buffer.from([1])), ext, sender],
      }),
    ),
    subInvocations: [
      new xdr.SorobanAuthorizedInvocation({
        function: xdr.SorobanAuthorizedFunction.sorobanAuthorizedFunctionTypeContractFn(
          new xdr.InvokeContractArgs({
            contractAddress: Address.fromString(tokenContract).toScAddress(),
            functionName: 'transfer',
            args: [
              sender,
              Address.fromString(POOL).toScVal(),
              nativeToScVal(25n, { type: 'i128' }),
            ],
          }),
        ),
        subInvocations: [],
      }),
    ],
  });
  return xdr.HashIdPreimage.envelopeTypeSorobanAuthorization(
    new xdr.HashIdPreimageSorobanAuthorization({
      networkId: hash(Buffer.from(Networks.TESTNET)),
      nonce: xdr.Int64(3n),
      signatureExpirationLedger: 50,
      invocation,
    }),
  ).toXDR('base64');
}

const digestSigner = {
  signDigest: async (digest: Uint8Array) => Keypair.random().sign(digest),
};

describe('SPP sign gate attack cases', () => {
  beforeEach(() => {
    resetSppSignApprovalsForTests();
  });

  it('allowlists Testnet and rejects Public and Futurenet', () => {
    expect(() => assertStellarTestnetPassphrase(Networks.TESTNET)).not.toThrow();
    expect(() => assertStellarTestnetPassphrase(Networks.PUBLIC)).toThrow(/Testnet/);
    expect(() => assertStellarTestnetPassphrase(Networks.FUTURENET)).toThrow(/Testnet/);
    expect(() => assertStellarTestnetPassphrase(`${Networks.TESTNET} `)).toThrow(/Testnet/);
    expect(() => mintSppSignApproval(intent({ networkPassphrase: Networks.PUBLIC }))).toThrow(/Testnet/);
    expect(() => mintSppSignApproval(intent({ networkPassphrase: Networks.FUTURENET }))).toThrow(/Testnet/);
  });

  it('rejects a classic payment and an unexpected contract or function', () => {
    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: paymentXdr(),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/invokeHostFunction/);

    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ contract: OTHER_POOL }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);

    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ functionName: 'withdraw' }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/Unexpected contract function/);
  });

  it('rejects a mismatched amount and a mismatched recipient', () => {
    mintSppSignApproval(intent({ amountStroops: '25' }));
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ amount: 26n }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);

    mintSppSignApproval(intent({ recipient: OTHER }));
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ recipient: ACCOUNT }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);
  });

  it('enforces tx.fee and simulated minResourceFee against the real ceiling', () => {
    expect(() => assertSppAssembledFees({
      operation: 'deposit',
      approvedMaxFeeStroops: '8000000',
      txFeeStroops: '7900000',
      minResourceFeeStroops: '7900000',
      requireTxFee: true,
      requireMinResourceFee: true,
    })).not.toThrow();

    expect(() => assertSppAssembledFees({
      operation: 'deposit',
      approvedMaxFeeStroops: '8000000',
      minResourceFeeStroops: '8718236',
      requireMinResourceFee: true,
    })).toThrow(/minResourceFee/);

    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ fee: '8000001' }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/tx\.fee/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(intent({ maxFeeStroops: '1000', minResourceFeeStroops: '900' }));
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: transactXdr({ fee: '1001' }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approved max fee/);
  });

  it('rejects auth entries on the wrong network or a foreign contract', () => {
    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: authXdr({ network: Networks.PUBLIC }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/networkId/);

    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: authXdr({ network: Networks.FUTURENET }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/networkId/);

    mintSppSignApproval(intent());
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: authXdr({ contract: OTHER_POOL }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);
  });

  it('rejects replay of a used approval, including a disposable digest signer', async () => {
    mintSppSignApproval(intent());
    const xdrInput = transactXdr();
    const first = await signDigestWithSppGate({
      kind: 'transaction',
      input: xdrInput,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
      signer: digestSigner,
    });
    expect(first.signature).toHaveLength(64);

    await expect(signDigestWithSppGate({
      kind: 'transaction',
      input: xdrInput,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
      signer: digestSigner,
    })).rejects.toThrow(/already used/);

    await expect(signDigestWithSppGate({
      kind: 'transaction',
      input: xdrInput,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.PUBLIC,
      signer: digestSigner,
    })).rejects.toThrow(/Testnet/);
  });

  it('binds register owner, keys, and the approved derivation message', async () => {
    const config = getNethermindPublicTestnetContractConfig();
    const message = sppKeyDerivationMessage(config.kdf_domain);
    const approved = intent({
      operation: 'register_public_keys',
      amountStroops: null,
      recipient: null,
      poolContractId: null,
      registryContractId: config.public_key_registry,
      maxFeeStroops: '5000000',
      exactMessage: message,
      registerNoteKeyHex: NOTE_KEY,
      registerEncryptionKeyHex: ENC_KEY,
      registerNoteKeyProofHex: null,
    });
    mintSppSignApproval(approved);
    const signed = await signDigestWithSppGate({
      kind: 'message',
      input: message,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
      signer: digestSigner,
    });
    expect(signed.signature).toHaveLength(64);
    await expect(signDigestWithSppGate({
      kind: 'message',
      input: 'Privacy Pool Key Derivation [v2] (other)',
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
      signer: digestSigner,
    })).rejects.toThrow(/already used|no matching/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(approved);
    const ok = await signDigestWithSppGate({
      kind: 'transaction',
      input: registerXdr(NOTE_KEY, ENC_KEY),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
      signer: digestSigner,
    });
    expect(ok.signature).toHaveLength(64);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(approved);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: registerXdr('33'.repeat(32), ENC_KEY),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(approved);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: registerXdr(NOTE_KEY, ENC_KEY, 'abcd'),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);
  });

  it('requires the configured pool token and a token.transfer sub-invocation on deposit auth', () => {
    const config = getNethermindPublicTestnetContractConfig();
    const token = tokenContractIdForEnabledPool(config, XLM_POOL);
    expect(token).toBe(config.pools.find((pool) => pool.poolContractId === XLM_POOL)?.tokenContractId);
    expect(() => tokenContractIdForEnabledPool(config, 'C'.padEnd(56, 'Z'))).toThrow(/No enabled pool/);

    const deposit = intent({
      operation: 'deposit',
      amountStroops: '25',
      recipient: null,
      poolContractId: POOL,
      tokenContractId: token,
    });
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: authXdr({ recipient: ACCOUNT }),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/exactly one token\.transfer/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: depositAuthXdr(OTHER_POOL),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/approved token/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: depositAuthXdr(token),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: depositTxXdr('none', token),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/missing Soroban authorization/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: depositTxXdr('empty-sub', token),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/exactly one token\.transfer/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: depositTxXdr('token', token),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: depositTxWithSplitProof(token),
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/do not match the transaction invoke/);
  });

  it('binds auth_entry and transaction to one invocation tree', async () => {
    const token = tokenContractIdForEnabledPool(getNethermindPublicTestnetContractConfig(), XLM_POOL);
    const deposit = intent({
      operation: 'deposit',
      amountStroops: '25',
      recipient: null,
      poolContractId: POOL,
      tokenContractId: token,
    });
    const treeA = depositPair(token, 1, 9);
    const treeB = depositPair(token, 2, 9);

    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: treeA.auth,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: treeB.tx,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/authorization identity/);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: treeA.tx,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: treeA.auth,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/already used/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: treeB.tx,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: treeA.auth,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/authorization identity/);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: treeB.auth,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    const raced = await Promise.allSettled([
      Promise.resolve().then(() => authorizeSppSignature({
        kind: 'auth_entry',
        input: treeA.auth,
        boundAccount: ACCOUNT,
        networkPassphrase: Networks.TESTNET,
      })),
      Promise.resolve().then(() => authorizeSppSignature({
        kind: 'transaction',
        input: treeB.tx,
        boundAccount: ACCOUNT,
        networkPassphrase: Networks.TESTNET,
      })),
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    await Promise.all([
      Promise.resolve().then(() => authorizeSppSignature({
        kind: 'transaction',
        input: treeA.tx,
        boundAccount: ACCOUNT,
        networkPassphrase: Networks.TESTNET,
      })),
      Promise.resolve().then(() => authorizeSppSignature({
        kind: 'auth_entry',
        input: treeA.auth,
        boundAccount: ACCOUNT,
        networkPassphrase: Networks.TESTNET,
      })),
    ]);

    const extOnly = depositPair(token, 1, 8);
    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => authorizeSppSignature({
      kind: 'auth_entry',
      input: treeA.auth,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).not.toThrow();
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: extOnly.tx,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/authorization identity/);
  });

  it('binds auth and transaction to one address nonce and expiration', async () => {
    const token = tokenContractIdForEnabledPool(getNethermindPublicTestnetContractConfig(), XLM_POOL);
    const deposit = intent({
      operation: 'deposit',
      amountStroops: '25',
      recipient: null,
      poolContractId: POOL,
      tokenContractId: token,
    });
    const matched = depositPair(token, 1, 9, { nonce: 11n, expiration: 150 });
    const otherNonce = depositPair(token, 1, 9, { nonce: 12n, expiration: 150 });
    const otherExpiration = depositPair(token, 1, 9, { nonce: 11n, expiration: 151 });
    const sourceTx = depositPair(token, 1, 9, { nonce: 11n, expiration: 150, txCredentials: 'source' });
    const foreign = depositPair(token, 1, 9, { nonce: 11n, expiration: 150, txAddress: OTHER });

    const sign = (kind: 'auth_entry' | 'transaction', input: string) => authorizeSppSignature({
      kind,
      input,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    });

    mintSppSignApproval(deposit);
    expect(() => sign('auth_entry', matched.auth)).not.toThrow();
    expect(() => sign('transaction', otherNonce.tx)).toThrow(/authorization identity/);
    expect(() => sign('transaction', otherExpiration.tx)).toThrow(/authorization identity/);
    expect(() => sign('transaction', sourceTx.tx)).toThrow(/authorization identity/);
    expect(() => sign('transaction', foreign.tx)).toThrow(/bound Stellar account/);
    expect(() => sign('transaction', matched.tx)).not.toThrow();
    expect(() => sign('auth_entry', matched.auth)).toThrow(/already used/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('transaction', matched.tx)).not.toThrow();
    expect(() => sign('auth_entry', otherNonce.auth)).toThrow(/authorization identity/);
    expect(() => sign('auth_entry', otherExpiration.auth)).toThrow(/authorization identity/);
    expect(() => sign('auth_entry', matched.auth)).not.toThrow();

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('transaction', sourceTx.tx)).not.toThrow();
    expect(() => sign('auth_entry', matched.auth)).toThrow(/authorization identity/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('auth_entry', matched.auth)).not.toThrow();
    expect(() => sign('transaction', sourceTx.tx)).toThrow(/authorization identity/);
    expect(() => sign('transaction', matched.tx)).not.toThrow();

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    const raced = await Promise.allSettled([
      Promise.resolve().then(() => sign('auth_entry', matched.auth)),
      Promise.resolve().then(() => sign('transaction', otherNonce.tx)),
    ]);
    expect(raced.filter((result) => result.status === 'fulfilled')).toHaveLength(1);
    expect(raced.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });

  it('covers supported credential routes and rejects the others', () => {
    const token = tokenContractIdForEnabledPool(getNethermindPublicTestnetContractConfig(), XLM_POOL);
    const deposit = intent({
      operation: 'deposit',
      amountStroops: '25',
      recipient: null,
      poolContractId: POOL,
      tokenContractId: token,
    });
    const matched = depositPair(token, 1, 9, { nonce: 11n, expiration: 150, signatureFill: 9 });
    const otherSignature = depositPair(token, 1, 9, {
      nonce: 11n,
      expiration: 150,
      publicFill: 4,
      signatureFill: 3,
    });
    const withAddress = depositPair(token, 1, 9, {
      nonce: 11n,
      expiration: 150,
      authVariant: 'withAddress',
    });
    const addressV2 = depositPair(token, 1, 9, {
      nonce: 11n,
      expiration: 150,
      txCredentials: 'address-v2',
    });
    const sign = (kind: 'auth_entry' | 'transaction', input: string) => authorizeSppSignature({
      kind,
      input,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    });

    mintSppSignApproval(deposit);
    expect(() => sign('auth_entry', matched.auth)).not.toThrow();
    expect(() => sign('transaction', otherSignature.tx)).not.toThrow();
    expect(() => sign('transaction', matched.tx)).toThrow(/already used/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('transaction', matched.tx)).not.toThrow();
    expect(() => sign('auth_entry', withAddress.auth)).toThrow(/authorization identity/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('auth_entry', withAddress.auth)).not.toThrow();
    expect(() => sign('transaction', matched.tx)).toThrow(/authorization identity/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(deposit);
    expect(() => sign('transaction', addressV2.tx)).toThrow(/Unsupported Soroban credential/);
    expect(() => sign('transaction', matched.tx)).not.toThrow();

    mintSppSignApproval(deposit);
    expect(() => sign('auth_entry', matched.auth)).toThrow(/ambiguous/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(intent());
    expect(() => sign('transaction', transactXdr())).not.toThrow();
    expect(() => sign('auth_entry', authXdr())).toThrow(/authorization identity/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(intent({ operation: 'withdraw', recipient: null }));
    expect(() => sign('transaction', transactXdr({ recipient: ACCOUNT }))).not.toThrow();
    expect(() => sign('auth_entry', authXdr({ recipient: ACCOUNT }))).toThrow(/authorization identity/);

    const config = getNethermindPublicTestnetContractConfig();
    const registered = intent({
      operation: 'register_public_keys',
      amountStroops: null,
      recipient: null,
      poolContractId: null,
      registryContractId: config.public_key_registry,
      maxFeeStroops: '5000000',
      exactMessage: sppKeyDerivationMessage(config.kdf_domain),
      registerNoteKeyHex: NOTE_KEY,
      registerEncryptionKeyHex: ENC_KEY,
    });
    resetSppSignApprovalsForTests();
    mintSppSignApproval(registered);
    expect(() => sign('transaction', registerXdr(NOTE_KEY, ENC_KEY))).not.toThrow();
    expect(() => sign('auth_entry', registerAuthXdr(NOTE_KEY, ENC_KEY))).toThrow(/authorization identity/);

    resetSppSignApprovalsForTests();
    mintSppSignApproval(registered);
    expect(() => sign('transaction', registerTxWithTwoAuth(NOTE_KEY, ENC_KEY))).toThrow(/more than one Soroban authorization/);
    expect(() => sign('transaction', registerXdr(NOTE_KEY, ENC_KEY))).not.toThrow();
  });

  it('does not sign a register envelope against a transfer approval', () => {
    mintSppSignApproval(intent());
    const registerTx = registerXdr(NOTE_KEY, ENC_KEY);
    expect(() => authorizeSppSignature({
      kind: 'transaction',
      input: registerTx,
      boundAccount: ACCOUNT,
      networkPassphrase: Networks.TESTNET,
    })).toThrow(/no matching prior approval/);
  });
});
