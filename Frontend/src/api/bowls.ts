import { API_BASE_URL, fetchJson } from "./client";

export type BowlStatus = "AVAILABLE" | "SOLD";

export type Bowl = {
  id: string;
  serialNumber: number;
  name: string;
  imageUrl: string;
  audioUrl: string | null;
  description: string | null;
  weightGrams: number;
  heightMm: number;
  widthMm: number;
  note: string;
  frequency: string;
  price: string;
  currency: string;
  status: BowlStatus;
  nftObjectId: string | null;
};

export async function listBowls(): Promise<Bowl[]> {
  const json = await fetchJson<{ bowls: Bowl[] }>(`${API_BASE_URL}/bowls`);
  return json.bowls ?? [];
}

export async function getBowl(serial: number): Promise<Bowl> {
  const json = await fetchJson<{ bowl: Bowl }>(`${API_BASE_URL}/bowls/${serial}`);
  return json.bowl;
}

export type BowlCheckoutResponse = {
  sessionId: string;
  url: string;
  totals: { subtotal: string; total: string; currency: string };
};

export async function createBowlCheckoutSession(args: {
  serial: number;
  successUrl?: string;
  cancelUrl?: string;
}): Promise<BowlCheckoutResponse> {
  return fetchJson<BowlCheckoutResponse>(`${API_BASE_URL}/bowls/checkout/session`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(args),
  });
}

export type NftCertificate = {
  id: string;
  orderId: string;
  productKind: "BOWL" | "SHOPIFY";
  status: "PENDING" | "MINTING" | "MINTED" | "FAILED";
  suiObjectId: string | null;
  mintTxDigest: string | null;
  recipientSuiAddress: string;
  createdAt: string;
  bowl: {
    serialNumber: number;
    name: string;
    imageUrl: string;
    weightGrams: number;
    heightMm: number;
    widthMm: number;
    note: string;
    frequency: string;
  } | null;
  order: { id: string; createdAt: string; total: string; currency: string } | null;
};

export async function listMyNfts(): Promise<NftCertificate[]> {
  const json = await fetchJson<{ nfts: NftCertificate[] }>(`${API_BASE_URL}/users/me/nfts`);
  return json.nfts ?? [];
}
