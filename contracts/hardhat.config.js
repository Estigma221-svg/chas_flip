require('@nomicfoundation/hardhat-toolbox');
require('dotenv').config({ path: '.env.local' });

const AMOY_RPC_URL = process.env.AMOY_RPC_URL || 'https://rpc-amoy.polygon.technology';
const POLYGON_RPC_URL = process.env.POLYGON_RPC_URL || 'https://polygon-rpc.com';

// Estas keys vienen del generador `npm run generate-wallets`. Se quedan en
// `.env.local` (gitignored). Para mainnet hay que ROTARLAS por nuevas.
const DEPLOYER_PRIVATE_KEY = process.env.DEPLOYER_PRIVATE_KEY || '';
const SERVER_SIGNER_ADDRESS = process.env.SERVER_SIGNER_ADDRESS || '';

const accounts = DEPLOYER_PRIVATE_KEY ? [DEPLOYER_PRIVATE_KEY] : [];

/** @type {import('hardhat/config').HardhatUserConfig} */
module.exports = {
  solidity: {
    version: '0.8.27',
    settings: {
      optimizer: { enabled: true, runs: 200 },
      viaIR: true,
      evmVersion: 'cancun',
    },
  },
  networks: {
    hardhat: {
      chainId: 31337,
    },
    localhost: {
      url: 'http://127.0.0.1:8545',
      chainId: 31337,
    },
    amoy: {
      url: AMOY_RPC_URL,
      chainId: 80002,
      accounts,
    },
    polygon: {
      url: POLYGON_RPC_URL,
      chainId: 137,
      accounts,
    },
  },
  etherscan: {
    apiKey: {
      polygonAmoy: process.env.POLYGONSCAN_API_KEY || '',
      polygon: process.env.POLYGONSCAN_API_KEY || '',
    },
  },
  paths: {
    sources: './contracts',
    tests: './test',
    cache: './cache',
    artifacts: './artifacts',
  },
  mocha: {
    timeout: 60000,
  },
};

module.exports.SERVER_SIGNER_ADDRESS = SERVER_SIGNER_ADDRESS;
