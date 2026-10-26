import { Link } from "react-router-dom";

export function StoreFooter() {
  return (
    <footer className="om-footer">
      <div className="om-footer-inner">
        <div className="om-footer-cols">
          <div>
            <div className="om-footer-brand">Omorenda</div>
            <p className="om-footer-blurb">
              Himalayan herbs, botanicals and singing bowls, sourced with care.
            </p>
          </div>

          <div className="om-footer-col">
            <h3>Shop</h3>
            <Link to="/shop">Shop all</Link>
            <Link to="/shop">Teas &amp; herbs</Link>
            <Link to="/bowls">Singing bowls</Link>
          </div>

          <div className="om-footer-col">
            <h3>Account</h3>
            <Link to="/orders">My purchases</Link>
            <Link to="/account/nfts">NFT certificates</Link>
            <Link to="/login">Sign in</Link>
          </div>
        </div>

        <div className="om-footer-bottom">© {new Date().getFullYear()} Omorenda. All rights reserved.</div>
      </div>
    </footer>
  );
}
