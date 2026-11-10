# Wave M fix requests

## R3a

The contract has no outcome-unknown code. When an `act` call's `submitPlan` times out after the
Body may have received the plan, the reserve is refunded and the call is reported with the closest
existing code. The plan may still run. This is a known low-severity gap: the player is told the
plan was refused while the Body may act on it. Closing it needs a contract code for an unknown
outcome, which is out of scope for this packet.
