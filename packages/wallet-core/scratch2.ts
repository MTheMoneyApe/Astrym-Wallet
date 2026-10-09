import { createDefaultRpcTransport, createSolanaRpcFromTransport, devnet, address } from '@solana/kit';

const transport = createDefaultRpcTransport({ url: devnet('https://api.devnet.solana.com') });
const rpc = createSolanaRpcFromTransport(transport);

async function main() {
  const acc = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
  const user = address('4Nd1mBQtrCGZXm3XgMy5b2nStJcQG3FmPkWG3wVvjT8Q'); // Random address
  
  const res = await rpc.getTokenAccountsByOwner(
    user,
    { programId: acc },
    { encoding: 'jsonParsed' }
  ).send();
  
  console.dir(res, { depth: null });
}

main().catch(console.error);
