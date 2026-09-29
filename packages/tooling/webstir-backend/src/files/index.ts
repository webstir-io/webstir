import { createHmac, timingSafeEqual } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  type GetObjectCommandOutput,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

import { appRoot } from '../app/app-root.js';
import { sessionSecret } from '../app/env.js';

export type FileData = string | ArrayBuffer | Uint8Array | Blob;

export interface PutOptions {
  /** The file's media type, such as `image/png`; inferred from the key's extension when left out. */
  readonly contentType?: string;
  /** Write only when no file has this key yet; otherwise `put` throws `FileExistsError`. */
  readonly ifAbsent?: boolean;
  /** Short text kept with the file and returned with it, such as who uploaded it. */
  readonly metadata?: Readonly<Record<string, string>>;
}

export interface GetOptions {
  /** The most bytes to read; a larger file throws `FileTooLargeError` instead of loading. */
  readonly maxBytes?: number;
}

/** A stored file: its contents as a Blob (`await file.text()`, `file.stream()`), and its metadata. */
export type StoredFile = Blob & { readonly metadata: Readonly<Record<string, string>> };

export interface Files {
  put(key: string, data: FileData, options?: PutOptions): Promise<void>;
  /** The file, or undefined when there is none. */
  get(key: string, options?: GetOptions): Promise<StoredFile | undefined>;
  /** An address the browser can fetch the file from, for `expiresIn` seconds (default an hour). */
  url(key: string, options?: { readonly expiresIn?: number }): Promise<string>;
  delete(key: string): Promise<void>;
}

/** An app's own storage, for `setFileStore`: Webstir checks keys and settles the options first. */
export interface FileStore {
  put(key: string, data: FileData, options?: PutOptions): Promise<void>;
  get(key: string, options?: GetOptions): Promise<StoredFile | undefined>;
  url(key: string, options: { readonly expiresIn: number }): Promise<string>;
  delete(key: string): Promise<void>;
}

/** `put` with `ifAbsent` found a file already at the key. */
export class FileExistsError extends Error {
  constructor(readonly key: string) {
    super(`A file already exists at ${key}.`);
    this.name = 'FileExistsError';
  }
}

/** `get` with `maxBytes` found a larger file. */
export class FileTooLargeError extends Error {
  constructor(
    readonly key: string,
    readonly maxBytes: number,
  ) {
    super(`The file at ${key} is larger than ${maxBytes} bytes.`);
    this.name = 'FileTooLargeError';
  }
}

let customStore: FileStore | undefined;

/** Keeps files with this store instead of STORAGE_URL: an app's own client for its storage. */
export function setFileStore(store: FileStore | undefined): void {
  customStore = store;
}

/** The app's own store, when it set one, for a key that passes the same check. */
function appStore(key: string): FileStore | undefined {
  if (customStore) checkKey(key);
  return customStore;
}

export const LOCAL_FILES_PATH = '/api/_webstir/files/';
export const DEFAULT_STORAGE_URL = 'file:./data/files';

/**
 * File storage: `STORAGE_URL=file:./data/files` (the default) keeps files on disk; `s3://bucket` or
 * `s3://bucket/prefix` keeps them in S3, R2 or MinIO through the AWS SDK. It reads S3_* settings
 * (key, secret, region, endpoint, profile), or finds AWS credentials the SDK's usual way: AWS_*
 * variables, an `AWS_PROFILE`, or the instance's role. `setFileStore` puts an app's own store in their place.
 */
export const files: Files = {
  async put(key, data, options) {
    const type =
      options?.contentType ?? (data instanceof Blob && data.type ? data.type : undefined);
    const own = appStore(key);
    if (own) {
      const contentType = type ?? typeFromKey(key);
      const settled = { ...options, ...(contentType ? { contentType } : {}) };
      return own.put(key, data, Object.keys(settled).length > 0 ? settled : undefined);
    }
    const store = resolveStore();
    if (store.kind === 's3') return putS3(store, key, data, type, options);
    return putLocal(store, key, data, type, options);
  },
  async get(key, options) {
    const own = appStore(key);
    if (own) return own.get(key, options);
    const store = resolveStore();
    if (store.kind === 's3') return getS3(store, key, options);
    return existsSync(store.file(key)) ? await localFile(store, key, options) : undefined;
  },
  async url(key, options) {
    const expiresIn = Math.max(1, Math.floor(options?.expiresIn ?? 3600));
    const own = appStore(key);
    if (own) return own.url(key, { expiresIn });
    const store = resolveStore();
    if (store.kind === 's3') {
      return getSignedUrl(
        store.client,
        new GetObjectCommand({ Bucket: store.bucket, Key: store.key(key) }),
        { expiresIn },
      );
    }
    checkKey(key);
    const expires = Math.floor(Date.now() / 1000) + expiresIn;
    const address = `${LOCAL_FILES_PATH}${key.split('/').map(encodeURIComponent).join('/')}`;
    return `${address}?expires=${expires}&signature=${signLocal(key, expires)}`;
  },
  async delete(key) {
    const own = appStore(key);
    if (own) return own.delete(key);
    const store = resolveStore();
    if (store.kind === 's3') {
      await store.client.send(
        new DeleteObjectCommand({ Bucket: store.bucket, Key: store.key(key) }),
      );
      return;
    }
    await rm(store.file(key), { force: true });
    await rm(store.typeFile(key), { force: true });
    await rm(store.metadataFile(key), { force: true });
  },
};

