import "@/unistyles";
import { useMutation } from "@tanstack/react-query";
import * as AppleAuthentication from "expo-apple-authentication";
import { useEffect, useState } from "react";
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { StyleSheet, useUnistyles } from "react-native-unistyles";

import { LogoMark } from "@/components/logo-mark";
import { Button, ErrorNote, Input, Text } from "@/components/ui";
import { api } from "@/lib/api";
import { isAppleSignInAvailable, signInWithApple } from "@/lib/apple-auth";
import { signInWithGoogle } from "@/lib/google-auth";
import { startSession } from "@/lib/session";

type Mode = "password" | "code";

export default function Login() {
  const [mode, setMode] = useState<Mode>("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [codeSent, setCodeSent] = useState(false);

  const passwordLogin = useMutation({
    mutationFn: () => api.signIn(email.trim(), password),
    onSuccess: (r) => startSession(r.session_token),
  });
  const requestCode = useMutation({
    mutationFn: () => api.requestOtp(email.trim()),
    onSuccess: (r) => {
      setCodeSent(true);
      // Local dev servers echo the code instead of emailing it.
      if (r.dev_code) setCode(r.dev_code);
    },
  });
  const verifyCode = useMutation({
    mutationFn: () => api.verifyOtp(email.trim(), code.trim()),
    onSuccess: (r) => startSession(r.session_token),
  });
  const google = useMutation({ mutationFn: signInWithGoogle });
  const apple = useMutation({ mutationFn: signInWithApple });

  // iOS only; the button stays hidden until the OS confirms support.
  const [appleAvailable, setAppleAvailable] = useState(false);
  useEffect(() => {
    void isAppleSignInAvailable().then(setAppleAvailable);
  }, []);
  const { rt } = useUnistyles();

  const switchMode = (next: Mode) => {
    setMode(next);
    setCodeSent(false);
    setCode("");
    passwordLogin.reset();
    requestCode.reset();
    verifyCode.reset();
  };

  const emailOk = /\S+@\S+\.\S+/.test(email.trim());
  const error =
    passwordLogin.error ?? requestCode.error ?? verifyCode.error ?? google.error ?? apple.error;

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          <View style={styles.hero}>
            <LogoMark size={56} />
            <Text style={styles.wordmark}>Atur</Text>
            <Text style={styles.tagline}>Issues, decisions, and the agents working on them.</Text>
          </View>

          <View style={styles.form}>
            <Input
              label="Email"
              value={email}
              onChangeText={setEmail}
              placeholder="you@company.com"
              autoCapitalize="none"
              autoComplete="email"
              keyboardType="email-address"
              textContentType="emailAddress"
              editable={!codeSent}
            />

            {mode === "password" ? (
              <>
                <Input
                  label="Password"
                  value={password}
                  onChangeText={setPassword}
                  placeholder="••••••••"
                  secureTextEntry
                  autoComplete="password"
                  textContentType="password"
                  onSubmitEditing={() => emailOk && password && passwordLogin.mutate()}
                />
                <Button
                  label="Sign in"
                  loading={passwordLogin.isPending}
                  disabled={!emailOk || !password}
                  onPress={() => passwordLogin.mutate()}
                />
              </>
            ) : codeSent ? (
              <>
                <Input
                  label="Code from your email"
                  value={code}
                  onChangeText={setCode}
                  placeholder="123456"
                  keyboardType="number-pad"
                  autoComplete="one-time-code"
                  textContentType="oneTimeCode"
                  maxLength={8}
                />
                <Button
                  label="Verify code"
                  loading={verifyCode.isPending}
                  disabled={code.trim().length < 4}
                  onPress={() => verifyCode.mutate()}
                />
                <Button
                  variant="ghost"
                  label="Use a different email"
                  onPress={() => switchMode("code")}
                />
              </>
            ) : (
              <Button
                label="Email me a code"
                loading={requestCode.isPending}
                disabled={!emailOk}
                onPress={() => requestCode.mutate()}
              />
            )}

            <ErrorNote error={error} />

            <Pressable
              accessibilityRole="button"
              onPress={() => switchMode(mode === "password" ? "code" : "password")}
              hitSlop={8}
              style={styles.switch}
            >
              <Text style={styles.switchLabel}>
                {mode === "password"
                  ? "Sign in with an email code instead"
                  : "Sign in with a password instead"}
              </Text>
            </Pressable>
          </View>

          {Platform.OS !== "web" ? (
            <View style={styles.form}>
              <View style={styles.dividerRow}>
                <View style={styles.divider} />
                <Text style={styles.dividerLabel}>or</Text>
                <View style={styles.divider} />
              </View>
              {appleAvailable ? (
                <AppleAuthentication.AppleAuthenticationButton
                  buttonType={AppleAuthentication.AppleAuthenticationButtonType.SIGN_IN}
                  buttonStyle={
                    rt.themeName === "dark"
                      ? AppleAuthentication.AppleAuthenticationButtonStyle.WHITE
                      : AppleAuthentication.AppleAuthenticationButtonStyle.BLACK
                  }
                  cornerRadius={10}
                  style={styles.appleButton}
                  onPress={() => {
                    if (!apple.isPending) apple.mutate();
                  }}
                />
              ) : null}
              <Button
                variant="secondary"
                icon="logo-google"
                label="Continue with Google"
                loading={google.isPending}
                onPress={() => google.mutate()}
              />
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create((theme) => ({
  screen: { flex: 1, backgroundColor: theme.colors.background },
  flex: { flex: 1 },
  content: {
    flexGrow: 1,
    justifyContent: "center",
    gap: theme.spacing.xl,
    padding: theme.spacing.xl,
    maxWidth: 440,
    width: "100%",
    alignSelf: "center",
  },
  hero: { alignItems: "center", gap: theme.spacing.sm, marginBottom: theme.spacing.md },
  wordmark: { fontSize: 32, fontFamily: theme.fonts.heavy, letterSpacing: -1 },
  tagline: {
    fontSize: theme.fontSize.base,
    color: theme.colors.mutedForeground,
    textAlign: "center",
    maxWidth: 280,
    lineHeight: 22,
  },
  form: { gap: theme.spacing.md },
  appleButton: { height: 50, width: "100%" },
  switch: { alignSelf: "center", paddingVertical: theme.spacing.xs },
  switchLabel: {
    fontSize: theme.fontSize.sm,
    fontFamily: theme.fonts.medium,
    color: theme.colors.mutedForeground,
  },
  dividerRow: { flexDirection: "row", alignItems: "center", gap: theme.spacing.md },
  divider: { flex: 1, height: 1, backgroundColor: theme.colors.hairline },
  dividerLabel: { fontSize: theme.fontSize.xs, color: theme.colors.mutedForeground },
}));
