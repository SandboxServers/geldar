package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import org.bukkit.Server;
import org.junit.jupiter.api.Test;

class PaperHostInfoTest {
    private static Server server(long[] tick, boolean[] primary) {
        return (Server) Proxy.newProxyInstance(
                PaperHostInfoTest.class.getClassLoader(), new Class<?>[] {Server.class}, (p, m, a) -> switch (m.getName()) {
                    case "getCurrentTick" -> (int) tick[0];
                    case "isPrimaryThread" -> primary[0];
                    default -> throw new UnsupportedOperationException(m.getName());
                });
    }

    @Test
    void serverTickComesFromTheServerTickCounterAndFollowsIt() {
        long[] tick = {41};
        PaperHostInfo info = new PaperHostInfo(server(tick, new boolean[] {true}));
        assertEquals(41, info.serverTick());
        tick[0] = 1_000_000;
        assertEquals(1_000_000, info.serverTick());
    }

    @Test
    void isMainThreadIsThePrimaryThreadFlagBothWays() {
        boolean[] primary = {true};
        PaperHostInfo info = new PaperHostInfo(server(new long[] {0}, primary));
        assertTrue(info.isMainThread());
        primary[0] = false;
        assertFalse(info.isMainThread());
    }

    @Test
    void loaderNameIsPaper() {
        assertEquals("paper", new PaperHostInfo(server(new long[] {0}, new boolean[] {true})).loaderName());
    }
}