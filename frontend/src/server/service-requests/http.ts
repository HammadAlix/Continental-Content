import "server-only";
import { isIP } from "node:net";

export class RequestError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export function verifyOfficeRequest(request: Request) {
  const configured = process.env.APP_URL || (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
  const url = new URL(configured);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && ["localhost", "127.0.0.1"].includes(url.hostname))) throw new Error("Invalid APP_URL.");
  if (request.headers.get("origin") !== url.origin) throw new RequestError("Please submit from the website directly.", 403);
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "application/json") throw new RequestError("Expected a JSON request.", 415);
  const key = request.headers.get("idempotency-key");
  if (!key || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(key)) throw new RequestError("Refresh the form and try again.", 400);
  return key.toLowerCase();
}

export function officeClientIp(request: Request) {
  // Vercel replaces this header. Other hosts must explicitly trust a sanitizing proxy.
  const raw = process.env.VERCEL
    ? request.headers.get("x-vercel-forwarded-for")
    : process.env.TRUST_PROXY === "true" ? request.headers.get("x-forwarded-for") : null;
  const ip = raw?.split(",")[0].trim();
  if (process.env.VERCEL && (!ip || !isIP(ip))) throw new Error("Trusted client address missing.");
  return ip && isIP(ip) ? ip : "local-shared";
}

export async function readOfficeBody(request: Request, maximum = 16 * 1024) {
  if (Number(request.headers.get("content-length")) > maximum) throw new RequestError("Request too large.", 413);
  const reader = request.body?.getReader();
  if (!reader) throw new RequestError("Empty request.", 400);
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  let timedOut = false;
  const timeout = setTimeout(() => { timedOut = true; void reader.cancel().catch(() => {}); }, 5000);
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (timedOut) throw new RequestError("Request timed out.", 408);
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maximum) { await reader.cancel(); throw new RequestError("Request too large.", 413); }
      chunks.push(value);
    }
    try { return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown; }
    catch { throw new RequestError("Malformed request.", 400); }
  } finally { clearTimeout(timeout); reader.releaseLock(); }
}
