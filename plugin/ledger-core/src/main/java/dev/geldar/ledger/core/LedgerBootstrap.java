package dev.geldar.ledger.core;

import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import io.opentelemetry.api.logs.LoggerProvider;
import io.opentelemetry.api.metrics.MeterProvider;
import java.util.logging.Logger;

/** Builds the {@link OtelLedger} over the global OpenTelemetry API (the Java agent installs the SDK behind it). */
public final class LedgerBootstrap {
    static final String SCOPE = "dev.geldar.ledger";

    private LedgerBootstrap() {}

    /** A ledger over {@link GlobalOpenTelemetry#get()}; works as a no-op without an agent. */
    public static OtelLedger create(LedgerConfig config, HostInfo host, Logger logger) {
        return create(config, host, logger, GlobalOpenTelemetry.get());
    }

    /** As {@link #create(LedgerConfig, HostInfo, Logger)} over a given API instance (tests, embedders). */
    public static OtelLedger create(LedgerConfig config, HostInfo host, Logger logger, OpenTelemetry otel) {
        boolean agent = agentPresent(otel);
        return new OtelLedger(
                config,
                host,
                logger,
                otel.getMeter(SCOPE),
                agent,
                LogOut.over(otel.getLogsBridge().get(SCOPE)));
    }

    /**
     * True unless the API is the no-op. The global instance is wrapped, so it is compared by its providers, not
     * by identity alone. The real {@code GlobalOpenTelemetry} wrapper delegates to the noop providers until the agent
     * installs the SDK (unverified against 1.67.0 bytecode); the decision logic is pinned by LedgerBootstrapTest.
     */
    static boolean agentPresent(OpenTelemetry otel) {
        if (otel == null || otel == OpenTelemetry.noop()) {
            return false;
        }
        return otel.getMeterProvider() != MeterProvider.noop() || otel.getLogsBridge() != LoggerProvider.noop();
    }
}
