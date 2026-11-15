import Hls from 'hls.js';
import type {
  HlsConfig,
  Loader,
  LoaderCallbacks,
  LoaderConfiguration,
  LoaderContext,
} from 'hls.js';
import { hmacSha256 } from './hmac';
import { playbackProof } from './mint.client';

const encoder = new TextEncoder();

function toB64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromB64url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

type LoaderClass = new (config: HlsConfig) => Loader<LoaderContext>;
let keyedLoader: LoaderClass | null = null;

/**
 * hls.js's own loader, except that a loadplay key request is signed with a
 * fresh one time proof and the masked key that comes back is unmasked before
 * hls.js sees it. Built lazily so nothing touches hls.js during SSR.
 */
export function keyedLoaderClass(): LoaderClass {
  if (keyedLoader) return keyedLoader;
  const Base = Hls.DefaultConfig.loader as LoaderClass;

  keyedLoader = class KeyedLoader extends Base {
    load(
      context: LoaderContext,
      config: LoaderConfiguration,
      callbacks: LoaderCallbacks<LoaderContext>,
    ) {
      const proof = context.type === 'key' ? playbackProof(context.url) : null;
      if (!proof) {
        super.load(context, config, callbacks);
        return;
      }

      const proofKey = fromB64url(proof);
      const r = toB64url(crypto.getRandomValues(new Uint8Array(16)));
      const x = toB64url(hmacSha256(proofKey, encoder.encode(`key|${r}`)));
      const mask = hmacSha256(proofKey, encoder.encode(`mask|${r}`));
      const signed = { ...context, url: `${context.url}&r=${r}&x=${x}` };

      // hls.js matches the answer to its request by the original context.
      super.load(signed, config, {
        ...callbacks,
        onSuccess: (response, stats, _ctx, details) => {
          const data = response.data;
          if (!(data instanceof ArrayBuffer) || data.byteLength !== 16) {
            callbacks.onError({ code: 0, text: 'bad key' }, context, details, stats);
            return;
          }
          const key = new Uint8Array(data);
          for (let i = 0; i < 16; i++) key[i] ^= mask[i];
          callbacks.onSuccess({ ...response, data: key.buffer }, stats, context, details);
        },
        onError: (error, _ctx, details, stats) => callbacks.onError(error, context, details, stats),
        onTimeout: (stats, _ctx, details) => callbacks.onTimeout(stats, context, details),
        onAbort: callbacks.onAbort
          ? (stats, _ctx, details) => callbacks.onAbort?.(stats, context, details)
          : undefined,
      });
    }
  };
  return keyedLoader;
}
