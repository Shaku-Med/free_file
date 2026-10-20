import { useDeviceStyle, type DeviceStyle } from "~/lib/device";

/** Which system tab bar the mobile web bar imitates; the same as the device's look. */
export type TabBarStyle = DeviceStyle;

export const useTabBarStyle = useDeviceStyle;
