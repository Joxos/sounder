# Key & Speed Changer — Product/Feature Research Report

**Use case:** creative/experimental audio manipulation (「有些音乐，降调升调、降速升速就别有风味」) — shifting a song's key and/or speed to produce a *different flavour*, not karaoke key-matching.
**Date:** 2026-09. Research only, no code.

---

## 0. Executive summary — the 6 things that matter most

1. **All three products you named are dead or pivoted.** `musictimetuner.com` does not resolve (DNS NXDOMAIN, verified by direct fetch). `180by2.com` cross-origin-redirects to `180by2.co.za`, which is now a smart-glasses / AR-VR company. `tunesplit.com` is now *"The royalty back-office for distributors, labels, and publishers"* — the karaoke key-shift product is discontinued. **Conclusion: there is no incumbent. Do not plan around cloning one.**

2. **The real competitor set is the "slowed + reverb" genre toolbox, not the DAWs.** [soundtools.io](https://soundtools.io/) ships ~30 single-purpose tools; [pitchchanger.io](https://pitchchanger.io/) does the same with a content site in 30 languages. These are the products real users actually open. DAWs are reference points for *ranges and DSP*, not for *UX*.

3. **Every existing tool gives you a 1-D diagonal through (key, speed) space. The wedge is the 2-D plane.** The genre tools all do the naive rate change (speed up ⇒ pitch rises for free) and expose **no independent key control at all**. soundtools.io's slowed+reverb page explicitly tells you the falling pitch is the point, then contradicts itself a few paragraphs later. Nobody lets you do "0.85× speed **and** −3 semitones." That combination is the product.

4. **A major Chinese music app already shipped exactly the user's quote, as a listening feature — but not as a download tool.** KuGou (酷狗音乐) added **调速/升降调** to its player in Nov 2022, speed range **0.5×–1.5×**, plus key shift, plus **per-track curated recommendations**. The launch copy literally says listening at 0.8× to certain tracks is "崭新听感犹如打开了新世界大门" and lists 搞怪/鬼畜 (meme/weird) as a use case. Sources: [baijiahao](https://baijiahao.baidu.com/s?id=1749728108027565118), [百度经验 nav path](https://jingyan.baidu.com/article/fec4bce28250c0b3618d8b94.html). **The demand is validated. The gap is that KuGou plays it and you can't download it, can't batch it, can't get ±12 semitones, and can't do anything but the coupled change.**

5. **The single best UX reference in the market is [lacuna.fm](https://www.lacuna.fm/zh-TW/song-key-changer)** (Chinese, traditional). It auto-detects the original key so you pick a *target key* instead of guessing semitones; it warns you when you cross into audible-artifact territory; it updates live preview while you drag; it runs client-side with no signup, no watermark, 50 MB. Copy this.

6. **Best technical starting point for a browser build is [cutterbl/SoundTouchJS](https://github.com/cutterbl/SoundTouchJS) (MPL-2.0).** It is an AudioWorklet port of SoundTouch with `pitch` / `pitchSemitones` / `playbackRate` as native `AudioParam`s (click-free live changes), a phase-vocoder package for extreme ratios, an **LPC-based formant-correction worklet**, and `processOffline()` for full-file render. Rubber Band's WASM build exists but Rubber Band is **GPL** — a proprietary web app must buy a commercial licence.

---

## A. Product survey

### A.1 The three named products

| Product | Status (verified 2026-09) | Notes |
|---|---|---|
| **Music Time Tuner** ([musictimetuner.com](https://musictimetuner.com/)) | **DEAD.** `getaddrinfo ENOTFOUND musictimetuner.com` on direct fetch. | Was a free browser-based speed/pitch changer. |
| **180by2** ([180by2.com](https://180by2.com/)) | **DEAD as a music tool.** Fetches cross-origin-redirect to `180by2.co.za`, now "Smart Glasses, AR/VR & 360° Cameras". | Was a well-known free online music time/pitch changer. |
| **TuneSplit** ([tunesplit.com](https://tunesplit.com/)) | **PIVOTED.** Page title: "TuneSplit — The royalty back-office for distributors, labels, and publishers". | Was a karaoke-style key-shift + vocal-suppression web service. The pivot is itself the market signal: *karaoke key matching does not pay.* Your creative framing is the better commercial bet. |

**Read:** the key-shift-in-browser market has consolidated around (a) genre-specific single-purpose tools, (b) local/everything-in-one tool suites, (c) Chinese-language tool suites. There is a clear opening for one *well-made, bilingual, general* key+speed instrument.

### A.2 The genre toolbox — the actual competitors

#### [soundtools.io](https://soundtools.io/) — the volume leader
~30 tools, all browser-based, all claiming "works in your browser / your audio is never uploaded", no account, no watermark. Relevant tools: `slowed-reverb`, `nightcore`, `nightcore-reverse`, `tiktok-slowed`, `vaporwave`, `sped-up`, `pitch-shifter`, `tempo-changer`, `bpm-detector`, `vaporwave`, `granular-synthesizer`.

| Tool | Controls & concrete ranges | Source |
|---|---|---|
| **Slowed + Reverb** | Presets: **TikTok Slowed = 80% speed + medium reverb**, **Nightcore Reverse = 75% speed + light reverb**, **Vaporwave = 65% speed + heavy reverb**. Custom: speed **50–100%**, reverb **0–200%**. Spacebar preview. "Most audio files process in under 30 seconds… large files typically complete within a minute." | [slowed-reverb](https://soundtools.io/slowed-reverb/) |
| **Pitch Shifter** | **−12 to +12 semitones**, key-name readout (`C → C`), ±1 "half step" buttons, Custom slider. Downloads in the **same format as input** (MP3/WAV/FLAC/AAC/OGG). | [pitch-shifter](https://soundtools.io/pitch-shifter/) |
| **Tempo Changer** | **50%–200%**, presets 75% / 50% / 125%, **plus auto-detected BPM with a linked BPM slider** (drag BPM 128→140 and the % slider shows 109.4%), with **÷2 / ×2 buttons to correct an octave detection error**. | [tempo-changer](https://soundtools.io/tempo-changer/) |

**Good UX:** linked % ↔ BPM sliders; explicit octave-correction buttons (they openly admit "every detector on earth occasionally lands an octave off"); processing-time expectation stated up front ("under 30 seconds"); "downloads in the same format you uploaded"; spacebar transport.
**Bad UX:** a slow+reverb page that says *"Yes! Our tool slows down the audio while preserving the original pitch, so the song doesn't sound lower or 'chipmunk-like'"* — which is the **opposite** of the slowed+reverb sound the same page describes. Never claim "no chipmunk" on a genre page.
**Bad UX:** the very useful "±1-3 semitones excellent / ±6-12 slight artifacts" guidance lives in the SEO body copy, not in the tool UI.

#### [pitchchanger.io](https://pitchchanger.io/) — the best *content*, and the best numbers
Localized into 30 languages including **zh, zh-TW, ja, ko, ru, ar, he, ur** — a strong signal that internationalising is table stakes. Client-side, no signup. The most useful "flavor recipe" numbers in the whole research:

- **Slowed + reverb:** speed **0.80×–0.90×**, start at **0.85×**; reverb mix **20%–40%** (start **25–35%**); **hall before cathedral**; add **pre-delay** when consonants lose definition; brighten the room / add damping when low mids turn to mud. ("At 0.85×, a 120 BPM track plays near 102 BPM and drops by about **2.8 semitones**.")
- **Nightcore:** **1.20×–1.30×**; preset starts at 1.30× but drop it if the voice goes thin or sibilants get harsh; *"if the hook is exciting at 1.22× and annoying at 1.30×, the lower value is the better edit."*
- **Daycore** is just the slowed half (slow + pitch drop). Reverb optional.
- Framing to steal: *"That falling pitch is not a defect to correct. It is a central part of the style."*

Sources: [how-to-make-slowed-and-reverb](https://pitchchanger.io/how-to-make-slowed-and-reverb) (EN), [中文版](https://pitchchanger.io/zh/how-to-make-slowed-and-reverb), [nightcore-maker](https://pitchchanger.io/zh/nightcore-maker).

#### Chrome extension: SlowedAndReverb.Studio
[Chrome Web Store listing](https://chromewebstore.google.com/detail/slowedandreverbstudio/flphhdfbcpebbehnmphjoaoffhgcjafi) — proves there is repeat demand inside the browser itself, and that "no upload" is the selling point. Listing content was behind a JS wall; not fully readable.

#### [lacuna.fm](https://www.lacuna.fm/zh-TW/song-key-changer) — **the UX benchmark**
Chinese (traditional), Taiwanese, with a whole tool suite. The best-designed key tool found anywhere in this research:
- **Detects the original key on load so you pick a target, not a delta:** 「拖一首曲子進來。它會先讀出原調，這樣你可以直接挑想要的調，而不用猜該移幾個半音。」
- **Three ways to say the same thing:** semitone stepper / direct target key picker / pick a vocal range (bass, baritone, tenor, contralto, mezzo, soprano). Their justification is the best one-liner in this report: 「別的工具都在問你需要移幾個半音——而這恰好是唱歌的人答不出來的問題。」 ("Other tools ask how many semitones — which is exactly the question a singer can't answer.")
- **±12 semitones.**
- **Honest artifact warning:** 「小幅移動乾淨俐落；一旦進到拉伸痕跡聽得出來的區間，工具會提醒你。」 ("Small moves are clean; once you enter the range where stretch artifacts are audible, the tool warns you.")
- **Live preview follows the control, no re-compute between attempts:** 「你移動控制項時試聽會跟著更新——兩次嘗試之間不用重新算一遍。」
- **Client-side, 50 MB cap, no upload, no signup, no watermark, no queue, MP3 or full-quality WAV.**
- Suite also has `bpm-key-finder`, `audio-speed-changer`, **`audio-looper`**, `syllable-counter`, `stem-splitter`, `mp3-tag-editor`.

#### [KeyAndBPM](https://keyandbpm.com/) — the cautionary tale
"Speed & Pitch Changer". 12 languages incl. 简体/繁體中文. **"Adjust pitch by up to ±6 semitones"**, pitch-preserving-tempo, free, no registration. Four steps, no exceptions: **Upload → Adjust Pitch → Process Audio → Download.** Marketing claims "Lightning Fast — process your audio files in seconds".
**Every anti-pattern in one page:** you cannot hear anything before you commit to a server-side render; the pitch slider is a bare continuous range with no semitone stepping, no key readout, no artifact warning, no A/B; it uploads your file to their server; and ±6 semitones is a hard cap that is too small for the creative use case.

#### Other 变速/变调 web tools seen in search results (not deeply fetched; existence confirmed)
[rtcd.io/zh-cn/audio-pitch-shifter](https://rtcd.io/zh-cn/audio-pitch-shifter/), [artplayer.org/zh-CN/pitch-changer](https://artplayer.org/zh-CN/pitch-changer/), [elysiatools.com/zh/tools/audio-time-stretch-pitch](https://elysiatools.com/zh/tools/audio-time-stretch-pitch), [stemsplit.io/pitch-changer](https://stemsplit.io/pitch-changer) (Cloudflare-blocked), [tool.yolo813.com](https://tool.yolo813.com/en/audio-tool/audio-speed-pitch-adjuster) (Cloudflare-blocked), [pitchchanger.io/audio-speed-changer](https://pitchchanger.io/zh/audio-speed-changer).
**Pattern across all of them: the pitch shifter and the speed changer are separate pages.** That separation is the incumbents' structural weakness and your opening.

### A.3 Chinese market

| Product | What it actually offers | Source |
|---|---|---|
| **酷狗音乐 (KuGou)** | Player page → 菜单栏/更多 → **调速/升降调**. Speed **0.5×–1.5×**. Added **变调** (key shift) on top of the previous speed-only function. **Curated per-track recommendations** so indecisive users can jump to a good version. Stated use cases: sleep music, exercise/dance, karaoke key matching, and explicitly 搞怪/鬼畜 (meme/weird). The launch article's framing is *verbatim* your user's quote: 用0.8倍速听歌…「崭新听感犹如打开了新世界大门」. Example given: 降调 on Tanya Chua's *Letting Go* turns the bright female vocal into 「一股较为沧桑的质感」. | [baijiahao](https://baijiahao.baidu.com/s?id=1749728108027565118) · [百度经验 (nav path)](https://jingyan.baidu.com/article/fec4bce28250c0b3618d8b94.html) |
| 酷狗 变调器 / **Pitchwheel** plugin | KuGou ecosystem ships a "key changer" app feature and a third-party **Pitchwheel** accompaniment-key plugin. | [ZOL: Pitchwheel 怎么用](https://xiazai.zol.com.cn/baike/551720.shtml) |
| 网易云音乐 | 慢速播放 (slow playback) — a speed control, typically the coupled kind, playback-only. | [sm.cn 教程](https://page.sm.cn/blm/midpage-317/index?id=10_f87453592ffd96b7b7441a5657ff894d) |
| QQ音乐 / 全民K歌 | 调性 (key) selection inside the karaoke flow — this is the karaoke-parallel-key pattern, semitone-based. | [全民K歌 调音 教程](https://www.php.cn/faq/892778.html) |
| 唱吧 (Changba) | Karaoke 变调 (key shift) in the recording/performance flow. No authoritative numeric range found publicly. | — |

**The differentiation opening in the Chinese market:** every one of these is **playback-only**. None of them exports a file, none of them offers an independent key axis, none of them go past 1.5×, and none of them let you render "0.8× **and** −3 semitones." For the creative "flavour" use case, Chinese tools are structurally weak.

### A.4 DAW / pro-audio reference — concrete standard controls

#### Audacity 3 (legacy, still the reference for its numbers)
- **Change Speed and Pitch** — Speed Multiplier **0.010 to 50.000**; Percent Change **−99.000% to +4900.000%**; out-of-range values grey out the OK and Preview buttons. Also: Standard Vinyl RPM (from-rpm → to-rpm dropdowns), Current Length / New Length. Note the doc's own tip: *"If you need to change the speed and pitch independently you can use the Clip context menu. But note that this applies to an entire clip, not a selection or a track."* → [manual.audacityteam.org/man/change_speed.html](https://manual.audacityteam.org/man/change_speed.html)
- **Change Tempo** — linked **Percent Change / BPM / Length** fields; a **"Use high quality stretching (slow)"** checkbox that switches to the **SBSMS** algorithm. Documented limitations: the default fast algorithm *"may remove some audio from the start or end of the selection"*, *"may sometimes sound echoey, especially when slowing down percussive music"*, and the high-quality option is *"only suitable for small to moderate tempo changes"* and *"will deteriorate very badly for extreme changes"* → use **Paulstretch** instead. → [change_tempo.html](https://manual.audacityteam.org/man/change_tempo.html)
- **Paulstretch** — extreme slow-down without pitch change. **Stretch Factor** (10 ⇒ 1 min becomes ~10 min) and **Time Resolution**; *"Usually, a value of 0.25 seconds is good for most music. Very large values (greater than 2 seconds) can be used for special effects such as 'smearing' a song into a sound-texture."* Small values = good time resolution, poor frequency resolution. → [paulstretch.html](https://manual.audacityteam.org/man/paulstretch.html)

#### Audacity 4 (new pitch/tempo UI — worth copying the *information architecture*)
- **Change Pitch** dialog exposes all four linked representations at once: **Estimated start pitch** (auto-detected note+octave), **From pitch / To pitch** (note + octave), **Semitones**, **Cents**, **From frequency / To frequency** (Hz), **Percentage change** (slider + numeric), and **"Use high quality stretching (slow)"**. All fields stay in step; you type into whichever one suits the job. The doc explicitly warns the pitch estimate "on material that is not a clear sustained note it can land on the wrong octave" and tells you to correct *From pitch* by hand because everything is measured from it. → [audacityteam.org/manual/…/change-pitch](https://www.audacityteam.org/manual/effects/pitch-and-tempo/change-pitch/)
- **Sliding Stretch** — ramps rather than constants. **Initial/Final tempo change: −90% to +500%** (percent). **Initial/Final pitch shift: −12 to +12 semitones**, or **−50% to +100%** (percent). *"This is the effect that replaces Audacity 3's Change Tempo and Change Speed."* → […/sliding-stretch](https://www.audacityteam.org/manual/effects/pitch-and-tempo/sliding-stretch/)

#### Ableton Live — warp modes (the "creative" mental model)
| Mode | What it's for | Source |
|---|---|---|
| **Beats** | rhythmic accuracy, transient-warped; good for groove | [Garnish / Ableton Advanced](https://edu.garnishmusicproduction.com/ableton-advanced-granular-creative-time-stretching/) |
| **Tones** | tonal accuracy on monophonic material (bass, lead) | same |
| **Texture** | polyphonic/noisy; **grain size** + **flux** knobs for granular sound-design | same |
| **Repitch** | **"Turntable mode"** — changes pitch and tempo together. *"Great for pitch-shifted vocal effects and tape-stop-like effects."* ← this is exactly the coupled "vinyl" mode the genre uses | same |
| **Complex / Complex Pro** | full tracks; Complex Pro is higher quality, more CPU | same |
Plus **Transpose**, **Detune**, **Formant** parameters. Formant: *"At 100%, the original formants will be preserved, which allows for large changes in transposition while maintaining the sample's original tonal quality"* (range runs 0–200%, 100% = neutral). Envelope: *"128 should work well for most audio."* The article's framing line is worth stealing verbatim for your own copy: **"Warp modes are granular engines. Used deliberately they are a sound design tool, not a correction."**

#### REAPER
- Item **playrate** is the model: a rate control with a **preserve-pitch** toggle, decoupled from the take's pitch.
- Concrete, verified: the ReaScript API documents take pitch as **semitones, −12 = octave down, 0 = normal, +12 = one octave up** (`D_PITCH`). → [reaper.fm/sdk/reascript/reascripthelp.html](https://www.reaper.fm/sdk/reascript/reascripthelp.html)
- ⚠️ **Verification gap:** I could **not** fetch a primary REAPER source for the numeric playrate slider range or the exact "stretch/splice/preserve-pitch" sub-mode names. `reaper.fm/docs/*` returns 404, `wiki.reaper.fm` fails DNS, the Cockos wiki and forums are behind bot-checks, and the user-guide PDFs 404/redirect. **Verify the exact REAPER numbers in-app before quoting them.** Do not propagate a "±4 octaves" figure from memory into any user-facing copy.

#### Rubber Band (the DSP quality reference)
- **GPL**, or a commercial licence from Breakfast Quay — including a hard constraint you must design around: *"you may not legally distribute through any Apple App Store unless you have a commercial licence."*
- CLI: `-t/--time X` (duration ratio) · `-T/--tempo X` · `-p/--pitch X` (**semitones**) · `-f/--frequency X` · `-n/--crisp N`.
- **Two engines:** **R2 (Faster)** and **R3 (Finer)**. R3 *"produces higher-quality results than R2 for most material, especially complex mixes, vocals and other sounds that have soft onsets and smooth pitch changes, and music with substantial bass content"* — at much higher CPU cost. R2 is the default for backward compat.
- **Crispness `-c 0..6`, default 4:** `0 = --no-transients --no-peaklock --window-long` · `1 = --no-transients --no-peaklock` · `2 = --no-transients` · `3 = --bl-transients` · `4 = default` · `5 = --no-peaklock --window-short` (**"may be suitable for drums"**).
- Other flags that map directly to the knobs you may want in the UI: `-P/--precise` (minimal time distortion), `-R/--realtime`, `--no-transients` (disable phase resync at transients), `--bl-transients` (band-limit phase resync to extreme frequencies), `--no-peaklock` (disable phase locking to peak frequencies), `--no-softening`, `--window-long/--window-short`, `--thresh N F`.
- → [README](https://github.com/breakfastquay/rubberband) · [`rubberband(1)` man page](https://manpages.ubuntu.com/manpages/focal/man1/rubberband.1.html)

#### SoundTouch (the "fast" tier)
- Clean three-way concept split worth copying into your own UI vocabulary: **Tempo** (time-stretch, pitch preserved) · **Pitch** (key, tempo preserved) · **Playback Rate** (both together, *"as if a vinyl disc was played at different RPM rate"*).
- **LGPL v2.1**, commercial alternative available. Real-time, input/output latency max **~100 ms**.
- Known behaviour to design around: it processes *"in batches of few tens of milliseconds"*, so a single `putSamples` call may return nothing and the next may return more than you fed — you must loop `receiveSamples` until it returns zero. Output length = input / (tempo_change × rate_change).
- → [surina.net/soundtouch](https://www.surina.net/soundtouch/) · [FAQ](https://www.surina.net/soundtouch/faq.html)

#### Key/BPM detection as a standard control
- [glittercowboy/bpm-key-finder](https://github.com/glittercowboy/bpm-key-finder) (MIT, browser): BPM via low-pass → peak detection → most-common interval; key via **Krumhansl–Schmuckler** chroma correlation against major/minor profiles; **Camelot wheel** for harmonic-mixing compatibility; **tap tempo** fallback; localStorage history.
- The same detection idea is commercialised by [lacuna.fm/bpm-key-finder](https://www.lacuna.fm/zh-TW/bpm-key-finder) and [theghostproduction.com/song-key-finder](https://theghostproduction.com/song-key-finder/).

---

## B. UX patterns worth copying

### B.1 Semitone-stepped keyboard vs. continuous slider → **do both, tied together**
- **Stepped is the primary.** Every well-made tool snaps to semitones. KeyAndBPM's bare continuous slider is the negative example.
- **A piano keyboard is the best input affordance found.** It is *self-labelling* (you click D♭, you get D♭), it makes ±12 the obvious range, and it makes the octave wrap legible. The detected original key can be highlighted on the keyboard at load.
- **Keep a continuous fine control underneath, in cents.** Audacity 4's linked Semitones / Cents / Hz / % set is the reference, but the *consumer* version should show only **semitones + key names**, with Hz/cents behind an "advanced" disclosure.
- **The killer feature lacuna.fm has and nobody else does: express the shift three ways simultaneously** — semitone stepper, target-key picker, and a **voice-range picker** (baritone / tenor / alto / soprano …). Their argument is perfect and applies to the creative case too: the user does not think in semitones, they think in "make it deeper / make it faster / make it weird."
- **Show the derived pitch in coupled mode as a live secondary readout, not a control.** pitchchanger.io does this math explicitly (0.85× ⇒ 120 BPM becomes 102 BPM, **−2.8 semitones**). When the user drags speed in "vinyl" mode, the key readout updates itself to show the consequence. That teaches the relationship instead of hiding it.

### B.2 Preset "flavours" → **ship these, and print the numbers on the chips**
The genre has already converged on specific values. Steal them verbatim and show the parameters on the chip so users learn the mapping rather than being blocked by it:

| Preset | Speed | Key | Reverb | Source |
|---|---|---|---|---|
| Slowed + Reverb (the canonical) | **0.85×** (range 0.80–0.90) | 0 (coupled pitch drop) | **25–35%** hall, with pre-delay | [pitchchanger.io](https://pitchchanger.io/how-to-make-slowed-and-reverb) |
| Daycore | 0.85× | 0 | none | same |
| Nightcore | **1.25×** (range 1.20–1.30) | 0 (coupled rise) | light plate | [pitchchanger.io nightcore](https://pitchchanger.io/zh/nightcore-maker) |
| TikTok Slowed | **0.80×** | 0 | medium | [soundtools.io](https://soundtools.io/slowed-reverb/) |
| Vaporwave | **0.65×** | 0 | heavy | same |
| Nightcore Reverse | **0.75×** | 0 | light | same |
| **Chipmunk / 鬼畜** | 1.0× | **+12 st** | 0 | *proposed — no incumbent ships this* |
| **Deep / "沧桑"** | 1.0× | **−3 to −5 st** | 0 | *proposed* (KuGou's 降调 example) |
| **Dub Techno** | 0.75× looped at 16 steps | 0 | — | see B.4 |
| **Lo-fi slow** | 0.85× | −2 st, **+8 cents** | 15% | *proposed — the detune is the flavour* |
| **Half speed (study)** | 0.50× | 0, **pitch preserved** | 0 | [soundtools tempo](https://soundtools.io/tempo-changer/) |
| **1.25× (challenge)** | 1.25× | 0, **pitch preserved** | 0 | same |

Note the last two: they are the *pitch-preserving* tempo presets, which is the second reason you need both modes.

### B.3 Instant A/B compare
- **Pattern to copy (lacuna.fm, soundtools.io):** "你移動控制項時試聽會跟著更新——兩次嘗試之間不用重新算一遍." The preview follows the control continuously, in real time, with no re-render round-trip.
- **Add a hold-to-compare "Original" button** (hold anywhere on it, or a big toggle, or a momentary A/B key). lacuna.fm's own copy makes the case for the second position, not a hideable control.
- **Also: loop a 4–8 second excerpt for auditioning.** Comparing 3:40 of audio is friction. See B.4.
- ⚠️ **Avoid a wet/dry crossfade slider as the *primary* A/B.** It's a nice trick for a reverb mix, but for key/speed it makes the pitch and tempo comparison mushy and it implies you can only hear the difference continuously rather than A/B instantly. A toggle is faster and more decisive. (If you ship one, it's a bonus, not the main affordance.)

### B.4 A/B loop regions & loop-with-varispeed — the classic "flavour" trick
The DJ beat-repeat / loop-roll technique is real and is exactly the "降速升速就别有风味" instinct applied at phrase level rather than song level.
- **The product primitive:** select a region → set a speed (e.g. 0.75×) → it loops → optionally pitch-shifted. This is how dub-techno and glitch are made.
- **It is a first-class node, not a gimmick.** [NFPlayerJS](https://github.com/spotify/NFPlayerJS) (Spotify, Apache-2.0) models exactly this: a `Loop` node and a `Stretch` node composed in a graph, where *"a Stretch node can affect time for an entire subgraph, requiring that subgraph to be rendered much faster than realtime… an entire graph could be audibly 'sped up' like fast forwarding a tape cassette."* That declarative model (Grapher Score) is the cleanest way to ever implement loop+varispeed+live-parameter-change together.
- **Independent corroboration in the tool market:** lacuna.fm ships a dedicated **音訊循環 / audio-looper** alongside its key changer.
- **Sensible default:** a loop whose length is a small number of beats, with quantise-to-BPM snapping if a BPM is known. Quantising the loop to the beat grid is the single quality-of-life feature that makes this feel professional.

### B.5 Waveform + keyboard shortcuts
- **Ship a waveform with a loop/shrink region.** It makes B.3 and B.4 legible and gives the download an honest length readout (0.85× of a 3:40 track = 4:19).
- **Shortcuts** (none of the surveyed tools have any — this is free differentiation):
  - `←` / `→` — key ∓1 semitone
  - `Shift` + `←` / `→` — key ∓1 octave (±12)
  - `Alt` + `←` / `→` — key ∓1 cent
  - `↑` / `↓` — speed ±1% (`Shift` for ±5%)
  - `0` — reset both
  - `Space` — play/pause (soundtools.io and every one of these tools already do this one)
  - `A` — hold-to-compare original; `Tab` — toggle original
  - `L` — set loop region to selection; `R` — region render
  - `C` — render/download
- **Live-update params while playing with no clicks** (see B.7) is the single highest-impact quality item in this whole report. Anything that clicks when you drag is an instant credibility killer for an audio product.

### B.6 Batch / queue
- Defer. Every surveyed consumer tool is strictly one-file-at-a-time; SoundTouch's own FAQ shows batch is trivially a shell loop, so a **"apply this setting to N files"** checkbox (even if it just loops the same single-file path N times) buys a lot of perceived power for almost nothing. True parallel queueing is not worth it yet.

### B.7 Progressive streaming preview vs. full offline render
**Both, and they are different systems.** This is the most important architectural point in the report.
- **Real products do real-time preview, then an offline render for the download.** soundtools.io: *"The preview uses the exact same algorithm as the download, so what you hear is what you get."* That sentence is the whole requirement — preview and render must share one algorithm, or users will feel lied to.
- **The gap in the market is that "preview" is currently almost always a re-render button, not a live stream.** KeyAndBPM has no preview at all. The genre tools say "adjust in real time during preview" in their body copy but the actual flow is render-then-download.
- **How to communicate progress:** the incumbents communicate it in prose, not in UI — "Most audio files process in under 30 seconds… even large files typically complete within a minute" ([soundtools.io](https://soundtools.io/slowed-reverb/)). That is a decent baseline expectation-setter. Do better: a real progress bar with a **rough ETA that updates from actual measured throughput after the first second**, plus a **per-item status in a list** ("rendering 2 of 5"). Because everything is client-side, also show **which thread the work is on** and keep the UI interactive — a user who can keep listening to the previous render while the next one bakes is dramatically faster than one staring at a spinner.
- **The failure mode to avoid: a "Preview" button that re-renders from zero every time you touch a control.** That is the single most-copied anti-pattern in this category (soundtools.io's own copy literally describes it: *"Adjust the pitch shift slider in real-time while previewing"* … then *"click Preview again to hear the new speed"*).

### B.8 Formant preservation → **default OFF, and say why**
- **Formant preservation exists to stop exactly the chipmunk/Darth-Vader effect:** *"Formants (resonant frequencies) define voice character. Pitch shifting without formant preservation creates unnatural 'chipmunk' or 'Darth Vader' effects."* → [pproenca/dot-skills reference](https://github.com/pproenca/dot-skills/blob/HEAD/skills/.experimental/audio-voice-recovery/references/voice-formant-preserve.md)
- Ableton exposes it as a 0–200% knob with 100% = neutral: *"At 100%, the original formants will be preserved, which allows for large changes in transposition while maintaining the sample's original tonal quality."*
- **For your use case, preserving formants is usually WRONG.** The user is chasing a timbre change. Chipmunk is the product, not a bug. **Ship it as an explicit, clearly-labelled off-by-default toggle** — "Keep the voice natural" — so that:
  - the creative default is formant-shifting (the flavour the user wants), and
  - the karaoke/utility user who lands on the same site by accident can turn it on.
  - Do not name the toggle "preserve formants" in the primary UI. Name it by what it *does to the sound*: **"Natural voice" / "原声人声"** vs **"Timbre shift" / "音色改变"**.
- **The two-axis framing is the right one:** voice-type (formant) and key (pitch) are separate musical parameters, just as speed and key are. Surfacing that distinction is itself a differentiator.

### B.9 Smooth / idempotent re-adjustment while playing
- **Every parameter must be a continuous, idempotent, audio-thread operation.** Changing a value must not restart playback, must not re-seek, and must not produce a discontinuity.
- The mechanism that gets you this for free in the browser is **`AudioParam` on an `AudioWorkletProcessor`** — `k-rate`/`a-rate` params are smoothed by the audio graph and are explicitly designed for this. SoundTouchJS exposes exactly three: `pitch`, `pitchSemitones`, `playbackRate`. Playback speed is driven by mirroring the source node's `playbackRate` onto the worklet's `playbackRate`.
- **Rate changes must themselves be smoothed** (ramp `playbackRate` over ~30–60 ms rather than stepping it) or you get a click at every slider tick.
- **The DSP trap:** a naive "re-run the stretch from sample 0 with the new parameter" loop *is* clicky and is the reason most web tools fall back to a re-render button. The good designs keep a continuous streaming processor alive and mutate the parameter.
- **Idempotence means the same settings always produce the same output** — a user who finds −3 st / 0.85× and likes it must be able to return to it exactly. Make the state URL-encodable and shareable.

---

## C. Technical community knowledge

### C.1 Why large pitch shifts sound bad, and where the ceiling is

**Mechanism, concretely:**
- Audacity's default pitch engine is **SoundTouch**, which *"uses time-domain splicing that causes severe phase cancellation and metallic flutter in complex, monophonic vocal frequencies."* Checking "Use high quality stretching" switches to **SBSMS (Subband Sinusoidal Modeling Synthesis)**, which *"analyzes the audio's underlying frequency components and synthesizes continuous spectral bands."* → [salivity/audacity guide](https://salivity.github.io/audacity/article/audacity-change-pitch-without-robotic-artifacts)
- The classic "chipmunk" is *not* only a phase-vocoder artefact: **the naive resample route and the phase-vocoder route sound genuinely different.** The genre's "slowed" sound is the *resample* route (playback rate), which is why pitchchanger.io insists *"a tempo-only speed changer, which rebuilds the audio to hold the original key"* is a **different product**, not a better one. This is the single most important thing your product must let the user choose between.
- **Formants move with pitch when you don't compensate them.** *"Because the Change Pitch effect shifts all frequencies equally rather than dynamically scaling formants, drastic changes inevitably sound unnatural."* (same source)

**The numeric ceiling — the most-cited guidance found:**
- **±3 semitones (≈ ±15%) for speech**: *"Keep speech adjustments between −3.00 and +3.00 semitones. Exceeding four semitones will compress or expand vocal formants into artificial ranges, yielding either a robotic chipmunk or an electronic monster effect."*
- **±1–3 semitones = excellent; ±6–12 = "slight artifacts but remain highly usable"**: → [soundtools.io pitch-shifter](https://soundtools.io/pitch-shifter/)
- **±7–12 = "sounds robotic"**; **±2 = the most common useful shift**; **±7 = used by content creators "to avoid copyright detection"**; **±12 = "same key, different octave"** — same source.
- **±12 is a real quality cliff, and a *good* one to stop at.** soundtools.io's own best practice: *"For Extreme Shifts, Try Octave Shifting — if you need a song much higher or lower, consider shifting by exactly ±12 semitones rather than ±7–10. Octave shifts maintain the key relationship and often sound more natural."* (PSOLA/phase-vocoder algorithms work on waveform periodicity; an octave is an exact integer ratio, so it lands cleanly.)
- **Extreme slow-down: nothing in the phase-vocoder family works; go granular.** Audacity's own doc: *"The 'high quality' algorithm is only suitable for small to moderate tempo changes and the sound quality will deteriorate very badly for extreme changes. For extreme slowing down, consider using the Paulstretch effect."*
- **Material matters, and you should let the user tell you which kind of track they're feeding it.** Ableton's mode taxonomy is the practical version of this: *Beats* for rhythmic, *Tones* for monophonic tonal, *Texture* for polyphonic/noisy, *Complex / Complex Pro* for full mixes. Rubber Band's crispness `5 = --no-peaklock --window-short` is explicitly *"may be suitable for drums"* while the R3 (Finer) engine is recommended for *"complex mixes, vocals and other sounds that have soft onsets… and music with substantial bass content."* **A "Drums / Vocal / Full mix" quality selector is a genuinely differentiating control that almost no web tool exposes.**

### C.2 Which mode is more useful — "tempo change that preserves key" or "key change that preserves tempo"?

**Both — and for this use case the coupled (naive rate) change is arguably the more important of the two.** But the real answer is that these are not two modes, they are **two independent axes**, and every existing tool only gives you one line through that space.

- **The coupled change is the genre default.** pitchchanger.io: *"That falling pitch is not a defect to correct. It is a central part of the style."* And: *"If you want a slower performance in the original key for practice or transcription, use a tempo-preserving Audio Speed Changer instead."* → the industry already treats these as two *different products*, and validates both audiences.
- **The preserving change is a real, separate job.** soundtools.io runs it as a standalone product for practice, dance, language learning, accessibility, transcription and DJ beat-matching, at **50%–200%**, and sells it with a whole content page.
- **The argument nobody makes: you want them composed.** "Slowed **+ reverb**" is the coupled change. "Lo-fi" is the preserving change. "A dub-techno loop at 0.75× pitched down another 4 semitones" is **neither** — it's a coupled change with an *additional independent* key offset. KuGou's 调速/升降调 puts the two controls in one panel; every English-language genre tool does not.
- **Recommended product model:**
  1. **Speed** control (50%–200%), with a mode toggle.
  2. **Key** control (−12…+12 st) as a *separate additive axis* on top, defaulting to 0 and meaning "extra semitones on top of whatever the speed change did."
  3. In **"Vinyl" mode** (default), speed moves pitch by the linked amount and the key readout shows the **derived total** (`0.85× + 0 st extra → −2.80 st total, C → A♭`), read-only, so the user can see the consequence and then push it further.
  4. In **"Indie" mode**, speed moves *only* speed and the key slider is the sole pitch authority.
  5. A third, cheap and very on-brief option: **"Listen (no download)"** — the KuGou behaviour, as an instant preview. Because rendering is the expensive step, letting people audition freely and only then commit to a render is the single biggest UX win available.

### C.3 Ranges people actually use (the evidence table)

| Parameter | Evidence-backed range | Source |
|---|---|---|
| Key shift, "sounds good" | **−4 … +4 st** (±15%) | [salivity/Audacity](https://salivity.github.io/audacity/article/audacity-change-pitch-without-robotic-artifacts) |
| Key shift, "usable with artefacts" | **−6 … +6 st** | [KeyAndBPM](https://keyandbpm.com/) caps at ±6 |
| Key shift, "creatively dirty" | **−12 … +12 st** | [lacuna.fm](https://www.lacuna.fm/zh-TW/song-key-changer), [soundtools.io](https://soundtools.io/pitch-shifter/), [Audacity 4 Sliding Stretch](https://www.audacityteam.org/manual/effects/pitch-and-tempo/sliding-stretch/) |
| Key shift, "exact octave is cleaner than 7–10" | **±12 st** | [soundtools.io](https://soundtools.io/pitch-shifter/) best practice |
| Key shift, freestyle / nonsense | ±4 octaves (REAPER) | ⚠️ **UNVERIFIED** — see A.4. Do not publish. |
| Speed, general consumer | **50%–200%** | [soundtools.io tempo-changer](https://soundtools.io/tempo-changer/) |
| Speed, Chinese major app | **0.5×–1.5×** | [KuGou](https://baijiahao.baidu.com/s?id=1749728108027565118) |
| Speed, DAW legacy extremes | multiplier **0.010–50.000**; **−99%…+4900%** | [Audacity Change Speed and Pitch](https://manual.audacityteam.org/man/change_speed.html) — **do not copy these for a consumer product** |
| Speed, Audacity 4 ramp range | **−90% … +500%** | [Sliding Stretch](https://www.audacityteam.org/manual/effects/pitch-and-tempo/sliding-stretch/) |
| Slowed / lo-fi / vaporwave | **0.65× – 0.90×** (0.85× canonical) | [pitchchanger.io](https://pitchchanger.io/how-to-make-slowed-and-reverb), [soundtools.io](https://soundtools.io/slowed-reverb/) |
| Nightcore / sped-up | **1.20× – 1.30×** | [pitchchanger.io nightcore](https://pitchchanger.io/zh/nightcore-maker) |
| Groove lost / intelligibility falls | below **0.40×** | [soundtools.io](https://soundtools.io/tempo-changer/) own guidance: *"below 40% it's hard to feel the musical groove or beat"* |
| Reverb mix for the genre | **20%–40%** (start 25–35%) | [pitchchanger.io](https://pitchchanger.io/how-to-make-slowed-and-reverb) |
| Vocal shift for natural speech | **±3 st** | [salivity/Audacity](https://salivity.github.io/audacity/article/audacity-change-pitch-without-robotic-artifacts) |
| Formant neutrality | 100% (range 0–200%) | [Ableton warp](https://edu.garnishmusicproduction.com/ableton-advanced-granular-creative-time-stretching/) |
| Paulstretch time resolution | **0.25 s** default; >2 s = texture | [Paulstretch](https://manual.audacityteam.org/man/paulstretch.html) |
| Rubber Band crispness | **0–6**, default **4**; **5** for drums | [man page](https://manpages.ubuntu.com/manpages/focal/man1/rubberband.1.html) |
| Rubber Band pitch units | **semitones** (`-p`) | same |
| Derived: 0.85× on a 120 BPM track | 102 BPM, **−2.8 st** | [pitchchanger.io](https://pitchchanger.io/how-to-make-slowed-and-reverb) |

**Formulas to have on hand:** semitones → ratio `2^(n/12)`; speed % → semitones `12·log2(speed)`; 0.85× → 12·log2(0.85) = **−2.80 st**; 1.25× → **+3.86 st**; new length = old length / speed.

### C.4 Open-source web projects worth studying

| Project | Licence | Why it's relevant |
|---|---|---|
| **[cutterbl/SoundTouchJS](https://github.com/cutterbl/SoundTouchJS)** | **MPL-2.0** (moved off LGPL) | ⭐ **Start here.** Nx/pnpm monorepo, 11 packages: `core`, `audio-worklet` (AudioWorklet + **`processOffline()`** for full-file render + processor metrics), **`stretch-phase-vocoder`** (phase-vocoder `StretchPipe` for extreme ratios), **`phase-vocoder-worklet`** (smoother at extreme ratios), **`formant-correction-worklet`** (**LPC-based formant preservation for natural vocal pitch shifts**), plus pluggable interpolation strategies **lanczos (default) / linear / hann / blackman / kaiser**. The node exposes exactly the three `AudioParam`s you need: `pitch`, `pitchSemitones`, `playbackRate`. Ships a demo with pitch/key/speed/volume sliders and a Storybook playground per strategy. |
| **[Daninet/rubberband-wasm](https://github.com/Daninet/rubberband-wasm)** | GPL (Rubber Band) + commercial licence | Highest-quality offline render available in a browser. **Licence trap:** Rubber Band is GPL and *"you may not legally distribute through any Apple App Store unless you have a commercial licence."* Budget for a commercial licence or keep it server-side. Working demo: `daninet.github.io/rubberband-wasm`. |
| **[spotify/NFPlayerJS](https://github.com/spotify/NFPlayerJS)** (→ nativeformat) | **Apache-2.0** (dep: SoundTouch-TS, LGPL-2.1, swappable) | ⭐ **Best architecture reference.** Declarative "Grapher Score" graph over Web Audio with **Stretch / Loop / Gain / File** nodes. `"A Stretch node can affect time for an entire subgraph, requiring that subgraph to be rendered much faster than realtime… an entire graph could be audibly 'sped up' like fast forwarding a tape cassette."` Supports live mutation of the score, faster-than-realtime offline render (CLI: 120 s of audio in ~5 s), and multi-score crossfading. **This is exactly the graph you need for the DJ loop-with-varispeed feature (B.4).** Known limits to design around: loads all files into memory, main-thread only (mitigate with a Worker / AudioWorklet), no DRM/EME. |
| **[glittercowboy/bpm-key-finder](https://github.com/glittercowboy/bpm-key-finder)** | MIT | Reference implementation of the key/BPM detection panel: Krumhansl–Schmuckler chroma key detection, peak-interval BPM, **Camelot wheel**, tap-tempo fallback, localStorage history, all in-browser. |
| Audacity **Paulstretch** | GPL (in audacity repo) | The reference for *extreme* slow-down. `Stretch Factor` + `Time Resolution`. |
| **Julius O. Smith**, *Mathematics of the DFT with Audio Applications* (2nd ed.) | Free online, [ccrma.stanford.edu/~jos/mdft/](https://ccrma.stanford.edu/~jos/mdft/) | Background reading on phase, spectral phase, spectral pincer, and the analysis–modify–resynthesis loop. (I fetched the table of contents, not a specific section — verify any specific claim before quoting it.) |

**Recommended stack:** `SoundTouchJS` (MPL-2.0) for the realtime AudioWorklet + live params + `processOffline()` render; optionally a Rubber Band WASM path *server-side* if you can afford the GPL/commercial licence; `bpm-key-finder`'s Krumhansl-Schmuckler approach for key/BPM detection; NFPlayerJS's node-graph model as the blueprint for the loop feature.

---

## D. Ranked feature list (value / effort)

Legend: **V** = user value (1–5), **E** = effort (1–5). Ratio = V/E.

### Tier 1 — ship first (the product's reason to exist)

| # | Feature | V | E | Notes |
|---|---|---|---|---|
| 1 | **Two independent controls**: stepped key (−12…+12 st, key names shown) + speed (50%–200%) | 5 | 3 | The whole premise. The DSP is the real cost, not the UI. |
| 2 | **Coupled ("vinyl") vs. independent mode toggle**, with the key slider as an *additive* offset on top of the coupled change | 5 | 1 | Near-free UI framing over the same DSP, and it is the 2-D-plane wedge (§0.3). Biggest value-per-effort item in this list. |
| 3 | **Live, click-free preview that follows the control while you drag** | 5 | 3 | AudioWorklet `AudioParam`s + ramped rate changes. Non-negotiable for an audio product. |
| 4 | **Instant A/B vs. original** (hold-to-compare button + `Tab` toggle) | 5 | 1 | Reuses the same streaming processor. Cheap, decisive, and nobody in the category has it. |
| 5 | **Download without signup, without watermark, client-side** | 5 | 2 | soundtools, pitchchanger, lacuna all advertise it as a feature; KeyAndBPM loses on it. |
| 6 | **Preset flavour chips with the numbers printed on them** | 4 | 1 | Use the table in §B.2 verbatim. Teaches the mapping instead of hiding it. |
| 7 | **Honest quality bands on the key slider** — visually mark "clean to ±4", "characterful to ±6", "lo-fi to ±12" | 4 | 1 | lacuna.fm's pattern. Converts a limitation into a trust signal. |

### Tier 2 — the differentiators

| # | Feature | V | E | Notes |
|---|---|---|---|---|
| 8 | **Auto-detect original key; pick a *target* key, not a semitone delta** | 5 | 3 | Krumhansl–Schmuckler, MIT-licensed reference impl available. Removes the "how many semitones?" question nobody can answer. |
| 9 | **Auto-BPM + linked BPM slider + ÷2/×2 octave-error correction** | 4 | 3 | soundtools' exact pattern. For a *creative* tool, "set it to 174 BPM" beats "set it to 1.30×". |
| 10 | **Three expressions of the key shift**: semitone stepper / target-key picker / **voice-range picker** (baritone…soprano) | 4 | 1 | Once #8 exists this is nearly free UI, and it extends naturally to creative labels ("deeper", "smaller", "heavier"). |
| 11 | **Formant toggle, default OFF**, labelled by effect ("Timbre shift" / "Natural voice"), not by jargon | 4 | 3 | LPC formant correction is available in SoundTouchJS. Required to be a full-range instrument; the default choice is what encodes your use case. |
| 12 | **Keyboard shortcuts** (arrows = st/%, shift = octave/5%, space, A, 0, C) | 4 | 1 | Free differentiation; nobody surveyed has any beyond spacebar. |
| 13 | **Waveform + loop region + honest output-length readout** | 4 | 2 | Sets up #14 and makes the download feel trustworthy. |
| 14 | **Quality tier: Fast / High, plus a "Drums / Vocal / Full mix" hint** | 3 | 2 | Rubber Band crispness + R2/R3 map cleanly onto a user-facing selector. The material hint is the genuinely novel part. |
| 15 | **Shareable URL state** (key, speed, mode, formant all in the query string) | 3 | 1 | Idempotence + virality. Ties to "find −3 st / 0.85× and return to it exactly." |
| 16 | **"Listen only" mode** — audition freely, skip the render | 3 | 1 | KuGou's behaviour. Frees exploration from render cost. |

### Tier 3 — high value, high effort (schedule, don't start here)

| # | Feature | V | E | Notes |
|---|---|---|---|---|
| 17 | **Loop-with-varispeed (DJ beat-repeat)** — quantised to the beat grid | 5 | 5 | The "classic flavour trick" the brief asks about. NFPlayerJS's Loop+Stretch node graph is the blueprint. Do this after Tier 1 ships. |
| 18 | **Reverb in the same tool** (mix 0–40%, hall/plate, pre-delay) | 4 | 2 | Completes the actual "slowed + reverb" recipe. Strong SEO/discovery play — that phrase is the volume search. Consider a thin "send to <existing reverb tool>" instead. |
| 19 | **Apply to a time range only** (partial render) | 3 | 4 | Genuinely useful for intro/verse-only edits; painful to build and to explain. |
| 20 | **Batch / multi-file queue** | 3 | 3 | Defer. A checkbox that loops the single-file path N times captures 80% of the value. |
| 21 | **Pitch/speed ramps (tape-stop, pitch-bend sweeps)** | 2 | 3 | Audacity's Sliding Stretch already does this properly. Fun, narrow. |

### Tier 4 — explicitly out of scope for v1
- Split-screen / wet-dry A/B slider (a toggle is better; see anti-patterns)
- From/To frequency in Hz, or percent-pitch, in the primary UI (engineer surface; put behind "advanced")
- YouTube / streaming-URL input (copyright)
- Anything above ±12 st or outside 50%–200% without a serious reason

---

## E. UX anti-patterns to avoid

1. **One slider that does both.** The classic Audacity "Change Speed and Pitch". It makes the entire premise impossible. If it exists anywhere in your UI it is a bug.
2. **A "Preview" button that re-renders from zero on every parameter change.** This is the most-copied flaw in the category. soundtools.io's own body copy describes it as a feature: *"click Preview again to hear the new speed."* Your preview must be a live stream, not a re-render.
3. **Clicks or gaps when dragging.** Non-negotiable. Ramp every rate change; keep the processor alive; never restart playback.
4. **Forcing a render before the user can hear anything.** KeyAndBPM's entire flow is Upload → Adjust → Process → Download. The user pays a render to discover whether they like the setting.
5. **Marketing copy that contradicts the product.** soundtools.io's slowed+reverb page says *"Yes! Our tool slows down the audio while preserving the original pitch, so the song doesn't sound lower or 'chipmunk-like'"* — on a page about the genre where the falling pitch is the entire point. Never promise "no chipmunk" on a chipmunk product.
6. **Splitting the key shifter and the speed changer into two separate pages.** Every incumbent does this (soundtools, lacuna, rtcd, artplayer, elysia, stemsplit). It is the incumbents' structural weakness and your single clearest opening.
7. **Hiding the parameters behind preset chips.** Presets are good; opaque presets are not. Put `0.85× · −0 st` on the chip.
8. **Presenting auto-detected key/BPM as authoritative.** Every detector lands an octave off sometimes. Provide ÷2/×2 and a "wrong? fix it" affordance (soundtools does this well; most don't).
9. **Engineer surface in the consumer UI.** From-frequency in Hz, cents as the primary unit, percent-pitch. Put them behind "advanced". Audacity's four-linked-fields design is right *for Audacity*.
10. **A huge range with no quality guidance.** If you offer ±24 semitones you must visibly mark where artifacts begin. Better: cap at ±12, and mark the bands.
11. **Uploading the file to a server when it runs fine client-side.** Costs latency and privacy credibility for zero benefit. Three of the four good competitors run client-side and say so on the page.
12. **Signup walls, watermarks, queueing, or hidden size caps.** lacuna.fm lists "50 MB / 不需要註冊 / 沒有浮水印 / 不用排隊" as *features* on the landing page. Any of these reads as a scam to this audience.
13. **No keyboard support.** DJ/pro-audio users live on arrows and spacebar. Competitors ship spacebar only.
14. **Showing the derived pitch change only in one mode.** In coupled mode the key readout must update live to show the consequence (`0.85× → −2.80 st`) — otherwise users never learn that the two controls interact.
15. **Forcing a semantic choice ("key or speed?") before the user can play anything.** Both controls, always visible, always live.
16. **Trusting a copied range.** Audacity's `0.010–50.000` multiplier exists because a DAW must not break a user's file. A consumer tool should expose **50%–200%** and refuse gracefully outside it.

---

## F. Verification gaps and cautions

- **REAPER playrate numbers are unverified.** `reaper.fm/docs/*` → 404; `wiki.reaper.fm` → DNS failure; Cockos wiki & forums → bot check; user-guide PDFs → 404/redirect. The only REAPER fact I could source is the `D_PITCH` semitone convention (−12/0/+12). **Do not publish a REAPER playrate range without checking in-app.**
- **`musictimetuner.com`, `180by2.com`, `tunesplit.com`** — status verified by direct fetch on 2026-09, but I could not reach the Wayback Machine to confirm *when* they changed or what their exact old ranges were. If you need the historical feature set, query `archive.org` separately.
- **Julius O. Smith's DFT book** — I confirmed the table of contents only. Cite it as background; verify any specific statement.
- **Cloudflare-blocked, not read:** [stemsplit.io/pitch-changer](https://stemsplit.io/pitch-changer), [tool.yolo813.com](https://tool.yolo813.com/en/audio-tool/audio-speed-pitch-adjuster), [help.bandlab.com AudioStretch guide](https://help.bandlab.com/hc/en-us/articles/28737505847833-Using-AudioStretch), [keyandbpm.com Product Hunt page](https://www.producthunt.com/products/keyandbpm) (403). The product pages themselves were read directly; only these secondary pages were blocked.
- **唱吧 (Changba)** — no authoritative public documentation of its 变调 range or UI was findable. KuGou is the solid Chinese-market datapoint; treat Changba as unverified.
