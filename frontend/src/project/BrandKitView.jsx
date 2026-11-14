import { Check, X } from 'lucide-react'
import { inkOn } from '../lib/util'
import { useFontFace } from './ItemCard'

const ROLE_LABEL = { primary: 'Primary', secondary: 'Secondary', accent: 'Accent', neutral: 'Neutral' }
const TYPE_ROLE = { display: 'Headlines', body: 'Body text', accent: 'Accent' }

export function isKitEmpty(kit) {
  if (!kit) return true
  return !Object.values(kit).some((v) => (Array.isArray(v) ? v.length : v && typeof v === 'object' ? Object.values(v).some((x) => (Array.isArray(x) ? x.length : x)) : v))
}

function Section({ title, children }) {
  return (
    <section className="kit-section border-t-2 border-ink pt-5 mt-12">
      <h3 className="text-[1.6rem] mb-5">{title}</h3>
      {children}
    </section>
  )
}

function TypeSpecimen({ entry, item }) {
  const loaded = useFontFace(item || { media_type: 'none' })
  const family = loaded ? `"${loaded}"` : entry.family ? `"${entry.family}", var(--font-sans)` : 'inherit'
  return (
    <div className="grid sm:grid-cols-[11rem_1fr] gap-x-8 gap-y-2 py-5 border-b border-line last:border-0">
      <div>
        <p className="font-semibold">{entry.family || 'Unnamed typeface'}</p>
        <p className="text-sm text-mute">{[TYPE_ROLE[entry.role], entry.weights].filter(Boolean).join(', ')}</p>
        {!loaded && entry.family && <p className="text-xs text-mute mt-1">Shown in a stand-in face unless this one is installed here.</p>}
      </div>
      <div className="min-w-0">
        <p style={{ fontFamily: family, fontSize: entry.role === 'body' ? '1.25rem' : '2.6rem', lineHeight: 1.15 }} className="break-words">
          {entry.sample || (entry.role === 'body' ? 'The quick brown fox jumps over the lazy dog, then stops to read the brief again.' : 'Aa Bb Cc 123')}
        </p>
        {entry.usage && <p className="text-mute mt-2 max-w-xl">{entry.usage}</p>}
      </div>
    </div>
  )
}

function Pictures({ ids, itemsById }) {
  const found = (ids || []).map((id) => itemsById.get(id)).filter((it) => it?.thumbnail_url)
  if (!found.length) return null
  return (
    <div className="columns-2 sm:columns-3 gap-3 mt-4">
      {found.map((it) => (
        <img key={it.id} src={it.thumbnail_url} alt={it.title || ''} className="w-full mb-3 rounded-sm break-inside-avoid" loading="lazy" />
      ))}
    </div>
  )
}

