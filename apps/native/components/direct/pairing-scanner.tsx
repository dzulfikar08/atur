import "@/unistyles";
import { CameraView, useCameraPermissions } from "expo-camera";
import { useEffect, useRef } from "react";
import { Linking, View } from "react-native";
import { StyleSheet } from "react-native-unistyles";

import { Button, Text } from "@/components/ui";

/**
 * Camera preview that reads one QR code, the pairing code Atur Terminal shows on the computer.
 * Asks for the camera the first time; `onScanned` gets the raw text once.
 */
export function PairingScanner({
  onScanned,
  onCancel,
}: {
  onScanned: (data: string) => void;
  onCancel: () => void;
}) {
  const [permission, requestPermission] = useCameraPermissions();
  const scanned = useRef(false);
  const undetermined = permission?.status === "undetermined";

  useEffect(() => {
    if (undetermined) void requestPermission();
  }, [undetermined, requestPermission]);

  if (!permission?.granted) {
    return (
      <View style={styles.box}>
        <Text style={styles.note}>
          {permission && !undetermined
            ? "Atur needs the camera to read the pairing code. You can allow it in Settings."
            : "Allow the camera to read the pairing code."}
        </Text>
        {permission && !permission.canAskAgain ? (
          <Button label="Open Settings" onPress={() => void Linking.openSettings()} />
        ) : (
          <Button label="Allow camera" onPress={() => void requestPermission()} />
        )}
        <Button variant="ghost" label="Cancel" onPress={onCancel} />
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <CameraView
        style={styles.camera}
        facing="back"
        barcodeScannerSettings={{ barcodeTypes: ["qr"] }}
        onBarcodeScanned={({ data }) => {
          if (scanned.current) return;
          scanned.current = true;
          onScanned(data);
        }}
      />
      <Text style={styles.note}>Point the camera at the code shown by Atur Terminal.</Text>
      <Button variant="ghost" label="Cancel" onPress={onCancel} />
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  box: { gap: theme.spacing.md },
  camera: { height: 320, borderRadius: theme.radius.lg, overflow: "hidden" },
  note: { fontSize: theme.fontSize.sm, color: theme.colors.mutedForeground },
}));
