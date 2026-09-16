import { env } from "cloudflare:workers";

type CredentialEnv = { CREDENTIAL_ENCRYPTION_KEY?: string; COMFYUI_BRIDGE_TOKEN?: string };

function encryptionSecret(): string {
  const runtime = env as unknown as CredentialEnv;
  const value = runtime.CREDENTIAL_ENCRYPTION_KEY?.trim() || runtime.COMFYUI_BRIDGE_TOKEN?.trim();
  if (!value || value.length < 32) throw new Error("CREDENTIAL_ENCRYPTION_KEY_MISSING");
  return value;
}

async function encryptionKey(): Promise<CryptoKey> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(encryptionSecret()));
  return crypto.subtle.importKey("raw", digest, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function encode(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

function decode(value: string): ArrayBuffer {
  const binary = atob(value);
  const bytes = Uint8Array.from(binary, (character) => character.charCodeAt(0));
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer;
}

export async function encryptCredential(value: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await encryptionKey(), new TextEncoder().encode(value));
  return `v1.${encode(iv)}.${encode(new Uint8Array(encrypted))}`;
}

export async function decryptCredential(value: string): Promise<string> {
  const [version, encodedIv, encodedPayload] = value.split(".");
  if (version !== "v1" || !encodedIv || !encodedPayload) throw new Error("CREDENTIAL_FORMAT_INVALID");
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv: new Uint8Array(decode(encodedIv)) }, await encryptionKey(), decode(encodedPayload));
  return new TextDecoder().decode(decrypted);
}
