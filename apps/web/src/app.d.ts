declare global {
  namespace App {}
  interface ImportMetaEnv {
    readonly VITE_MOCK_API?: string;
  }
}

export {};
