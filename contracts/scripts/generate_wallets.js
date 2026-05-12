/* eslint-disable no-console */
/**
 * Genera DOS wallets fresh (deployer + server signer) y las imprime a stdout.
 *
 * Uso:
 *   cd contracts
 *   node scripts/generate_wallets.js
 *
 * Las private keys SOLO se imprimen UNA VEZ. Copiarlas a:
 *   - DEPLOYER_PRIVATE_KEY  → contracts/.env.local
 *   - SERVER_SIGNER_PRIVATE_KEY → Supabase Edge Function secrets
 *     (`npx supabase secrets set SERVER_SIGNER_PRIVATE_KEY=0x...`)
 *   - SERVER_SIGNER_ADDRESS → contracts/.env.local (la address publica
 *     se necesita para el deploy del Vault).
 *
 * Para mainnet (produccion): rotar ambas wallets generando un par nuevo.
 */
const { ethers } = require('ethers');

function newWallet(label) {
  const w = ethers.Wallet.createRandom();
  return {
    label,
    address: w.address,
    privateKey: w.privateKey,
    mnemonic: w.mnemonic ? w.mnemonic.phrase : null,
  };
}

const deployer = newWallet('DEPLOYER');
const serverSigner = newWallet('SERVER_SIGNER');

console.log('========================================');
console.log('  ChasFlip — wallets generadas');
console.log('  Polygon Amoy (chainId 80002)');
console.log('========================================');

for (const w of [deployer, serverSigner]) {
  console.log(`\n## ${w.label}`);
  console.log(`  address:     ${w.address}`);
  console.log(`  private key: ${w.privateKey}`);
  if (w.mnemonic) console.log(`  mnemonic:    ${w.mnemonic}`);
}

console.log('\n----------------------------------------');
console.log('Snippet listo para pegar en contracts/.env.local:');
console.log('----------------------------------------');
console.log(`DEPLOYER_PRIVATE_KEY=${deployer.privateKey}`);
console.log(`SERVER_SIGNER_ADDRESS=${serverSigner.address}`);
console.log('');
console.log('Snippet para Supabase Edge Function secrets:');
console.log(`  npx supabase secrets set SERVER_SIGNER_PRIVATE_KEY=${serverSigner.privateKey}`);
console.log('');
console.log('IMPORTANTE:');
console.log(' • Estas keys son SOLO para Polygon Amoy (testnet). NO usar en mainnet.');
console.log(' • Fondear DEPLOYER con MATIC del faucet: https://faucet.polygon.technology/');
console.log(' • Mantener la SERVER_SIGNER_PRIVATE_KEY secreta — autoriza retiros.');
console.log('========================================');
