package dev.geldar.ledger.neoforge.curated;

import dev.geldar.ledger.core.CollectorContext;
import dev.geldar.ledger.core.HostInfo;
import dev.geldar.ledger.core.HostScheduler;
import dev.geldar.ledger.core.Ledger;
import java.util.function.Consumer;
import java.util.logging.Logger;
import net.neoforged.bus.api.Event;
import net.neoforged.bus.api.EventPriority;
import net.neoforged.neoforge.common.NeoForge;
import net.neoforged.neoforge.event.server.ServerStartedEvent;
import net.neoforged.neoforge.event.server.ServerStoppingEvent;

/**
 * Registers the curated listeners on the NeoForge game bus and starts the {@link CuratedCollector} once the server has
 * started. Fail-safe: any failure leaves the collector off and the server running. Listeners are added at startup only;
 * they do nothing until the collector is active.
 */
public final class CuratedWiring {
    private static final Logger LOG = Logger.getLogger("ledger");

    private CuratedWiring() {}

    /** Call from the mod constructor. Does nothing for a null ledger. */
    public static void install(Ledger ledger, HostInfo host, HostScheduler scheduler) {
        if (ledger == null) {
            return;
        }
        try {
            CuratedCollector c = new CuratedCollector();
            Bus bus = new Bus() {
                @Override
                public <E extends Event> void listen(Class<E> type, Consumer<E> handler) {
                    NeoForge.EVENT_BUS.addListener(EventPriority.LOWEST, true, type, handler);
                }
            };
            Readers readers = new McReaders();
            BlocksItemsFamily.register(bus, c, readers);
            ContainersFamily.register(bus, c, readers);
            NeoForge.EVENT_BUS.addListener(ServerStartedEvent.class, e -> start(c, ledger, host, scheduler));
            NeoForge.EVENT_BUS.addListener(ServerStoppingEvent.class, e -> c.stop());
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger curated wiring failed: " + t.getClass().getName());
        }
    }

    static void start(CuratedCollector c, Ledger ledger, HostInfo host, HostScheduler scheduler) {
        try {
            c.start(new CollectorContext() {
                @Override
                public Ledger ledger() {
                    return ledger;
                }

                @Override
                public HostScheduler scheduler() {
                    return scheduler;
                }

                @Override
                public HostInfo host() {
                    return host;
                }
            });
        } catch (Throwable t) {
            if (t instanceof VirtualMachineError vme) {
                throw vme;
            }
            LOG.warning("ledger curated collector failed, off: " + t.getClass().getName());
        }
    }
}
