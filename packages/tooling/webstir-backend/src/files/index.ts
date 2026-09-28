import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { appRoot } from '../app/app-root.js';
import { sessionSecret } from '../app/env.js';

export type FileData = string | ArrayBuffer | Uint8Array | Blob;

export interface PutOptions {
  /** The file's media type, such as `image/png`; inferred from the key's extension when left out. */
  readonly contentType?: string;
}

export interface Files {
  put(key: string, data: FileData, options?: PutOptions): Promise<void>;
  /** The file, as a Blob (`await file.text()`, `file.stream()`), or undefined when there is none. */
  get(key: string): Promise<Blob | undefined>;
  /** An address the browser can fetch the file from, for `expiresIn` seconds (default an hour). */
  url(key: string, options?: { readonly expiresIn?: number }): Promise<string>;
  delete(key: string): Promise<void>;
}

export const LOCAL_FILES_PATH = '/api/_webstir/files/';
export const DEFAULT_STORAGE_URL = 'file:./data/files';

/**
 * File storage: `STORAGE_URL=file:./data/files` (the default) keeps files on disk; `s3://bucket` or
 * `s3://bucket/prefix` keeps them in S3, R2 or MinIO through Bun's S3 client, which reads the usual
 * S3_* or AWS_* credentials and S3_ENDPOINT.
 */
export const files: Files = {
  async put(key, data, options) {
    const store = resolveStore();
    const type =
      options?.contentType ?? (data instanceof Blob && data.type ? data.type : undefined);
    if (store.kind === 's3') {
      await store.client.write(store.key(key), data, type ? { type } : undefined);
      return;
    }
    const file = store.file(key);
    await mkdir(path.dirname(file), { recursive: true });
    await Bun.write(file, data);
    // A folder has no media types, so the given one is kept beside it, as S3 keeps it.
    const typeFile = store.typeFile(key);
    if (type) {
      await mkdir(path.dirname(typeFile), { recursive: true });
      await Bun.write(typeFile, type);
    } else {
      await rm(typeFile, { force: true });
    }
  },
  async get(key) {
    const store = resolveStore();
    if (store.kind === 's3') {
      const file = store.client.file(store.key(key));
      return (await file.exists()) ? file : undefined;
    }
    return existsSync(store.file(key)) ? await localFile(store, key) : undefined;
  },
  async url(key, options) {
    const store = resolveStore();
    const expiresIn = Math.max(1, Math.floor(options?.expiresIn ?? 3600));
    if (store.kind === 's3') return store.client.presign(store.key(key), { expiresIn });
    checkKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const address = `${LOCAL_FILES_PATH}${key.split('/').map(encodeURIComponent).join('/')}`;
    return `${address}?expires=${expires}&signature=${signLocal(key, expires)}`;
  },
  async delete(key) {
    const store = resolveStore();
    if (store.kind === 's3') {
      await store.client.delete(store.key(key));
      return;
    }
    await rm(store.file(key), { force: true });
    await rm(store.typeFile(key), { force: true });
  },
};

// Types a browser shows without running anything; anything else is served as a download.
const INLINE_TYPES =
  /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf|text\/plain)(?:;|$)/;

