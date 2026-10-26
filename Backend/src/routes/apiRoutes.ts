import { Router } from "express";
import { listProducts } from "../controllers/productController";
import { createCheckoutSession } from "../controllers/checkoutController";
import { getOrderById, hideOrderFromHistory, listOrders } from "../controllers/orderController";
import { requireAuth } from "../auth/middleware";
import { bowlRoutes } from "./bowlRoutes";
import { rateLimit } from "express-rate-limit";

export const apiRoutes = Router();
const checkoutLimiter = rateLimit({ windowMs: 10 * 60 * 1000, limit: 30, standardHeaders: "draft-8", legacyHeaders: false });

apiRoutes.get("/health", (_req, res) => {
  res.status(200).json({ ok: true });
});

apiRoutes.get("/products", listProducts);
apiRoutes.post("/checkout/session", checkoutLimiter, requireAuth, createCheckoutSession);
apiRoutes.get("/orders", requireAuth, listOrders);
apiRoutes.get("/orders/:id", requireAuth, getOrderById);
apiRoutes.delete("/orders/:id/history", requireAuth, hideOrderFromHistory);

apiRoutes.use(bowlRoutes);

