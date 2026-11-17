package dev.geldar.ledger.neoforge;

import dev.geldar.ledger.core.ConfigParser;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.LedgerBootstrap;
import dev.geldar.ledger.core.OtelLedger;
import io.opentelemetry.api.GlobalOpenTelemetry;
import io.opentelemetry.api.OpenTelemetry;
import java.io.IOException;
import java.io.InputStream;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Properties;
import java.util.function.Supplier;
import java.util.logging.Logger;
import net.minecraft.server.MinecraftServer;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Server-only entry point. Builds the ledger from {@code config/ledger.properties} (a missing file means defaults, a
 * bad file means no ledger). Nothing here may stop the server from starting: any failure leaves the ledger off. Each
 * wiring (tick, progress, curated, audit) installs on its own: one failing install never skips the others or the
 * shutdown listener. No registry entries and no payloads, ever.
 */
@Mod(value = "ledger", dist = Dist.DEDICATED_SERVER)
public final class LedgerMod {
    static final String CONFIG_FILE = "ledger.properties";
    /** The ledger closes after every collector's own stop listener (they run at NORMAL). */
    static final EventPriority SHUTDOWN_PRIORITY = EventPriority.LOWEST;

    private static final Logger LOG = LedgerLog.server();

    private final NeoForgeHostScheduler scheduler = new NeoForgeHostScheduler(LOG);
    private volatile MinecraftServer server;
    private OtelLedger ledger;

    public LedgerMod() {
        try {
            NeoForgeHostInfo host = new NeoForgeHostInfo(
                    scheduler::serverTick, () -> server != null && server.isSameThread());
            ledger = create(FMLPaths.CONFIGDIR.get().resolve(CONFIG_FILE), host, GlobalOpenTelemetry::get);
            OtelLedger l = ledger;
            // First, so no failing install can skip it. LOWEST: it runs after the collectors' own stop listeners
            // (priority NORMAL), whatever the registration order, so the ledger still closes last.
            isolated("shutdown listener", () -> NeoForge.EVENT_BUS.addListener(
                    SHUTDOWN_PRIORITY, ServerStoppingEvent.class, e -> shutdown(ledger, scheduler)));
            isolated("server holder", () -> NeoForge.EVENT_BUS.addListener(ServerStartingEvent.class, e -> server = e.getServer()));
            isolated("tick", () -> dev.geldar.ledger.neoforge.tick.TickWiring.install(l, host, scheduler));
            // After TickWiring: Post listeners run in registration order, so the measured tick excludes our own tasks.
            isolated("scheduler tick", () -> NeoForge.EVENT_BUS.addListener(ServerTickEvent.Post.class, e -> scheduler.onServerTick()));
            isolated("progress", () -> dev.geldar.ledger.neoforge.players.ProgressWiring.install(l, host, scheduler));
            isolated("curated", () -> dev.geldar.ledger.neoforge.curated.CuratedWiring.install(l, host, scheduler));
            isolated("audit", () -> dev.geldar.ledger.neoforge.audit.AuditWiring.install(l, host));
            isolated("world, server, snapshot", () -> StateWiring.install(l, host, scheduler));
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger setup failed, ledger off: " + t.getClass().getName());
        }
    }

    /** Runs one install on its own: a throw (a linkage error included) is logged and never skips the others. */
    static void isolated(String what, Runnable install) {
        try {
            install.run();
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger " + what + " install failed: " + t.getClass().getName());
        }
    }

    /** Closes the ledger first (flush), then the scheduler; neither failure escapes. */
    static void shutdown(OtelLedger ledger, NeoForgeHostScheduler scheduler) {
        shutdown(ledger == null ? null : ledger::close, scheduler::close);
    }

    /** The order itself: flush the ledger, then close the scheduler even when the flush failed. */
    static void shutdown(Runnable closeLedger, Runnable closeScheduler) {
        try {
            if (closeLedger != null) {
                closeLedger.run();
            }
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger close failed: " + t.getClass().getName());
        } finally {
            closeScheduler.run();
        }
    }

    /** The ledger for a config file; null (logged) when the file is unreadable or invalid or anything else fails. */
    static OtelLedger create(Path file, HostInfo host, Supplier<OpenTelemetry> otel) {
        try {
            Properties props = new Properties();
            if (Files.isRegularFile(file)) {
                try (InputStream in = Files.newInputStream(file)) {
                    props.load(in);
                } catch (IOException | IllegalArgumentException e) {
                    LOG.warning("ledger config unreadable, ledger off: " + e.getClass().getSimpleName());
                    return null;
                }
            }
            ConfigParser.ParseResult result = ConfigParser.parse(props);
            if (!result.ok()) {
                LOG.warning("ledger config invalid, ledger off: " + result.errors());
                return null;
            }
            return LedgerBootstrap.create(result.config(), host, LOG, otel.get());
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger startup failed, ledger off: " + t.getClass().getName());
            return null;
        }
    }

    private static void rethrowIfVmError(Throwable t) {
        if (t instanceof VirtualMachineError vme) {
            throw vme;
        }
    }
}