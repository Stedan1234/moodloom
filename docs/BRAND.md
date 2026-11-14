# Moodloom: identity and interface rules

Moodloom has its own identity, separate from Stedan.'s. This is the working guide for anyone touching the interface, the extension, the site or the social posts.

## The idea

**A studio pin-up wall and a loom.** References go up on a wall; threads run between them; a direction gets woven out of them. Every visual decision comes back to those two objects.

One sentence for what it is: *Moodloom is where a project's references, reasons and decisions live.*

## Colour

The wall has to be neutral, or every reference on it looks tinted. So the interface is quiet and the references carry the colour.

| Name | Hex | Use |
|---|---|---|
| Wall | `#E7E9E5` | The background of every working surface. A cool, slightly green grey; never warm. |
| Paper | `#FCFCFA` | Anything Moodloom adds: cards, panels, notes. |
| Ink | `#16201D` | Text. |
| Spruce | `#17332D` | The one dark: primary buttons, the mark's warp threads, dark panels. |
| Weld | `#F0B90B` | The one bright: the active tool, selection, the weft thread. Named after the plant dyers got yellow from. |
| Mute | `#5C6762` | Secondary text. Passes 4.5:1 on Wall. |
| Line | `#C9CEC7` | Borders. |
| Madder | `#B83F27` | Errors and destructive actions only. |

**Threads.** Categories are threads, and each gets a dye colour by its position: weld `#D9A300`, madder `#C4472E`, woad `#2F5FA8`, moss `#5E8B3A`, cochineal `#B5578A`, walnut `#7B5B3E`, verdigris `#2E8C87`, logwood `#6B5BA8`. A thread keeps its colour everywhere it appears.

Rules: weld is never used for text on a light ground. Spruce and weld together are the brand; neither appears as a gradient. No shadows heavier than paper on a wall.

## Type

| | Face | Use |
|---|---|---|
| Display | **Bricolage Grotesque** (variable) | Headings, the wordmark, passages on cards. Weight 650, tight tracking, slightly condensed at large sizes. |
| Text | **Instrument Sans** (variable) | Everything else. |

Both are open-licensed and bundled with the app, so nothing loads from a third party. Sentence case everywhere. No all-caps labels, no letter-spaced eyebrows.

## The mark

Three vertical warp threads in spruce, one weld weft passing over, under, over. It works at 16px. The wordmark is `moodloom`, lowercase, in Bricolage 700, to the right of the mark. Source: `frontend/public/favicon.svg`, `icon.svg`.

Don't: recolour it, outline it, set it on a photograph, or rotate it.

## The running stitch

The one decorative device: a dashed line, 7 on and 5 off, 2px. It marks a start (under section openers), a path not yet taken (unreached stages in the brief), and dividers in notes. It is not a border style to sprinkle around.

## Shape and motion

- Cards are paper pinned to a wall: 12px corners, a very soft shadow. They land with a small bounce and lean slightly when hovered.
- Buttons, thread tabs and chips are pills; fields have 12px corners. Tags take a dye colour from their name, and the active thread tab fills with its own dye.
- Motion answers an action (a dialog rising, a toast). The only unprompted animation in the product is the thread drawing itself across the welcome screen, once.
- Reduced-motion preferences are respected.

## Voice

Plain, specific, a little dry. It sounds like a designer who has done this before talking to another one.

| Do | Don't |
|---|---|
| "A bare wall" | "No items found" |
| "Pin this passage" | "Create quote card from selection" |
| "Why it's here" | "Description" |
| "Can't reach Moodloom. Check your connection, or that the server is running." | "Oops! Something went wrong." |
| Say what a button does: "Save account", "Draft a note" | "Submit", "Continue" |

Never: "just", "simply", "unleash", "supercharge", "AI-powered". Errors say what happened and what to do; they don't apologise. The AI is described as what it does ("reads what you collected", "drafts a note"), never as magic, and every screen that uses a model says so.

## What the AI may and may not be, in the interface

- It reads; it does not generate images.
- Anything a model wrote is labelled as a draft, names the model, and shows the references it's drawn from.
- Nothing is sent to a provider without a switch the project's owner turned on, and the switch says exactly what is sent.

## Accessibility floor

Text contrast 4.5:1 or better. Every control reachable and visible by keyboard. Every icon-only button has a label. Colour is never the only signal (threads have names; errors have words).
