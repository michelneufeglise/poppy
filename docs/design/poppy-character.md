# Poppy character design (locked)

## The rule
**Poppy is the user's own drawings. Don't redraw, re-create or "interpret" the character.**
Every state shows the original picture from the emotion sheet, unchanged. This applies to every mockup, preview and implementation. Change it only when the user explicitly asks.

- Source: [emotions-sheet.jpg](emotions-sheet.jpg)
- Cut-out images (transparent background, solid white body): `assets/states/<state>.png`
- They're made by `python3 scripts/cut_sheet.py`. When the user gives a new or updated sheet, replace the jpg, adjust the cell boxes in the script if needed, and run it again.
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

## What animation is allowed
Motion is applied to the **whole drawing**, never by changing what's drawn:
- Breathing bob and a soft shadow underneath (always)
- Crossfade when switching states
- Per-state whole-image motion: hops (happy), tilts (listening, curious, thinking), sway (say hello), slow breathing (sleeping), a jump and shake (surprised), a small bounce (talking, determined)

If a state ever needs real frame-by-frame animation (for example a blinking idle or a moving mouth), ask the user for extra drawings in the same style, rather than drawing frames yourself.

## Color
The drawings stay as pencil on a white body. Don't add color (like blue eyes) unless the user asks for it.

## The chat window
The chat window is the user's own picture, [chat-window.jpg](chat-window.jpg), used the same way as the emotion sheet: never redrawn, only cut and stretched.
- `scripts/cut_chat.py` (`npm run cut-chat`) cuts the frame, paper, POPPY lettering, ×, gear, the two pencil lines, both speech bubbles, the input box and the Send button into `assets/chat/`. Only the pencil is kept; the paper turns see-through, except inside the bubbles, which keep paper so they also work on the desktop. Text from the picture is erased.
- The state names under Poppy (LISTENING, TALKING, SAY HELLO…) are cut from the lettering on the emotion sheet. The sheet calls Determined "FOCUSED", so that's what shows.
- Frame, bubbles and input stretch with CSS `border-image` (9-slice): corners and bubble tails keep their shape.
- **The chat is one big comic balloon (user's choice, replacing the paper window).** Poppy's speech bubble from the picture (`bubble-poppy.png`) is stretched with `border-image` into the whole chat; its tail points down at Poppy, who stays outside it at his normal size and place. The window grows upward while the balloon is open (main process, `setChatOpen`) so Poppy doesn't move.
- Inside the balloon (option B from the mockup): Poppy's replies are plain handwriting, since the balloon itself is his speech; only the user's messages get the small "you" bubble. Top-right: gear, ≡, –, × as separate pieces cut from the picture's header (`gear.png`, `menu.png`, `minimize.png`, `close.png`). The top strip of the balloon is the drag handle. Below the messages: file name tags, the "attach" link, the input and Send.
- The state's name (from the emotion sheet's lettering) shows left of Poppy's feet while the chat is open.
- The window is always pencil on cream paper, also in dark mode. Text uses Patrick Hand (`assets/fonts/`, SIL Open Font License).
- Not used (user's choice): the mic and smiley icons from the picture. Attaching is a handwritten "attach" link in Patrick Hand, plus drag-and-drop onto the balloon.
- Still cut from the picture but used only by the settings window: the frame, paper tile, `header.png` (Poppy head, POPPY, –, ×, gear, ≡) and the pencil lines.
- The settings window uses the same pieces: frame, paper, the same header (× and – close settings; gear and menu do nothing there), pencil lines between sections, the input box drawing around fields and dropdowns, and `button.png` (the Send button with its word erased) for buttons. The picture has no checkbox or slider drawing, so those are the normal controls in graphite.

## Menu-bar icon
Made by `scripts/cut_sheet.py` from the idle drawing: its silhouette as a macOS template image, with the drawing's own pupils cut out as holes so it reads as Poppy's face at 18 px. Nothing is redrawn.
