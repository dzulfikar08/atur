import { Redirect } from "expo-router";
import { useState } from "react";
import { Text, TextInput, View } from "react-native";

import { useHardwareChords } from "@/lib/hardware-keys";
import { encodeChord } from "@/lib/terminal-keys";

// Proof screen for the iOS hardware-keyboard module (e2e/keys-uitest drives it with XCUITest):
// only reachable in builds made with EXPO_PUBLIC_ATUR_E2E=1 (app/_layout.tsx registers the route
// only then). It shows the bytes each captured chord encodes to (hex) and what reached the focused
// text field, which must stay empty for chords the module took.
const ENABLED = process.env.EXPO_PUBLIC_ATUR_E2E === "1";

const hex = (data: string) =>
  Array.from(data, (c) => c.charCodeAt(0).toString(16).padStart(2, "0")).join("");

export default function E2EKeys() {
  if (!ENABLED) return <Redirect href="/" />;
  return <Run />;
}

function Run() {
  const [sent, setSent] = useState<string[]>([]);
  const [text, setText] = useState("");
  useHardwareChords(true, (chord) => {
    const data = encodeChord(chord);
    setSent((prev) => [...prev, data === null ? "none" : hex(data)]);
  });
  return (
    <View style={{ flex: 1, paddingTop: 80, paddingHorizontal: 16 }}>
      <TextInput
        testID="keys-input"
        autoFocus
        autoCapitalize="none"
        autoCorrect={false}
        value={text}
        onChangeText={setText}
        style={{ borderWidth: 1, padding: 8 }}
      />
      <Text testID="keys-log" accessibilityLabel={`sent=${sent.join(",")} input=[${text}]`}>
        {`sent=${sent.join(",")} input=[${text}]`}
      </Text>
    </View>
  );
}
