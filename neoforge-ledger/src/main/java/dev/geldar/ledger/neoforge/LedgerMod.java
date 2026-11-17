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
import net.neoforged.fml.common.Mod;
import net.neoforged.fml.loading.FMLPaths;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartingEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;
import net.neoforged.neoforge.event.tick.ServerTickEvent;

/**
 * Server-only entry point. Builds the ledger from {@code config/ledger.properties} (a missing file means defaults, a
 * bad file means no ledger). Nothing here may stop the server from starting: any failure leaves the ledger off. No
 * collectors are registered yet; no registry entries and no payloads, ever.
 */
@Mod(value = "ledger", dist = Dist.DEDICATED_SERVER)
public final class LedgerMod {
    static final String CONFIG_FILE = "ledger.properties";
    private static final Logger LOG = LedgerLog.server();

    private final NeoForgeHostScheduler scheduler = new NeoForgeHostScheduler(LOG);
    private volatile MinecraftServer server;
    private OtelLedger ledger;

    public LedgerMod() {
        try {
            NeoForgeHostInfo host = new NeoForgeHostInfo(
                    scheduler::serverTick, () -> server != null && server.isSameThread());
            ledger = create(FMLPaths.CONFIGDIR.get().resolve(CONFIG_FILE), host, GlobalOpenTelemetry::get);
            NeoForge.EVENT_BUS.addListener(ServerStartingEvent.class, e -> server = e.getServer());
            dev.geldar.ledger.neoforge.tick.TickWiring.install(ledger, host, scheduler);
            // After TickWiring: Post listeners run in registration order, so the measured tick excludes our own tasks.
            NeoForge.EVENT_BUS.addListener(ServerTickEvent.Post.class, e -> scheduler.onServerTick());
            dev.geldar.ledger.neoforge.players.ProgressWiring.install(ledger, host, scheduler);
            dev.geldar.ledger.neoforge.audit.AuditWiring.install(ledger, host);
            NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> shutdown(ledger, scheduler));
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger setup failed, ledger off: " + t.getClass().getName());
        }
    }

    /** Closes the ledger first (flush), then the scheduler; neither failure escapes. */
    static void shutdown(OtelLedger ledger, NeoForgeHostScheduler scheduler) {
        try {
            if (ledger != null) {
                ledger.close();
            }
        } catch (Throwable t) {
            rethrowIfVmError(t);
            LOG.warning("ledger close failed: " + t.getClass().getName());
        } finally {
            scheduler.close();
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