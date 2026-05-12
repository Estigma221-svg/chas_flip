/* eslint-disable no-console */
/**
 * Despliega `MockUSDT` (test ERC-20 con 6 decimales) en la red activa.
 *
 * Output: contracts/deployments/<network>.local.json con la address. Ese
 * archivo es gitignored, no se sube al repo.
 */
const fs = require('fs');
const path = require('path');
const hre = require('hardhat');

async function main() {
  const [deployer] = await hre.ethers.getSigners();
  console.log(`Network: ${hre.network.name}  (chainId=${hre.network.config.chainId})`);
  console.log(`Deployer: ${deployer.address}`);
  const balance = await hre.ethers.provider.getBalance(deployer.address);
  console.log(`Balance:  ${hre.ethers.formatEther(balance)} native`);

  const Mock = await hre.ethers.getContractFactory('MockUSDT');
  const mock = await Mock.deploy();
  await mock.waitForDeployment();
  const addr = await mock.getAddress();
  console.log(`\n✅ MockUSDT deployed at: ${addr}`);

  const dest = path.join(__dirname, '..', 'deployments', `${hre.network.name}.local.json`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  const current = fs.existsSync(dest) ? JSON.parse(fs.readFileSync(dest, 'utf8')) : {};
  const updated = {
    ...current,
    mockUsdt: addr,
    deployedAt: new Date().toISOString(),
    chainId: hre.network.config.chainId,
  };
  fs.writeFileSync(dest, JSON.stringify(updated, null, 2));
  console.log(`\nSaved to ${dest}`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
