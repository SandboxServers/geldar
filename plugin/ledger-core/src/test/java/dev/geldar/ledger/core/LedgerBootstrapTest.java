package dev.geldar.ledger.core;

import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.logs.LoggerProvider;
import io.opentelemetry.api.metrics.MeterProvider;
import java.lang.reflect.Proxy;
import org.junit.jupiter.api.Test;

/**
 * agentPresent compares providers, because {@code GlobalOpenTelemetry.get()} is a wrapper that is never identical to
 * {@code OpenTelemetry.noop()}. Until the agent installs the SDK the wrapper delegates to the noop providers; once it
 * does, the providers are not the noop ones. That delegation is unverified against 1.67.0 bytecode (no javap here);
 * these tests pin the decision logic over fake API objects, not the wrapper itself.
 */
class LedgerBootstrapTest {
    private static MeterProvider realMeterProvider() {
        MeterProvider noop = MeterProvider.noop();
        return (MeterProvider) Proxy.newProxyInstance(
                MeterProvider.class.getClassLoader(),
                new Class<?>[] {MeterProvider.class},
                (p, m, a) -> m.invoke(noop, a));
    }

    private static LoggerProvider realLoggerProvider() {
        LoggerProvider noop = LoggerProvider.noop();
        return (LoggerProvider) Proxy.newProxyInstance(
                LoggerProvider.class.getClassLoader(),
                new Class<?>[] {LoggerProvider.class},
                (p, m, a) -> m.invoke(noop, a));
    }

    /** An OpenTelemetry that answers like the noop one except for the two providers given (null: keep noop). */
    private static OpenTelemetry otel(MeterProvider meters, LoggerProvider logs) {
        OpenTelemetry noop = OpenTelemetry.noop();
        return (OpenTelemetry) Proxy.newProxyInstance(
                OpenTelemetry.class.getClassLoader(), new Class<?>[] {OpenTelemetry.class}, (p, m, a) -> {
                    if (m.getName().equals("getMeterProvider") && meters != null) {
                        return meters;
                    }
                    if (m.getName().equals("getLogsBridge") && logs != null) {
                        return logs;
                    }
                    if (m.getName().equals("equals")) {
                        return p == a[0];
                    }
                    if (m.getName().equals("hashCode")) {
                        return System.identityHashCode(p);
                    }
                    return m.invoke(noop, a);
                });
    }

    @Test
    void noopAndNullAreNotAnAgent() {
        assertFalse(LedgerBootstrap.agentPresent(OpenTelemetry.noop()));
        assertFalse(LedgerBootstrap.agentPresent(null));
    }

    @Test
    void aWrapperDelegatingToNoopProvidersIsNotAnAgent() {
        assertFalse(LedgerBootstrap.agentPresent(otel(null, null)));
    }

    @Test
    void realMeterAndLogProvidersMeanAnAgent() {
        assertTrue(LedgerBootstrap.agentPresent(otel(realMeterProvider(), realLoggerProvider())));
    }

    @Test
    void oneRealProviderIsEnough() {
        assertTrue(LedgerBootstrap.agentPresent(otel(realMeterProvider(), null)));
        assertTrue(LedgerBootstrap.agentPresent(otel(null, realLoggerProvider())));
    }
}
