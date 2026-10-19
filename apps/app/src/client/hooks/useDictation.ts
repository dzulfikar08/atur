/**
 * Browser dictation via the Web Speech API (Chrome, Edge, Safari). Unlike the
 * app, where recognition runs on the phone, the browser decides where audio
 * goes: Chrome sends it to Google's speech service. The UI says so in the mic
 * button's tooltip. Firefox has no implementation: `supported` is false.
 */
import { useCallback, useEffect, useRef, useState } from "react";

interface RecognitionResult {
  isFinal: boolean;
  0: { transcript: string };
}
interface RecognitionEvent {
  resultIndex: number;
  results: ArrayLike<RecognitionResult>;
}
interface Recognition {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((e: RecognitionEvent) => void) | null;
  onerror: ((e: { error: string }) => void) | null;
  onend: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}
type RecognitionCtor = new () => Recognition;

function recognitionCtor(): RecognitionCtor | null {
  if (typeof window === "undefined") return null;
  const w = window as unknown as {
    SpeechRecognition?: RecognitionCtor;
    webkitSpeechRecognition?: RecognitionCtor;
  };
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null;
}

/** id-ID for Indonesian browsers, en-US otherwise (same rule as the app). */
export function dictationLocale(languages: readonly string[]): string {
  return languages.some((l) => l.toLowerCase().startsWith("id")) ? "id-ID" : "en-US";
}

/**
 * `start(base)` listens and calls `onText(base + transcript)` as results come
 * in (interim included), so the field shows words live; listening ends on
 * silence or `stop()`.
 */
export function useDictation(onText: (text: string) => void) {
  const ctor = recognitionCtor();
  const [listening, setListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const rec = useRef<Recognition | null>(null);
  const onTextRef = useRef(onText);
  onTextRef.current = onText;

  useEffect(() => () => rec.current?.abort(), []);

  const start = useCallback(
    (base: string) => {
      if (!ctor || rec.current) return;
      const r = new ctor();
      r.lang = dictationLocale(navigator.languages ?? [navigator.language]);
      r.continuous = false;
      r.interimResults = true;
      const prefix = base === "" || /\s$/.test(base) ? base : `${base} `;
      let finalText = "";
      r.onresult = (e) => {
        let interim = "";
        for (let i = e.resultIndex; i < e.results.length; i++) {
          const res = e.results[i]!;
          if (res.isFinal) finalText += res[0].transcript;
          else interim += res[0].transcript;
        }
        onTextRef.current(prefix + (finalText + interim).trimStart());
      };
      r.onerror = (e) => {
        if (e.error === "not-allowed" || e.error === "service-not-allowed") {
          setError("Microphone access is blocked for this site.");
        } else if (e.error !== "no-speech" && e.error !== "aborted") {
          setError(`Dictation failed (${e.error}).`);
        }
      };
      r.onend = () => {
        rec.current = null;
        setListening(false);
      };
      setError(null);
      rec.current = r;
      setListening(true);
      r.start();
    },
    [ctor],
  );

  const stop = useCallback(() => rec.current?.stop(), []);
  /** Stop and drop any result still on its way (e.g. the draft was just sent). */
  const abort = useCallback(() => {
    const r = rec.current;
    if (!r) return;
    r.onresult = null;
    r.abort();
  }, []);

  return { supported: ctor !== null, listening, error, start, stop, abort };
}
