import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { ScrollView } from 'react-native';

export default function SearchScreen() {
  return (
    <ScrollView contentContainerStyle={{ padding: 16 }}>
      <ThemedView>
        <ThemedText>Lorem ipsum dolor sit amet consectetur adipisicing elit. A ipsa magni fugiat maiores assumenda ducimus ex ratione vero deleniti sapiente quibusdam quidem quas temporibus, est fuga itaque tempora aliquam repudiandae.</ThemedText>
        <ThemedText>Lorem ipsum dolor sit amet consectetur adipisicing elit. A ipsa magni fugiat maiores assumenda ducimus ex ratione vero deleniti sapiente quibusdam quidem quas temporibus, est fuga itaque tempora aliquam repudiandae.</ThemedText>
        <ThemedText>Lorem ipsum dolor sit amet consectetur adipisicing elit. A ipsa magni fugiat maiores assumenda ducimus ex ratione vero deleniti sapiente quibusdam quidem quas temporibus, est fuga itaque tempora aliquam repudiandae.</ThemedText>
        <ThemedText>Lorem ipsum dolor sit amet consectetur adipisicing elit. A ipsa magni fugiat maiores assumenda ducimus ex ratione vero deleniti sapiente quibusdam quidem quas temporibus, est fuga itaque tempora aliquam repudiandae.</ThemedText>
      </ThemedView>
    </ScrollView>
  );
}
