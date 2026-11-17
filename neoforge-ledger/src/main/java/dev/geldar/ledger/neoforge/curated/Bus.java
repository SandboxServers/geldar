package dev.geldar.ledger.neoforge.curated;

import java.util.function.Consumer;
import net.neoforged.bus.api.Event;

/**
 * Where the family lambdas are installed. Production: the NeoForge game bus, at the lowest priority and receiving
 * cancelled events (so a cancelled break is seen, and marked). Tests: a recording fake.
 */
interface Bus {
    <E extends Event> void listen(Class<E> type, Consumer<E> handler);
}
