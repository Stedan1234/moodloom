import { useEffect, useRef, useState } from 'react'
import { X } from 'lucide-react'
import { api } from '../api'

const STAGES = [
  ['brief', 'Brief', 'What’s being asked for'],
  ['research', 'Research', 'Collecting and reading'],
  ['concepts', 'Concepts', 'Trying directions'],
  ['refine', 'Refining', 'Narrowing to one'],
  ['deliver', 'Delivered', 'Handed over'],
]

const FIELDS = [
  ['client', 'Who it’s for', 'The client, or yourself', false],
  ['summary', 'The job in a few sentences', 'What are you making, and why now?', true],
  ['audience', 'Who has to respond to it', 'Be specific: who are they, what do they already think?', true],
  ['goals', 'What it has to achieve', 'What should be different once this exists?', true],
  ['deliverables', 'What you’ll hand over', 'Logo suite, landing page, guidelines…', true],
  ['constraints', 'What you can’t change', 'Existing colours, a fixed name, budget, formats, deadlines', true],
  ['tone', 'How it should feel', 'In the client’s words if you have them', true],
]

// The written brief. It sits one tab from the board on purpose: references
// only mean something against what was actually asked for. It is also what
// a direction note is checked against.
export default function Brief({ project, projectId, canEdit, changeProject }) {
  const [brief, setBrief] = useState(project.brief || {})
  const [status, setStatus] = useState('idle')
  const [keyword, setKeyword] = useState('')
  const timer = useRef(null)
  const latest = useRef(brief)

  useEffect(() => () => clearTimeout(timer.current), [])

  function update(changes) {
    const next = { ...latest.current, ...changes }
    latest.current = next
    setBrief(next)
    setStatus('saving')
    clearTimeout(timer.current)
    timer.current = setTimeout(async () => {
      try {
        await api.updateProject(projectId, { brief: next })
        setStatus('saved')
      } catch {
        setStatus('error')
      }
    }, 700)
  }

  const keywords = brief.keywords || []
  const addKeyword = () => {
    const words = keyword.split(',').map((w) => w.trim()).filter(Boolean)
    if (words.length) update({ keywords: [...new Set([...keywords, ...words])].slice(0, 24) })
    setKeyword('')
  }
  const stageIndex = STAGES.findIndex(([id]) => id === project.stage)

  return (
    <div className="h-full overflow-y-auto scroll-thin">
      <div className="max-w-3xl mx-auto px-4 sm:px-8 py-8">
        <div className="flex items-baseline justify-between gap-4 mb-1">
          <h2 className="text-[2rem]">Brief</h2>
          <span className="text-xs text-mute" aria-live="polite">
            {status === 'saving' ? 'Saving…' : status === 'saved' ? 'Saved' : status === 'error' ? 'Not saved. Check your connection.' : ''}
          </span>
        </div>
        <p className="text-mute mb-8 max-w-xl">What was actually asked for. Fill in what you know; a half-written brief still beats one that lives in an email thread.</p>

        {/* Where the project is. A real sequence, so it's drawn as one thread. */}
        <ol className="flex mb-10" aria-label="Project stage">
          {STAGES.map(([id, label, hintText], i) => {
            const done = i < stageIndex
            const current = i === stageIndex
            return (
              <li key={id} className="flex-1 min-w-0">
                <button
                  disabled={!canEdit}
                  onClick={() => changeProject({ stage: id })}
                  className="w-full text-left group disabled:cursor-default"
                  aria-current={current ? 'step' : undefined}
                >
                  <span className="flex items-center">
                    <span className={`w-4 h-4 rounded-full border-2 shrink-0 ${current ? 'bg-weld border-ink' : done ? 'bg-spruce border-spruce' : 'bg-paper border-line group-hover:border-ink'}`} />
                    {i < STAGES.length - 1 && <span className={`flex-1 ${done ? 'h-0.5 bg-spruce' : 'stitch-line text-line'}`} />}
                  </span>
                  <span className={`block mt-2 text-sm pr-2 ${current ? 'font-semibold' : 'text-mute'}`}>{label}</span>
                  <span className="hidden sm:block text-xs text-mute pr-2">{hintText}</span>
                </button>
              </li>
            )
          })}
        </ol>

        <div className="sheet p-5 sm:p-7 space-y-6">
          {FIELDS.map(([key, label, placeholder, long]) => (
            <label key={key} className="block">
              <span className="label">{label}</span>
              {long ? (
                <textarea className="field" value={brief[key] || ''} placeholder={placeholder} readOnly={!canEdit} maxLength={key === 'tone' ? 600 : 2000} onChange={(e) => update({ [key]: e.target.value })} />
              ) : (
                <input className="field" value={brief[key] || ''} placeholder={placeholder} readOnly={!canEdit} maxLength={200} onChange={(e) => update({ [key]: e.target.value })} />
              )}
            </label>
          ))}

          <div className="grid sm:grid-cols-[14rem_1fr] gap-6">
            <label className="block">
              <span className="label">Due</span>
              <input type="date" className="field" value={brief.deadline || ''} readOnly={!canEdit} onChange={(e) => update({ deadline: e.target.value })} />
            </label>
            <div>
              <span className="label">Words to hold on to</span>
              <div className="field flex flex-wrap gap-1.5 items-center !py-1.5 min-h-[42px]">
                {keywords.map((w) => (
                  <span key={w} className="chip chip-weld">
                    {w}
                    {canEdit && (
                      <button onClick={() => update({ keywords: keywords.filter((k) => k !== w) })} aria-label={`Remove ${w}`}>
                        <X size={12} />
                      </button>
                    )}
                  </span>
                ))}
                {canEdit && (
                  <input
                    className="bg-transparent outline-none flex-1 min-w-28 text-sm"
                    placeholder={keywords.length ? '' : 'quiet, cinematic, late…'}
                    value={keyword}
                    maxLength={40}
                    onChange={(e) => setKeyword(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ',') {
                        e.preventDefault()
                        addKeyword()
                      }
                    }}
                    onBlur={addKeyword}
                    aria-label="Add a keyword"
                  />
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
