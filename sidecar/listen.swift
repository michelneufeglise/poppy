// Poppy's ears: Apple's SpeechAnalyzer + SpeechTranscriber (macOS 26), which run on this Mac only with
// Apple's on-device speech models (downloaded once per language through macOS). No audio leaves the Mac,
// and it works with Siri and Dictation turned off. It turns the microphone into text as you speak; the app
// looks for "Poppy"/"Polly" in that text and takes the question after it (src/main/listen.ts).
//
// JSON lines on stdin:  {"cmd":"check","locale":"en-US"}   microphone access + language support, never asks
//                       {"cmd":"listen","locale":"en-US","hints":["Polly"]}
//                                                          asks for the microphone the first time, then listens;
//                                                          hints: words to expect (the name)
//                       {"cmd":"reset"}                    start a fresh transcript (keeps listening)
//                       {"cmd":"pause"}                    stop the microphone
// JSON lines on stdout: {"type":"check",…} {"type":"downloading"} {"type":"listening"} {"type":"paused"}
//                       {"type":"reset"} {"type":"text","text":"…"} {"type":"error","code":"…","message":"…"}
//                       {"type":"note","message":"…"} (the recognizer had a problem)
// "text" is everything heard since the last reset.
//
// Built by src/main/listen.ts with swiftc, with an Info.plist inside the binary for the microphone text.
// `--file <audio>` plays a file (once, in real time, then silence) instead of the microphone, for tests.
import AVFoundation
import CoreMedia
import Foundation
import Speech

/// With POPPY_LISTEN_DEBUG set (Poppy passes its environment on), each step of starting is reported.
let debugging = ProcessInfo.processInfo.environment["POPPY_LISTEN_DEBUG"] != nil
func step(_ what: String) {
  if debugging { emit(["type": "note", "message": what]) }
}

func emit(_ obj: [String: Any]) {
  guard let data = try? JSONSerialization.data(withJSONObject: obj), let line = String(data: data, encoding: .utf8) else { return }
  FileHandle.standardOutput.write((line + "\n").data(using: .utf8)!)
}

struct Fail: Error {
  let code: String
  let message: String
}

func micStatus() -> String {
  switch AVCaptureDevice.authorizationStatus(for: .audio) {
  case .authorized: return "authorized"
  case .denied: return "denied"
  case .restricted: return "restricted"
  default: return "notDetermined"
  }
}

/// How much audio went to the analyzer (its timeline), counted from the audio thread.
final class Fed: @unchecked Sendable {
  private let lock = NSLock()
  private var s = 0.0
  func add(_ d: Double) {
    lock.lock()
    s += d
    lock.unlock()
  }
  var seconds: Double {
    lock.lock()
    defer { lock.unlock() }
    return s
  }
}

/// Converts the microphone's (or file's) audio to the format the analyzer wants.
func convert(_ buf: AVAudioPCMBuffer, with conv: AVAudioConverter) -> AVAudioPCMBuffer? {
  let fmt = conv.outputFormat
  let cap = AVAudioFrameCount(Double(buf.frameLength) * fmt.sampleRate / buf.format.sampleRate + 1024)
  guard let out = AVAudioPCMBuffer(pcmFormat: fmt, frameCapacity: cap) else { return nil }
  var given = false
  var err: NSError?
  conv.convert(to: out, error: &err) { _, status in
    if given {
      status.pointee = .noDataNow
      return nil
    }
    given = true
    status.pointee = .haveData
    return buf
  }
  return err == nil && out.frameLength > 0 ? out : nil
}

@available(macOS 26.0, *)
@MainActor
final class Ears {
  let file: URL?
  var locale = ""
  var analyzer: SpeechAnalyzer?
  var input: AsyncStream<AnalyzerInput>.Continuation?
  var format: AVAudioFormat?
  var reader: Task<Void, Never>?
  let engine = AVAudioEngine()
  var feeding = false
  var feeder: DispatchSourceTimer?
  var filePlayed = false
  let fed = Fed()
  /// Results that end before this (seconds on the analyzer's timeline) belong to an earlier transcript.
  var cutoff = 0.0
  var hints: [String] = []
  var finals = ""
  var volatile = ""

  init(file: URL?) { self.file = file }

