/**
 * Vitest alias 로 `obsidian` 모듈을 이 파일로 재라우팅.
 * 코어 엔진은 obsidian API 를 직접 안 쓰지만, settings.ts/vault.ts/main.ts 등이
 * import 하는 심볼들을 최소 형태로 스텁.
 */

export class TFile {}
export class TFolder {}

export function normalizePath(p: string): string {
  return p.replace(/\\/g, "/").replace(/\/+/g, "/");
}

export class App {}
export class Plugin {
  async saveData(_data: unknown): Promise<void> {}
  async loadData(): Promise<unknown> {
    return null;
  }
}
export class ItemView {}
export class WorkspaceLeaf {}
export class Modal {}
export class Notice {
  constructor(_message: string, _timeout?: number) {}
}

export class PluginSettingTab {
  app: App;
  plugin: Plugin;
  containerEl: HTMLElement = {} as HTMLElement;
  constructor(app: App, plugin: Plugin) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
}

export class Setting {
  constructor(_containerEl: HTMLElement) {}
  setName(_n: string): this {
    return this;
  }
  setDesc(_d: string): this {
    return this;
  }
  addText(_cb: unknown): this {
    return this;
  }
  addToggle(_cb: unknown): this {
    return this;
  }
  addButton(_cb: unknown): this {
    return this;
  }
}
