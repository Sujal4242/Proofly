/**
 * Proofly — canonical compact-runtime import for the frontend graph.
 *
 * The frontend is a separate npm project with its OWN `node_modules` copy of
 * `@midnight-ntwrk/*` (the root repo node_modules has another). Those are two
 * physically distinct sets of classes, so `instanceof` checks performed by the
 * runtime against state values are only satisfied when every runtime instance
 * a contract sees was constructed by the SAME copy.
 *
 * `frontend/src/compiled-contract.js` resolves the runtime through this
 * frontend copy. Tests and tooling that run the unproven circuit must import
 * the runtime HERE — never from the repo root — or the `ContractState` /
 * `ChargedState` / `StateValue` instances they feed in will be rejected by
 * `createCircuitContext` with "unexpected type".
 */
import * as ocrt from '@midnight-ntwrk/compact-runtime';

export { ocrt };