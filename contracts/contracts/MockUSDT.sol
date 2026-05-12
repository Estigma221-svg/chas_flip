// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/**
 * @title MockUSDT
 * @notice ERC-20 con 6 decimales (igual que USDT real) para tests en local
 *         hardhat-node y en Polygon Amoy (donde no existe USDT canonico).
 *         Tiene `mint(to, amount)` abierto al publico para que cualquier
 *         tester pueda generar saldo. NO USAR EN MAINNET.
 */
contract MockUSDT is ERC20 {
    uint8 private constant _DECIMALS = 6;

    constructor() ERC20("Mock Tether USD", "mUSDT") {}

    function decimals() public pure override returns (uint8) {
        return _DECIMALS;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }
}
