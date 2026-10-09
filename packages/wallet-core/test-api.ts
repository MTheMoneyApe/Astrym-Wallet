import { getBase64EncodedWireTransaction } from '@solana/kit';

const msgBytes = [
  0x80, // version 0
  1, // numSignerAccounts
  0, // numReadonlySignerAccounts
  1, // numReadonlyNonSignerAccounts
  2, // 2 static accounts
  ...new Uint8Array(32).fill(2), // source account
  ...new Uint8Array(32).fill(0), // system program
  ...new Uint8Array(32).fill(3), // fake blockhash
  1, // 1 instruction
  1, // program index (SYSTEM_PROGRAM_ID)
  2, // 2 account indices
  0, 2, // 0 = source, 2 = ALT account
  12, // data length
  2, 0, 0, 0, 50, 0, 0, 0, 0, 0, 0, 0, // transfer data
  1, // 1 address table lookup
  ...new Uint8Array(32).fill(4), // ALT address
  1, // 1 writable index
  0, // index 0 in ALT
  0 // 0 readonly indices
];

const b64 = getBase64EncodedWireTransaction({
  messageBytes: new Uint8Array(msgBytes),
  signatures: {
    '4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi': new Uint8Array(64).fill(1) // source address Base58
  }
} as any);

console.log(b64);
