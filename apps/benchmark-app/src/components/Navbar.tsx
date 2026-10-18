import { Link } from 'react-router-dom'
import { useCart } from '../App'
import { ShoppingCart } from 'lucide-react'

export default function Navbar() {
  const { items } = useCart()
  const totalItems = items.reduce((sum, i) => sum + i.quantity, 0)

  return (
    <nav className="nav">
      <Link to="/" className="nav-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
        BuggyCart
      </Link>
      <div className="nav-links">
        <Link to="/">Shop</Link>
        <Link to="/cart">Cart</Link>
        <Link to="/cart" className="cart-btn">
          <ShoppingCart size={16} />
          Cart
          {totalItems > 0 && <span className="cart-count">{totalItems}</span>}
        </Link>
      </div>
    </nav>
  )
}
