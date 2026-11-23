/** Base64url-encoded deflate, with a plain fallback where CompressionStream is missing. */
export async function compress(text: string): Promise<string> {
  const bytes = new TextEncoder().encode(text);
  if (typeof CompressionStream === 'undefined') return 'p' + toBase64Url(bytes);
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new CompressionStream('deflate-raw'));
  return 'z' + toBase64Url(new Uint8Array(await new Response(stream).arrayBuffer()));
}

export async function decompress(code: string): Promise<string> {
  const bytes = fromBase64Url(code.slice(1));
  if (code[0] === 'p') return new TextDecoder().decode(bytes);
  if (code[0] !== 'z') throw new Error('unknown encoding');
  const stream = new Response(bytes as BodyInit).body!.pipeThrough(new DecompressionStream('deflate-raw'));
  return new TextDecoder().decode(await new Response(stream).arrayBuffer());
}

function toBase64Url(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function fromBase64Url(s: string): Uint8Array {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}
