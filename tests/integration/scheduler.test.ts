/**
 * Scheduler — 1분 tick 폴링의 하루-한-번 게이트 및 실패 복원 검증.
 *
 * 실제 window.setInterval 등록은 검증 범위 밖 (Obsidian 런타임 관심사).
 * tick() 을 직접 호출해 게이트 로직만 결정적으로 테스트.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Scheduler } from "../../src/scheduler";
import type { Engine } from "../../src/engine";
import type { Plugin } from "obsidian";

function withFixedDate<T>(iso: string, fn: () => T | Promise<T>): Promise<T> {
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

function mockPlugin(): Plugin {
  return { registerInterval: () => {} } as unknown as Plugin;
}

/** Scheduler.tick 은 private 이지만 게이트 로직 검증을 위해 외부에서 호출. */
async function tick(scheduler: Scheduler): Promise<void> {
  await (scheduler as unknown as { tick(): Promise<void> }).tick();
}

describe("Scheduler.tick — 하루 한 번 게이트", () => {
  let errorSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    // 실패 케이스에서 console.error 가 자연스럽게 호출되므로 실무 로그 노이즈 억제.
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    errorSpy.mockRestore();
  });

  it("같은 날 tick 을 여러 번 호출해도 engine.createForToday 는 한 번만 호출", async () => {
    await withFixedDate("2026-09-15", async () => {
      const create = vi.fn().mockResolvedValue({ status: "created" });
      const engine = { createForToday: create } as unknown as Engine;
      const scheduler = new Scheduler(engine, mockPlugin());

      await tick(scheduler);
      await tick(scheduler);
      await tick(scheduler);

      expect(create).toHaveBeenCalledTimes(1);
    });
  });

  it("자정 넘겨 날짜가 바뀌면 다시 실행", async () => {
    const create = vi.fn().mockResolvedValue({ status: "created" });
    const engine = { createForToday: create } as unknown as Engine;
    const scheduler = new Scheduler(engine, mockPlugin());

    await withFixedDate("2026-09-15", async () => {
      await tick(scheduler); // 1회
      await tick(scheduler); // 게이트에 걸림
    });
    await withFixedDate("2026-09-16", async () => {
      await tick(scheduler); // 날짜 바뀜 → 재실행
      await tick(scheduler); // 같은 날 재게이트
    });

    expect(create).toHaveBeenCalledTimes(2);
  });

  it("실패해도 내부 lastRunDate 를 갱신 안 함 → 다음 tick 에서 재시도", async () => {
    await withFixedDate("2026-09-15", async () => {
      const create = vi
        .fn()
        .mockRejectedValueOnce(new Error("transient failure"))
        .mockResolvedValueOnce({ status: "created" });
      const engine = { createForToday: create } as unknown as Engine;
      const scheduler = new Scheduler(engine, mockPlugin());

      await tick(scheduler); // 첫 시도 실패 (catch)
      await tick(scheduler); // 재시도 → 성공

      expect(create).toHaveBeenCalledTimes(2);
      expect(errorSpy).toHaveBeenCalled(); // 첫 실패가 로깅됐는지
    });
  });

  it("성공한 뒤에는 실패 여지가 있어도 게이트가 재시도를 막음", async () => {
    // "성공했다면 두 번 부르지 않는다" 는 규칙이 실패 복원과 상충하지 않는지 확인.
    await withFixedDate("2026-09-15", async () => {
      const create = vi.fn().mockResolvedValue({ status: "created" });
      const engine = { createForToday: create } as unknown as Engine;
      const scheduler = new Scheduler(engine, mockPlugin());

      await tick(scheduler); // 성공
      await tick(scheduler); // 게이트 차단
      await tick(scheduler); // 게이트 차단

      expect(create).toHaveBeenCalledTimes(1);
    });
  });
});

describe("Scheduler.start — 초기 tick 즉시 실행 + 인터벌 등록", () => {
  it("start() 는 즉시 첫 tick 을 발동하고 setInterval 을 plugin.registerInterval 로 넘김", async () => {
    // window.setInterval / plugin.registerInterval 을 스파이로 관찰.
    const setIntervalSpy = vi.fn().mockReturnValue(4242);
    const registerSpy = vi.fn();
    // scheduler.start() 는 window.setInterval 을 사용하므로 node env 에서는 stub 필요.
    (globalThis as unknown as { window: unknown }).window = {
      setInterval: setIntervalSpy,
    };
    const plugin = { registerInterval: registerSpy } as unknown as Plugin;

    await withFixedDate("2026-09-15", async () => {
      const create = vi.fn().mockResolvedValue({ status: "created" });
      const engine = { createForToday: create } as unknown as Engine;
      const scheduler = new Scheduler(engine, plugin);
      scheduler.start();
      // start 내부의 `void this.tick()` 이 마이크로태스크로 실행되므로 한 틱 양보.
      await Promise.resolve();
      await Promise.resolve();

      expect(create).toHaveBeenCalledTimes(1);
      expect(setIntervalSpy).toHaveBeenCalledTimes(1);
      // 60초 주기가 유지되는지도 함께 확인 (회귀 방지: 사용자가 실수로 값을 낮추면 배터리·CPU 이슈).
      expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60_000);
      expect(registerSpy).toHaveBeenCalledWith(4242);
    });

    delete (globalThis as unknown as { window?: unknown }).window;
  });
});
