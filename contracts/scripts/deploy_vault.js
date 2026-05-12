/* eslint-disable no-console */
/**
 * Despliega `ChasFlipVault` en la red activa.
 *
 * Configuracion via env (contracts/.env.local):
 *   - DEPLOYER_PRIVATE_KEY   privkey del deployer (hace deploy y queda owner)
 *   - SERVER_SIGNER_ADDRESS  address (publica) que firmara withdraw tickets
 *   - VAULT_TOKEN_ADDRESS    address del ERC-20 que custodia el vault
 *                            (en Amoy = MockUSDT recien deployado,
 *                             en mainnet = USDT 0xc2132...)
 *   - VAULT_MAX_SIZE         (opcional) cap maximo de saldo total. 0 = sin cap.
 *                            Formato: numero con 6 dp. Ejemplo: 100000000000
 *                            = 100,000 USDT.
 *   - VAULT_MAX_DEPOSIT      (opcional) cap maximo por deposito individual.
 *
 * Output: contracts/deployments/<network>.local.json
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

function readEnvOrFail(key) {
  const v = process.env[key];
  if (!v || v.length === 0 || v === '0x') {
    throw new Error(`Missing env var ${key} in contracts/.env.local`);
  }
  return v;
}

async function main() {
  const network = hre.network.name;
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Network: ${network} (chainId=${hre.network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} native`);

  const dest = path.join(__dirname, '..', 'deployments', `${network}.local.json`);
  const persisted = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : {};

  const tokenAddress = process.env.VAULT_TOKEN_ADDRESS || persisted.mockUsdt;
  if (!tokenAddress) {
    throw new Error(
      `No token address. Set VAULT_TOKEN_ADDRESS in .env.local or run deploy_mock_usdt.js first.`,
    );
  }
  const serverSignerAddress = readEnvOrFail('SERVER_SIGNER_ADDRESS');
  const maxVaultSize = BigInt(process.env.VAULT_MAX_SIZE || '0');
  const maxDepositAmount = BigInt(process.env.VAULT_MAX_DEPOSIT || '0');

  console.log(`\nDeploying ChasFlipVault with:`);
  console.log(`  token:            ${tokenAddress}`);
  console.log(`  initialOwner:     ${deployer.address}`);
  console.log(`  serverSigner:     ${serverSignerAddress}`);
  console.log(`  maxVaultSize:     ${maxVaultSize}`);
  console.log(`  maxDepositAmount: ${maxDepositAmount}`);

  const Vault = await hre.ethers.getContractFactory('ChasFlipVault');
  const vault = await Vault.deploy(
    tokenAddress,
    deployer.address,
    serverSignerAddress,
    maxVaultSize,
    maxDepositAmount,
  );
  await vault.waitForDeployment();
  const addr = await vault.getAddress();
  console.log(`\n✅ ChasFlipVault deployed at: ${addr}`);

  const updated = {
    ...persisted,
    chainId: hre.network.config.chainId,
    token: tokenAddress,
    vault: addr,
    serverSigner: serverSignerAddress,
    maxVaultSize: maxVaultSize.toString(),
    maxDepositAmount: maxDepositAmount.toString(),
    deployedAt: new Date().toISOString(),
  };
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, JSON.stringify(updated, null, 2));
  console.log(`\nSaved to ${dest}`);

  console.log(`\nVerify on Polygonscan (Amoy):`);
  console.log(
    `  npx hardhat verify --network ${network} ${addr} ${tokenAddress} ${deployer.address} ${serverSignerAddress} ${maxVaultSize} ${maxDepositAmount}`,
  );
  console.log(`\nNext steps:`);
  console.log(` 1. Update the frontend with the vault address (src/config/onchainEnv.js).`);
  console.log(` 2. Deploy / restart the Edge Function vault-deposit-listener with these addresses.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
