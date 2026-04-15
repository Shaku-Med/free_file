import { Stack } from 'expo-router';

export default function SubscriptionsLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Subscriptions' }} />
    </Stack>
  );
}
