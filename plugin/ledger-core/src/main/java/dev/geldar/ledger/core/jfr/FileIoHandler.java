package dev.geldar.ledger.core.jfr;

import dev.geldar.ledger.core.BoundHistogram;
import dev.geldar.ledger.core.Histogram;
import dev.geldar.ledger.core.Ledger;
import dev.geldar.ledger.core.Names;
import java.time.Duration;
import java.util.List;
import java.util.Set;
import java.util.function.Function;
import jdk.jfr.consumer.RecordedEvent;

/**
 * Records the duration of {@code jdk.FileRead} and {@code jdk.FileWrite} (threshold 10 ms) in
 * {@code geldar_jfr_file_io_ms{op=read|write}}. These events carry a file {@code path}: this handler reads only
 * {@code duration} and never the path.
 */
public final class FileIoHandler implements JfrHandler {
    static final String READ = "jdk.FileRead";
    static final String WRITE = "jdk.FileWrite";
    static final Set<String> FIELDS = Set.of("duration");
    static final double[] BOUNDS = {10, 20, 50, 100, 250, 500, 1000, 5000};

    private final BoundHistogram read;
    private final BoundHistogram write;

    public FileIoHandler(Ledger ledger) {
        Histogram h = ledger.histogram(
                Names.Jfr.FILE_IO_MS, "ms", "File read and write durations over the JFR threshold", BOUNDS, "op");
        this.read = h.bind("read");
        this.write = h.bind("write");
    }

    @Override
    public List<String> eventNames() {
        return List.of(READ, WRITE);
    }

    @Override
    public void handle(RecordedEvent event) {
        handle(event.getEventType().getName(), f -> event.getValue(f));
    }

    void handle(String eventName, Function<String, Object> field) {
        BoundHistogram target = READ.equals(eventName) ? read : WRITE.equals(eventName) ? write : null;
        if (target != null && field.apply("duration") instanceof Duration d) {
            target.record(d.toNanos() / 1_000_000.0);
        }
    }
}
