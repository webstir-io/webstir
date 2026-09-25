import { RequestBodyTooLargeError } from './core.js';

export type FormBodyValue = string | File;
export type FormBody = Record<string, FormBodyValue | FormBodyValue[]>;

export async function readRequestBody(request: Request, maxBodyBytes: number): Promise<unknown> {
  const method = (request.method ?? 'GET').toUpperCase();
  if (method === 'GET' || method === 'HEAD') {
    return undefined;
  }

  const declaredContentLength = Number(request.headers.get('content-length') ?? '');
  if (Number.isFinite(declaredContentLength) && declaredContentLength > maxBodyBytes) {
    throw new RequestBodyTooLargeError(maxBodyBytes);
  }

  const bodyBytes = await readBoundedBody(request, maxBodyBytes);
  if (bodyBytes.byteLength === 0) {
    return undefined;
  }

  const contentType = request.headers.get('content-type') ?? '';
  const mediaType = contentType.split(';', 1)[0]?.trim().toLowerCase() ?? '';
  if (mediaType === 'multipart/form-data') {
    return await parseMultipart(bodyBytes, contentType);
  }

  const bodyText = Buffer.from(bodyBytes).toString('utf8');
  if (mediaType === 'application/json' || contentType.includes('application/json')) {
    try {
      return JSON.parse(bodyText);
    } catch {
      return undefined;
    }
  }
  if (mediaType === 'application/x-www-form-urlencoded') {
    return collectEntries(new URLSearchParams(bodyText).entries());
  }
  return bodyText;
}

async function readBoundedBody(request: Request, maxBodyBytes: number): Promise<Uint8Array> {
  if (!request.body) {
    return new Uint8Array(0);
  }
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) {
      break;
    }
    total += value.byteLength;
    if (total > maxBodyBytes) {
      await reader.cancel().catch(() => undefined);
      throw new RequestBodyTooLargeError(maxBodyBytes);
    }
    chunks.push(value);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return bytes;
}

async function parseMultipart(
  bytes: Uint8Array,
  contentType: string,
): Promise<FormBody | undefined> {
  let formData: FormData;
  try {
    formData = await new Response(bytes as Uint8Array<ArrayBuffer>, {
      headers: { 'content-type': contentType },
    }).formData();
  } catch {
    return undefined;
  }
  const entries: [string, FormBodyValue][] = [];
  formData.forEach((value, key) => {
    // A file input left empty still posts a part with no name and no bytes.
    if (typeof value !== 'string' && !value.name && value.size === 0) {
      return;
    }
    entries.push([key, value]);
  });
  return collectEntries(entries);
}

function collectEntries(entries: Iterable<[string, FormBodyValue]>): FormBody {
  const body: FormBody = {};
  for (const [key, value] of entries) {
    const existing = body[key];
    if (existing === undefined) {
      body[key] = value;
    } else if (Array.isArray(existing)) {
      existing.push(value);
    } else {
      body[key] = [existing, value];
    }
  }
  return body;
}
