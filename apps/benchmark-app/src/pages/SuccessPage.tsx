import { Link } from 'react-router-dom'
import { CheckCircle2 } from 'lucide-react'

export default function SuccessPage() {
  return (
    <div className="success-page">
      <div className="success-icon">
        <CheckCircle2 size={56} strokeWidth={1.5} color="var(--primary)" />
      </div>
      <h1>Order Placed Successfully!</h1>
      <p>
        Thank you for your purchase. Your order is being processed<br />
        and you'll receive a confirmation email shortly.
      </p>
      <Link to="/" className="hero-cta">Continue Shopping</Link>
    </div>
  )
}