async function bytesOf(data: FileData): Promise<Uint8Array> {
  if (typeof data === 'string') return new TextEncoder().encode(data);
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  return new Uint8Array(await data.arrayBuffer());
}

async function putLocal(
  store: Extract<Store, { kind: 'local' }>,
  key: string,
  data: FileData,
  type: string | undefined,
  options: PutOptions | undefined,
): Promise<void> {
  const file = store.file(key);
  await mkdir(path.dirname(file), { recursive: true });
  try {
    // `wx` creates the file only when none is there, in one step, so two writers cannot both win.
    await writeFile(file, await bytesOf(data), { flag: options?.ifAbsent ? 'wx' : 'w' });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'EEXIST') throw new FileExistsError(key);
    throw error;
  }
  // A folder has no media types or metadata, so they are kept beside it, as S3 keeps them.
  await keepBeside(store.typeFile(key), type);
  await keepBeside(
    store.metadataFile(key),
    options?.metadata && Object.keys(options.metadata).length > 0
      ? JSON.stringify(options.metadata)
      : undefined,
  );
}

async function keepBeside(file: string, contents: string | undefined): Promise<void> {
  if (contents === undefined) {
    await rm(file, { force: true });
    return;
  }
  await mkdir(path.dirname(file), { recursive: true });
  await Bun.write(file, contents);
}

async function putS3(
  store: Extract<Store, { kind: 's3' }>,
  key: string,
  data: FileData,
  type: string | undefined,
  options: PutOptions | undefined,
): Promise<void> {
  try {
    await store.client.send(
      new PutObjectCommand({
        Bucket: store.bucket,
        Key: store.key(key),
        Body: await bytesOf(data),
        ...(type ? { ContentType: type } : {}),
        ...(options?.metadata ? { Metadata: { ...options.metadata } } : {}),
        ...(options?.ifAbsent ? { IfNoneMatch: '*' } : {}),
        // S3 checks the bytes it receives against this, and returns it on reads to check them.
        ChecksumAlgorithm: 'SHA256',
      }),
    );
  } catch (error) {
    if (options?.ifAbsent && statusOf(error) === 412) throw new FileExistsError(key);
    throw error;
  }
}

async function getS3(
  store: Extract<Store, { kind: 's3' }>,
  key: string,
  options: GetOptions | undefined,
): Promise<StoredFile | undefined> {
  let response: GetObjectCommandOutput;
  try {
    response = await store.client.send(
      new GetObjectCommand({ Bucket: store.bucket, Key: store.key(key), ChecksumMode: 'ENABLED' }),
    );
  } catch (error) {
    if (statusOf(error) === 404) return undefined;
    throw error;
  }
  const limit = options?.maxBytes;
  const body = response.Body as
    | { transformToByteArray(): Promise<Uint8Array>; destroy?(): void }
    | undefined;
  if (limit !== undefined && (response.ContentLength ?? 0) > limit) {
    body?.destroy?.();
    throw new FileTooLargeError(key, limit);
  }
  const bytes = body ? await body.transformToByteArray() : new Uint8Array();
  if (limit !== undefined && bytes.byteLength > limit) throw new FileTooLargeError(key, limit);
  return withMetadata(
    new Blob(
      [bytes as Uint8Array<ArrayBuffer>],
      response.ContentType ? { type: response.ContentType } : undefined,
    ),
    response.Metadata ?? {},
  );
}

function statusOf(error: unknown): number | undefined {
  return (error as { $metadata?: { httpStatusCode?: number } })?.$metadata?.httpStatusCode;
}

function withMetadata(blob: Blob, metadata: Record<string, string>): StoredFile {
  return Object.assign(blob, { metadata: Object.freeze({ ...metadata }) });
}

