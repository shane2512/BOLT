// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @title BoltUnlockTimer
/// @notice FR-5.4 — the 24-hour cool-off between an unlock's final approval and
/// its executability, published on chain as a constant nobody (including us) can
/// shorten after the fact.
///
/// Why this is a separate contract and not a `require` inside `BoltRegistry`:
/// `BoltRegistry` is already deployed at a fixed address and is the subgraph's
/// only data source. Adding code to it means a redeploy, a new address, a new
/// manifest and the loss of every block of coverage history indexed in Phases
/// 2–5 — which is the one thing FR-6.4 cannot afford. So the timer gets its own
/// deployment and `BoltRegistry` keeps recording, untouched.
///
/// What this contract is and is not:
///  - It IS a public, immutable commitment to the delay. `UNLOCK_DELAY` is
///    compiled into the deployed bytecode; there is no setter, no owner override
///    and no "dev mode" (CLAUDE.md invariant 3). Anyone can read `timers(id)` and
///    check for themselves when a given unlock became executable.
///  - It is NOT where the money is. Nothing is custodied here, exactly as in
///    `BoltRegistry`. The three things that actually stop money moving are the
///    Privy policy (where it may go), the World Selfie Check (who may start it)
///    and the 3-of-5 key quorum (how many must agree) — see CLAUDE.md invariant
///    1. `release()` is the transaction BOLT's unlock flow must land before it
///    asks Privy for a signature, and before the window it reverts.
contract BoltUnlockTimer {
    /// FR-5.4. Not shortened for demos. If you are reading this because a demo
    /// needs to finish sooner: the correct answer is to arm the timer a day
    /// earlier, not to change this number.
    uint256 public constant UNLOCK_DELAY = 24 hours;

    struct Timer {
        /// Block timestamp at which the quorum's final approval was recorded.
        uint64 armedAt;
        /// armedAt + UNLOCK_DELAY. Zero means "never armed".
        uint64 executableAt;
        bool released;
    }

    mapping(bytes32 => Timer) public timers;

    address public immutable recorder;

    event UnlockArmed(bytes32 indexed unlockId, uint64 armedAt, uint64 executableAt);
    event UnlockReleased(bytes32 indexed unlockId, uint64 releasedAt);

    modifier onlyRecorder() {
        require(msg.sender == recorder, "BoltUnlockTimer: not recorder");
        _;
    }

    constructor(address _recorder) {
        recorder = _recorder;
    }

    /// Called once, when the unlock's final quorum approval is recorded. Starts
    /// the clock from *that* moment — FR-5.4 measures the delay from the final
    /// approval, not from the request.
    function arm(bytes32 unlockId) external onlyRecorder returns (uint64 executableAt) {
        Timer storage t = timers[unlockId];
        require(t.executableAt == 0, "BoltUnlockTimer: already armed");

        t.armedAt = uint64(block.timestamp);
        executableAt = uint64(block.timestamp + UNLOCK_DELAY);
        t.executableAt = executableAt;

        emit UnlockArmed(unlockId, t.armedAt, executableAt);
    }

    /// The gate. Reverts until `UNLOCK_DELAY` has elapsed since arming, and
    /// reverts on a second call so one armed timer releases one unlock.
    function release(bytes32 unlockId) external onlyRecorder {
        Timer storage t = timers[unlockId];
        require(t.executableAt != 0, "BoltUnlockTimer: not armed - no final approval recorded");
        require(!t.released, "BoltUnlockTimer: already released");
        require(
            block.timestamp >= t.executableAt,
            "BoltUnlockTimer: 24h timer has not elapsed"
        );

        t.released = true;
        emit UnlockReleased(unlockId, uint64(block.timestamp));
    }

    /// Read-only view for the public page and for anyone checking our work.
    function secondsRemaining(bytes32 unlockId) external view returns (uint256) {
        uint64 executableAt = timers[unlockId].executableAt;
        if (executableAt == 0 || block.timestamp >= executableAt) return 0;
        return executableAt - block.timestamp;
    }
}
