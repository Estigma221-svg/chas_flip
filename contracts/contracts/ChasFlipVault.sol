// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Ownable2Step, Ownable} from "@openzeppelin/contracts/access/Ownable2Step.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";
import {EIP712} from "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import {ECDSA} from "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title ChasFlipVault
 * @notice Vault simple para que los usuarios depositen USDT (o cualquier ERC-20
 *         con 6 decimales) on-chain. El saldo se refleja off-chain en el ledger
 *         autoritativo (`public.transactions` de Supabase) cuando la Edge
 *         Function `vault-deposit-listener` ve el evento `Deposited`.
 *
 *         Retiros: el server firma un EIP-712 ticket que autoriza al usuario a
 *         retirar X cantidad. El usuario presenta el ticket on-chain. El
 *         contrato verifica la firma del SERVER_SIGNER (cuya address fue fijada
 *         en el deploy) y libera fondos. Protege contra replay con `nonce` y
 *         `deadline`.
 *
 *         Fase 2.C.1 — sin escrow por match, sin VRF. Eso llega en Fase 2.C.2.
 */
contract ChasFlipVault is EIP712, Ownable2Step, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------------------------------------------------------------------
    // Constantes / inmutables
    // ---------------------------------------------------------------------

    /// @dev EIP-712 type hash del withdraw ticket. Cualquier cambio en este
    ///      struct requiere recompilar el frontend Y la Edge Function que firma.
    bytes32 public constant WITHDRAW_TICKET_TYPEHASH =
        keccak256(
            "WithdrawTicket(address user,uint256 amount,uint256 nonce,uint256 deadline)"
        );

    IERC20 public immutable token;

    // ---------------------------------------------------------------------
    // Estado
    // ---------------------------------------------------------------------

    /// @notice Address autorizada a firmar withdraw tickets. La privkey
    ///         correspondiente vive en Supabase Edge Function secrets.
    address public serverSigner;

    /// @notice Limite maximo de USDT que puede mantener el vault. Cap defensivo
    ///         para que si algo se rompe en el listener / ledger off-chain, el
    ///         dano este limitado. Owner puede actualizar via `setMaxVaultSize`.
    uint256 public maxVaultSize;

    /// @notice Limite maximo por deposito en una sola tx (anti-typo del user).
    uint256 public maxDepositAmount;

    /// @dev nonces consumidos por withdraw, indexado por user.
    ///      bit en el bitmap = nonce usado. Lock-bitmap permite ~uint256 nonces
    ///      en un slot. Para empezar usamos un mapping simple uint256->bool.
    mapping(address => mapping(uint256 => bool)) public usedWithdrawNonces;

    /// @dev Total acumulado depositado por user (para metricas y caps).
    mapping(address => uint256) public lifetimeDeposited;
    mapping(address => uint256) public lifetimeWithdrawn;

    // ---------------------------------------------------------------------
    // Eventos
    // ---------------------------------------------------------------------

    event Deposited(
        address indexed user,
        uint256 amount,
        uint256 lifetimeAfter,
        uint256 vaultBalanceAfter
    );

    event Withdrawn(
        address indexed user,
        uint256 amount,
        uint256 indexed nonce,
        uint256 lifetimeAfter,
        uint256 vaultBalanceAfter
    );

    event ServerSignerUpdated(address indexed oldSigner, address indexed newSigner);
    event MaxVaultSizeUpdated(uint256 oldMax, uint256 newMax);
    event MaxDepositAmountUpdated(uint256 oldMax, uint256 newMax);

    event RescueERC20(address indexed token, address indexed to, uint256 amount);

    // ---------------------------------------------------------------------
    // Errores
    // ---------------------------------------------------------------------

    error ZeroAmount();
    error VaultCapped();
    error DepositTooLarge();
    error TicketExpired();
    error TicketAmountZero();
    error NonceAlreadyUsed();
    error InvalidSignature();
    error ZeroAddress();
    error RescueNotAllowed();

    // ---------------------------------------------------------------------
    // Constructor
    // ---------------------------------------------------------------------

    /**
     * @param token_         ERC-20 que custodia el vault (USDT en Polygon).
     * @param initialOwner   Owner inicial (deployer). Se puede transferir.
     * @param serverSigner_  Address que firmara withdraw tickets server-side.
     * @param maxVaultSize_  Cap maximo de USDT en el vault. 0 = sin limite.
     * @param maxDepositAmount_  Cap maximo por tx de deposito. 0 = sin limite.
     */
    constructor(
        IERC20 token_,
        address initialOwner,
        address serverSigner_,
        uint256 maxVaultSize_,
        uint256 maxDepositAmount_
    ) EIP712("ChasFlipVault", "1") Ownable(initialOwner) {
        if (address(token_) == address(0)) revert ZeroAddress();
        if (serverSigner_ == address(0)) revert ZeroAddress();

        token = token_;
        serverSigner = serverSigner_;
        maxVaultSize = maxVaultSize_;
        maxDepositAmount = maxDepositAmount_;

        emit ServerSignerUpdated(address(0), serverSigner_);
        emit MaxVaultSizeUpdated(0, maxVaultSize_);
        emit MaxDepositAmountUpdated(0, maxDepositAmount_);
    }

    // ---------------------------------------------------------------------
    // Owner-only
    // ---------------------------------------------------------------------

    function setServerSigner(address newSigner) external onlyOwner {
        if (newSigner == address(0)) revert ZeroAddress();
        address old = serverSigner;
        serverSigner = newSigner;
        emit ServerSignerUpdated(old, newSigner);
    }

    function setMaxVaultSize(uint256 newMax) external onlyOwner {
        uint256 old = maxVaultSize;
        maxVaultSize = newMax;
        emit MaxVaultSizeUpdated(old, newMax);
    }

    function setMaxDepositAmount(uint256 newMax) external onlyOwner {
        uint256 old = maxDepositAmount;
        maxDepositAmount = newMax;
        emit MaxDepositAmountUpdated(old, newMax);
    }

    function pause() external onlyOwner {
        _pause();
    }

    function unpause() external onlyOwner {
        _unpause();
    }

    /// @notice Rescate de tokens DISTINTOS al token principal del vault.
    ///         Imagina que alguien manda accidentalmente USDC al contrato.
    ///         NO permite mover el `token` principal: ese solo sale via
    ///         withdraw firmado por server signer.
    function rescueERC20(IERC20 stuckToken, address to, uint256 amount) external onlyOwner {
        if (address(stuckToken) == address(token)) revert RescueNotAllowed();
        if (to == address(0)) revert ZeroAddress();
        stuckToken.safeTransfer(to, amount);
        emit RescueERC20(address(stuckToken), to, amount);
    }

    // ---------------------------------------------------------------------
    // Public — deposito
    // ---------------------------------------------------------------------

    /**
     * @notice Deposita `amount` del token al vault. El usuario debe haber
     *         llamado `approve(vault, amount)` antes. Despues de esta tx,
     *         la Edge Function `vault-deposit-listener` vera el evento
     *         `Deposited` y acreditara el saldo off-chain en el ledger
     *         (`kind='deposit', source='on_chain:<txhash>:<logIndex>'`).
     *
     *         IMPORTANTE: el saldo del juego NO se actualiza atomicamente con
     *         la tx on-chain. El listener tarda algunos bloques en confirmar
     *         y escribir. UI debe explicarlo (~30s tipico).
     */
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (maxDepositAmount != 0 && amount > maxDepositAmount) revert DepositTooLarge();

        uint256 balanceBefore = token.balanceOf(address(this));
        if (maxVaultSize != 0 && balanceBefore + amount > maxVaultSize) revert VaultCapped();

        token.safeTransferFrom(msg.sender, address(this), amount);

        // Algunos tokens fee-on-transfer reportarian "received" diferente.
        // Calculamos el real recibido para evitar mentir en el evento.
        uint256 received = token.balanceOf(address(this)) - balanceBefore;
        lifetimeDeposited[msg.sender] += received;

        emit Deposited(
            msg.sender,
            received,
            lifetimeDeposited[msg.sender],
            balanceBefore + received
        );
    }

    // ---------------------------------------------------------------------
    // Public — retiro con EIP-712 server signature
    // ---------------------------------------------------------------------

    /**
     * @notice Retira `amount` del vault hacia el `user`. Requiere una firma
     *         EIP-712 del SERVER_SIGNER que autorize especificamente este
     *         retiro. El server emite la firma DESPUES de debitar el saldo
     *         del ledger atomicamente (RPC `issue_withdraw_intent`), asi
     *         garantizamos que un mismo saldo no se puede retirar dos veces.
     *
     * @param user      Address que recibe los fondos. Tipicamente == msg.sender.
     * @param amount    Cantidad en unidades del token (6 dp para USDT).
     * @param nonce     Nonce unico por (user, retiro). Lo asigna el server.
     * @param deadline  Unix timestamp tras el cual el ticket es invalido.
     * @param signature Firma EIP-712 del SERVER_SIGNER del struct
     *                  WithdrawTicket(user, amount, nonce, deadline).
     */
    function withdraw(
        address user,
        uint256 amount,
        uint256 nonce,
        uint256 deadline,
        bytes calldata signature
    ) external whenNotPaused nonReentrant {
        if (amount == 0) revert TicketAmountZero();
        if (block.timestamp > deadline) revert TicketExpired();
        if (usedWithdrawNonces[user][nonce]) revert NonceAlreadyUsed();

        bytes32 structHash = keccak256(
            abi.encode(WITHDRAW_TICKET_TYPEHASH, user, amount, nonce, deadline)
        );
        bytes32 digest = _hashTypedDataV4(structHash);
        address recovered = ECDSA.recover(digest, signature);
        if (recovered != serverSigner) revert InvalidSignature();

        usedWithdrawNonces[user][nonce] = true;
        lifetimeWithdrawn[user] += amount;

        uint256 balanceBefore = token.balanceOf(address(this));
        token.safeTransfer(user, amount);
        uint256 balanceAfter = token.balanceOf(address(this));

        emit Withdrawn(
            user,
            amount,
            nonce,
            lifetimeWithdrawn[user],
            balanceAfter < balanceBefore ? balanceAfter : balanceBefore
        );
    }

    // ---------------------------------------------------------------------
    // Views helpers
    // ---------------------------------------------------------------------

    /// @notice Saldo total custodiado en el vault (todos los users juntos).
    function vaultBalance() external view returns (uint256) {
        return token.balanceOf(address(this));
    }

    /// @notice Domain separator EIP-712 — util para que el frontend / Edge
    ///         Function arme el digest off-chain antes de firmar.
    function domainSeparator() external view returns (bytes32) {
        return _domainSeparatorV4();
    }
}
