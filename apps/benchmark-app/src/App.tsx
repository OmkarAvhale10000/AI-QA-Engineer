import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { useState, useEffect, createContext, useContext } from 'react'
import { getBugFlags, setBugFlags, enableAllBugs, disableAllBugs, type BugFlags } from './bugMatrix'
import StorePage from './pages/StorePage'
import CartPage from './pages/CartPage'
import CheckoutPage from './pages/CheckoutPage'
import SuccessPage from './pages/SuccessPage'
import Navbar from './components/Navbar'
import BugAdminPanel from './components/BugAdminPanel'

// ── Cart Context ─────────────────────────────────────────────────────────────

export interface CartItem {
  id: number
  name: string
  price: number
  icon: any
  quantity: number
}

interface CartContextType {
  items: CartItem[]
  addItem: (product: Omit<CartItem, 'quantity'>) => void
  updateQty: (id: number, qty: number) => void
  removeItem: (id: number) => void
  clearCart: () => void
  discount: number
  setDiscount: (d: number) => void
  bugFlags: BugFlags
  setBugFlag: (key: keyof BugFlags, val: boolean) => void
  toast: (msg: string, type?: 'success' | 'error' | 'info') => void
}

const CartCtx = createContext<CartContextType>(null!)
export const useCart = () => useContext(CartCtx)

export default function App() {
  const [items, setItems] = useState<CartItem[]>([])
  const [discount, setDiscount] = useState(0)
  const [bugFlags, setBugFlagsState] = useState<BugFlags>(getBugFlags())
  const [toastMsg, setToastMsg] = useState<{ text: string; type: string } | null>(null)

  const addItem = (product: Omit<CartItem, 'quantity'>) => {
    setItems(prev => {
      const existing = prev.find(i => i.id === product.id)
      if (existing) return prev.map(i => i.id === product.id ? { ...i, quantity: i.quantity + 1 } : i)
      return [...prev, { ...product, quantity: 1 }]
    })
    toast(`${product.name} added to cart`, 'success')
  }

  const updateQty = (id: number, qty: number) => {
    // BUG 2: Negative quantity is allowed when bug2 is active
    if (!bugFlags.bug2_negativeQuantity && qty < 1) return
    setItems(prev => prev.map(i => i.id === id ? { ...i, quantity: qty } : i))
  }

  const removeItem = (id: number) => {
    setItems(prev => prev.filter(i => i.id !== id))
    // BUG 1: When removing an item, discount gets applied again
    if (bugFlags.bug1_doubleDiscount && discount > 0) {
      setDiscount(d => d * 2)
    }
  }

  const clearCart = () => {
    // BUG 5: When navigating back, cart state may be cleared
    if (bugFlags.bug5_stateLoss) {
      setItems([])
      setDiscount(0)
    }
  }

  const setBugFlag = (key: keyof BugFlags, val: boolean) => {
    const next = { ...bugFlags, [key]: val }
    setBugFlagsState(next)
    setBugFlags(next)
  }

  const toast = (text: string, type: 'success' | 'error' | 'info' = 'info') => {
    setToastMsg({ text, type })
    setTimeout(() => setToastMsg(null), 3000)
  }

  return (
    <CartCtx.Provider value={{
      items, addItem, updateQty, removeItem, clearCart,
      discount, setDiscount, bugFlags, setBugFlag, toast
    }}>
      <BrowserRouter>
        <Navbar />
        {/* BUG 4: Invisible modal overlay trap */}
        {bugFlags.bug4_modalTrap && (
          <div className={`modal-overlay-trap active`} aria-hidden="true" />
        )}
        <Routes>
          <Route path="/" element={<StorePage />} />
          <Route path="/cart" element={<CartPage />} />
          <Route path="/checkout" element={<CheckoutPage />} />
          <Route path="/success" element={<SuccessPage />} />
        </Routes>
        <BugAdminPanel
          flags={bugFlags}
          onToggle={setBugFlag}
          onEnableAll={() => {
            const all = enableAllBugs()
            setBugFlagsState(all)
            toast('All 6 bugs activated', 'error')
          }}
          onDisableAll={() => {
            const none = disableAllBugs()
            setBugFlagsState(none)
            toast('All bugs disabled', 'success')
          }}
        />
        {toastMsg && (
          <div className={`toast ${toastMsg.type}`}>{toastMsg.text}</div>
        )}
      </BrowserRouter>
    </CartCtx.Provider>
  )
}
