// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BoltRegistry
/// @notice Append-only on-chain record for BOLT. Custodies nothing — every
/// function here only emits an event (and, where the requirement needs it,
/// updates a read-only bookkeeping mapping). The safety property — where
/// money can go — lives entirely in a Privy policy, never in this contract.
/// See CLAUDE.md invariant 1: enforcement lives in the Privy policy, never here.
contract BoltRegistry {
    enum AccountClass {
        OPERATING,
        CLIENT_MONEY,
        OBLIGATION_RESERVE
    }

    // ---------------------------------------------------------------- events
    // Exact event set and parameter lists per docs/REQUIREMENTS.md §4.

    event BusinessRegistered(bytes32 indexed businessId, string slug, address admin);

    event AccountRegistered(
        bytes32 indexed businessId,
        address indexed account,
        AccountClass class,
        bytes32 policyHash,
        string label
    );

    event PolicyRotated(
        bytes32 indexed businessId,
        address indexed account,
        bytes32 oldPolicyHash,
        bytes32 newPolicyHash,
        bytes32 quorumRef
    );

    event MandatePublished(bytes32 indexed businessId, uint256 version, bytes32 rulesHash, bytes32 quorumRef);

    event DepositObserved(bytes32 indexed businessId, bytes32 indexed depositId, uint256 amount, uint256 mandateVersion);

    event SplitExecuted(bytes32 indexed depositId, address indexed account, uint256 amount);

    event ObligationAccrued(
        bytes32 indexed businessId,
        bytes32 indexed obligationId,
        address account,
        bytes32 beneficiaryRef,
        uint256 amount
    );

    event ObligationSettled(bytes32 indexed obligationId, uint256 amount, bytes32 txRef);

    event UnlockRequested(
        bytes32 indexed businessId,
        bytes32 indexed unlockId,
        address account,
        uint256 amount,
        address destination,
        bytes32 reasonHash,
        uint256 executableAt
    );

    event UnlockApproved(bytes32 indexed unlockId, address approver, bytes32 humanProofRef);

    event UnlockExecuted(bytes32 indexed unlockId, uint256 amount);

    event UnlockCancelled(bytes32 indexed unlockId, bytes32 reasonHash);

    event RecorderUpdated(address indexed oldRecorder, address indexed newRecorder);

    // -------------------------------------------------------------- storage

    /// outstandingObligations[businessId][class] → uint256 (REQUIREMENTS.md §4)
    mapping(bytes32 => mapping(AccountClass => uint256)) public outstandingObligations;

    /// Account → class, populated on registration. Lets recordObligationAccrued
    /// / recordObligationSettled resolve which (businessId, class) bucket in
    /// outstandingObligations to move, without repeating that in every call.
    struct AccountInfo {
        bool registered;
        bytes32 businessId;
        AccountClass class;
    }

    mapping(address => AccountInfo) public accounts;

    struct ObligationInfo {
        bool exists;
        bytes32 businessId;
        AccountClass class;
        uint256 outstanding;
    }

    mapping(bytes32 => ObligationInfo) public obligations;

    /// The only address permitted to record events — the splitter. Settable
    /// only by the owner. This is bookkeeping access control, not the
    /// enforcement boundary: Privy is. (invariant 1)
    address public owner;
    address public recorder;

    modifier onlyOwner() {
        require(msg.sender == owner, "BoltRegistry: not owner");
        _;
    }

    modifier onlyRecorder() {
        require(msg.sender == recorder, "BoltRegistry: not recorder");
        _;
    }

    constructor(address _recorder) {
        owner = msg.sender;
        recorder = _recorder;
        emit RecorderUpdated(address(0), _recorder);
    }

    function setRecorder(address _recorder) external onlyOwner {
        emit RecorderUpdated(recorder, _recorder);
        recorder = _recorder;
    }

    // ------------------------------------------------------------- recorders

    function recordBusinessRegistered(bytes32 businessId, string calldata slug, address admin) external onlyRecorder {
        emit BusinessRegistered(businessId, slug, admin);
    }

    function recordAccountRegistered(
        bytes32 businessId,
        address account,
        AccountClass class,
        bytes32 policyHash,
        string calldata label
    ) external onlyRecorder {
        accounts[account] = AccountInfo({registered: true, businessId: businessId, class: class});
        emit AccountRegistered(businessId, account, class, policyHash, label);
    }

    function recordPolicyRotated(
        bytes32 businessId,
        address account,
        bytes32 oldPolicyHash,
        bytes32 newPolicyHash,
        bytes32 quorumRef
    ) external onlyRecorder {
        emit PolicyRotated(businessId, account, oldPolicyHash, newPolicyHash, quorumRef);
    }

    function recordMandatePublished(bytes32 businessId, uint256 version, bytes32 rulesHash, bytes32 quorumRef)
        external
        onlyRecorder
    {
        emit MandatePublished(businessId, version, rulesHash, quorumRef);
    }

    function recordDepositObserved(bytes32 businessId, bytes32 depositId, uint256 amount, uint256 mandateVersion)
        external
        onlyRecorder
    {
        emit DepositObserved(businessId, depositId, amount, mandateVersion);
    }

    function recordSplitExecuted(bytes32 depositId, address account, uint256 amount) external onlyRecorder {
        emit SplitExecuted(depositId, account, amount);
    }

    function recordObligationAccrued(
        bytes32 businessId,
        bytes32 obligationId,
        address account,
        bytes32 beneficiaryRef,
        uint256 amount
    ) external onlyRecorder {
        AccountInfo memory info = accounts[account];
        require(info.registered, "BoltRegistry: unregistered account");

        ObligationInfo storage ob = obligations[obligationId];
        ob.exists = true;
        ob.businessId = businessId;
        ob.class = info.class;
        ob.outstanding += amount;

        outstandingObligations[businessId][info.class] += amount;

        emit ObligationAccrued(businessId, obligationId, account, beneficiaryRef, amount);
    }

    function recordObligationSettled(bytes32 obligationId, uint256 amount, bytes32 txRef) external onlyRecorder {
        ObligationInfo storage ob = obligations[obligationId];
        require(ob.exists, "BoltRegistry: unknown obligation");
        require(ob.outstanding >= amount, "BoltRegistry: settles more than outstanding");

        ob.outstanding -= amount;
        outstandingObligations[ob.businessId][ob.class] -= amount;

        emit ObligationSettled(obligationId, amount, txRef);
    }

    function recordUnlockRequested(
        bytes32 businessId,
        bytes32 unlockId,
        address account,
        uint256 amount,
        address destination,
        bytes32 reasonHash,
        uint256 executableAt
    ) external onlyRecorder {
        emit UnlockRequested(businessId, unlockId, account, amount, destination, reasonHash, executableAt);
    }

    function recordUnlockApproved(bytes32 unlockId, address approver, bytes32 humanProofRef) external onlyRecorder {
        emit UnlockApproved(unlockId, approver, humanProofRef);
    }

    function recordUnlockExecuted(bytes32 unlockId, uint256 amount) external onlyRecorder {
        emit UnlockExecuted(unlockId, amount);
    }

    function recordUnlockCancelled(bytes32 unlockId, bytes32 reasonHash) external onlyRecorder {
        emit UnlockCancelled(unlockId, reasonHash);
    }
}