  func check(_ id: String) async {
    let supported = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: id))
    let installed = await SpeechTranscriber.installedLocales.contains { $0.identifier(.bcp47) == supported?.identifier(.bcp47) }
    emit([
      "type": "check", "locale": id, "available": SpeechTranscriber.isAvailable, "supported": supported != nil,
      "installed": installed, "mic": file == nil ? micStatus() : "authorized",
    ])
  }

  func listen(_ id: String, hints: [String]) async {
    step("listen: asking for the microphone")
    if file == nil {
      guard await AVCaptureDevice.requestAccess(for: .audio) else {
        return emit(["type": "error", "code": "mic-denied", "message": "The microphone isn't allowed. Turn on Poppy under System Settings → Privacy & Security → Microphone."])
      }
    }
    do {
      if id != locale || analyzer == nil { try await setUp(id) }
      if hints != self.hints, let analyzer {
        // Without this, "Polly" from a laptop microphone often comes out as "Holly".
        let ctx = AnalysisContext()
        ctx.contextualStrings[.general] = hints
        try await analyzer.setContext(ctx)
        self.hints = hints
      }
      step("listen: starting over")
      await startOver()
      step("listen: starting audio")
      try startAudio()
      emit(["type": "listening"])
    } catch let f as Fail {
      emit(["type": "error", "code": f.code, "message": f.message])
    } catch {
      emit(["type": "error", "code": "start", "message": "Listening didn't start: \(error.localizedDescription)"])
    }
  }

  private func setUp(_ id: String) async throws {
    await tearDown()
    guard SpeechTranscriber.isAvailable else {
      throw Fail(code: "unavailable", message: "Apple's speech recognition isn't available on this Mac.")
    }
    guard let loc = await SpeechTranscriber.supportedLocale(equivalentTo: Locale(identifier: id)) else {
      throw Fail(code: "no-locale", message: "This Mac has no speech recognition for \(id).")
    }
    let transcriber = SpeechTranscriber(locale: loc, transcriptionOptions: [], reportingOptions: [.volatileResults], attributeOptions: [.audioTimeRange])
    let installed = await SpeechTranscriber.installedLocales.contains { $0.identifier(.bcp47) == loc.identifier(.bcp47) }
    if let request = try await AssetInventory.assetInstallationRequest(supporting: [transcriber]) {
      if !installed { emit(["type": "downloading"]) } // Apple's speech model for this language, once
      try await request.downloadAndInstall()
    }
    guard let fmt = await SpeechAnalyzer.bestAvailableAudioFormat(compatibleWith: [transcriber]) else {
      throw Fail(code: "format", message: "Apple's speech recognition gave no audio format.")
    }
    let analyzer = SpeechAnalyzer(modules: [transcriber])
    let (stream, cont) = AsyncStream<AnalyzerInput>.makeStream()
    try await analyzer.start(inputSequence: stream)
    self.analyzer = analyzer
    input = cont
    format = fmt
    locale = id
    reader = Task { [weak self] in
      do {
        for try await r in transcriber.results { self?.got(r) }
      } catch {
        emit(["type": "note", "message": error.localizedDescription])
      }
    }
  }

  private func tearDown() async {
    stopAudio()
    input?.finish()
    await analyzer?.cancelAndFinishNow()
    reader?.cancel()
    analyzer = nil
    input = nil
    reader = nil
    locale = ""
    hints = []
  }

  private func got(_ r: SpeechTranscriber.Result) {
    if r.range.end.seconds <= cutoff + 0.05 { return }
    let text = String(r.text.characters).trimmingCharacters(in: .whitespaces)
    if r.isFinal {
      finals = [finals, text].filter { !$0.isEmpty }.joined(separator: " ")
      volatile = ""
    } else {
      volatile = text
    }
    // settled: nothing is still being guessed at (the recognizer finished what it heard so far).
    if feeding {
      emit(["type": "text", "text": [finals, volatile].filter { !$0.isEmpty }.joined(separator: " "), "settled": volatile.isEmpty])
    }
  }

  /// A fresh transcript: what was being said is finalized and dropped.
  func startOver() async {
    let now = fed.seconds
    if let analyzer, now > 0 {
      // Everything it has so far (nil), never a time it may not have reached: with the microphone
      // paused that waited forever. And never longer than 2 seconds.
      await withTaskGroup(of: Void.self) { group in
        group.addTask { try? await analyzer.finalize(through: nil) }
        group.addTask { try? await Task.sleep(for: .seconds(2)) }
        await group.next()
        group.cancelAll()
      }
    }
    cutoff = now
    finals = ""
    volatile = ""
  }

  private func startAudio() throws {
    guard !feeding, let format, let input else { return }
    let fed = self.fed
    let push = { (buf: AVAudioPCMBuffer, conv: AVAudioConverter) in
      guard let out = convert(buf, with: conv) else { return }
      fed.add(Double(out.frameLength) / format.sampleRate)
      input.yield(AnalyzerInput(buffer: out))
    }
    if let file {
      let audio = try AVAudioFile(forReading: file)
      if filePlayed { audio.framePosition = audio.length } // once per run; after that only silence
      filePlayed = true
      let src = audio.processingFormat
      guard let conv = AVAudioConverter(from: src, to: format) else { throw Fail(code: "audio", message: "Can't convert the test file.") }
      let chunk = AVAudioFrameCount(src.sampleRate / 10)
      let timer = DispatchSource.makeTimerSource(queue: .main)
      timer.schedule(deadline: .now(), repeating: .milliseconds(100))
      timer.setEventHandler {
        guard let buf = AVAudioPCMBuffer(pcmFormat: src, frameCapacity: chunk) else { return }
        if audio.framePosition < audio.length { try? audio.read(into: buf, frameCount: chunk) }
        if buf.frameLength == 0 { // the file is over: silence
          buf.frameLength = chunk
          if let ch = buf.floatChannelData { for c in 0..<Int(src.channelCount) { ch[c].update(repeating: 0, count: Int(chunk)) } }
        }
        push(buf, conv)
      }
      timer.resume()
      feeder = timer
    } else {
      let node = engine.inputNode
      let src = node.outputFormat(forBus: 0)
      guard src.channelCount > 0, let conv = AVAudioConverter(from: src, to: format) else {
        throw Fail(code: "audio", message: "No microphone found.")
      }
      node.installTap(onBus: 0, bufferSize: 4096, format: src) { buf, _ in push(buf, conv) }
      engine.prepare()
      try engine.start()
    }
    feeding = true
  }

  private func stopAudio() {
    guard feeding else { return }
    feeder?.cancel()
    feeder = nil
    if file == nil {
      engine.inputNode.removeTap(onBus: 0)
      engine.stop()
    }
    feeding = false
  }

  func pause() {
    stopAudio()
    emit(["type": "paused"])
  }
}

