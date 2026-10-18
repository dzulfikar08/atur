export type DictationLocale = "id-ID" | "en-US";

export const DICTATION_LOCALES: DictationLocale[] = ["id-ID", "en-US"];

/** Indonesian when the device is set to it, English otherwise. */
export function pickDictationLocale(deviceTag: string | undefined): DictationLocale {
  return deviceTag?.toLowerCase().startsWith("id") ? "id-ID" : "en-US";
}

/** Append a transcript to the text already in the field, separated by one space. */
export function joinTranscript(base: string, transcript: string): string {
  const spoken = transcript.trim();
  if (spoken === "") return base;
  if (base === "" || /\s$/.test(base)) return base + spoken;
  return `${base} ${spoken}`;
}
