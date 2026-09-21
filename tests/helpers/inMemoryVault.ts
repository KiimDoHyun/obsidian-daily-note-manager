import type { VaultLike } from "../../src/engine/vault";

/**
 * 파일시스템 없이 Map 으로 볼트를 시뮬레이션.
 * Engine·writer 는 VaultLike 인터페이스만 사용하므로 obsidian API 없이 통합 테스트 가능.
 */
export class InMemoryVault implements VaultLike {
  private files = new Map<string, string>();
  private folders = new Set<string>();

  exists(path: string): boolean {
    return this.files.has(path) || this.folders.has(path);
  }

  async read(path: string): Promise<string> {
    const c = this.files.get(path);
    if (c === undefined) throw new Error(`file not found: ${path}`);
    return c;
  }

  async write(path: string, content: string): Promise<void> {
    this.ensureAncestors(path);
    this.files.set(path, content);
  }

  async remove(path: string): Promise<void> {
    this.files.delete(path);
  }

  async ensureFolder(path: string): Promise<void> {
    if (!path) return;
    this.folders.add(path);
  }

  // ---------- 테스트 헬퍼 ----------

  /** 파일 시드. write 와 같지만 이름으로 의도를 드러냄. */
  seed(path: string, content: string): void {
    this.ensureAncestors(path);
    this.files.set(path, content);
  }

  /** 시드된 파일 경로 목록 (정렬). */
  list(): string[] {
    return Array.from(this.files.keys()).sort();
  }

  /** 특정 경로의 내용. 없으면 undefined. */
  peek(path: string): string | undefined {
    return this.files.get(path);
  }

  /** 특정 접두어로 시작하는 파일들. */
  listByPrefix(prefix: string): string[] {
    return this.list().filter((p) => p.startsWith(prefix));
  }

  private ensureAncestors(filePath: string): void {
    const parts = filePath.split("/");
    let cur = "";
    for (let i = 0; i < parts.length - 1; i++) {
      cur = cur ? `${cur}/${parts[i]}` : parts[i];
      this.folders.add(cur);
    }
  }
}