// macOS asks for the microphone on behalf of the "responsible" app, which would be the terminal (or
// Electron) that started Poppy. So the helper first starts itself again, disclaimed: then it is
// responsible for itself, macOS asks for "Poppy" (this binary's Info.plist), and the answer sticks to
// this helper no matter how Poppy was started. (Same trick Chromium and terminal apps use.)
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attr: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

var child: pid_t = 0
if ProcessInfo.processInfo.environment["POPPY_LISTEN_OWN"] == nil {
  var attr: posix_spawnattr_t?
  posix_spawnattr_init(&attr)
  _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
  setenv("POPPY_LISTEN_OWN", "1", 1)
  let path = Bundle.main.executablePath ?? CommandLine.arguments[0]
  let args = CommandLine.arguments.map { strdup($0) } + [nil]
  if posix_spawn(&child, path, nil, &attr, args, environ) == 0 {
    for sig in [SIGTERM, SIGINT, SIGHUP] {
      signal(sig) { s in
        kill(child, s)
        exit(0)
      }
    }
    var status: Int32 = 0
    waitpid(child, &status, 0)
    exit((status >> 8) & 0xff)
  }
  // Couldn't start itself again: carry on as is (macOS then asks for the app that started Poppy).
}

guard #available(macOS 26.0, *) else {
  emit(["type": "error", "code": "macos", "message": "Voice input needs macOS 26 or newer."])
  exit(1)
}

var fileArg: URL?
if let i = CommandLine.arguments.firstIndex(of: "--file"), i + 1 < CommandLine.arguments.count {
  fileArg = URL(fileURLWithPath: CommandLine.arguments[i + 1])
}
let ears = MainActor.assumeIsolated { Ears(file: fileArg) } // top-level code runs on the main thread

// Commands come in on a background thread and run one at a time on the main actor.
let (commands, sendCommand) = AsyncStream<[String: Any]>.makeStream()
Thread.detachNewThread {
  while let line = readLine() {
    if let data = line.data(using: .utf8), let msg = (try? JSONSerialization.jsonObject(with: data)) as? [String: Any] {
      sendCommand.yield(msg)
    }
  }
  exit(0) // stdin closed: the app is gone
}
Task { @MainActor in
  for await msg in commands {
    let locale = msg["locale"] as? String ?? "en-US"
    switch msg["cmd"] as? String {
    case "check": await ears.check(locale)
    case "listen": await ears.listen(locale, hints: msg["hints"] as? [String] ?? [])
    case "reset":
      await ears.startOver()
      emit(["type": "reset"]) // what comes after this is from the fresh transcript
    case "pause": ears.pause()
    case "quit": exit(0)
    default: break
    }
  }
}
dispatchMain()
