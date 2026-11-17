package dev.geldar.ledger.core.container;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

/**
 * Reads the container's own cgroup v2 files under an injectable root (default {@code /sys/fs/cgroup}). Never throws:
 * {@link #read()} returns {@code null} when the layout is unavailable (cgroup v1, a missing or unreadable required
 * file, a malformed required number). Required files: {@code cpu.stat} and {@code memory.current}. Optional (0 when
 * absent): {@code memory.max}, {@code memory.events}, {@code pids.current}, {@code pids.max}. Files are tiny and
 * bounded (read capped at {@link #MAX_BYTES}).
 */
public final class CgroupReader {
    public static final String DEFAULT_ROOT = "/sys/fs/cgroup";
    static final int MAX_BYTES = 8192;

    /**
     * One reading. {@code memoryLimit} and {@code pidsMax} are 0 when unlimited ({@code max}) or absent. Counters are
     * raw kernel values.
     */
    public record Sample(
            long periods,
            long throttledPeriods,
            long throttledUsec,
            long memoryCurrent,
            long memoryLimit,
            long oom,
            long oomKill,
            long pidsCurrent,
            long pidsMax) {
        public double throttledSeconds() {
            return throttledUsec / 1e6;
        }

        /** Throttled periods over all periods, 0 when no period has elapsed. */
        public double throttledRatio() {
            return periods <= 0 ? 0.0 : (double) throttledPeriods / (double) periods;
        }
    }

    private final Path root;

    public CgroupReader(Path root) {
        this.root = root;
    }

    /** One sample, or {@code null} when unavailable. */
    public Sample read() {
        try {
            List<String> cpu = lines("cpu.stat");
            Long memCurrent = singleNumber("memory.current");
            if (cpu == null || memCurrent == null) {
                return null;
            }
            long periods = 0;
            long throttled = 0;
            long usec = 0;
            for (String line : cpu) {
                String[] kv = line.trim().split("\\s+");
                if (kv.length != 2) {
                    continue;
                }
                Long v = parse(kv[1]);
                if (v == null) {
                    continue;
                }
                switch (kv[0]) {
                    case "nr_periods" -> periods = v;
                    case "nr_throttled" -> throttled = v;
                    case "throttled_usec" -> usec = v;
                    default -> {}
                }
            }
            long oom = 0;
            long oomKill = 0;
            List<String> events = lines("memory.events");
            if (events != null) {
                for (String line : events) {
                    String[] kv = line.trim().split("\\s+");
                    Long v = kv.length == 2 ? parse(kv[1]) : null;
                    if (v == null) {
                        continue;
                    }
                    if (kv[0].equals("oom")) {
                        oom = v;
                    } else if (kv[0].equals("oom_kill")) {
                        oomKill = v;
                    }
                }
            }
            return new Sample(
                    periods,
                    throttled,
                    usec,
                    memCurrent,
                    limit("memory.max"),
                    oom,
                    oomKill,
                    orZero(singleNumber("pids.current")),
                    limit("pids.max"));
        } catch (RuntimeException e) {
            return null;
        }
    }

    private static long orZero(Long v) {
        return v == null ? 0 : v;
    }

    /** A limit file: {@code max}, absent or malformed all mean unlimited (0). */
    private long limit(String name) {
        return orZero(singleNumber(name));
    }

    private Long singleNumber(String name) {
        List<String> l = lines(name);
        if (l == null || l.isEmpty()) {
            return null;
        }
        return parse(l.get(0).trim());
    }

    private static Long parse(String s) {
        try {
            long v = Long.parseLong(s);
            return v < 0 ? null : v;
        } catch (NumberFormatException e) {
            return null;
        }
    }

    private List<String> lines(String name) {
        Path p = root.resolve(name);
        try (var in = Files.newInputStream(p)) {
            byte[] buf = in.readNBytes(MAX_BYTES);
            return new String(buf, StandardCharsets.US_ASCII).lines().toList();
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }
}
