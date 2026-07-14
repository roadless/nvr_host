declare module "onvif/promises/index.js" {
  export class Cam {
    constructor(options: {
      hostname: string;
      port?: number;
      username?: string;
      password?: string;
      timeout?: number;
      preserveAddress?: boolean;
    });
    connect(): Promise<void>;
    getDeviceInformation(): Promise<Record<string, unknown>>;
    getPresets(options?: { profileToken?: string }): Promise<Record<string, unknown>>;
    gotoPreset(options: { profileToken?: string; preset: string }): Promise<void>;
    profiles?: unknown[];
    activeSource?: { profileToken?: string };
  }
}
