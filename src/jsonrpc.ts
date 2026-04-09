/**
 * helper function to create a JSON-RPC request
 */
export function jsonrpc(
  id: number,
  method: string,
  params: Record<string, unknown>,
) {
  return { jsonrpc: "2.0", id, method, params };
}
