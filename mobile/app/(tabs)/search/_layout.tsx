import { Stack } from 'expo-router';

export default function SearchLayout() {
  return (
    <Stack>
      <Stack.Screen name="index" options={{ title: 'Search', 
        headerSearchBarOptions: {
          placeholder: 'Search',
        },
        headerTransparent: true,
        headerLargeTitle: true,
       }} />
    </Stack>
  );
}
