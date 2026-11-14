import { useState } from 'react'
import { Play, Link2, FileText } from 'lucide-react'
import { api } from '../api'
import { navigate } from '../router'
import { ErrorNote, Wordmark } from '../ui'
import AuthDialog from '../AuthDialog'

// A drawn stand-in for a board: five kinds of reference and the one weld
// thread that runs through them to a direction. Nothing here is a real
// image, so nothing has to load.
function WallSketch() {
  const pin = 'absolute bg-paper rounded-[5px] shadow-[var(--shadow-paper)] overflow-hidden'
  return (
    <div className="relative w-full max-w-[560px] aspect-[56/50] mx-auto select-none" aria-hidden="true">
      {/* photograph */}
      <div className={pin} style={{ left: '2%', top: '4%', width: '36%', transform: 'rotate(-1.6deg)' }}>
        <div className="aspect-[4/5]" style={{ background: 'linear-gradient(180deg,#2f5fa8 0 38%,#e7a13c 38% 52%,#c4472e 52% 61%,#17332d 61%)' }}>
          <div className="w-[26%] aspect-square rounded-full bg-[#fbe9a9] ml-[58%] translate-y-[95%]" />
        </div>
        <div className="flex h-2.5">
          {['#2f5fa8', '#e7a13c', '#c4472e', '#17332d', '#fbe9a9'].map((c) => (
            <span key={c} className="flex-1" style={{ background: c }} />
          ))}
        </div>
      </div>
      {/* type specimen */}
      <div className={`${pin} p-3`} style={{ left: '42%', top: '0%', width: '25%', transform: 'rotate(1.2deg)' }}>
        <div className="display text-[clamp(2.2rem,7vw,3.6rem)] leading-none" style={{ fontVariationSettings: '"opsz" 96, "wdth" 78' }}>
          Ag
        </div>
        <div className="text-[10px] text-mute mt-1.5">Bricolage, 700</div>
      </div>
      {/* film */}
      <div className={pin} style={{ left: '71%', top: '7%', width: '28%', transform: 'rotate(2.2deg)' }}>
        <div className="aspect-video grid place-items-center" style={{ background: 'radial-gradient(circle at 30% 30%,#5e8b3a,#17332d 70%)' }}>
          <span className="w-8 h-8 rounded-full bg-paper/90 grid place-items-center">
            <Play size={14} fill="#16201d" />
          </span>
        </div>
        <div className="text-[10px] px-2 py-1.5 truncate">Title sequence, slow pans</div>
      </div>
      {/* passage */}
      <div className={`${pin} p-3`} style={{ left: '43%', top: '33%', width: '30%', transform: 'rotate(-1deg)' }}>
        <FileText size={13} className="text-mute mb-1.5" />
        <p className="display text-[13px] leading-snug">Blue hour. Wet tarmac. One window still lit.</p>
        <div className="text-[10px] text-mute mt-2">from the manuscript, p. 41</div>
      </div>
      {/* link */}
      <div className={pin} style={{ left: '77%', top: '40%', width: '22%', transform: 'rotate(-2deg)' }}>
        <div className="aspect-[5/4]" style={{ background: 'repeating-linear-gradient(135deg,#f0b90b 0 14px,#fcfcfa 14px 28px)' }} />
        <div className="text-[10px] px-2 py-1.5 flex items-center gap-1 text-mute">
          <Link2 size={10} /> studio-site.co
        </div>
      </div>
      {/* pattern */}
      <div className={pin} style={{ left: '8%', top: '58%', width: '27%', transform: 'rotate(1.4deg)' }}>
        <div className="aspect-square" style={{ background: 'radial-gradient(circle,#b5578a 22%,transparent 23%) 0 0/26px 26px,#f6dcd5' }} />
      </div>
      {/* the thread */}
      <svg viewBox="0 0 560 500" className="absolute inset-0 w-full h-full overflow-visible">
        <path
          d="M-10 120 C 70 60, 130 210, 215 150 S 330 40, 400 110 S 300 250, 250 300 S 120 380, 210 420 S 330 400, 372 392"
          fill="none"
          stroke="#f0b90b"
          strokeWidth="3.5"
          strokeLinecap="round"
          strokeDasharray="1400"
          strokeDashoffset="1400"
          style={{ animation: 'weave 2.2s .25s cubic-bezier(.6,0,.2,1) forwards' }}
        />
      </svg>
      {/* where it ends up */}
      <div className="absolute bg-spruce text-paper rounded-[5px] p-3.5 shadow-[var(--shadow-lift)]" style={{ left: '66%', top: '68%', width: '34%' }}>
        <div className="text-[10px] text-weld font-semibold mb-1">Direction</div>
        <p className="display text-[14px] leading-snug">Quiet, late, a little cinematic. Type does the talking.</p>
      </div>
    </div>
  )
}

