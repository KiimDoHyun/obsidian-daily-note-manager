/**
 * Engine 은 내부에서 today() 로 시스템 시각을 읽는다. 테스트 결정성을 위해 fn 실행 동안만
 * 인자 없는 `new Date()` 와 `Date.now()` 가 주어진 날짜의 로컬 자정을 돌려주게 바꾼다.
 * fn 이 끝나면(실패해도) 원래 Date 로 되돌린다.
 */
export function withFixedToday<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
  const orig = Date;
  const [y, m, d] = iso.split("-").map((n) => parseInt(n, 10));
  const target = new orig(y, m - 1, d).getTime();
  // @ts-expect-error monkey patch for test determinism
  globalThis.Date = class extends orig {
    constructor(...args: unknown[]) {
      if (args.length === 0) super(target);
      else super(...(args as ConstructorParameters<typeof orig>));
    }
    static now() {
      return target;
    }
  };
  return Promise.resolve(fn()).finally(() => {
    globalThis.Date = orig;
  });
}
