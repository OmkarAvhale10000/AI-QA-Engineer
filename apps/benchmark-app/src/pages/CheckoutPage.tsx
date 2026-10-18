import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useCart } from '../App'
import { ShoppingCart } from 'lucide-react'

interface FormData {
  firstName: string
  lastName: string
  email: string
  address: string
  city: string
  zip: string
  cardNumber: string
  expiry: string
  cvv: string
}

interface Errors {
  [key: string]: string
}

export default function CheckoutPage() {
  const { items, discount, bugFlags, clearCart, toast } = useCart()
  const navigate = useNavigate()
  const [loading, setLoading] = useState(false)
  const [formData, setFormData] = useState<FormData>({
    firstName: '', lastName: '', email: '',
    address: '', city: '', zip: '',
    cardNumber: '', expiry: '', cvv: ''
  })
  const [errors, setErrors] = useState<Errors>({})

  const subtotal = items.reduce((sum, i) => sum + i.price * i.quantity, 0)
  const total = Math.max(subtotal - discount, 0)

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target
    setFormData(prev => ({ ...prev, [name]: value }))
    if (errors[name]) setErrors(prev => ({ ...prev, [name]: '' }))
  }

  const validate = (): boolean => {
    const newErrors: Errors = {}

    // BUG 3: Special characters in name fields crash instead of validating
    if (bugFlags.bug3_formCrash) {
      const specialChars = /[<>"';&]/
      if (specialChars.test(formData.firstName) || specialChars.test(formData.lastName)) {
        // Simulate unhandled error / crash
        throw new Error('Unhandled input validation error')
      }
    }

    if (!formData.firstName.trim()) newErrors.firstName = 'First name is required'
    if (!formData.lastName.trim()) newErrors.lastName = 'Last name is required'
    if (!formData.email.trim() || !formData.email.includes('@')) newErrors.email = 'Valid email is required'
    if (!formData.address.trim()) newErrors.address = 'Address is required'
    if (!formData.city.trim()) newErrors.city = 'City is required'
    if (!formData.zip.trim()) newErrors.zip = 'ZIP code is required'
    if (!formData.cardNumber.trim() || formData.cardNumber.replace(/\s/g, '').length < 16) {
      newErrors.cardNumber = 'Valid 16-digit card number is required'
    }
    if (!formData.expiry.trim()) newErrors.expiry = 'Expiry date is required'
    if (!formData.cvv.trim() || formData.cvv.length < 3) newErrors.cvv = 'Valid CVV is required'

    setErrors(newErrors)
    return Object.keys(newErrors).length === 0
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()

    let valid = false
    try {
      valid = validate()
    } catch {
      // BUG 3: Crash on special characters — no error shown, white screen
      return
    }

    if (!valid) return

    setLoading(true)

    // BUG 6: Silent API failure — spinner never resolves
    if (bugFlags.bug6_silentApiError) {
      // Never resolves — button stays in loading state forever
      toast('Processing your order...', 'info')
      return
    }

    // Simulate API call
    await new Promise<void>((resolve) => setTimeout(resolve, 1500))

    setLoading(false)
    clearCart()
    navigate('/success')
  }

  if (items.length === 0) {
    return (
      <div className="page">
        <div className="empty-state">
          <div className="empty-state-icon">
            <ShoppingCart size={40} strokeWidth={1.5} color="var(--primary)" />
          </div>
          <h2>Your cart is empty</h2>
          <p>Add some items before checking out.</p>
          <Link to="/" className="hero-cta">Go Shopping</Link>
        </div>
      </div>
    )
  }

  return (
    <div className="page">
      <div className="breadcrumb">
        <Link to="/">Store</Link>
        <span>/</span>
        <Link to="/cart">Cart</Link>
        <span>/</span>
        <span>Checkout</span>
      </div>
      <h1 className="section-title" style={{ fontSize: 24, marginBottom: 32 }}>Checkout</h1>

      <div className="checkout-layout">
        <form className="checkout-form" onSubmit={handleSubmit} noValidate>
          {/* Shipping */}
          <div className="form-section">
            <div className="form-section-title">Shipping Information</div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="firstName">First Name</label>
                <input
                  id="firstName" name="firstName" type="text"
                  placeholder="John" value={formData.firstName}
                  onChange={handleChange}
                />
                {errors.firstName && <span className="field-error">{errors.firstName}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="lastName">Last Name</label>
                <input
                  id="lastName" name="lastName" type="text"
                  placeholder="Doe" value={formData.lastName}
                  onChange={handleChange}
                />
                {errors.lastName && <span className="field-error">{errors.lastName}</span>}
              </div>
            </div>
            <div className="form-group">
              <label htmlFor="email">Email Address</label>
              <input
                id="email" name="email" type="email"
                placeholder="john@example.com" value={formData.email}
                onChange={handleChange}
              />
              {errors.email && <span className="field-error">{errors.email}</span>}
            </div>
            <div className="form-group">
              <label htmlFor="address">Street Address</label>
              <input
                id="address" name="address" type="text"
                placeholder="123 Main St" value={formData.address}
                onChange={handleChange}
              />
              {errors.address && <span className="field-error">{errors.address}</span>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="city">City</label>
                <input
                  id="city" name="city" type="text"
                  placeholder="New York" value={formData.city}
                  onChange={handleChange}
                />
                {errors.city && <span className="field-error">{errors.city}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="zip">ZIP Code</label>
                <input
                  id="zip" name="zip" type="text"
                  placeholder="10001" value={formData.zip}
                  onChange={handleChange}
                />
                {errors.zip && <span className="field-error">{errors.zip}</span>}
              </div>
            </div>
          </div>

          {/* Payment */}
          <div className="form-section">
            <div className="form-section-title">Payment Details</div>
            <div className="form-group">
              <label htmlFor="cardNumber">Card Number</label>
              <input
                id="cardNumber" name="cardNumber" type="text"
                placeholder="4242 4242 4242 4242"
                value={formData.cardNumber}
                onChange={handleChange}
                maxLength={19}
              />
              {errors.cardNumber && <span className="field-error">{errors.cardNumber}</span>}
            </div>
            <div className="form-row">
              <div className="form-group">
                <label htmlFor="expiry">Expiry Date</label>
                <input
                  id="expiry" name="expiry" type="text"
                  placeholder="MM/YY" value={formData.expiry}
                  onChange={handleChange}
                />
                {errors.expiry && <span className="field-error">{errors.expiry}</span>}
              </div>
              <div className="form-group">
                <label htmlFor="cvv">CVV</label>
                <input
                  id="cvv" name="cvv" type="text"
                  placeholder="123" value={formData.cvv}
                  onChange={handleChange}
                  maxLength={4}
                />
                {errors.cvv && <span className="field-error">{errors.cvv}</span>}
              </div>
            </div>
          </div>

          <button
            id="place-order"
            type="submit"
            className="place-order-btn"
            disabled={loading}
          >
            {loading ? (
              <>
                <div className="spinner" />
                Processing...
              </>
            ) : (
              `Place Order — ₹${total.toFixed(2)}`
            )}
          </button>
        </form>

        {/* Order summary sidebar */}
        <div className="cart-summary">
          <div className="summary-title">Order Summary</div>
          {items.map(item => (
            <div className="summary-row" key={item.id}>
              <span>{item.name} × {item.quantity}</span>
              <span>₹{(item.price * item.quantity).toFixed(2)}</span>
            </div>
          ))}
          {discount > 0 && (
            <div className="summary-row discount-row">
              <span>Coupon Discount</span>
              <span>−₹{discount.toFixed(2)}</span>
            </div>
          )}
          <div className="summary-row">
            <span>Shipping</span>
            <span style={{ color: '#16a34a' }}>Free</span>
          </div>
          <div className="summary-row">
            <span>Total</span>
            <span>₹{total.toFixed(2)}</span>
          </div>
        </div>
      </div>
    </div>
  )
}
