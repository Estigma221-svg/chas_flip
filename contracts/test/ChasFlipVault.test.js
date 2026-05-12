const { expect } = require('chai');
const { ethers } = require('hardhat');

const ZERO = ethers.ZeroAddress;
const ONE_USDT = 1_000_000n; // 1 USDT con 6 decimales

async function buildTicket({ vaultAddress, chainId, user, amount, nonce, deadline }) {
  const domain = {
    name: 'ChasFlipVault',
    version: '1',
    chainId,
    verifyingContract: vaultAddress,
  };
  const types = {
    WithdrawTicket: [
      { name: 'user', type: 'address' },
      { name: 'amount', type: 'uint256' },
      { name: 'nonce', type: 'uint256' },
      { name: 'deadline', type: 'uint256' },
    ],
  };
  const value = { user, amount, nonce, deadline };
  return { domain, types, value };
}

describe('ChasFlipVault', function () {
  let deployer; let user; let outsider; let serverSigner;
  let token; let vault; let chainId;

  beforeEach(async function () {
    [deployer, user, outsider, serverSigner] = await ethers.getSigners();
    chainId = Number((await ethers.provider.getNetwork()).chainId);

    const MockUSDT = await ethers.getContractFactory('MockUSDT');
    token = await MockUSDT.deploy();
    await token.waitForDeployment();

    const Vault = await ethers.getContractFactory('ChasFlipVault');
    vault = await Vault.deploy(
      await token.getAddress(),
      deployer.address,
      serverSigner.address,
      0n,
      0n,
    );
    await vault.waitForDeployment();

    await token.mint(user.address, 1000n * ONE_USDT);
    await token.connect(user).approve(await vault.getAddress(), ethers.MaxUint256);
  });

  describe('deployment', function () {
    it('refuses zero addresses', async function () {
      const Vault = await ethers.getContractFactory('ChasFlipVault');
      await expect(
        Vault.deploy(ZERO, deployer.address, serverSigner.address, 0n, 0n),
      ).to.be.revertedWithCustomError(vault, 'ZeroAddress');
      await expect(
        Vault.deploy(await token.getAddress(), deployer.address, ZERO, 0n, 0n),
      ).to.be.revertedWithCustomError(vault, 'ZeroAddress');
    });

    it('stores config', async function () {
      expect(await vault.token()).to.equal(await token.getAddress());
      expect(await vault.serverSigner()).to.equal(serverSigner.address);
      expect(await vault.maxVaultSize()).to.equal(0n);
      expect(await vault.maxDepositAmount()).to.equal(0n);
    });
  });

  describe('deposit', function () {
    it('happy path: transfers tokens and emits Deposited', async function () {
      const amount = 10n * ONE_USDT;
      await expect(vault.connect(user).deposit(amount))
        .to.emit(vault, 'Deposited')
        .withArgs(user.address, amount, amount, amount);

      expect(await token.balanceOf(await vault.getAddress())).to.equal(amount);
      expect(await token.balanceOf(user.address)).to.equal(990n * ONE_USDT);
      expect(await vault.lifetimeDeposited(user.address)).to.equal(amount);
    });

    it('reverts on zero amount', async function () {
      await expect(vault.connect(user).deposit(0n)).to.be.revertedWithCustomError(vault, 'ZeroAmount');
    });

    it('reverts past maxDepositAmount', async function () {
      await vault.connect(deployer).setMaxDepositAmount(5n * ONE_USDT);
      await expect(vault.connect(user).deposit(6n * ONE_USDT)).to.be.revertedWithCustomError(
        vault,
        'DepositTooLarge',
      );
      await expect(vault.connect(user).deposit(5n * ONE_USDT)).to.emit(vault, 'Deposited');
    });

    it('reverts past maxVaultSize', async function () {
      await vault.connect(deployer).setMaxVaultSize(10n * ONE_USDT);
      await vault.connect(user).deposit(8n * ONE_USDT);
      await expect(vault.connect(user).deposit(3n * ONE_USDT)).to.be.revertedWithCustomError(
        vault,
        'VaultCapped',
      );
      await vault.connect(user).deposit(2n * ONE_USDT);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(10n * ONE_USDT);
    });

    it('reverts when paused', async function () {
      await vault.connect(deployer).pause();
      await expect(vault.connect(user).deposit(ONE_USDT)).to.be.revertedWithCustomError(
        vault,
        'EnforcedPause',
      );
      await vault.connect(deployer).unpause();
      await expect(vault.connect(user).deposit(ONE_USDT)).to.emit(vault, 'Deposited');
    });
  });

  describe('withdraw', function () {
    beforeEach(async function () {
      await vault.connect(user).deposit(100n * ONE_USDT);
    });

    it('happy path with valid server signature', async function () {
      const amount = 30n * ONE_USDT;
      const nonce = 1n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);

      await expect(
        vault.connect(user).withdraw(user.address, amount, nonce, deadline, signature),
      )
        .to.emit(vault, 'Withdrawn')
        .withArgs(user.address, amount, nonce, amount, 70n * ONE_USDT);

      expect(await token.balanceOf(user.address)).to.equal(930n * ONE_USDT);
      expect(await token.balanceOf(await vault.getAddress())).to.equal(70n * ONE_USDT);
      expect(await vault.usedWithdrawNonces(user.address, nonce)).to.equal(true);
    });

    it('reverts when signature is from another signer', async function () {
      const amount = 30n * ONE_USDT;
      const nonce = 2n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline,
      });
      const badSignature = await outsider.signTypedData(ticket.domain, ticket.types, ticket.value);
      await expect(
        vault.connect(user).withdraw(user.address, amount, nonce, deadline, badSignature),
      ).to.be.revertedWithCustomError(vault, 'InvalidSignature');
    });

    it('reverts if ticket was modified after signing', async function () {
      const nonce = 3n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount: 20n * ONE_USDT,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);
      // Intento de aumentar el monto despues de firmar.
      await expect(
        vault.connect(user).withdraw(user.address, 50n * ONE_USDT, nonce, deadline, signature),
      ).to.be.revertedWithCustomError(vault, 'InvalidSignature');
    });

    it('reverts on replay (same nonce reused)', async function () {
      const amount = 10n * ONE_USDT;
      const nonce = 7n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);

      await vault.connect(user).withdraw(user.address, amount, nonce, deadline, signature);
      await expect(
        vault.connect(user).withdraw(user.address, amount, nonce, deadline, signature),
      ).to.be.revertedWithCustomError(vault, 'NonceAlreadyUsed');
    });

    it('reverts past deadline', async function () {
      const amount = 10n * ONE_USDT;
      const nonce = 8n;
      const past = BigInt((await ethers.provider.getBlock('latest')).timestamp) - 60n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline: past,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);
      await expect(
        vault.connect(user).withdraw(user.address, amount, nonce, past, signature),
      ).to.be.revertedWithCustomError(vault, 'TicketExpired');
    });

    it('reverts on zero amount', async function () {
      const nonce = 9n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount: 0n,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);
      await expect(
        vault.connect(user).withdraw(user.address, 0n, nonce, deadline, signature),
      ).to.be.revertedWithCustomError(vault, 'TicketAmountZero');
    });

    it('reverts when paused', async function () {
      const amount = 5n * ONE_USDT;
      const nonce = 11n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);
      await vault.connect(deployer).pause();
      await expect(
        vault.connect(user).withdraw(user.address, amount, nonce, deadline, signature),
      ).to.be.revertedWithCustomError(vault, 'EnforcedPause');
    });

    it('allows withdraw initiated by a relayer (any caller) as long as signature is valid', async function () {
      const amount = 5n * ONE_USDT;
      const nonce = 21n;
      const deadline = BigInt((await ethers.provider.getBlock('latest')).timestamp) + 3600n;
      const ticket = await buildTicket({
        vaultAddress: await vault.getAddress(),
        chainId,
        user: user.address,
        amount,
        nonce,
        deadline,
      });
      const signature = await serverSigner.signTypedData(ticket.domain, ticket.types, ticket.value);
      // outsider envía la tx pero los fondos van al user.
      await expect(
        vault.connect(outsider).withdraw(user.address, amount, nonce, deadline, signature),
      ).to.emit(vault, 'Withdrawn');
      expect(await token.balanceOf(user.address)).to.equal(905n * ONE_USDT);
      expect(await token.balanceOf(outsider.address)).to.equal(0n);
    });
  });

  describe('admin', function () {
    it('only owner can set server signer', async function () {
      await expect(vault.connect(user).setServerSigner(outsider.address)).to.be.revertedWithCustomError(
        vault,
        'OwnableUnauthorizedAccount',
      );
      await expect(vault.connect(deployer).setServerSigner(outsider.address))
        .to.emit(vault, 'ServerSignerUpdated')
        .withArgs(serverSigner.address, outsider.address);
      expect(await vault.serverSigner()).to.equal(outsider.address);
    });

    it('refuses zero address as new server signer', async function () {
      await expect(vault.connect(deployer).setServerSigner(ZERO)).to.be.revertedWithCustomError(
        vault,
        'ZeroAddress',
      );
    });

    it('rescue forbids the main token, allows other erc20', async function () {
      // Mint un token distinto y mandarlo accidentalmente al vault.
      const MockUSDT = await ethers.getContractFactory('MockUSDT');
      const other = await MockUSDT.deploy();
      await other.mint(await vault.getAddress(), 5n * ONE_USDT);

      await expect(
        vault.connect(deployer).rescueERC20(await token.getAddress(), deployer.address, 1n),
      ).to.be.revertedWithCustomError(vault, 'RescueNotAllowed');

      await expect(
        vault.connect(deployer).rescueERC20(await other.getAddress(), deployer.address, 5n * ONE_USDT),
      ).to.emit(vault, 'RescueERC20');
      expect(await other.balanceOf(deployer.address)).to.equal(5n * ONE_USDT);
    });
  });
});
