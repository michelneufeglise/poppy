# Poppy character design (locked)

## The rule
**Poppy is the user's own drawings. Don't redraw, re-create or "interpret" the character.**
Every state shows the original picture from the emotion sheet, unchanged. This applies to every mockup, preview and implementation. Change it only when the user explicitly asks.

- Sources: [emotions-sheet.jpg](emotions-sheet.jpg) (the first 12 states) and [emotions-sheet-2.jpg](emotions-sheet-2.jpg) ("More emotions & states", 36 more)
- **Polly, the female version** (user's choice in Settings, "Poppy or Polly"; named Polly on 2026-11-07, the male stays Poppy and the app stays Poppy). Her header drawing still says "Poppy" until the user draws one with "Polly": the same 48 states, from two sheets, cut by `scripts/cut_sheet_female.py` into `assets/female/` (states, labels, her own header and menu-bar icon):
  - [emotions-sheet-female.jpg](emotions-sheet-female.jpg) (35 states; its "SLEEPING / SNEAKY" cell is sleeping, the second "WONDER" is sighing, whose lettering comes from the male sheet, and the blush labelled "LAUGHING" is shy, with the "SHY" lettering; the drawing above "SHY" isn't used),
  - [emotions-sheet-female-2.jpg](emotions-sheet-female-2.jpg) (rows 1–4: curious, tired, focused, crying, determined, proud = hands on hips, hello, hungry, sneaky = the crouching cat, grumpy, playful, dreamy, and a real laugh for laughing; the rest repeat the first sheet or are a "MISSING" cell, and are skipped).
  - Sheet 2 is drawn in a slightly different style (a small nose, a face line, bigger heads). It's scaled so the poses on both sheets (sad, defiant, waving bye) match on average. Her header is the chat picture's header with her listening drawing peeking over the pencil line where his is.
- Cut-out images (transparent background, solid white body): `assets/states/<state>.png`
- They're made by `python3 scripts/cut_sheet.py` (first sheet, measured boxes) and `python3 scripts/cut_sheet2.py` (second sheet: finds the gaps between drawings itself, gives every pencil stroke to one drawing, scales by 1.25 so a standing pose is as tall as on the first sheet). When the user gives a new or updated sheet, replace the jpg, adjust the boxes/rows in the script if needed, and run it again. The second script also cuts each state's lettering into `assets/chat/label-<state>.png`.
- Live preview: [preview.html](preview.html). Start the `design-preview` server in `.claude/launch.json` and open http://localhost:5179/docs/design/preview.html.

## The 12 states
| State | File | Drawing |
|---|---|---|
| Idle | `idle.png` | Rounded-square head on a wide, low body, big round eyes with highlights, calm smile |
| Listening | `listening.png` | Hands cupped at the sides of the head, big eyes, small "o" mouth |
| Thinking | `thinking.png` | Hand on the chin, eyes up and to the side, one eyebrow raised, smirk |
| Talking | `talking.png` | One hand on the chest, the other out palm-up, open mouth |
| Happy | `happy.png` | Eyes closed into arcs, big open smile, arms up |
| Sad | `sad.png` | Drooping half-covered eyes, frown, arms hanging |
| Surprised | `surprised.png` | Ringed eyes with small pupils, "o" mouth, hands on the cheeks |
| Curious | `curious.png` | Eyes up, one eyebrow raised, finger at the mouth |
| Focused | `focused.png` | Skeptical frown, one eyebrow down, tilted mouth, arm across the body |
| Determined | `determined.png` | Angry eyebrows, wide fighting stance (the second "Focused" on the sheet) |
| Sleeping | `sleeping.png` | Sitting, eyes closed, "z z Z" |
| Say hello | `hello.png` | Big eyes, open smile, waving |

## The 36 states from the second sheet
Row by row as drawn: angry, laughing, shy, sneaky, bored, tired · crying, scared, excited, disgusted, confused, proud · hungry, sick, shocked, anxious, cheerful, frustrated · grumpy, playful, dreamy, **clapping** ("Proud (clapping)"), doubtful, lazy · **sad-hello** ("Sadly saying hello"), **bye** ("Waving bye"), cuddly, thirsty, busy, spooked · nervous, hopeful, chilling, wonder, defiant, sighing.

- The pink blush in shy, sick and frustrated is in the user's picture, so it stays.
- All 36 are moods the model can pick (grouped in the system prompt; the grumpy ones "only playfully, never at the user").
- Fixed moments in the app: **bye** when the chat balloon closes or Poppy is hidden (a short wave first), **tired** (the yawn) for the last minute before he falls asleep, **chilling** now and then for 20 s while idle on the desktop, **busy** while he reads attached files, **spooked** when Ollama can't be reached.
- Their whole-image motion reuses the existing moves: hop (laughing, excited, cheerful, clapping, playful), jump and shake (shocked, spooked), a small tremble (scared, nervous, anxious, frustrated), the sad sink (crying, sad-hello, sighing, tired, sick, bored), the hello sway (bye), the curious tilt (confused, wonder, dreamy, doubtful, hopeful, shy), the ready bounce (angry, sneaky), slow breathing (chilling, cuddly, lazy); the rest breathe.

## What animation is allowed
Motion is applied to the **whole drawing**, never by changing what's drawn:
- Breathing bob and a soft shadow underneath (always); the shadow shrinks and fades while she's in the air
- A quick crossfade plus a squish-and-spring when switching drawings (bigger for happy/angry, softer for sad/sleepy)
- Per-state whole-image motion with squash and stretch (`src/renderer/motion.ts`): hops with a wind-up and a landing squash (happy and friends), tilts (listening, curious, thinking), a wave (hello, bye), slow breathing (sleeping), a jump with a shake on landing (surprised, shocked, spooked), a slump (sad), an uneven talking bounce, a small tremble (scared)
- Every cycle differs a little in speed and size; while idle or listening she fidgets now and then (weight shift, look around, stretch, small bounce, wiggle)
- She leans into the move while dragged and wobbles when let go; a click squishes her
- macOS "Reduce motion": everything at half size, no intros or fidgets

If a state ever needs real frame-by-frame animation (for example a blinking idle or a moving mouth), ask the user for extra drawings in the same style, rather than drawing frames yourself.

## Color
The drawings stay as pencil on a white body. Don't add color (like blue eyes) unless the user asks for it.

## The chat window
The chat window is the user's own picture, [chat-window.jpg](chat-window.jpg), used the same way as the emotion sheet: never redrawn, only cut and stretched.
- `scripts/cut_chat.py` (`npm run cut-chat`) cuts the frame, paper, POPPY lettering, ×, gear, the two pencil lines, both speech bubbles, the input box and the Send button into `assets/chat/`. Only the pencil is kept; the paper turns see-through, except inside the bubbles, which keep paper so they also work on the desktop. Text from the picture is erased.
- The state names under Poppy (LISTENING, TALKING, SAY HELLO…) are cut from the lettering on the emotion sheet. The sheet calls Determined "FOCUSED", so that's what shows.
- Frame, bubbles and input stretch with CSS `border-image` (9-slice): corners and bubble tails keep their shape.
- **The chat is a comic strip (user's choice, layout B; it replaced the one big balloon).** The user types in their own speech bubble (`bubble-you.png`, stretched with `border-image`) at the top right; Poppy answers in her own speech bubble (`bubble-poppy.png`) right under it, its tail on her head; earlier balloons fade out above. Poppy stays outside the balloons at her normal size and place. The window grows upward while the chat is open (main process, `setChatOpen`) so Poppy doesn't move.
- Inside the user's balloon: gear, ≡, –, × on top as separate pieces cut from the picture's header (`gear.png`, `menu.png`, `minimize.png`, `close.png`; the strip next to them is the drag handle), then the text, the file name tags, the "attach" link and a small Send. Inside Poppy's balloon: tool lines and questions in pencil, her words, then "good" / "not quite".
- The state's name (from the emotion sheet's lettering) shows left of Poppy's feet while the chat is open.
- The window is always pencil on cream paper, also in dark mode. Text uses Patrick Hand (`assets/fonts/`, SIL Open Font License).
- Not used (user's choice): the mic and smiley icons from the picture. Attaching is a handwritten "attach" link in Patrick Hand, plus drag-and-drop onto the chat.
- Still cut from the picture but used only by the settings window: the frame, paper tile, `header.png` (Poppy head, POPPY, –, ×, gear, ≡) and the pencil lines.
- The settings window uses the same pieces: frame, paper, the same header (× and – close settings; gear and menu do nothing there), pencil lines between sections, the input box drawing around fields and dropdowns, and `button.png` (the Send button with its word erased) for buttons. The picture has no checkbox or slider drawing, so those are the normal controls in graphite.
- The memory window is a third paper window built from the same pieces as settings (frame, header, pencil lines, input box, `button.png`), with × next to each memory in Patrick Hand. Nothing new is drawn.
- The "good" / "not quite" feedback under Poppy's latest reply is handwritten text in Patrick Hand (faint until hovered), not a drawing. If the user wants drawn icons for these, ask for a picture.
- Tools: a small italic pencil note above the reply ("using read_note…", "used read_note", "didn't use write_note"), and the question "May I use this?" with the call in small pencil text and handwritten "yes" / "no" links in the same style as "good" / "not quite". All text, no drawings. Poses: hopeful while asking, busy while a tool runs, confused for a moment when one fails.

## Menu-bar icon
Made by `scripts/cut_sheet.py` from the idle drawing: its silhouette as a macOS template image, with the drawing's own pupils cut out as holes so it reads as Poppy's face at 18 px. Nothing is redrawn.
