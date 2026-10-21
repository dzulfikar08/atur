import { ActivityIndicator, Platform, View } from "react-native";
import { StyleSheet, useUnistyles } from "react-native-unistyles";
import { WebView } from "react-native-webview";

import { FileCard } from "@/components/attachment/file-card";
import type { AttachmentActions } from "@/components/attachment/use-attachment-actions";
import { assetSource } from "@/lib/api";
import type { AttachmentRef } from "@/lib/attachment-file";

/**
 * iOS: WKWebView renders PDFs natively, so a locked-down WebView pointed at the
 * auth-checked asset URL is the viewer. Same flags as html-view.tsx (no file
 * access, no windows, no storage) and no JavaScript, plus: the only URL that
 * may load is this one. Android's WebView can't render PDFs, so there the file
 * downloads and opens in whatever PDF app the device has.
 */
export function PdfViewer({ att, actions }: { att: AttachmentRef; actions: AttachmentActions }) {
  const { theme } = useUnistyles();
  if (Platform.OS !== "ios") {
    return <FileCard att={att} actions={actions} openLabel="Open in PDF viewer" />;
  }

  const { uri, headers } = assetSource(att.url);
  return (
    <WebView
      style={{ backgroundColor: theme.colors.background }}
      source={{ uri, headers }}
      originWhitelist={[`${/^[a-z][a-z0-9+.-]*:\/\/[^/]+/i.exec(uri)?.[0] ?? uri}*`]}
      onShouldStartLoadWithRequest={(request) => request.url.split("#")[0] === uri}
      startInLoadingState
      renderLoading={() => (
        <View style={styles.loading}>
          <ActivityIndicator color={theme.colors.mutedForeground} />
        </View>
      )}
      javaScriptEnabled={false}
      javaScriptCanOpenWindowsAutomatically={false}
      setSupportMultipleWindows={false}
      allowFileAccess={false}
      allowFileAccessFromFileURLs={false}
      allowUniversalAccessFromFileURLs={false}
      allowsLinkPreview={false}
      mixedContentMode="never"
      incognito
      cacheEnabled={false}
      domStorageEnabled={false}
      sharedCookiesEnabled={false}
      thirdPartyCookiesEnabled={false}
      geolocationEnabled={false}
      allowsInlineMediaPlayback={false}
    />
  );
}

const styles = StyleSheet.create((theme) => ({
  loading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: theme.colors.background,
  },
}));
