# Store Files

```ts
await ctx.files.put(`avatars/${ctx.user.id}.png`, upload, { contentType: 'image/png' });
const avatar = await ctx.files.get(`avatars/${ctx.user.id}.png`); // a Blob, or undefined
const link = await ctx.files.url(`avatars/${ctx.user.id}.png`, { expiresIn: 3600 });
await ctx.files.delete(`avatars/${ctx.user.id}.png`);
```

- A key is a relative path of plain segments: `avatars/42.png`, never `../x` or `/x`.
- `put` takes a string, bytes, a Blob, or a file from a form's file field.
- `url` makes a link that works for `expiresIn` seconds (an hour by default), for an `<img>` or a download.
- Outside a handler: `import { files } from '@webstir-io/webstir-backend/files'`.

## Where they go

`STORAGE_URL` picks it:

| `STORAGE_URL` | Storage |
| --- | --- |
| unset, or `file:./data/files` | a folder beside the app; links are served by the app, signed with `SESSION_SECRET` |
| `s3://bucket` or `s3://bucket/prefix` | S3, Cloudflare R2, MinIO or any S3 service, through Bun's S3 client; links are presigned |

For S3, set `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` and `S3_REGION` (or the `AWS_*` names), and `S3_ENDPOINT` for a service other than AWS.

## Files from a form

A form with `enctype="multipart/form-data"` gives its file fields as `File` objects in `ctx.body`:

```ts
const photo = (ctx.body as Record<string, unknown>).photo;
if (photo instanceof File && photo.size > 0) {
  await ctx.files.put(`photos/${crypto.randomUUID()}`, photo);
}
```

`REQUEST_BODY_MAX_BYTES` (1 MB by default) limits a request; raise it for large uploads.
