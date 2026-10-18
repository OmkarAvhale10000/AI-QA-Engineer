import { Link } from 'react-router-dom'
import { useCart } from '../App'

import { Headphones, Keyboard, Monitor, Mouse, Laptop, Lightbulb } from 'lucide-react'

const PRODUCTS = [
  { id: 1, name: 'Wireless Headphones Pro', price: 129.99, icon: Headphones, desc: 'Premium noise-cancelling audio with 30hr battery.' },
  { id: 2, name: 'Mechanical Keyboard', price: 89.99, icon: Keyboard, desc: 'Tactile switches, RGB backlight, compact layout.' },
  { id: 3, name: 'USB-C Monitor Hub', price: 49.99, icon: Monitor, desc: '7-in-1 hub: HDMI, USB 3.0, SD card, power delivery.' },
  { id: 4, name: 'Ergonomic Mouse', price: 64.99, icon: Mouse, desc: 'Vertical grip, 6 programmable buttons, wireless.' },
  { id: 5, name: 'Laptop Stand Aluminium', price: 39.99, icon: Laptop, desc: 'Adjustable height, portable folding design.' },
  { id: 6, name: 'Smart LED Desk Lamp', price: 54.99, icon: Lightbulb, desc: 'Adjustable color temp, USB charging port, touch dim.' },
]

export default function StorePage() {
  const { addItem } = useCart()

  return (
    <div className="page">
      <div className="hero">
        <h1>Your productivity, upgraded.</h1>
        <p>Premium tech accessories built for developers and creators who demand more.</p>
        <Link to="/cart" className="hero-cta">Shop Now</Link>
      </div>

      <h2 className="section-title">Featured Products</h2>
      <div className="products-grid">
        {PRODUCTS.map(product => (
          <div className="product-card" key={product.id}>
            <div className="product-img">
              {(() => {
                const IconComponent = product.icon as any
                return <IconComponent size={36} color="var(--primary)" />
              })()}
            </div>
            <div className="product-body">
              <div className="product-name">{product.name}</div>
              <div className="product-desc">{product.desc}</div>
              <div className="product-footer">
                <div className="product-price">₹{product.price.toFixed(2)}</div>
                <button
                  className="add-to-cart"
                  id={`add-to-cart-${product.id}`}
                  onClick={() => addItem(product)}
                >
                  Add to Cart
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