// The brand kit as a document: what gets shown to a client, shared by link,
// or printed. Everything in it was typed or chosen by the designer.
export default function BrandKitView({ kit, itemsById, fallbackName }) {
  const k = kit || {}
  const voice = k.voice || {}
  const para = (text) => text && <p className="max-w-2xl whitespace-pre-wrap text-[1.05rem] leading-relaxed">{text}</p>
  return (
    <article className="bg-paper">
      <header className="pb-2">
        <h2 className="text-[clamp(2.6rem,7vw,4.6rem)]" style={{ fontVariationSettings: '"opsz" 96, "wdth" 86', lineHeight: 0.98 }}>
          {k.name || fallbackName}
        </h2>
        {k.tagline && <p className="display text-[clamp(1.2rem,2.6vw,1.7rem)] text-mute mt-3 max-w-2xl" style={{ fontWeight: 480 }}>{k.tagline}</p>}
        <div className="stitch-line w-28 mt-6 text-weld" />
      </header>

      {(k.story || k.audience) && (
        <Section title="Who we are">
          <div className="grid md:grid-cols-2 gap-8">
            {k.story && <div><h4 className="font-semibold mb-1.5" style={{ fontFamily: 'var(--font-sans)', letterSpacing: 0 }}>The story</h4>{para(k.story)}</div>}
            {k.audience && <div><h4 className="font-semibold mb-1.5" style={{ fontFamily: 'var(--font-sans)', letterSpacing: 0 }}>Who it’s for</h4>{para(k.audience)}</div>}
          </div>
        </Section>
      )}

      {k.values?.length > 0 && (
        <Section title="What it stands for">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-x-8 gap-y-6">
            {k.values.map((v, i) => (
              <div key={i}>
                <h4 className="text-[1.15rem] mb-1">{v.name}</h4>
                {v.description && <p className="text-mute">{v.description}</p>}
              </div>
            ))}
          </div>
        </Section>
      )}

      {(voice.summary || voice.traits?.length || voice.weSay?.length || voice.weDontSay?.length) && (
        <Section title="How it sounds">
          {para(voice.summary)}
          {voice.traits?.length > 0 && (
            <div className="grid sm:grid-cols-2 gap-x-8 gap-y-5 mt-6">
              {voice.traits.map((t, i) => (
                <div key={i}>
                  <h4 className="text-[1.1rem] mb-0.5">{t.name}</h4>
                  {t.description && <p className="text-mute">{t.description}</p>}
                </div>
              ))}
            </div>
          )}
          {(voice.weSay?.length > 0 || voice.weDontSay?.length > 0) && (
            <div className="grid sm:grid-cols-2 gap-6 mt-7">
              {voice.weSay?.length > 0 && (
                <div className="rounded-md bg-[#e9f0e2] p-4">
                  <p className="font-semibold mb-2 flex items-center gap-1.5"><Check size={16} className="text-moss" /> We say</p>
                  <ul className="space-y-1.5">{voice.weSay.map((x, i) => <li key={i}>“{x}”</li>)}</ul>
                </div>
              )}
              {voice.weDontSay?.length > 0 && (
                <div className="rounded-md bg-madder-soft p-4">
                  <p className="font-semibold mb-2 flex items-center gap-1.5"><X size={16} className="text-madder" /> We don’t say</p>
                  <ul className="space-y-1.5">{voice.weDontSay.map((x, i) => <li key={i}>“{x}”</li>)}</ul>
                </div>
              )}
            </div>
          )}
        </Section>
      )}

      {(k.logos?.length > 0 || k.logoRules?.clearSpace || k.logoRules?.minSize || k.logoRules?.donts?.length > 0) && (
        <Section title="Logo">
          {k.logos?.length > 0 && (
            <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {k.logos.map((logo, i) => {
                const it = itemsById.get(logo.itemId)
                return (
                  <figure key={i}>
                    <div className={`aspect-[3/2] rounded-md grid place-items-center p-6 border border-line ${logo.background ? '' : 'checker'}`} style={{ background: logo.background || undefined }}>
                      {it?.thumbnail_url ? <img src={it.is_upload ? it.source_url : it.thumbnail_url} alt={logo.label || 'Logo'} className="max-w-full max-h-full object-contain" /> : <span className="text-sm text-mute">Logo file no longer on the board</span>}
                    </div>
                    <figcaption className="mt-2">
                      {logo.label && <p className="font-semibold">{logo.label}</p>}
                      {logo.usage && <p className="text-sm text-mute">{logo.usage}</p>}
                    </figcaption>
                  </figure>
                )
              })}
            </div>
          )}
          <div className="grid sm:grid-cols-3 gap-6 mt-6">
            {k.logoRules?.clearSpace && <div><p className="font-semibold mb-1">Clear space</p><p className="text-mute">{k.logoRules.clearSpace}</p></div>}
            {k.logoRules?.minSize && <div><p className="font-semibold mb-1">Smallest size</p><p className="text-mute">{k.logoRules.minSize}</p></div>}
            {k.logoRules?.donts?.length > 0 && (
              <div>
                <p className="font-semibold mb-1">Never</p>
                <ul className="text-mute list-disc pl-5 space-y-0.5">{k.logoRules.donts.map((d, i) => <li key={i}>{d}</li>)}</ul>
              </div>
            )}
          </div>
        </Section>
      )}

      {k.colors?.length > 0 && (
        <Section title="Colour">
          <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {k.colors.map((c, i) => (
              <div key={i} className="rounded-md overflow-hidden border border-line">
                <div className="h-28 p-3 flex flex-col justify-between" style={{ background: c.hex, color: inkOn(c.hex) }}>
                  <span className="text-xs font-semibold">{ROLE_LABEL[c.role] || ''}</span>
                  <span className="font-semibold tabular-nums">{c.hex.toUpperCase()}</span>
                </div>
                <div className="p-3">
                  <p className="font-semibold">{c.name || c.hex.toUpperCase()}</p>
                  {c.meaning && <p className="text-sm mt-1">{c.meaning}</p>}
                  {c.usage && <p className="text-sm text-mute mt-1">{c.usage}</p>}
                </div>
              </div>
            ))}
          </div>
        </Section>
      )}

      {k.typography?.length > 0 && (
        <Section title="Type">
          {k.typography.map((entry, i) => (
            <TypeSpecimen key={i} entry={entry} item={entry.itemId ? itemsById.get(entry.itemId) : null} />
          ))}
        </Section>
      )}

      {(k.imagery?.description || k.imagery?.itemIds?.length > 0 || k.imagery?.avoid) && (
        <Section title="Imagery">
          {para(k.imagery.description)}
          <Pictures ids={k.imagery.itemIds} itemsById={itemsById} />
          {k.imagery.avoid && <p className="mt-4 max-w-2xl"><span className="font-semibold">Avoid: </span><span className="text-mute">{k.imagery.avoid}</span></p>}
        </Section>
      )}

      {(k.patterns?.description || k.patterns?.itemIds?.length > 0) && (
        <Section title="Pattern and texture">
          {para(k.patterns.description)}
          <Pictures ids={k.patterns.itemIds} itemsById={itemsById} />
        </Section>
      )}

      {k.rules?.length > 0 && (
        <Section title="Using it">
          <div className="grid sm:grid-cols-2 gap-x-8 gap-y-3">
            {['do', 'dont'].map((kind) => {
              const rules = k.rules.filter((r) => r.kind === kind)
              if (!rules.length) return null
              return (
                <div key={kind}>
                  <p className="font-semibold mb-2 flex items-center gap-1.5">
                    {kind === 'do' ? <Check size={16} className="text-moss" /> : <X size={16} className="text-madder" />} {kind === 'do' ? 'Do' : 'Don’t'}
                  </p>
                  <ul className="space-y-3">
                    {rules.map((r, i) => {
                      const it = r.itemId ? itemsById.get(r.itemId) : null
                      return (
                        <li key={i} className="flex gap-3 items-start">
                          {it?.thumbnail_url && <img src={it.thumbnail_url} alt="" className="w-16 h-16 object-cover rounded-sm shrink-0" />}
                          <span>{r.text}</span>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </div>
        </Section>
      )}
    </article>
  )
}
