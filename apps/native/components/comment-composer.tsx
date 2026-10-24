import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { Directory, File, Paths } from "expo-file-system";
import * as Haptics from "expo-haptics";
import * as ImagePicker from "expo-image-picker";
import { useState } from "react";
import { ActivityIndicator, Alert, Image, Pressable, ScrollView, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { MicButton } from "@/components/mic-button";
import { ErrorNote, IconButton, Input, OptionSheet } from "@/components/ui";
import { api } from "@/lib/api";
import { SERVER_URL } from "@/lib/config";
import { textToHtml } from "@/lib/format";

interface Attached {
  /** Uploaded asset path, `/api/assets/<id>`. */
  url: string;
  /** Local copy, for the thumbnail. */
  preview: string;
}

/** Comment HTML: the typed paragraphs, then each image on its own line (as the web editor stores them). */
export function commentHtml(text: string, imageUrls: string[]): string {
  const body = text.trim() ? textToHtml(text) : "";
  return body + imageUrls.map((url) => `<p><img src="${SERVER_URL}${url}"></p>`).join("");
}

/**
 * Comment box for an issue: text (with dictation), images pasted from the
 * clipboard as removable thumbnails, and Send. Images upload as Atur assets
 * when attached, so Send only posts the comment.
 */
export function CommentComposer({
  sending,
  error,
  onSend,
}: {
  sending: boolean;
  error: unknown;
  /** Post the comment; resolve true when it was saved (the draft then clears). */
  onSend: (html: string) => Promise<boolean>;
}) {
  const { theme } = useUnistyles();
  const [text, setText] = useState("");
  const [images, setImages] = useState<Attached[]>([]);
  const [attaching, setAttaching] = useState(false);
  const [choosing, setChoosing] = useState(false);

  /** Upload local files and add them as thumbnails; each failure is reported once. */
  const upload = async (files: { uri: string; name: string; type: string }[]) => {
    setAttaching(true);
    try {
      for (const file of files) {
        const uploaded = await api.uploadAsset(file);
        setImages((list) => [...list, { url: uploaded.url, preview: file.uri }]);
      }
      void Haptics.selectionAsync().catch(() => {});
    } catch (e) {
      Alert.alert("Couldn't attach the image", e instanceof Error ? e.message : undefined);
    } finally {
      setAttaching(false);
    }
  };

  const fromClipboard = async () => {
    const image = (await Clipboard.hasImageAsync().catch(() => false))
      ? await Clipboard.getImageAsync({ format: "png" }).catch(() => null)
      : null;
    const base64 = image?.data.slice(image.data.indexOf(",") + 1);
    if (!base64) {
      Alert.alert("No image to paste", "Copy a screenshot or photo first.");
      return;
    }
    const dir = new Directory(Paths.cache, "comment-images");
    dir.create({ intermediates: true, idempotent: true });
    const file = new File(dir, `image-${Date.now()}.png`);
    file.create();
    file.write(base64, { encoding: "base64" });
    await upload([{ uri: file.uri, name: "image.png", type: "image/png" }]);
  };

  const fromPicker = async (source: "library" | "camera") => {
    const permission =
      source === "camera"
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      Alert.alert(
        source === "camera" ? "Camera access is off" : "Photo access is off",
        "Turn it on for Atur in Settings to attach images.",
      );
      return;
    }
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ["images"],
      quality: 0.85,
      allowsMultipleSelection: source === "library",
      selectionLimit: 6,
    };
    const result =
      source === "camera"
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (result.canceled) return;
    await upload(
      result.assets.map((a, i) => ({
        uri: a.uri,
        name: a.fileName ?? `photo-${Date.now()}-${i}.jpg`,
        type: a.mimeType ?? "image/jpeg",
      })),
    );
  };

  const choose = (key: string) => {
    // Let the sheet finish closing first: iOS drops a picker presented over a dismissing modal.
    setTimeout(() => {
      if (key === "clipboard") void fromClipboard();
      else void fromPicker(key === "camera" ? "camera" : "library");
    }, 350);
  };

  const canSend = !sending && !attaching && (text.trim().length > 0 || images.length > 0);
  const send = async () => {
    if (!canSend) return;
    const ok = await onSend(
      commentHtml(
        text,
        images.map((i) => i.url),
      ),
    );
    if (ok) {
      setText("");
      setImages([]);
    }
  };

  return (
    <View style={styles.wrap}>
      {images.length > 0 ? (
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.thumbs}
        >
          {images.map((img) => (
            <View key={img.url} style={styles.thumb}>
              <Image source={{ uri: img.preview }} style={styles.thumbImage} />
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove image"
                hitSlop={8}
                onPress={() => setImages((list) => list.filter((i) => i.url !== img.url))}
                style={styles.remove}
              >
                <Ionicons name="close" size={14} color={theme.colors.primaryForeground} />
              </Pressable>
            </View>
          ))}
        </ScrollView>
      ) : null}
      <View style={styles.row}>
        <View style={styles.flex}>
          <Input
            value={text}
            onChangeText={setText}
            placeholder="Add a comment…"
            multiline
            style={styles.input}
          />
        </View>
        {attaching ? (
          <View style={styles.spinner}>
            <ActivityIndicator color={theme.colors.foreground} />
          </View>
        ) : (
          <IconButton icon="image-outline" label="Attach image" onPress={() => setChoosing(true)} />
        )}
        <MicButton value={text} onChangeText={setText} />
        <IconButton
          icon={sending ? "hourglass-outline" : "send"}
          label="Send comment"
          onPress={() => void send()}
        />
      </View>
      {error ? (
        <View style={styles.error}>
          <ErrorNote error={error} />
        </View>
      ) : null}
      <OptionSheet
        visible={choosing}
        title="Attach image"
        onClose={() => setChoosing(false)}
        onSelect={choose}
        options={[
          { key: "library", label: "Photo library" },
          { key: "camera", label: "Take photo" },
          { key: "clipboard", label: "Paste from clipboard" },
        ]}
      />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  wrap: {
    borderTopWidth: 1,
    borderTopColor: theme.colors.hairline,
    backgroundColor: theme.colors.background,
  },
  thumbs: {
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingTop: theme.spacing.sm,
  },
  thumb: { width: 64, height: 64 },
  thumbImage: {
    width: 64,
    height: 64,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.muted,
  },
  remove: {
    position: "absolute",
    top: -6,
    right: -6,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.primary,
  },
  row: {
    flexDirection: "row",
    alignItems: "flex-end",
    gap: theme.spacing.sm,
    paddingHorizontal: theme.spacing.lg,
    paddingVertical: theme.spacing.sm,
  },
  flex: { flex: 1 },
  input: { minHeight: 42, maxHeight: 120, paddingTop: 10 },
  spinner: { width: 40, height: 40, alignItems: "center", justifyContent: "center" },
  error: { paddingHorizontal: theme.spacing.lg, paddingBottom: theme.spacing.sm },
}));
