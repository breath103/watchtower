# Wrap in an options object when there are more than 3 parameters

A function with more than three parameters takes an options object. Positional lists past three are unreadable at the
call site (`f(a, b, true, false)`) and easy to transpose.

```ts
// ✅ Correct — named fields at the call site (src/services/clips.ts, src/status.ts)
await clips.create({ camera: body.camera, start: body.start, end: body.end, stream, transcode });

export function statusSnapshot(opts: {
  startedAt: number;
  nvrs: NvrRecord[];
  // ...
}): StatusSnapshot {
  const { startedAt, nvrs, ... } = opts;
}
```

```ts
// ❌ Wrong — four positionals, two of them booleans-in-disguise
export async function remuxToMp4(tsPath: string, mp4Path: string, codec: Codec, transcode: boolean): Promise<void>
remuxToMp4(src, dest, "hevc", true);
```

Services that need several collaborators take them as one `opts` object in the constructor
(`new ConnectionPool({ db, registry, log })`). Inline the options type when it has one use; name it when it has two.
