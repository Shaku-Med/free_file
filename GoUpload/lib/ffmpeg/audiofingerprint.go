package ffmpeg

import (
	"math"
)

// Shazam-style audio fingerprinting.
//
// Pipeline: STFT -> per-log-band spectral peaks ("constellation map") ->
// anchor/target pair hashes. Each hash packs (anchor bin, target bin, frame
// gap); together with the anchor's frame offset it forms one fingerprint.
// Matching happens in the database: two recordings of the same audio share
// many hashes whose offsets differ by ONE consistent delta, while unrelated
// audio scatters. Robust to re-encoding, volume, and clipping; NOT robust to
// speed/pitch shifts (acceptable for v1 duplicate detection).
//
// Reuses the stems STFT config (22050 Hz / 1024 FFT / 512 hop) so both
// analyses run off a single PCM decode in the worker.

const (
	// Fingerprint at most this much audio  the opening minutes identify a
	// recording; bounding keeps the index ~thousands of rows per file.
	fingerprintMaxSeconds = 300
	// Hard cap on emitted fingerprints per file (DB row budget).
	fingerprintMaxHashes = 8000
	// Anchor pairs with targets this many frames ahead (~0.14s .. ~2.8s).
	fingerprintFanout      = 5
	fingerprintTargetMinDt = 3
	fingerprintTargetMaxDt = 120
	// A peak must beat its band's running average by this factor.
	fingerprintPeakRatio = 1.8
)

// Log-spaced band edges (FFT bin indices @ 1024-point, 22050 Hz):
// ~21Hz/bin. Bands cover ~40Hz .. ~5.5kHz where musical energy lives.
var fingerprintBandEdges = []int{2, 4, 8, 16, 32, 64, 128, 256}

type AudioFingerprint struct {
	// Hash packs (anchorBin<<18 | targetBin<<6 | dt) into 27 bits.
	Hash uint32
	// Offset is the anchor's STFT frame index (convert via hop/rate).
	Offset int32
}

type fingerprintPeak struct {
	frame int
	bin   int
}

// FingerprintPCM computes pair-hash fingerprints from mono PCM samples.
// Pure function  unit-testable without ffmpeg.
func FingerprintPCM(samples []float64, sampleRate int) []AudioFingerprint {
	maxSamples := fingerprintMaxSeconds * sampleRate
	if len(samples) > maxSamples {
		samples = samples[:maxSamples]
	}
	if len(samples) < stemsFFTSize*4 {
		return nil
	}

	peaks := constellationPeaks(samples)
	if len(peaks) < 2 {
		return nil
	}

	out := make([]AudioFingerprint, 0, len(peaks)*fingerprintFanout)
	for i, anchor := range peaks {
		paired := 0
		for j := i + 1; j < len(peaks) && paired < fingerprintFanout; j++ {
			dt := peaks[j].frame - anchor.frame
			if dt < fingerprintTargetMinDt {
				continue
			}
			if dt > fingerprintTargetMaxDt {
				break
			}
			out = append(out, AudioFingerprint{
				Hash:   packFingerprintHash(anchor.bin, peaks[j].bin, dt),
				Offset: int32(anchor.frame),
			})
			paired++
			if len(out) >= fingerprintMaxHashes {
				return out
			}
		}
	}
	return out
}

// constellationPeaks runs the STFT and keeps, per frame and per log band,
// the strongest bin  but only when it clearly beats the band's running
// average (so silence and noise floors emit nothing).
func constellationPeaks(samples []float64) []fingerprintPeak {
	frames := 1 + (len(samples)-stemsFFTSize)/stemsHopSize
	window := hannWindow(stemsFFTSize)
	re := make([]float64, stemsFFTSize)
	im := make([]float64, stemsFFTSize)

	bandCount := len(fingerprintBandEdges) - 1
	bandAvg := make([]float64, bandCount)
	var peaks []fingerprintPeak

	for f := 0; f < frames; f++ {
		off := f * stemsHopSize
		for i := 0; i < stemsFFTSize; i++ {
			re[i] = samples[off+i] * window[i]
			im[i] = 0
		}
		fftInPlace(re, im)

		for b := 0; b < bandCount; b++ {
			lo := fingerprintBandEdges[b]
			hi := fingerprintBandEdges[b+1]
			bestBin := -1
			bestMag := 0.0
			for k := lo; k < hi; k++ {
				m := math.Hypot(re[k], im[k])
				if m > bestMag {
					bestMag = m
					bestBin = k
				}
			}
			if bestBin < 0 {
				continue
			}
			// Slow-moving per-band average as the noise floor.
			if bandAvg[b] == 0 {
				bandAvg[b] = bestMag
			} else {
				bandAvg[b] = bandAvg[b]*0.98 + bestMag*0.02
			}
			if bestMag > bandAvg[b]*fingerprintPeakRatio {
				peaks = append(peaks, fingerprintPeak{frame: f, bin: bestBin})
			}
		}
	}
	return peaks
}

// packFingerprintHash packs (anchor bin, target bin, frame gap) into 27 bits:
// 9 bits each for the bins (< 512) and 9 bits for dt (< 512).
func packFingerprintHash(binA, binB, dt int) uint32 {
	return uint32(binA&0x1FF)<<18 | uint32(binB&0x1FF)<<9 | uint32(dt&0x1FF)
}

// FingerprintFrameDuration converts fingerprint offsets (STFT frames) to
// seconds for human-facing match info.
func FingerprintFrameDuration() float64 {
	return float64(stemsHopSize) / float64(stemsSampleRate)
}
