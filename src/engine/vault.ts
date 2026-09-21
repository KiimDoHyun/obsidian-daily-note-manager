import { App, TFile, TFolder, normalizePath } from "obsidian";

/**
 * 파일시스템 어댑터 인터페이스.
 * VaultAdapter(Obsidian) 와 테스트용 InMemoryVault 가 모두 이 형태를 만족.
 * 코어 엔진·writer 는 이 인터페이스에만 의존해서 Obsidian API 세부에 종속되지 않게 한다.
 */
export interface VaultLike {
  exists(path: string): boolean;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  remove(path: string): Promise<void>;
  ensureFolder(path: string): Promise<void>;
}

/**
 * Obsidian Vault API 위에 얇은 파일시스템 어댑터.
 */
export class VaultAdapter implements VaultLike {
  constructor(private app: App) {}

  private norm(path: string): string {
    return normalizePath(path);
  }

  exists(path: string): boolean {
    return this.app.vault.getAbstractFileByPath(this.norm(path)) !== null;
  }

  async read(path: string): Promise<string> {
    const f = this.app.vault.getAbstractFileByPath(this.norm(path));
    if (!(f instanceof TFile)) throw new Error(`file not found: ${path}`);
    return this.app.vault.read(f);
  }

  async write(path: string, content: string): Promise<void> {
    const p = this.norm(path);
    await this.ensureParent(p);
    const existing = this.app.vault.getAbstractFileByPath(p);
    if (existing instanceof TFile) {
      await this.app.vault.modify(existing, content);
    } else {
      await this.app.vault.create(p, content);
    }
  }

  async remove(path: string): Promise<void> {
    const f = this.app.vault.getAbstractFileByPath(this.norm(path));
    if (f instanceof TFile) await this.app.vault.delete(f);
  }

  async ensureFolder(path: string): Promise<void> {
    const p = this.norm(path);
    if (!p || p === "/" || p === ".") return;
    const existing = this.app.vault.getAbstractFileByPath(p);
    if (existing instanceof TFolder) return;
    if (existing) return;
    try {
      await this.app.vault.createFolder(p);
    } catch (err) {
      if (this.app.vault.getAbstractFileByPath(p) instanceof TFolder) return;
      throw err;
    }
  }

  private async ensureParent(filePath: string): Promise<void> {
    const idx = filePath.lastIndexOf("/");
    if (idx <= 0) return;
    const parent = filePath.substring(0, idx);
    if (!this.app.vault.getAbstractFileByPath(parent)) {
      const segments = parent.split("/");
      let cur = "";
      for (const seg of segments) {
        cur = cur ? `${cur}/${seg}` : seg;
        if (!this.app.vault.getAbstractFileByPath(cur)) {
          await this.ensureFolder(cur);
        }
      }
    }
  }
}
