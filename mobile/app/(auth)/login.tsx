import { useAuth } from '@/components/auth/auth-context';
import { signInWithProvider } from '@/components/auth/provider-signin';
import { Logo } from '@/components/brand/logo';
import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useRouter } from 'expo-router';
import { useState } from 'react';
import { ActivityIndicator, Alert, Pressable, StyleSheet, View, useColorScheme } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export default function LoginScreen() {
  const router = useRouter();
  const { signIn } = useAuth();
  const insets = useSafeAreaInsets();
  const scheme = useColorScheme();
  const isDark = scheme === 'dark';
  const [loading, setLoading] = useState(false);

  const handleSignIn = async () => {
    setLoading(true);
    const result = await signInWithProvider('web');
    setLoading(false);

    if (result.type === 'success') {
      signIn(result.token);
      router.replace('/(tabs)/home');
      return;
    }

    if (result.type === 'error') {
      Alert.alert('Sign in failed', result.message);
    }
  };

  return (
    <ThemedView style={styles.container}>
      <View style={styles.hero}>
        <Logo size={112} style={styles.logo} />
        <ThemedText type="title" style={styles.title}>
          Memories
        </ThemedText>
        <ThemedText style={styles.subtitle}>
          Share, watch, and discover. Sign in to get started.
        </ThemedText>
      </View>

      <View style={[styles.footer, { paddingBottom: Math.max(insets.bottom, 16) + 12 }]}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Sign in"
          disabled={loading}
          onPress={handleSignIn}
          style={({ pressed }) => [
            styles.button,
            {
              backgroundColor: isDark ? '#ffffff' : '#000000',
            },
            pressed && styles.buttonPressed,
            loading && styles.buttonDisabled,
          ]}>
          {loading ? (
            <ActivityIndicator color={isDark ? '#000000' : '#ffffff'} />
          ) : (
            <ThemedText style={[styles.buttonLabel, { color: isDark ? '#000000' : '#ffffff' }]}>
              Sign in
            </ThemedText>
          )}
        </Pressable>

        <ThemedText style={styles.legal}>
          By continuing you agree to our Terms and Privacy Policy.
        </ThemedText>
      </View>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 24,
  },
  hero: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 12,
  },
  logo: {
    marginBottom: 12,
  },
  title: {
    textAlign: 'center',
  },
  subtitle: {
    textAlign: 'center',
    opacity: 0.6,
    maxWidth: 320,
  },
  footer: {
    gap: 16,
  },
  button: {
    alignItems: 'center',
    justifyContent: 'center',
    height: 52,
    borderRadius: 26,
    paddingHorizontal: 20,
  },
  buttonPressed: {
    opacity: 0.7,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonLabel: {
    fontSize: 16,
    fontWeight: '600',
  },
  legal: {
    textAlign: 'center',
    fontSize: 12,
    opacity: 0.5,
  },
});
