/**
 * cross-fetch browser shim
 *
 * The real cross-fetch browser ponyfill (cross-fetch/dist/browser-ponyfill.js)
 * resolves to `window.fetch` as a detached reference when native fetch exists.
 * When the indexer-provider's GraphQL client calls that detached reference,
 * Chrome throws:
 *
 *   Failed to execute 'fetch' on 'Window': Illegal invocation
 *
 * This shim re-exports window.fetch with proper `this` binding so that any
 * midnight-js package importing from 'cross-fetch' gets a callable function.
 * (Pattern copied from ShadowPass-V2.)
 *
 * @see https://github.com/github/fetch/issues/254
 */

const boundFetch = window.fetch.bind(window);

export default boundFetch;
export { boundFetch as fetch };
export const Headers = window.Headers;
export const Request = window.Request;
export const Response = window.Response;