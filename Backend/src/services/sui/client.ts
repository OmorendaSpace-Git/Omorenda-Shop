import { config } from "../../config/config";

type SuiClientInstance = import("@mysten/sui/grpc").SuiGrpcClient;

let cached: SuiClientInstance | null = null;

export async function getSuiClient(): Promise<SuiClientInstance> {
  if (cached) return cached;
  if (!config.sui.rpcUrl) {
    throw new Error("Missing SUI_RPC_URL");
  }
  const { SuiGrpcClient } = await import("@mysten/sui/grpc");
  cached = new SuiGrpcClient({
    baseUrl: config.sui.rpcUrl,
    network: config.sui.network,
  });
  return cached;
}
