// RFC 6381 codec string (avc1.PPCCLL) from Annex-B H.264 parameter sets, for MSE.
export function h264CodecString(parameterSets: Buffer): string | null {
  const index = parameterSets.indexOf(Buffer.from([0, 0, 1, 0x67]));
  if (index < 0 || index + 6 >= parameterSets.length) return null;
  const profile = parameterSets[index + 4];
  const constraints = parameterSets[index + 5];
  const level = parameterSets[index + 6];
  return `avc1.${profile.toString(16).padStart(2, "0")}${constraints
    .toString(16)
    .padStart(2, "0")}${level.toString(16).padStart(2, "0")}`;
}
