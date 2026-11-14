import { useEffect, useLayoutEffect, useState } from 'react'

const DONE_KEY = 'moodloom_tour_done'
export const tourSeen = () => {
  try {
    return localStorage.getItem(DONE_KEY) === '1'
  } catch {
    return true // no storage: don't nag on every visit
  }
}
const markSeen = () => {
  try {
    localStorage.setItem(DONE_KEY, '1')
  } catch {
    /* fine */
  }
}

// Each step points at a real control (found by its data-tour attribute).
const STEPS = [
  { target: 'add', title: 'Everything starts here', body: 'Paste a link and press Add. Or drop files anywhere on the board, or paste a screenshot with Ctrl/Cmd + V. Import brings in a whole list of links at once.' },
  { target: 'threads', title: 'Threads keep a wall readable', body: 'Each thread is a grouping with its own colour. Select one and whatever you add lands on it. Double-click a name to change it.' },
  { target: 'notes', title: 'Your thinking sits beside it', body: 'Notes stay next to the references they are about. The arrows above the board tuck either side away when you want room.' },
  { target: 'sections', title: 'From a wall to a direction', body: 'Brief is what was asked for. Direction reads the board: shared colours, groupings, a drafted note. Sketch is a pad for thumbnails. Brand kit writes the decisions down.' },
]

// A short walk round the board the first time someone opens one. It points
// at the real interface instead of showing pictures of it, can be skipped at
// any step, and never appears again once finished or skipped.
export default function Tour({ onClose }) {
  const [step, setStep] = useState(0)
  const [box, setBox] = useState(null)

  useLayoutEffect(() => {
    const measure = () => {
      // Skip steps whose control isn't on screen (notes are hidden on a phone).
      const el = [...document.querySelectorAll(`[data-tour="${STEPS[step].target}"]`)].find((n) => n.getClientRects().length)
      if (!el) return setBox(null)
      const r = el.getBoundingClientRect()
      setBox({ top: r.top, left: r.left, width: r.width, height: Math.min(r.height, window.innerHeight - r.top - 8) })
    }
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [step])

  const finish = () => {
    markSeen()
    onClose()
  }
  const next = () => (step === STEPS.length - 1 ? finish() : setStep(step + 1))

  // A step with nothing to point at is passed over.
  useEffect(() => {
    if (box === null) {
      const t = setTimeout(() => {
        const el = [...document.querySelectorAll(`[data-tour="${STEPS[step].target}"]`)].find((n) => n.getClientRects().length)
        if (!el) next()
      }, 60)
      return () => clearTimeout(t)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [box, step])

  useEffect(() => {
    const key = (e) => {
      if (e.key === 'Escape') finish()
      if (e.key === 'ArrowRight' || e.key === 'Enter') next()
      if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
    }
    document.addEventListener('keydown', key)
    return () => document.removeEventListener('keydown', key)
  })

  if (!box) return null
  const s = STEPS[step]
  const pad = 6
  const below = box.top + box.height + 190 < window.innerHeight
  const cardTop = below ? box.top + box.height + pad + 12 : Math.max(12, box.top - 190)
  const cardLeft = Math.min(Math.max(12, box.left), window.innerWidth - 340)
  // On a tall target (the notes panel) the card sits inside it instead.
  const tall = box.height > window.innerHeight * 0.6
  return (
    <div className="fixed inset-0 z-[70] no-print" role="dialog" aria-label={`Getting started, step ${step + 1} of ${STEPS.length}`}>
      {/* the dimmed page, with a hole around the control being described */}
      <div
        className="absolute rounded-2xl transition-all duration-300 pointer-events-none"
        style={{ top: box.top - pad, left: box.left - pad, width: box.width + pad * 2, height: box.height + pad * 2, boxShadow: '0 0 0 9999px rgb(22 32 29 / 0.55), 0 0 0 3px #f0b90b' }}
      />
      <div className="absolute inset-0" onClick={next} />
      <div
        className="absolute w-[320px] max-w-[calc(100vw-24px)] bg-paper rounded-2xl shadow-2xl p-4 anim-rise"
        style={tall ? { top: box.top + 90, left: Math.min(Math.max(12, box.left + 16), window.innerWidth - 340) } : { top: cardTop, left: cardLeft }}
      >
        <p className="text-xs text-mute mb-1">{step + 1} of {STEPS.length}</p>
        <h2 className="text-[1.15rem] mb-1.5">{s.title}</h2>
        <p className="text-sm text-mute">{s.body}</p>
        <div className="flex items-center justify-between mt-4">
          <button className="text-sm text-mute underline" onClick={finish}>Skip</button>
          <div className="flex gap-2">
            {step > 0 && <button className="btn btn-quiet btn-sm" onClick={() => setStep(step - 1)}>Back</button>}
            <button className="btn btn-primary btn-sm" autoFocus onClick={next}>{step === STEPS.length - 1 ? 'Start pinning' : 'Next'}</button>
          </div>
        </div>
      </div>
    </div>
  )
}
