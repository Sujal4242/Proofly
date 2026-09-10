/**
 * isomorphic-ws browser shim
 *
 * The indexer-public-data-provider subscribes to a WebSocket GraphQL stream
 * via `isomorphic-ws`. Under Vite the Node `ws` implementation must not be
 * bundled; the browser's native `WebSocket` is used instead via path alias.
 * (Pattern copied from ShadowPass-V2.)
 */

const browserWebSocket = globalThis.WebSocket;

if (!browserWebSocket) {
  throw new Error('WebSocket is not available in this environment');
}

export default browserWebSocket;
export const WebSocket = browserWebSocket;