
import { Stack, Redirect } from 'expo-router';
import { useAuth } from '@/lib/auth';

export default function RootLayout() {
  const { user, loading } = useAuth();

  if (loading) {
    return null;
  }

  return (
    <>
      <Stack screenOptions={{ headerShown: false }}>
        <Stack.Screen name="login" />
        <Stack.Screen name="register" />
        <Stack.Screen name="(tabs)" />
      </Stack>

      {!user ? <Redirect href="/login" /> : null}
    </>
  );
}
