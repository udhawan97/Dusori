const encoder = new TextEncoder();

export async function sha256(content: string | Uint8Array): Promise<string> {
  const bytes = typeof content === 'string' ? encoder.encode(content) : content;
  const transferable = new Uint8Array(bytes.byteLength);
  transferable.set(bytes);
  const digest = await globalThis.crypto.subtle.digest('SHA-256', transferable.buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, '0')).join('');
}
