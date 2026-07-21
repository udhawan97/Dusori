import { maxSourceBytes } from './import.js';

const marker = '\n\n[truncated]\n';

export function cappedMarkdown(prefix: string, body: string): string {
  const encoder = new TextEncoder();
  const content = `${prefix}${body}\n`;
  if (encoder.encode(content).byteLength <= maxSourceBytes) return content;

  const available =
    maxSourceBytes - encoder.encode(prefix).byteLength - encoder.encode(marker).byteLength;
  const bytes = encoder.encode(body);
  const truncated = new TextDecoder().decode(bytes.slice(0, Math.max(0, available)));
  let result = `${prefix}${truncated}${marker}`;
  while (encoder.encode(result).byteLength > maxSourceBytes) {
    result = `${prefix}${truncated.slice(0, -(encoder.encode(result).byteLength - maxSourceBytes))}${marker}`;
  }
  return result;
}
