# Store Files

```ts
await ctx.files.put(`avatars/${ctx.user.id}.png`, upload, { contentType: 'image/png' });
const avatar = await ctx.files.get(`avatars/${ctx.user.id}.png`); // a Blob with .metadata, or undefined
const link = await ctx.files.url(`avatars/${ctx.user.id}.png`, { expiresIn: 3600 });
await ctx.files.delete(`avatars/${ctx.user.id}.png`);
```

- A key is a relative path of plain segments: `avatars/42.png`, never `../x` or `/x`. `.webstir/` is reserved: Webstir keeps local files' media types there.
- `put` takes a string, bytes, a Blob, or a file from a form's file field.
- `url` makes a link that works for `expiresIn` seconds (an hour by default), for an `<img>` or a download.
- Files come from your users, so a local file's link never runs as your app: images, audio, video, PDFs and plain text show in the browser, anything else (HTML and SVG included) downloads, and all of them are served under a sandbox policy.
- The media type given to `put` (or the Blob's own) is kept, so `get` and the link report it.
- Outside a handler: `import { files } from '@webstir-io/webstir-backend/files'`.

## Private documents

Files that must never be replaced or half-read, such as signed versions of a document, have three more options:

```ts
await ctx.files.put(`proposals/${id}/v3.json`, json, {
  ifAbsent: true, // write once: a file already at the key throws FileExistsError
  metadata: { 'uploaded-by': ctx.user.id }, // short text kept with the file
});
const version = await ctx.files.get(`proposals/${id}/v3.json`, { maxBytes: 1_000_000 });
version?.metadata['uploaded-by'];
```

- `ifAbsent` writes only when no file has the key, in one step, so two writers can't both win.
- `metadata` comes back on `get` as `file.metadata`.
- `maxBytes` refuses a larger file with `FileTooLargeError` instead of loading it.
- On S3, every write carries a SHA-256 checksum that S3 checks, and reads are checked against it. Each request gives up after 10 seconds, and the ones that may be retried are, three times.

## Where they go

`STORAGE_URL` picks it:

| `STORAGE_URL` | Storage |
| --- | --- |
| unset, or `file:./data/files` | a folder beside the app; links are served by the app, signed with `SESSION_SECRET` |
| `s3://bucket` or `s3://bucket/prefix` | S3, Cloudflare R2, MinIO or any S3 service, through the AWS SDK; links are presigned |

For S3, set `S3_REGION` (or `AWS_REGION`), and `S3_ENDPOINT` for a service other than AWS. Credentials are `S3_ACCESS_KEY_ID` and `S3_SECRET_ACCESS_KEY` when set; otherwise the SDK finds them its usual way: the `AWS_*` variables, a profile named by `S3_PROFILE` or `AWS_PROFILE` (with `AWS_SHARED_CREDENTIALS_FILE` for a file elsewhere), or the instance's role. `S3_PROFILE` gives storage its own profile when the app's other AWS calls, such as sending email, use another.

## Your own storage client

When neither fits, set a store in `src/backend/index.ts`, before the server starts. `ctx.files` then uses it, with the same key rule:

```ts
import { setFileStore } from '@webstir-io/webstir-backend/files';

setFileStore({
  async put(key, data, options) { /* write it, with options?.contentType, ifAbsent and metadata */ },
  async get(key, options) { /* a Blob with metadata, or undefined; options?.maxBytes */ },
  async url(key, { expiresIn }) { /* a link that works for expiresIn seconds */ },
  async delete(key) { /* remove it */ },
});
```

## Files from a form

A form with `enctype="multipart/form-data"` gives its file fields as `File` objects in `ctx.body`:

```ts
const photo = (ctx.body as Record<string, unknown>).photo;
if (photo instanceof File && photo.size > 0) {
  await ctx.files.put(`photos/${crypto.randomUUID()}`, photo);
}
```

`REQUEST_BODY_MAX_BYTES` (1 MB by default) limits a request; raise it for large uploads.
