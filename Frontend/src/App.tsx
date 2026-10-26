import { Route, Routes } from "react-router-dom";
import "./App.css";
import { HomePage } from "./pages/HomePage";
import { ShopPage } from "./pages/ShopPage";
import { ProductPage } from "./pages/ProductPage";
import { OrdersPage } from "./pages/OrdersPage";
import { SuccessPage } from "./pages/SuccessPage";
import { CheckoutPage } from "./pages/CheckoutPage";
import { LoginPage } from "./pages/LoginPage";
import { BowlsPage } from "./pages/BowlsPage";
import { BowlDetailPage } from "./pages/BowlDetailPage";
import { NftCertificatesPage } from "./pages/NftCertificatesPage";
import { GoogleCallbackPage } from "./pages/GoogleCallbackPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<HomePage />} />
      <Route path="/shop" element={<ShopPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/success" element={<SuccessPage />} />
      <Route path="/orders" element={<OrdersPage />} />
      <Route path="/checkout" element={<CheckoutPage />} />
      <Route path="/products/:handle" element={<ProductPage />} />
      <Route path="/bowls" element={<BowlsPage />} />
      <Route path="/bowls/:serial" element={<BowlDetailPage />} />
      <Route path="/account/nfts" element={<NftCertificatesPage />} />
      <Route path="/auth/google/callback" element={<GoogleCallbackPage />} />
    </Routes>
  );
}
