export {};

declare global {
  interface Window {
    memoriesDesktop: {
      minimize: () => Promise<void>;
      maximize: () => Promise<void>;
      close: () => Promise<void>;
      isMaximized: () => Promise<boolean>;
    };
  }
}
