import { Icon, Label, NativeTabs } from 'expo-router/unstable-native-tabs';
import { PlatformColor } from 'react-native';

export default function TabLayout() {
  return (
    <NativeTabs
    minimizeBehavior={`automatic`}
    >
      <NativeTabs.Trigger name="home">
        <Label>Home</Label>
        <Icon sf="house.fill" drawable="ic_menu_home" />
      </NativeTabs.Trigger>


      <NativeTabs.Trigger name="reel">
        <Label>Reels</Label>
        <Icon sf="play.rectangle.fill" drawable="ic_media_play" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="subscriptions">
        <Label>Subscriptions</Label>
        <Icon sf="rectangle.stack.badge.play" drawable="ic_menu_slideshow" />
      </NativeTabs.Trigger>

      <NativeTabs.Trigger name="notifications">
        <Label>Inbox</Label>
        <Icon sf="bell.fill" drawable="ic_popup_reminder" />
      </NativeTabs.Trigger>


      <NativeTabs.Trigger role='search' name="search">
        <Label>Search</Label>
        <Icon sf="magnifyingglass" drawable="ic_menu_search" />
      </NativeTabs.Trigger>
    </NativeTabs>
  );
}
