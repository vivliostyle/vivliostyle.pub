export interface Pkce {
  verifier: string;
  challenge: string;
  method: 'S256';
}

function base64UrlEncode(bytes: Uint8Array): string {
  let binary = '';
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function utf8(input: string): ArrayBuffer {
  const encoded = new TextEncoder().encode(input);
  const buffer = new ArrayBuffer(encoded.byteLength);
  new Uint8Array(buffer).set(encoded);
  return buffer;
}

export function randomVerifier(byteLength = 48): string {
  const bytes = new Uint8Array(byteLength);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes);
}

export async function challengeS256(verifier: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', utf8(verifier));
  return base64UrlEncode(new Uint8Array(digest));
}

export async function generatePkce(): Promise<Pkce> {
  const verifier = randomVerifier();
  const challenge = await challengeS256(verifier);
  return { verifier, challenge, method: 'S256' };
}
