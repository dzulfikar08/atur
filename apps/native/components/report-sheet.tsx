import "@/unistyles";
import { useMutation, useQuery } from "@tanstack/react-query";
import * as WebBrowser from "expo-web-browser";
import { useState } from "react";
import { Image, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Chip, ErrorNote, Input, Sheet, Text } from "@/components/ui";
import { api } from "@/lib/api";
import {
  captureCurrentScreen,
  REPORT_KINDS,
  reportUrl,
  submitReport,
  type ReportKind,
  type Screenshot,
} from "@/lib/feedback";
import { displayName } from "@/lib/format";

const TITLE_MIN = 3;
const TITLE_MAX = 120;
const DESCRIPTION_MAX = 4000;

const STEP_LABEL = { uploading: "Uploading screenshot…", sending: "Sending…" } as const;

/**
 * Report sheet state for a screen. `open()` snapshots the screen first (so the
 * sheet isn't in the picture), then shows the sheet; render `sheet` once.
 */
export function useReportSheet() {
  const [visible, setVisible] = useState(false);
  const [screenshot, setScreenshot] = useState<Screenshot | null>(null);
  const open = async () => {
    setScreenshot(await captureCurrentScreen());
    setVisible(true);
  };
  const sheet = (
    <ReportSheet visible={visible} screenshot={screenshot} onClose={() => setVisible(false)} />
  );
  return { open, sheet };
}

function ReportSheet({
  visible,
  screenshot,
  onClose,
}: {
  visible: boolean;
  screenshot: Screenshot | null;
  onClose: () => void;
}) {
  const me = useQuery({ queryKey: ["me"], queryFn: api.me });
  const [kind, setKind] = useState<ReportKind>("idea");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  // The screenshot is on by default; the user can drop it before sending.
  const [dropped, setDropped] = useState(false);
  const [step, setStep] = useState<keyof typeof STEP_LABEL>("sending");

  const attached = screenshot && !dropped ? screenshot : null;
  const send = useMutation({
    mutationFn: () =>
      submitReport(
        {
          kind,
          title,
          description,
          screenshot: attached,
          user: me.data
            ? { id: me.data.id, email: me.data.email, name: displayName(me.data) }
            : null,
        },
        setStep,
      ),
  });

  const close = () => {
    onClose();
    // Fresh form next time; wait out the fade so the content doesn't flash.
    setTimeout(() => {
      setKind("idea");
      setTitle("");
      setDescription("");
      setDropped(false);
      send.reset();
    }, 250);
  };

  const filed = send.data;
  return (
    <Sheet
      visible={visible}
      tall={!filed}
      title={filed ? "Thank you" : "Send feedback"}
      onClose={close}
    >
      {filed ? (
        <View style={styles.form}>
          <Text style={styles.body}>
            {kind === "idea"
              ? "Your idea is on our board."
              : "Your report is with the team. We'll follow up by email."}
          </Text>
          <Text style={styles.reference}>{`Reference #${filed.sequence_id}`}</Text>
          <Button
            variant="secondary"
            icon="open-outline"
            label="View it online"
            onPress={() => void WebBrowser.openBrowserAsync(reportUrl(filed.url))}
          />
          <Button label="Done" onPress={close} />
        </View>
      ) : (
        <View style={styles.form}>
          <View style={styles.kinds}>
            {REPORT_KINDS.map((k) => (
              <Chip
                key={k.value}
                label={k.label}
                selected={kind === k.value}
                onPress={() => setKind(k.value)}
              />
            ))}
          </View>
          <Text style={styles.hint}>{REPORT_KINDS.find((k) => k.value === kind)!.hint}</Text>
          <Input
            label="Title"
            value={title}
            onChangeText={setTitle}
            placeholder="Short summary"
            maxLength={TITLE_MAX}
            returnKeyType="next"
            accessibilityLabel="Title"
          />
          <Input
            label="Details"
            value={description}
            onChangeText={setDescription}
            placeholder={
              kind === "bug" ? "What happened? What did you expect?" : "Tell us more (optional)"
            }
            maxLength={DESCRIPTION_MAX}
            multiline
            accessibilityLabel="Details"
          />
          {screenshot ? (
            <View style={styles.shotBlock}>
              <Text style={styles.label}>Screenshot</Text>
              {attached ? (
                <View style={styles.shotRow}>
                  <Image
                    source={{ uri: attached.uri }}
                    style={styles.shot}
                    resizeMode="cover"
                    accessibilityLabel="Screenshot of the current screen"
                  />
                  <View style={styles.shotActions}>
                    <Text style={styles.hint}>Attached so we can see what you see.</Text>
                    <Button
                      variant="secondary"
                      icon="trash-outline"
                      label="Remove screenshot"
                      onPress={() => setDropped(true)}
                    />
                  </View>
                </View>
              ) : (
                <Button
                  variant="ghost"
                  icon="image-outline"
                  label="Attach screenshot"
                  onPress={() => setDropped(false)}
                />
              )}
            </View>
          ) : null}
          <Text style={styles.hint}>
            We include your app version, device and recent errors to help us fix things faster.
          </Text>
          <ErrorNote error={send.error} />
          {send.isPending ? <Text style={styles.hint}>{STEP_LABEL[step]}</Text> : null}
          <Button
            icon="paper-plane-outline"
            label="Send"
            loading={send.isPending}
            disabled={title.trim().length < TITLE_MIN}
            onPress={() => send.mutate()}
          />
        </View>
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create((theme) => ({
  form: { gap: theme.spacing.md, padding: theme.spacing.md, paddingBottom: theme.spacing.lg },
  kinds: { flexDirection: "row", gap: theme.spacing.sm },
  body: { fontSize: theme.fontSize.md, lineHeight: 22 },
  reference: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  hint: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
  label: {
    fontSize: theme.fontSize.xs,
    fontFamily: theme.fonts.bold,
    color: theme.colors.mutedForeground,
  },
  shotBlock: { gap: theme.spacing.sm },
  shotRow: { flexDirection: "row", gap: theme.spacing.md, alignItems: "flex-start" },
  shot: {
    width: 96,
    height: 160,
    borderRadius: theme.radius.md,
    backgroundColor: theme.colors.card,
  },
  shotActions: { flex: 1, gap: theme.spacing.sm },
}));
