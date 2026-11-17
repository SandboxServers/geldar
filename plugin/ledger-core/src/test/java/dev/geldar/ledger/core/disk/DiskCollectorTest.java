package dev.geldar.ledger.core.disk;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import dev.geldar.ledger.core.Cancellable;
import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.io.IOException;
import java.lang.reflect.Proxy;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.EnumMap;
import java.util.List;
import java.util.Map;
import java.util.function.LongSupplier;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

class DiskCollectorTest {
  @TempDir Path tmp;

  private record Gauge(String name, LongSupplier reader, List<String> attrs) {}

  private final List<Gauge> gauges = new ArrayList<>();
  private Runnable timer;
  private long timerMs;
  private boolean cancelled;
  private boolean mainThread;

  private CollectorContext ctx() {
    Ledger ledger =
        (Ledger)
            Proxy.newProxyInstance(
                Ledger.class.getClassLoader(),
                new Class<?>[] {Ledger.class},
                (p, m, a) -> {
                  if (m.getName().equals("gaugeLong")) {
                    gauges.add(
                        new Gauge(
                            (String) a[0], (LongSupplier) a[3], List.of((String[]) a[4])));
                  }
                  return null;
                });
    HostScheduler sched =
        new HostScheduler() {
          public Cancellable everyTicks(int ticks, Runnable r) {
            throw new AssertionError("must be async");
          }

          public Cancellable everyMillis(long ms, Runnable r) {
            timer = r;
            timerMs = ms;
            return () -> cancelled = true;
          }
        };
    HostInfo host =
        new HostInfo() {
          public long serverTick() {
            return 0;
          }

          public boolean isMainThread() {
            return mainThread;
          }

          public String loaderName() {
            return "test";
          }
        };
    return new CollectorContext() {
      public Ledger ledger() {
        return ledger;
      }

      public HostScheduler scheduler() {
        return sched;
      }

      public HostInfo host() {
        return host;
      }
    };
  }

  private Map<DiskArea, Path> roots() throws IOException {
    Map<DiskArea, Path> m = new EnumMap<>(DiskArea.class);
    Files.createDirectories(tmp.resolve("w"));
    Files.write(tmp.resolve("w/a"), new byte[100]);
    Files.createDirectories(tmp.resolve("l"));
    Files.write(tmp.resolve("l/b"), new byte[40]);
    m.put(DiskArea.WORLD, tmp.resolve("w"));
    m.put(DiskArea.LOGS, tmp.resolve("l"));
    m.put(DiskArea.BLUEMAP, tmp.resolve("missing"));
    return m;
  }

  private long gaugeFor(String area) {
    return gauges.stream()
        .filter(g -> g.attrs().contains(area))
        .findFirst()
        .orElseThrow()
        .reader()
        .getAsLong();
  }

  @Test
  void registersOneGaugePerAreaWithFixedAreaValuesAndSlowAsyncTimer() throws IOException {
    DiskCollector c = new DiskCollector(roots());
    c.start(ctx());
    assertEquals(3, gauges.size());
    for (Gauge g : gauges) {
      assertEquals("geldar_disk_bytes", g.name());
      assertEquals("area", g.attrs().get(0));
      assertTrue(
          List.of("world", "plugin_data", "logs", "bluemap", "chunky").contains(g.attrs().get(1)));
    }
    assertEquals(600_000L, timerMs);
  }

  @Test
  void eachRunWalksOneAreaInRoundRobin() throws IOException {
    DiskCollector c = new DiskCollector(roots());
    c.start(ctx());
    timer.run();
    int measured = 0;
    for (DiskArea a : List.of(DiskArea.WORLD, DiskArea.LOGS)) {
      if (c.bytes(a) != 0) {
        measured++;
      }
    }
    assertEquals(1, measured);
    timer.run();
    timer.run();
    assertEquals(100, gaugeFor("world"));
    assertEquals(40, gaugeFor("logs"));
    assertEquals(0, gaugeFor("bluemap"));
  }

  @Test
  void partialFlagIsReportedWhenBudgetHit() throws IOException {
    DiskCollector c = new DiskCollector(roots(), 1, Long.MAX_VALUE / 2, 1000);
    c.start(ctx());
    timer.run();
    timer.run();
    timer.run();
    assertTrue(c.isPartial(DiskArea.WORLD));
    assertFalse(c.isPartial(DiskArea.PLUGIN_DATA));
  }

  @Test
  void missingRootNeverThrows() throws IOException {
    DiskCollector c = new DiskCollector(Map.of(DiskArea.CHUNKY, tmp.resolve("absent")));
    c.start(ctx());
    timer.run();
    assertEquals(0, c.bytes(DiskArea.CHUNKY));
  }

  @Test
  void doesNotWalkOnTheMainThread() throws IOException {
    DiskCollector c = new DiskCollector(roots());
    c.start(ctx());
    mainThread = true;
    timer.run();
    timer.run();
    timer.run();
    assertEquals(0, c.bytes(DiskArea.WORLD));
    assertEquals(0, c.bytes(DiskArea.LOGS));
  }

  @Test
  void stopCancelsTheTimerAndIsIdempotent() throws IOException {
    DiskCollector c = new DiskCollector(roots());
    c.start(ctx());
    c.stop();
    c.stop();
    assertTrue(cancelled);
    assertNotNull(c.id());
  }
}