const STEPS = [
  {
    color: '#d9a300',
    title: 'Save it where it belongs',
    body: 'A browser button, a pasted screenshot, a file, a photo from your phone. It goes straight into the project it’s for, not a camera roll you’ll never open again.',
  },
  {
    color: '#c4472e',
    title: 'See what the wall is telling you',
    body: 'Every image gives up its colours. The board shows the palette it shares, which references belong together, and what else looks like the one you’re staring at.',
  },
  {
    color: '#2f5fa8',
    title: 'Write the direction down',
    body: 'A brief, your notes, a sketch pad, and a brand kit built from what’s on the wall. When you want a second read, Moodloom drafts a direction note that cites the references it’s drawn from.',
  },
]

export default function Welcome({ onSession, next }) {
  const [auth, setAuth] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  async function start() {
    setBusy(true)
    setError(null)
    try {
      await api.start()
      onSession()
      if (next) navigate(next, { replace: true })
    } catch (err) {
      setError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className="min-h-screen flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-10 py-5">
        <Wordmark />
        <button className="btn btn-quiet" onClick={() => setAuth(true)}>
          Log in
        </button>
      </header>

      <main className="flex-1">
        <section className="px-5 sm:px-10 pt-6 sm:pt-12 pb-16 max-w-[1240px] mx-auto grid lg:grid-cols-[1fr_1.05fr] gap-10 lg:gap-6 items-center">
          <div className="max-w-[34rem]">
            <h1 className="text-[clamp(2.6rem,6.4vw,4.6rem)]" style={{ fontVariationSettings: '"opsz" 96, "wdth" 88', lineHeight: 0.98 }}>
              Everything for the project, already on the wall.
            </h1>
            <p className="mt-6 text-[1.08rem] text-mute max-w-[30rem]">
              Moodloom keeps a project’s references, notes and direction in one place. Save things the moment you find them. When you sit down to design, they’re
              waiting, in order.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              <button className="btn btn-primary !min-h-12 !px-6 !text-base" onClick={start} disabled={busy}>
                {busy ? 'Setting up…' : 'Start a board'}
              </button>
              <span className="hint">No sign-up. Save your account when there’s something worth keeping.</span>
            </div>
            <div className="mt-4 max-w-sm">
              <ErrorNote>{error}</ErrorNote>
            </div>
          </div>
          <WallSketch />
        </section>

        <section className="bg-paper">
          <div className="max-w-[1240px] mx-auto px-5 sm:px-10 py-14 grid md:grid-cols-3 gap-x-10 gap-y-10">
            {STEPS.map((s) => (
              <div key={s.title}>
                <div className="stitch-line w-16 mb-4" style={{ color: s.color }} />
                <h2 className="text-[1.45rem] mb-2">{s.title}</h2>
                <p className="text-mute">{s.body}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="max-w-[1240px] mx-auto px-5 sm:px-10 py-14 grid md:grid-cols-[1fr_1.2fr] gap-8 items-start">
          <h2 className="text-[clamp(1.7rem,3.4vw,2.4rem)] max-w-md">It holds the work. It doesn’t do it for you.</h2>
          <div className="space-y-4 text-mute max-w-xl">
            <p>
              The designing stays in Figma, Illustrator, Blender, on paper. Moodloom is where the references, the reasons and the decisions for a project live, so the file
              you open to design isn’t the first place you have to think.
            </p>
            <p>
              The AI here reads what you collected. It doesn’t generate images, and nothing from a project is sent to an AI service until you switch that on for that
              project.
            </p>
          </div>
        </section>
      </main>

      <footer className="px-5 sm:px-10 py-6 flex flex-wrap gap-x-6 gap-y-2 items-center justify-between text-sm text-mute">
        <span>Moodloom, made by Stedan.</span>
        <button className="underline" onClick={() => setAuth(true)}>
          Log in to an account
        </button>
      </footer>

      {auth && (
        <AuthDialog
          mode="login"
          allowSave={false}
          onClose={() => setAuth(false)}
          onDone={() => {
            setAuth(false)
            onSession()
            if (next) navigate(next, { replace: true })
          }}
        />
      )}
    </div>
  )
}