/** A download's name: plain ASCII for old clients, and the real name encoded (RFC 6266). */
function attachment(name: string): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  return `attachment; filename="${plain}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

async function localFile(store: Extract<Store, { kind: 'local' }>, key: string): Promise<Blob> {
  const typeFile = Bun.file(store.typeFile(key));
  const type = (await typeFile.exists()) ? (await typeFile.text()).trim() : undefined;
  return Bun.file(store.file(key), type ? { type } : undefined);
}

/** Serves a file on local disk to a link `files.url` signed, or answers why not. */
export async function serveLocalFile(url: URL): Promise<Response | undefined> {
  if (!url.pathname.startsWith(LOCAL_FILES_PATH)) return undefined;
  const store = resolveStore();
  if (store.kind !== 'local') return new Response('Not found.', { status: 404 });
  let key: string;
  try {
    key = url.pathname.slice(LOCAL_FILES_PATH.length).split('/').map(decodeURIComponent).join('/');
    checkKey(key);
  } catch {
    return new Response('Not found.', { status: 404 });
  }
  const expires = Number(url.searchParams.get('expires'));
  const signature = url.searchParams.get('signature') ?? '';
  const expected = signLocal(key, expires);
  const valid =
    Number.isFinite(expires) &&
    expires * 1000 > Date.now() &&
    signature.length === expected.length &&
    timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  if (!valid) return new Response('This link has expired or is not valid.', { status: 403 });
  if (!existsSync(store.file(key))) return new Response('Not found.', { status: 404 });
  const file = await localFile(store, key);
  const type = file.type || 'application/octet-stream';
  // Files come from the app's users: on the app's own address, nothing in one may run as the app.
  const headers = new Headers({
    'content-type': type,
    'cache-control': 'private, max-age=300',
    'x-content-type-options': 'nosniff',
    'content-security-policy': "sandbox; default-src 'none'",
  });
  if (!INLINE_TYPES.test(type)) {
    headers.set('content-disposition', attachment(path.basename(key)));
  }
  return new Response(file, { headers });
}

type Store =
  | { kind: 'local'; file(key: string): string; typeFile(key: string): string }
  | { kind: 's3'; client: Bun.S3Client; key(key: string): string };

let cached: { key: string; store: Store } | undefined;

function resolveStore(): Store {
  const url = process.env.STORAGE_URL?.trim() || DEFAULT_STORAGE_URL;
  const credentials = s3Credentials();
  const key = `${appRoot()}\n${url}\n${JSON.stringify(credentials)}`;
  if (cached?.key === key) return cached.store;
  let store: Store;
  if (url.startsWith('s3://')) {
    const [bucket, ...prefix] = url.slice('s3://'.length).split('/').filter(Boolean);
    if (!bucket) throw new Error(`STORAGE_URL "${url}" names no bucket; use s3://bucket.`);
    const base = prefix.join('/');
    const client = new Bun.S3Client({ bucket, ...credentials });
    store = { kind: 's3', client, key: (key) => (checkKey(key), base ? `${base}/${key}` : key) };
  } else if (url.startsWith('file:')) {
    const root = path.resolve(appRoot(), url.slice('file:'.length).replace(/^\/\/(?=\/)/, ''));
    store = {
      kind: 'local',
      file: (key) => (checkKey(key), path.join(root, ...key.split('/'))),
      // Inside the storage folder, under a name no file key may take.
      typeFile: (key) => (checkKey(key), path.join(root, TYPES_FOLDER, ...key.split('/'))),
    };
  } else {
    throw new Error(
      `STORAGE_URL "${url}" is not a storage URL; use file:./data/files or s3://bucket.`,
    );
  }
  cached = { key, store };
  return store;
}

/**
 * S3 settings from the environment as it is now, `.env` files included: Bun's client reads its own
 * only when the process starts.
 */
function s3Credentials(): Record<string, string> {
  const pick = (...names: string[]) =>
    names.map((name) => process.env[name]?.trim()).find((value) => value);
  const settings = {
    accessKeyId: pick('S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: pick('S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    sessionToken: pick('S3_SESSION_TOKEN', 'AWS_SESSION_TOKEN'),
    region: pick('S3_REGION', 'AWS_REGION'),
    endpoint: pick('S3_ENDPOINT', 'AWS_ENDPOINT'),
  };
  return Object.fromEntries(
    Object.entries(settings).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

const TYPES_FOLDER = path.join('.webstir', 'types');

/** A key is a relative path of plain segments: `avatars/42.png`, never `../x`, `/x` or `.webstir/...`. */
function checkKey(key: string): void {
  const segments = key.split('/');
  if (segments[0] === '.webstir') {
    throw new Error(`"${key}" is not a file key; .webstir/ is where Webstir keeps file types.`);
  }
  const plain = segments.every(
    (segment) => segment !== '' && segment !== '.' && segment !== '..' && !/[\\\0]/.test(segment),
  );
  if (!plain)
    throw new Error(`"${key}" is not a file key; use a relative path such as avatars/42.png.`);
}

function signLocal(key: string, expires: number): string {
  return createHmac('sha256', `${sessionSecret()}:files`)
    .update(`${key}\n${expires}`)
    .digest('base64url');
}
