import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../App'
import { Trash2, ArrowRight, ShoppingCart } from 'lucide-react'

export default function CartPage() {
  const { items, updateQty, removeItem, discount, setDiscount, bugFlags, toast } = useCart()
  const [couponCode, setCouponCode] = useState('')
  const [couponApplied, setCouponApplied] = useState(false)
  const navigate = useNavigate()

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const discountAmount = discount
  const total = Math.max(subtotal - discountAmount, 0)

  const handleApplyCoupon = () => {
    if (couponCode.trim().toUpperCase() === 'SAVE20') {
      const discountValue = subtotal * 0.2

      if (bugFlags.bug1_doubleDiscount && couponApplied) {
        // BUG 1: Apply discount twice instead of replacing
        setDiscount(discount + discountValue)
        toast('Coupon applied again!', 'success')
      } else {
        setDiscount(discountValue)
        setCouponApplied(true)
        toast('Coupon SAVE20 applied — 20% off!', 'success')
      }
    } else {
      toast('Invalid coupon code', 'error')
    }
  }

  const handleRemoveItem = (id: number) => {
    removeItem(id)
    // BUG 1 is handled inside removeItem in App.tsx
  }

  if (items.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <ShoppingCart size={40} strokeWidth={1.5} color="var(--primary)" />
          </div>
          <h2>Your cart is empty</h2>
          <p>Add some items from the store to get started.</p>
          <Link to="/" className="hero-cta">Continue Shopping</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Store</Link>
        <span>/</span>
        <span>Cart</span>
      </div>
      <h1 className="section-title" style={{ fontSize: 24, marginBottom: 32 }}>Shopping Cart ({items.length} item{items.length !== 1 ? 's' : ''})</h1>

      <div className="cart-layout">
        <div className="cart-items">
          {items.map(item => (
            <div className="cart-item" key={item.id}>
              <div className="cart-item-emoji">
                {item.icon ? (() => {
                  const IconComp = item.icon as any
                  return <IconComp size={22} color="var(--primary)" />
                })() : null}
              </div>
              <div className="cart-item-info">
                <div className="cart-item-name">{item.name}</div>
                <div className="cart-item-price">₹{item.price.toFixed(2)} each</div>
                <div className="qty-control">
                  <button
                    className="qty-btn"
                    onClick={() => updateQty(item.id, item.quantity - 1)}
                    aria-label="Decrease quantity"
                  >−</button>
                  <input
                    className="qty-input"
                    type="number"
                    value={item.quantity}
                    onChange={(e) => updateQty(item.id, parseInt(e.target.value) || 0)}
                    aria-label={`Quantity for ${item.name}`}
                    id={`qty-${item.id}`}
                  />
                  <button
                    className="qty-btn"
                    onClick={() => updateQty(item.id, item.quantity + 1)}
                    aria-label="Increase quantity"
                  >+</button>
                </div>
              </div>
                  ₹{(item.price * item.quantity).toFixed(2)}
              <div style={{ textAlign: 'right' }}>
                <div style={{ fontWeight: 700, marginBottom: 8 }}>
                </div>
                <button
                  onClick={() => handleRemoveItem(item.id)}
                  style={{ background: 'none', border: 'none', color: '#9ca3af', cursor: 'pointer' }}
                  aria-label={`Remove ${item.name}`}
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
        </div>

        <div className="cart-summary">
          <div className="summary-title">Order Summary</div>

          {/* Coupon */}
          <div className="coupon-form">
            <input
              className="coupon-input"
              id="coupon-input"
              type="text"
              placeholder="Coupon code (try SAVE20)"
              value={couponCode}
              onChange={(e) => setCouponCode(e.target.value)}
            />
            <button className="apply-btn" id="apply-coupon" onClick={handleApplyCoupon}>Apply</button>
          </div>

          <div className="summary-row">
            <span>Subtotal</span>
            <span>₹{subtotal.toFixed(2)}</span>
          </div>
          {discountAmount > 0 && (
            <div className="summary-row discount-row">
              <span>Discount</span>
              <span>−₹{discountAmount.toFixed(2)}</span>
            </div>
          )}
          <div className="summary-row">
            <span>Shipping</span>
            <span style={{ color: '#16a34a' }}>Free</span>
          </div>
          <div className="summary-row">
            <span>Total</span>
            <span style={{ color: total < 0 ? '#dc2626' : 'inherit' }}>₹{total.toFixed(2)}</span>
          </div>

          <button
            id="proceed-to-checkout"
            className="checkout-btn"
            onClick={() => navigate('/checkout')}
          >
            Proceed to Checkout <ArrowRight size={16} style={{ display: 'inline', marginLeft: 4 }} />
          </button>
          <Link to="/" className="back-btn" style={{ display: 'block', textAlign: 'center', marginTop: 12 }}>
            ← Continue Shopping
          </Link>
        </div>
      </div>
    </div>
  )
}
