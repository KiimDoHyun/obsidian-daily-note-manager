import { App, TFile, TFolder, normalizePath } from "obsidian";

/**
 * Obsidian Vault API 위에 얇은 파일시스템 어댑터.
 * 코어 로직이 Obsidian API 세부에 노출되지 않도록 감싼다.
 */
export class VaultAdapter {
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
