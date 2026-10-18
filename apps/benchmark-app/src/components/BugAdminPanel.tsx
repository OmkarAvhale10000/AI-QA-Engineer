import { useState } from 'react'
import type { BugFlags } from '../bugMatrix'
import { Bug, ChevronUp, ChevronDown } from 'lucide-react'

interface Props {
  flags: BugFlags
  onToggle: (key: keyof BugFlags, val: boolean) => void
  onEnableAll: () => void
  onDisableAll: () => void
}

const BUG_LABELS: Record<keyof BugFlags, string> = {
  bug1_doubleDiscount: 'Bug #1: Double discount on item removal',
  bug2_negativeQuantity: 'Bug #2: Negative quantity reduces total',
  bug3_formCrash: 'Bug #3: Special chars crash checkout form',
  bug4_modalTrap: 'Bug #4: Invisible overlay blocks checkout',
  bug5_stateLoss: 'Bug #5: Back button clears cart state',
  bug6_silentApiError: 'Bug #6: Silent API failure (infinite spinner)',
}

export default function BugAdminPanel({ flags, onToggle, onEnableAll, onDisableAll }: Props) {
  const [open, setOpen] = useState(false)
  const activeCount = Object.values(flags).filter(Boolean).length

  return (
    <div className="bug-panel">
      <div className="bug-panel-header" onClick={() => setOpen(o => !o)}>
        <div className="bug-panel-title">
          <div className="bug-indicator" />
          <Bug size={14} />
          QA Bug Matrix
          {activeCount > 0 && (
            <span style={{ background: '#ef4444', color: '#fff', borderRadius: 100, fontSize: 11, padding: '1px 7px' }}>
              {activeCount} active
            </span>
          )}
        </div>
        {open ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
      </div>

      {open && (
        <>
          <div className="bug-panel-body">
            {(Object.keys(flags) as Array<keyof BugFlags>).map((key) => (
              <div className="bug-toggle" key={key}>
                <span className="bug-toggle-label">{BUG_LABELS[key]}</span>
                <button
                  className={`toggle-switch ${flags[key] ? 'on' : ''}`}
                  onClick={() => onToggle(key, !flags[key])}
                  aria-label={`Toggle ${BUG_LABELS[key]}`}
                  aria-pressed={flags[key]}
                />
              </div>
            ))}
          </div>
          <div className="bug-panel-footer">
            <button className="bug-panel-btn enable" onClick={onEnableAll}>Enable All Bugs</button>
            <button className="bug-panel-btn disable" onClick={onDisableAll}>Disable All</button>
          </div>
        </>
      )}
    </div>
  )
}
