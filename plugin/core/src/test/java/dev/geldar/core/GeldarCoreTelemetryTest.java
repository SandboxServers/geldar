package dev.geldar.core;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;

import dev.geldar.core.trace.TraceHook;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.logging.Logger;
import org.junit.jupiter.api.Test;

class GeldarCoreTelemetryTest {
    private static final Logger LOG = Logger.getLogger("telemetry-test");

    @Test
    void aHookFactoryThatThrowsALinkageErrorFallsBackToNoopAndTheCoreStaysEnabled() {
        AtomicInteger shutdowns = new AtomicInteger();
        AtomicInteger disables = new AtomicInteger();
        AtomicInteger enabled = new AtomicInteger();
        GeldarCore.enableOrStop(() -> {
            TraceHook hook = GeldarCore.telemetryHook(() -> {
                throw new NoClassDefFoundError("io/opentelemetry/api/GlobalOpenTelemetry");
            }, LOG);
            assertSame(TraceHook.NOOP, hook);
            enabled.incrementAndGet();
        }, disables::incrementAndGet, shutdowns::incrementAndGet, LOG);
        assertEquals(1, enabled.get(), "enable ran to the end");
        assertEquals(0, shutdowns.get());
        assertEquals(0, disables.get());
    }

    @Test
    void aRuntimeFaultInTheHookFactoryAlsoFallsBack() {
        assertSame(TraceHook.NOOP, GeldarCore.telemetryHook(() -> {
            throw new IllegalStateException("bridge");
        }, LOG));
    }

    @Test
    void aWorkingFactoryIsUsed() {
        TraceHook mine = new TraceHook() {
            public io.nats.client.impl.Headers inject(io.nats.client.impl.Headers target) {
                return target;
            }

            public Scope enter(io.nats.client.impl.Headers incoming) {
                return Scope.NONE;
            }

            public void annotate(String key, String value) {}
        };
        assertSame(mine, GeldarCore.telemetryHook(() -> mine, LOG));
    }

    @Test
    void metricsFaultsAreSkippedAndAValidRegistrationIsKept() {
        assertNull(GeldarCore.telemetryMetrics(() -> {
            throw new NoSuchMethodError("meter");
        }, LOG));
        assertNull(GeldarCore.telemetryMetrics(() -> {
            throw new IllegalArgumentException("bad instrument");
        }, LOG));
        AutoCloseable ok = () -> {};
        assertSame(ok, GeldarCore.telemetryMetrics(() -> ok, LOG));
    }

    @Test
    void aVmErrorIsNotSwallowed() {
        assertThrows(OutOfMemoryError.class, () -> GeldarCore.telemetryHook(() -> {
            throw new OutOfMemoryError();
        }, LOG));
    }
}
