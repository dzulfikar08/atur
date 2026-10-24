import { ExpoSpeechRecognitionModule, useSpeechRecognitionEvent } from "expo-speech-recognition";
import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Platform } from "react-native";

import {
  DICTATION_LOCALES,
  joinTranscript,
  pickDictationLocale,
  type DictationLocale,
} from "@/lib/dictation-text";
import { getItem, setItem } from "@/lib/storage";

// Speech-to-text for text fields. Recognition runs on the device's speech
// engine; when the OS reports on-device support it is required, so no audio
// leaves the phone. The app never records, stores or uploads audio itself.

const LOCALE_KEY = "atur.dictation.locale";
/** Stop listening this long after the last recognised words. */
const SILENCE_MS = 2500;

export type DictationState = "idle" | "starting" | "listening" | "denied" | "unsupported" | "error";

// --- Locale: device default, user-switchable, persisted ----------------------

let locale: DictationLocale = pickDictationLocale(Intl.DateTimeFormat().resolvedOptions().locale);
const localeListeners = new Set<() => void>();

void getItem(LOCALE_KEY).then((stored) => {
  const saved = DICTATION_LOCALES.find((l) => l === stored);
  if (saved && saved !== locale) setDictationLocale(saved, false);
});

function setDictationLocale(next: DictationLocale, persist = true): void {
  locale = next;
  if (persist) void setItem(LOCALE_KEY, next);
  for (const listener of localeListeners) listener();
}

function useDictationLocale(): DictationLocale {
  return useSyncExternalStore(
    (listener) => {
      localeListeners.add(listener);
      return () => localeListeners.delete(listener);
    },
    () => locale,
  );
}

// --- Hook ----------------------------------------------------------------------

/** Human message for a recognizer error code. */
function errorMessage(code: string, lang: DictationLocale): string | null {
  switch (code) {
    case "aborted":
      return null;
    case "no-speech":
    case "speech-timeout":
      return "Didn't catch that. Tap the mic and try again.";
    case "language-not-supported":
      return `Speech recognition for ${lang} isn't available on this device (the language pack may not be installed).`;
    case "network":
      return "Speech recognition needs a network connection on this device.";
    case "audio-capture":
      return "Couldn't access the microphone.";
    case "busy":
      return "Speech recognition is busy. Try again in a moment.";
    default:
      return "Speech recognition failed.";
  }
}

/**
 * Dictate into a text field. Interim results are written into the field as they
 * arrive (re-derived from the text that was there when listening began), and
 * listening stops after a short silence.
 */
export function useDictation(value: string, onChangeText: (text: string) => void) {
  const lang = useDictationLocale();
  const [state, setState] = useState<DictationState>(
    Platform.OS === "web" ? "unsupported" : "idle",
  );
  const [error, setError] = useState<string | null>(null);

  // Every mounted mic hears the module's global events; only the one that
  // started the session (`active`) may react.
  const active = useRef(false);
  const base = useRef("");
  const silence = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const onChange = useRef(onChangeText);
  onChange.current = onChangeText;
  const valueRef = useRef(value);
  valueRef.current = value;

  const clearSilence = () => {
    clearTimeout(silence.current);
    silence.current = undefined;
  };

  const finish = (next: DictationState, message: string | null) => {
    active.current = false;
    clearSilence();
    setState(next);
    setError(message);
  };

  useSpeechRecognitionEvent("start", () => {
    if (active.current) setState("listening");
  });

  useSpeechRecognitionEvent("result", (event) => {
    if (!active.current) return;
    const transcript = event.results[0]?.transcript ?? "";
    onChange.current(joinTranscript(base.current, transcript));
    if (event.isFinal) base.current = joinTranscript(base.current, transcript);
    clearSilence();
    silence.current = setTimeout(() => ExpoSpeechRecognitionModule.stop(), SILENCE_MS);
  });

  useSpeechRecognitionEvent("end", () => {
    if (active.current) finish("idle", null);
  });

  useSpeechRecognitionEvent("error", (event) => {
    if (!active.current) return;
    if (event.error === "not-allowed") {
      finish("denied", "Microphone or speech recognition access is off. Enable it in Settings.");
      return;
    }
    const message = errorMessage(event.error, lang);
    finish(message ? "error" : "idle", message);
  });

  // Leaving the screen mid-dictation must release the microphone.
  useEffect(
    () => () => {
      clearTimeout(silence.current);
      if (active.current) {
        active.current = false;
        ExpoSpeechRecognitionModule.abort();
      }
    },
    [],
  );

  const stop = useCallback(() => ExpoSpeechRecognitionModule.stop(), []);

  const start = useCallback(async () => {
    if (Platform.OS === "web" || active.current) return;
    setError(null);
    setState("starting");
    // Mark active before awaiting: a second tap while the permission dialog is up is ignored.
    active.current = true;
    try {
      const permission = await ExpoSpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        finish("denied", "Microphone or speech recognition access is off. Enable it in Settings.");
        return;
      }
      base.current = valueRef.current;
      // On device whenever this language's offline pack is installed; otherwise the OS recogniser.
      // Forcing on-device without the pack makes Android prompt for a download and then fail.
      const onDevice =
        ExpoSpeechRecognitionModule.supportsOnDeviceRecognition() &&
        (await ExpoSpeechRecognitionModule.getSupportedLocales({})
          .then(({ installedLocales }) =>
            installedLocales.some((l) => l.toLowerCase() === lang.toLowerCase()),
          )
          .catch(() => false));
      ExpoSpeechRecognitionModule.start({
        lang,
        interimResults: true,
        requiresOnDeviceRecognition: onDevice,
        addsPunctuation: true,
        androidIntentOptions: {
          EXTRA_SPEECH_INPUT_COMPLETE_SILENCE_LENGTH_MILLIS: SILENCE_MS,
        },
      });
    } catch {
      finish("error", "Speech recognition isn't available on this device.");
    }
  }, [lang]);

  return {
    state,
    error,
    lang,
    setLang: setDictationLocale,
    start,
    stop,
    toggle: () => (state === "listening" || state === "starting" ? stop() : void start()),
  };
}
