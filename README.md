# Poppy

**A hand-drawn desk buddy for macOS that talks with your local Ollama models.**

Poppy is a small pencil-drawn character who sits on your desktop. Click him and a paper chat window opens. You can ask questions, drop in pictures, PDFs or text files, and he answers out loud. Everything runs on your own Mac: the language model runs in [Ollama](https://ollama.com), and the voice is [Kokoro](https://github.com/thewh1teagle/kokoro-onnx) or a built-in Mac voice. No accounts, no cloud, no tracking.

![Poppy on the desktop, the chat window and the settings window](docs/screenshots/overview.png)

---

## Contents

- [What Poppy can do](#what-poppy-can-do)
- [What you need](#what-you-need)
- [Install and run](#install-and-run)
- [First start](#first-start)
- [Using Poppy](#using-poppy)
- [Attachments](#attachments)
- [Voices and languages](#voices-and-languages)
- [Settings](#settings)
- [Privacy](#privacy)
- [Troubleshooting](#troubleshooting)
- [For developers](#for-developers)
- [Roadmap](#roadmap)
- [License and credits](#license-and-credits)

---

## What Poppy can do

- **Lives on your desktop.** A see-through, always-on-top window in the bottom-right corner. Drag him anywhere; he remembers the spot. Clicks go straight through to your desktop except on Poppy himself.
- **Chats with your local model.** Replies stream in from Ollama, word by word.
- **Shows how he feels.** The model starts each reply with a mood (happy, curious, surprised…), and Poppy switches to the matching drawing. There are 12 poses, all hand-drawn.
- **Talks out loud.** English replies use Kokoro, a natural-sounding voice that runs on your Mac. Dutch replies use the Mac voice Xander. Long answers are read up to about 40 words, and then Poppy sums up the rest in a sentence or two.
- **Reads your files.** Drop in images, PDFs, text and code files (up to 5 at a time).
- **Falls asleep** after 10 minutes of quiet and wakes up when you hover over him.
- **Stays out of the way.** No Dock icon; a small menu-bar icon has everything else.

| On the desktop | The chat window | Settings |
| --- | --- | --- |
| ![Poppy waving with a speech bubble](docs/screenshots/floating.png) | ![The chat window with an image attachment](docs/screenshots/chat.png) | ![The settings window](docs/screenshots/settings.png) |

## What you need

| | Needed? | Notes |
| --- | --- | --- |
| **macOS** | Yes | Poppy uses macOS tools (`say`, `afplay`). Apple Silicon or Intel. |
| **Node.js 20 or newer** | Yes | Only to build and run Poppy from source. [nodejs.org](https://nodejs.org) |
| **Ollama** with at least one chat model | Yes | [ollama.com/download](https://ollama.com/download) |
| **Python 3 + `kokoro-onnx`** | Optional | For the Kokoro English voice. Without it, Poppy uses a Mac voice. |

**Which model?** Poppy's default is `qwen3.6:35b-a3b` (about 23 GB, needs a Mac with 32 GB of memory or more). It also understands pictures. On a smaller Mac, a small model works fine for chatting:

| Model | Size | Pictures? | Good for |
| --- | --- | --- | --- |
| `qwen3.6:35b-a3b` | ~23 GB | Yes | The best answers; the default |
| `qwen3:4b-instruct-2507-q4_K_M` | ~2.5 GB | No | Fast chat on any Apple Silicon Mac |
| `gemma3:4b` | ~3.3 GB | Yes | Small model that can look at images |

If the default isn't installed, Poppy picks the best model you do have. You can change it any time in Settings.

## Install and run

**1. Install Ollama and pull a model**

```bash
ollama pull qwen3.6:35b-a3b
```

(or one of the smaller models above). Make sure Ollama is running: the Ollama app in the menu bar, or `ollama serve` in a terminal.

**2. Optional: install Kokoro for the natural English voice**

Poppy looks for Python at `/opt/homebrew/bin/python3`, `/usr/local/bin/python3` and `/usr/bin/python3`, in that order.

```bash
python3 -m pip install kokoro-onnx
```

If pip says the environment is "externally managed" (Homebrew Python), use:

```bash
python3 -m pip install --user --break-system-packages kokoro-onnx
```

**3. Get Poppy and start him**

```bash
git clone https://github.com/michelneufeglise/poppy.git
```

```bash
cd poppy && npm install
```

```bash
npm run build && npx electron .
```

Poppy appears in the bottom-right corner of your screen and a small Poppy icon shows up in the menu bar. To stop him, use the menu-bar icon → **Quit Poppy**.

> Poppy runs from the project folder for now; there is no packaged `.app` yet.

## First start

- **Kokoro downloads its voice model once** (about 350 MB) into `~/Library/Application Support/poppy/kokoro/`. Until that's done, English replies use the Mac voice. If you already have the files (`kokoro-v1.0.onnx` and `voices-v1.0.bin`), point Poppy at their folder with `POPPY_KOKORO_DIR=/path/to/folder npx electron .` and he copies them instead.
- **The first reply takes a little longer** (about 10 seconds for a big model) while Ollama loads the model into memory. After that, replies start in about a second.

## Using Poppy

| You want to… | Do this |
| --- | --- |
| Open the chat | Click Poppy |
| Move Poppy | Drag him (or drag the chat window by its header) |
| Close the chat | The **×** in the header, or press Esc |
| Hide Poppy | The **–** in the header. Bring him back from the menu-bar icon → Show Poppy |
| Start a new conversation | The **≡** menu in the header → New chat |
| Turn the voice on or off | The **≡** menu → Voice, or the menu-bar icon |
| Open settings | The gear in the header, or the menu-bar icon → Settings… |
| Put Poppy back in the corner | Menu-bar icon → Reset position |

While Poppy works you'll see him change: *listening* while you type, *thinking* while the model works, *talking* while he speaks, and then the mood the model picked. The name of the current state is written under him in the chat window.

## Attachments

Click **attach** in the chat window, choose **Attach file…** from the ≡ menu, or simply **drag files onto the chat window**. Each file shows up as a small chip above the input; click its × to remove it. Then type your question (or nothing at all) and press Send.

| Kind | Files | What Poppy does with it |
| --- | --- | --- |
| Images | `.png .jpg .jpeg .gif .webp .bmp` | Sends the picture to the model (scaled down to at most 1600 px). The model must support images. |
| PDFs | `.pdf` | Reads the text from every page. Scanned PDFs without a text layer have no text to read. |
| Text and code | `.txt .md .csv .json .yaml .html .py .ts .js .swift .go .rs .sql` and many more | Adds the text to your message. |
| Anything else | `.zip .docx .mov` … | Refused with a short note. |

Limits: up to **5 files** per message and **20 MB** per file. Very long text is cut at about 60,000 characters per file (and 120,000 per message), and Poppy is told it was cut. For long files, Poppy asks Ollama for a bigger context window automatically.

Pictures are sent only with the message they belong to; the text of files stays part of the conversation, so you can ask follow-up questions about them.

## Voices and languages

| Language | Voice | Notes |
| --- | --- | --- |
| English | **Kokoro** (default voice `af_heart`, 16 voices to choose from) | Runs on your Mac in a small Python helper. If it fails or is too slow, that sentence falls back to a Mac voice. |
| English | Mac voice (optional) | Pick "Mac voice" as the English engine in Settings. |
| Dutch | Mac voice **Xander** | Kokoro has no Dutch. |
| Others | English route | Spoken with the English voice. |

Poppy picks the language once per reply, by looking at the reply and at your message. He speaks one sentence at a time while the reply is still coming in, so he starts talking quickly.

**Long replies.** By default Poppy reads the first ~40 words. If the rest is short he reads it too; otherwise he asks the model for a one- or two-sentence spoken wrap-up of the rest. Code blocks and tables are not read out; he just says they're on screen. Set **Long replies → Read everything** if you'd rather hear it all.

More Mac voices can be added in **System Settings → Accessibility → Spoken Content → System Voice → Manage Voices…**.

## Settings

Open them from the gear in the chat window or the menu-bar icon → Settings…. Changes are saved right away.

| Setting | What it does |
| --- | --- |
| Ollama address | Where Ollama runs. Default `http://127.0.0.1:11434`. |
| Model | Which model Poppy uses. **Refresh** reloads the list. |
| Speak replies out loud | Voice on or off. |
| Long replies | *Read the start, then a short spoken wrap-up* or *Read everything*. |
| English voice engine | Kokoro or a Mac voice. |
| Kokoro voice and speed | Which Kokoro voice, and how fast. |
| Mac voice (English) | Used for English when the engine is "Mac voice", and as the backup for Kokoro. |
| Dutch Mac voice | Default Xander. |
| Mac voice speed | Speed for all Mac voices. |
| Fall asleep after | Minutes of quiet before Poppy dozes off. Default 10. |

Settings are stored in `~/Library/Application Support/poppy/settings.json`.

## Privacy

- **Everything stays on your Mac.** Poppy only talks to the Ollama address in Settings (your own computer by default).
- The only download is Kokoro's voice model from GitHub, once, on first start.
- Files you attach are read on your Mac and sent only to your Ollama. Poppy only reads files you pick or drop yourself.
- The conversation is kept in memory only (the last 20 messages) and is gone when Poppy quits.
- No analytics, no telemetry, no accounts.

## Troubleshooting

| Problem | Try this |
| --- | --- |
| "I can't reach Ollama" | Start Ollama (open the app or run `ollama serve`) and check the address in Settings. |
| "No Ollama models are installed yet" | Run `ollama pull <model>`, then press Refresh in Settings. |
| "My model can't look at pictures" | Choose a model that supports images (see the table above). |
| Poppy uses a robotic English voice | Kokoro isn't ready: install `kokoro-onnx` (see step 2), and wait for the first download. The status shows in Settings under English. |
| No sound at all | Check that "Speak replies out loud" is on, and your Mac's volume. |
| The first reply is slow | Normal: Ollama is loading the model. Next replies are fast. |
| Poppy is gone | Menu-bar icon → Show Poppy, or Reset position. |

## For developers

### Stack

Electron + [electron-vite](https://electron-vite.org) + TypeScript, no UI framework. The page runs sandboxed with context isolation; everything that touches the system (Ollama, files, sound) happens in the main process and is reached through a small `window.poppy` bridge.

### Commands

| Command | What it does |
| --- | --- |
| `npm run dev` | Run with hot reload |
| `npm run build` | Build into `out/` |
| `npx electron .` | Start the built app |
| `npm test` | Unit tests (reply parsing, speech clean-up and language, attachment rules) |
| `npm run typecheck` | TypeScript check |
| `npm run cut-sheet` | Re-cut Poppy's poses from the emotion sheet |
| `npm run cut-chat` | Re-cut the chat window pieces from the chat-window picture |

### Project layout

```
src/
  main/        Electron main process
    index.ts       windows, menu-bar icon, chat flow, IPC
    ollama.ts      Ollama client (streaming chat, model list, image support check)
    voice.ts       speech queue: Kokoro WAVs through afplay, or the Mac's say
    kokoro.ts      talks to the Kokoro helper process
    summary.ts     spoken wrap-up for long replies
    attachments.ts reads attached files (images, PDFs, text)
    settings.ts    settings.json
  preload/     the window.poppy bridge
  renderer/    the Poppy window, the chat window and the settings window
  shared/      types and pure logic (mood tags, speech text, attachment rules)
sidecar/
  kokoro_tts.py  Kokoro text-to-speech over JSON lines on stdin/stdout
scripts/
  cut_sheet.py   cuts the 12 poses out of docs/design/emotions-sheet.jpg
  cut_chat.py    cuts the chat window pieces out of docs/design/chat-window.jpg
assets/        the cut-out drawings, the menu-bar icon and the font
docs/design/   the original drawings and the design notes
test/          unit tests (vitest)
```

### How the drawings become the app

Poppy is not redrawn in code. Every pose and every piece of the chat window is cut straight out of two hand-drawn pictures:

- [`docs/design/emotions-sheet.jpg`](docs/design/emotions-sheet.jpg): the 12 poses and their names.
- [`docs/design/chat-window.jpg`](docs/design/chat-window.jpg): the chat window, header, speech bubbles, input and Send button.

The Python scripts in `scripts/` (OpenCV) cut each piece out, make the paper see-through and save PNGs into `assets/`. The window frame, bubbles and input are stretched with CSS `border-image` (9-slice), so the pencil lines keep their shape at any size. Animation only moves whole images (a bob, a hop, a crossfade); it never changes the drawings. Design notes are in [`docs/design/poppy-character.md`](docs/design/poppy-character.md).

<p align="center"><img src="docs/design/emotions-sheet.jpg" alt="The emotion sheet with Poppy's 12 poses" width="520"></p>

### How a reply works

1. Your message (plus any files) goes to Ollama with a short system prompt that asks the model to start with a mood tag like `[happy]`.
2. The reply streams in. Poppy strips the mood tag, any `<think>` blocks, markdown and emoji for the bubble, and switches to the mood's drawing.
3. Finished sentences go to the speech queue straight away. Kokoro renders two sentences ahead, so there are no gaps between them.

## Roadmap

- **Memory:** remember conversations and facts about you between sessions (SQLite with local embeddings).
- **Reflection:** a quiet nightly pass where Poppy tidies up what he learned.
- **Co-worker tools:** help with Mail and files in folders you allow, always asking before he sends, moves or deletes anything.
- **Voice input:** talk to Poppy instead of typing.
- **A real `.app`** you can drag into Applications.

## License and credits

- **Code:** [MIT](LICENSE).
- **Drawings:** the Poppy character and all drawings and pictures (`docs/design/`, `docs/screenshots/`, `assets/states/`, `assets/chat/`, `assets/tray/`) are © 2026 Michel Neufeglise, **all rights reserved**. You may run Poppy with them for personal use, but please don't reuse the character or drawings elsewhere. If you build on this code, draw your own buddy! Details in [LICENSE](LICENSE).
- **Font:** [Patrick Hand](https://fonts.google.com/specimen/Patrick+Hand) by Patrick Wagesreiter, SIL Open Font License 1.1 ([`assets/fonts/OFL.txt`](assets/fonts/OFL.txt)).
- **Voice:** [Kokoro-82M](https://huggingface.co/hexgrad/Kokoro-82M) by hexgrad, run through [kokoro-onnx](https://github.com/thewh1teagle/kokoro-onnx) by thewh1teagle.
- **PDF reading:** [pdf.js](https://mozilla.github.io/pdf.js/) by Mozilla.
- **Speech pipeline:** the voice handling (language detection, read-along and spoken wrap-up) is adapted from Persephone, an earlier assistant project by the same author.