/** The media type a key's extension names, as local disk and S3 infer it, or undefined. */
function typeFromKey(key: string): string | undefined {
  const type = Bun.file(key).type;
  return type && !type.startsWith('application/octet-stream') ? type : undefined;
}

// Types a browser shows without running anything; anything else is served as a download.
const INLINE_TYPES =
  /^(?:image\/(?:png|jpeg|gif|webp|avif)|audio\/[\w.+-]+|video\/[\w.+-]+|application\/pdf|text\/plain)(?:;|$)/;

/** A download's name: plain ASCII for old clients, and the real name encoded (RFC 6266). */
function attachment(name: string): string {
  const plain = name.replace(/[^\x20-\x7e]|["\\]/g, '_');
  const encoded = encodeURIComponent(name).replace(
    /[!'()*]/g,
    (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${plain}"; filename*=UTF-8''${encoded}`;
}

async function localFile(
  store: Extract<Store, { kind: 'local' }>,
  key: string,
  options?: GetOptions,
): Promise<StoredFile> {
  const file = store.file(key);
  if (options?.maxBytes !== undefined && (await stat(file)).size > options.maxBytes) {
    throw new FileTooLargeError(key, options.maxBytes);
  }
  const typeFile = Bun.file(store.typeFile(key));
  const type = (await typeFile.exists()) ? (await typeFile.text()).trim() : undefined;
  const metadataFile = Bun.file(store.metadataFile(key));
  const metadata = (await metadataFile.exists())
    ? (JSON.parse(await metadataFile.text()) as Record<string, string>)
    : {};
  return withMetadata(Bun.file(file, type ? { type } : undefined), metadata);
}

/** Serves a file on local disk to a link `files.url` signed, or answers why not. */
export async function serveLocalFile(url: URL): Promise<Response | undefined> {
  if (!url.pathname.startsWith(LOCAL_FILES_PATH)) return undefined;
  const store = customStore ? undefined : resolveStore();
  if (store?.kind !== 'local') return new Response('Not found.', { status: 404 });
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
  | {
      kind: 'local';
      file(key: string): string;
      typeFile(key: string): string;
      metadataFile(key: string): string;
    }
  | { kind: 's3'; client: S3Client; bucket: string; key(key: string): string };

const cachedStores = new Map<string, Store>();

// Each request gives up after S3_TIMEOUT_MS (ten seconds by default), and the SDK retries the
// ones that may be retried.
const S3_REQUEST_TIMEOUT_MS = 10_000;
const S3_ATTEMPTS = 3;

function resolveStore(url = process.env.STORAGE_URL?.trim() || DEFAULT_STORAGE_URL): Store {
  const settings = s3Settings();
  const key = `${appRoot()}\n${url}\n${JSON.stringify(settings)}`;
  const known = cachedStores.get(key);
  if (known) return known;
  let store: Store;
  if (url.startsWith('s3://')) {
    const [bucket, ...prefix] = url.slice('s3://'.length).split('/').filter(Boolean);
    if (!bucket) throw new Error(`STORAGE_URL "${url}" names no bucket; use s3://bucket.`);
    const base = prefix.join('/');
    const client = new S3Client({
      region: settings.region ?? 'us-east-1',
      ...(settings.endpoint ? { endpoint: settings.endpoint, forcePathStyle: true } : {}),
      ...(settings.profile ? { profile: settings.profile } : {}),
      ...(settings.accessKeyId && settings.secretAccessKey
        ? {
            credentials: {
              accessKeyId: settings.accessKeyId,
              secretAccessKey: settings.secretAccessKey,
              ...(settings.sessionToken ? { sessionToken: settings.sessionToken } : {}),
            },
          }
        : {}),
      maxAttempts: S3_ATTEMPTS,
      requestHandler: {
        requestTimeout: settings.timeoutMs ?? S3_REQUEST_TIMEOUT_MS,
        // Without this, the SDK only logs a request that runs over and keeps waiting on it.
        throwOnRequestTimeout: true,
        connectionTimeout: Math.min(settings.timeoutMs ?? S3_REQUEST_TIMEOUT_MS, 5_000),
      },
    });
    store = {
      kind: 's3',
      client,
      bucket,
      key: (key) => (checkKey(key), base ? `${base}/${key}` : key),
    };
  } else if (url.startsWith('file:')) {
    const root = path.resolve(appRoot(), url.slice('file:'.length).replace(/^\/\/(?=\/)/, ''));
    store = {
      kind: 'local',
      file: (key) => (checkKey(key), path.join(root, ...key.split('/'))),
      // Inside the storage folder, under names no file key may take.
      typeFile: (key) => (checkKey(key), path.join(root, TYPES_FOLDER, ...key.split('/'))),
      metadataFile: (key) => (checkKey(key), path.join(root, METADATA_FOLDER, ...key.split('/'))),
    };
  } else {
    throw new Error(
      `STORAGE_URL "${url}" is not a storage URL; use file:./data/files or s3://bucket.`,
    );
  }
  if (cachedStores.size > 8) cachedStores.clear();
  cachedStores.set(key, store);
  return store;
}

/**
 * For Webstir's own use: a store at another storage URL, such as SNAPSHOT_URL, with the same
 * settings and key rule as `files`.
 */
export function storeAt(url: string): {
  put(key: string, data: FileData, options?: PutOptions): Promise<void>;
  /** Every key in the store, in no particular order. */
  list(): Promise<string[]>;
  delete(key: string): Promise<void>;
} {
  const store = resolveStore(url);
  return {
    put: (key, data, options) =>
      store.kind === 's3'
        ? putS3(store, key, data, options?.contentType, options)
        : putLocal(store, key, data, options?.contentType, options),
    async list() {
      if (store.kind === 'local') {
        const root = store.file('x').slice(0, -2);
        if (!existsSync(root)) return [];
        return (await readdir(root, { recursive: true, withFileTypes: true }))
          .filter((entry) => entry.isFile())
          .map((entry) =>
            path.relative(root, path.join(entry.parentPath, entry.name)).split(path.sep).join('/'),
          )
          .filter((key) => !key.toLowerCase().startsWith('.webstir/'));
      }
      const prefix = store.key('x').slice(0, -1);
      const keys: string[] = [];
      let token: string | undefined;
      do {
        const page = await store.client.send(
          new ListObjectsV2Command({
            Bucket: store.bucket,
            Prefix: prefix,
            ...(token ? { ContinuationToken: token } : {}),
          }),
        );
        for (const item of page.Contents ?? []) {
          if (item.Key) keys.push(item.Key.slice(prefix.length));
        }
        token = page.IsTruncated ? page.NextContinuationToken : undefined;
      } while (token);
      return keys;
    },
    async delete(key) {
      if (store.kind === 's3') {
        await store.client.send(
          new DeleteObjectCommand({ Bucket: store.bucket, Key: store.key(key) }),
        );
        return;
      }
      await rm(store.file(key), { force: true });
      await rm(store.typeFile(key), { force: true });
      await rm(store.metadataFile(key), { force: true });
    },
  };
}

/**
 * S3 settings from the environment as it is now, `.env` files included. Without a key and secret,
 * the SDK finds credentials itself: AWS_* variables, a profile (`S3_PROFILE`, else `AWS_PROFILE`), or
 * the instance's role.
 */
function s3Settings(): {
  accessKeyId?: string;
  secretAccessKey?: string;
  sessionToken?: string;
  region?: string;
  endpoint?: string;
  profile?: string;
  timeoutMs?: number;
} {
  const pick = (...names: string[]) =>
    names.map((name) => process.env[name]?.trim()).find((value) => value);
  const settings = {
    accessKeyId: pick('S3_ACCESS_KEY_ID', 'AWS_ACCESS_KEY_ID'),
    secretAccessKey: pick('S3_SECRET_ACCESS_KEY', 'AWS_SECRET_ACCESS_KEY'),
    sessionToken: pick('S3_SESSION_TOKEN', 'AWS_SESSION_TOKEN'),
    region: pick('S3_REGION', 'AWS_REGION'),
    endpoint: pick('S3_ENDPOINT', 'AWS_ENDPOINT'),
    profile: pick('S3_PROFILE', 'AWS_PROFILE'),
    timeoutMs: readTimeout(pick('S3_TIMEOUT_MS')),
  };
  return Object.fromEntries(Object.entries(settings).filter((entry) => Boolean(entry[1])));
}

function readTimeout(raw: string | undefined): number | undefined {
  if (raw === undefined) return undefined;
  const value = Number(raw);
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`S3_TIMEOUT_MS is "${raw}"; expected a whole number of milliseconds.`);
  }
  return value;
}

const TYPES_FOLDER = path.join('.webstir', 'types');
const METADATA_FOLDER = path.join('.webstir', 'metadata');

/** A key is a relative path of plain segments: `avatars/42.png`, never `../x`, `/x` or `.webstir/...`. */
function checkKey(key: string): void {
  const segments = key.split('/');
  if (segments[0]?.toLowerCase() === '.webstir') {
    throw new Error(
      `"${key}" is not a file key; .webstir/ is where Webstir keeps file types and metadata.`,
    );
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
