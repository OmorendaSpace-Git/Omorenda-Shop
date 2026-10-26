import { API_BASE_URL, fetchJson } from "./client";

export type OrderStatus =
  | "PENDING"
  | "PAID"
  | "SHOPIFY_CREATED"
  | "SHOPIFY_FAILED"
  | "REFUNDED";

export type OrderItem = {
  id: string;
  shopifyVariantGid: string | null;
  title: string | null;
  sku: string | null;
  quantity: number;
  unitPrice: string;
  discountApplied: string;
  lineTotal: string;
  createdAt: string;
  updatedAt: string;
};

export type Order = {
  id: string;
  email: string;
  stripeSessionId: string;
  stripePaymentId: string | null;
  stripeRefundId: string | null;
  shopifyOrderId: string | null;
  status: OrderStatus;
  currency: string;
  subtotal: string;
  discountAmount: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  refundedAt: string | null;
  items: OrderItem[];
};

export async function listOrders(): Promise<Order[]> {
  const url = `${API_BASE_URL}/orders`;
  const json = await fetchJson<{ orders: Order[] }>(url);
  return json.orders ?? [];
}

export async function hideOrderFromHistory(id: string): Promise<void> {
  await fetchJson<{ hidden: true }>(`${API_BASE_URL}/orders/${encodeURIComponent(id)}/history`, {
    method: "DELETE",
  });
}

