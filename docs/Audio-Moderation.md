# Audio moderation

Status: **investigated and benchmarked, not built.**

The question was whether we could do what TikTok does, catch a video whose
picture is clean but whose audio is not. The answer is yes, and cheaper than
expected, because most of the pieces are already on the VPS.

This document records the measurements so nobody has to redo them.

---

## Split the problem first

"Audio NSFW" is two different problems wearing one name.

**Spoken content.** Someone saying explicit sexual things, slurs, threats. This
is solvable with transcription plus text classification, and it is most of what
actually needs catching.

**Non-speech sound.** Moaning, sexual audio with no words. This is genuinely
hard and there is no good free model for it. The available options are AudioSet
style taggers like YAMNet, which give you tags in the breathing, groaning and
gasping family. Those are terrible proxies: they fire on gym footage, childbirth,
medical content, horror and someone lifting something heavy.

Do the first properly. If the second is ever added, it must be a **review hint
that never decides anything**, in the same shape as the gore classifier, which
already both misses real cases and false-positives on medical and news footage.

Do not train a bespoke sexual-audio classifier. The dataset is the problem and
it is not a problem worth having.

---

## What is already on the box

`/opt/whisper/src` is **whisper.cpp, already compiled**, and nothing is using it.
It was found while investigating disk usage, not installed for this.

Built binaries in `/opt/whisper/src/build/bin`:

| Binary | Use |
| --- | --- |
| `whisper-cli` | one shot transcription, what the benchmarks below used |
| `whisper-server` | keeps the model resident, this is what production would use |
| `whisper-quantize` | produced the q8_0 model |
| `whisper-vad-speech-segments` | Silero VAD, overlaps with inaSpeechSegmenter |
| `whisper-bench` | |

`MusicDetector` already runs inaSpeechSegmenter, which segments audio into
speech, music and noise. **That is the expensive plumbing and it is already
done.** It tells us exactly where the speech is, so most files transcribe a
fraction of their length.

Audio is also already isolated as its own HLS track from the encoding ladder
work, so there is no extra extraction step.

---

## Benchmarks

Measured on the production VPS: Hostinger KVM 2, **2 cores, 8 GB**, Ubuntu 25.10.
The CPU reports `AVX512`, `AVX512_VNNI` and `AVX512_BF16`.

All runs: `-t 1 -bo 1 -bs 1`, warm page cache, `samples/jfk.wav`, which is 11
seconds of clean studio speech.

| Model | Size | encode | wall |
| --- | --- | --- | --- |
| base.en f16 | 141 MB | 3269 ms | 3.74 s |
| base.en q5_0 | 52 MB | 3927 ms | 4.34 s |
| **base.en q8_0** | **77 MB** | **2704 ms** | **3.07 s** |

**Use q8_0.** It is 17% faster than f16 and 45% smaller.

q5_0 being the slowest is the counterintuitive part and worth remembering: 5 bit
weights have to be unpacked before the matmul, and that costs more than the
smaller weights save. AVX512_VNNI accelerates **int8**, which is q8_0, not q5_0.
Do not assume smaller is faster on this hardware.

### Two settings that dominate everything else

**Greedy decoding.** whisper-cli defaults to `5 beams + best of 5`. That took
10.3 s. Passing `-bo 1 -bs 1` halved it. Beam search is for publication quality
transcripts; this asks "does this contain explicit speech", so greedy is the
right trade.

**Keep the model resident.** Cold model load was 4074 ms, warm 106 ms. Per file
process spawning would pay that every time, which is why `whisper-server` exists.

### Reading the numbers correctly

whisper's encoder always processes a fixed **30 second window** (`n_audio_ctx =
1500`, 50 frames per second). The 11 second sample was padded to a full window,
so 3.07 s is the cost of 30 seconds of audio, not 11.

That is roughly **10x realtime on one core**, leaving the second core for ffmpeg.

Caveat on that figure: `jfk.wav` leaves most of its window empty, so its decode
cost is lower than a fully packed window of dense speech. Decode was about 600 ms
of the total and a full window could triple that. Plan for **7 to 10x realtime**,
not a flat 10.

| Content | Single core cost |
| --- | --- |
| 30 s reel | ~4 s |
| 4 min track with 20 s of talking | ~4 s (one window) |
| 30 min all-speech video | ~3 to 4 min |

---

## Shape of the build

Not built yet. When it is:

- extend **MusicDetector**, do not add a service. It already has the audio, the
  speech segments, the FastAPI shape and the Docker image
- **finish the Go worker wiring for MusicDetector first.** `is_music` is still
  not gated end to end, and the audio moderation path rides the same wire
- run `whisper-server` so the model stays resident
- **transcribe speech regions only.** This is the single biggest saving. A four
  minute track with a twenty second intro is one window of work, not eight
- one thread, and **serialize after the encode, never alongside it.** On 2 cores
  goupload's ffmpeg ladder is the real hog, and both fire on the same upload
- for long spoken uploads, sample rather than transcribe everything. First 60
  seconds of speech plus a few spread samples. Explicit speech is rarely
  confined to minute 23
- feed the result into `moderation_evidence` and the existing review flow from
  docs/Moderation.md, never a direct restriction

### Why transcription beats an acoustic classifier here

It produces **evidence a human can check in two seconds**: "at 01:23 it says X."
The vision classifier gives nothing reviewable, which is why its false positives
are so expensive. A transcript fits the review-before-unlock design instead of
fighting it.

---

## The real remaining work is the text side

Performance is solved. `lib/nsfwTextCheck.ts` is not.

It is 20 words matched as whole words. Against a transcript it fails in both
directions:

- one "sex" in a five minute transcript is not porn. Needs **density and
  repetition**, not presence
- ASR mishears things constantly, and mishearings are a real false positive source
- **it is English only**

That last point matters more once transcription exists. Whisper handles many
languages, so non-English uploads would be transcribed and then silently pass an
English-only filter. Enforcement would land hardest on English speaking creators
purely as an artefact of tooling.

`ggml-base.bin` (multilingual, 141 MB) is downloaded alongside `base.en` for
exactly this reason. Deciding between them, or routing by detected language, is
part of the text-side work rather than a separate problem.

---

## Reproducing the benchmark

```
cd /opt/whisper/src
./build/bin/whisper-quantize models/ggml-base.en.bin models/ggml-base.en-q8_0.bin q8_0
time ./build/bin/whisper-cli -m models/ggml-base.en-q8_0.bin -f samples/jfk.wav -t 1 -bo 1 -bs 1
```

Run it twice. The first pays the cold model read and is not representative.

Not yet measured: real platform audio. Finished uploads go straight to GitHub and
R2, so nothing local exists to test against. That gap only affects threshold
tuning, not the decision to build.
