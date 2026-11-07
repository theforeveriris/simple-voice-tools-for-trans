/**
 * 局域网点对点同步的信令编解码（供二维码搬运）
 *
 * WebRTC 的 SDP 文本通常 1–2 KB，直接塞进二维码会逼近版本 40 的上限，
 * 手机相机很难扫。这里先 deflate-raw 压缩（SDP 重复度极高，通常压到 1/3 以下），
 * 再 base64url 编码，并加 `svt1.` 前缀区分格式。
 *
 * 解码同时兼容：带前缀的压缩串、以及用户直接粘贴的原始 SDP JSON。
 */

const PREFIX = 'svt1.';

/** Uint8Array → base64url（无填充，二维码友好） */
function bytesToBase64Url(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** base64url → Uint8Array */
function base64UrlToBytes(s: string): Uint8Array {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  const bin = atob(b64 + pad);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** 复制到独立 ArrayBuffer（Response 的 BodyInit 不接受 ArrayBufferLike 泛型的 Uint8Array） */
function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const ab = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(ab).set(bytes);
  return ab;
}

async function pipeThrough(bytes: Uint8Array, stream: CompressionStream | DecompressionStream): Promise<Uint8Array> {
  const streamObj = new Response(toArrayBuffer(bytes)).body!.pipeThrough(stream);
  const buf = await new Response(streamObj).arrayBuffer();
  return new Uint8Array(buf);
}

/** SDP 文本 → 二维码载荷（压缩 + base64url）；压缩不可用时退化为原样 */
export async function encodeSdpForQr(sdp: string): Promise<string> {
  if (typeof CompressionStream === 'undefined') return sdp;
  try {
    const compressed = await pipeThrough(new TextEncoder().encode(sdp), new CompressionStream('deflate-raw'));
    return PREFIX + bytesToBase64Url(compressed);
  } catch {
    return sdp;
  }
}

/** 二维码载荷 → SDP 文本；兼容原始 JSON SDP */
export async function decodeSdpFromQr(payload: string): Promise<string> {
  const text = payload.trim();
  if (!text.startsWith(PREFIX)) return text;
  if (typeof DecompressionStream === 'undefined') throw new Error('decompression unavailable');
  const bytes = base64UrlToBytes(text.slice(PREFIX.length));
  const raw = await pipeThrough(bytes, new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(raw);
}
