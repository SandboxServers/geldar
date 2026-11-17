package dev.geldar.ledger.paper;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.lang.reflect.Proxy;
import java.util.Arrays;
import java.util.logging.Logger;
import org.bukkit.event.EventHandler;
import org.bukkit.event.EventPriority;
import org.bukkit.event.HandlerList;
import org.bukkit.event.Listener;
import org.bukkit.event.player.PlayerJoinEvent;
import org.bukkit.event.player.PlayerQuitEvent;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;
import org.bukkit.plugin.RegisteredListener;
import org.junit.jupiter.api.Test;

/** S10: turning Ledger off leaves no Ledger listener in any HandlerList. */
class ListenerRegistryTest {
    static final class JoinQuitListener implements Listener {
        @EventHandler(priority = EventPriority.MONITOR)
        void onJoin(PlayerJoinEvent e) {}

        @EventHandler(priority = EventPriority.MONITOR)
        void onQuit(PlayerQuitEvent e) {}
    }

    private final Plugin plugin = (Plugin) Proxy.newProxyInstance(
            getClass().getClassLoader(), new Class<?>[] {Plugin.class}, (p, m, a) -> defaultFor(m.getReturnType()));

    /** A plugin manager whose registerEvents puts the listener into the real HandlerLists, like the server does. */
    private PluginManager manager(boolean throwAfterRegistering) {
        return (PluginManager) Proxy.newProxyInstance(
                getClass().getClassLoader(), new Class<?>[] {PluginManager.class}, (p, m, a) -> {
                    if (m.getName().equals("registerEvents")) {
                        Listener l = (Listener) a[0];
                        PlayerJoinEvent.getHandlerList()
                                .register(new RegisteredListener(l, (li, e) -> {}, EventPriority.MONITOR, plugin, false));
                        PlayerQuitEvent.getHandlerList()
                                .register(new RegisteredListener(l, (li, e) -> {}, EventPriority.MONITOR, plugin, false));
                        if (throwAfterRegistering) {
                            throw new IllegalStateException("boom");
                        }
                    }
                    return defaultFor(m.getReturnType());
                });
    }

    private static Object defaultFor(Class<?> t) {
        if (t == boolean.class) return false;
        if (t == int.class) return 0;
        if (t == long.class) return 0L;
        return null;
    }

    private static boolean present(HandlerList list, Listener l) {
        return Arrays.stream(list.getRegisteredListeners()).anyMatch(rl -> rl.getListener() == l);
    }

    @Test
    void unregisterAllLeavesNoLedgerListenerInAnyHandlerList() {
        ListenerRegistry registry = new ListenerRegistry(plugin, manager(false), Logger.getAnonymousLogger());
        JoinQuitListener a = new JoinQuitListener();
        JoinQuitListener b = new JoinQuitListener();
        registry.register(a);
        registry.register(b);
        assertTrue(present(PlayerJoinEvent.getHandlerList(), a));
        assertTrue(present(PlayerQuitEvent.getHandlerList(), b));
        assertEquals(2, registry.count());

        registry.unregisterAll();

        assertFalse(present(PlayerJoinEvent.getHandlerList(), a));
        assertFalse(present(PlayerJoinEvent.getHandlerList(), b));
        assertFalse(present(PlayerQuitEvent.getHandlerList(), a));
        assertFalse(present(PlayerQuitEvent.getHandlerList(), b));
        assertEquals(0, registry.count());
        registry.unregisterAll(); // idempotent
    }

    @Test
    void aRegistrationThatThrowsHalfwayDoesNotEscapeAndIsStillRemoved() {
        ListenerRegistry registry = new ListenerRegistry(plugin, manager(true), Logger.getAnonymousLogger());
        JoinQuitListener a = new JoinQuitListener();
        registry.register(a); // must not throw
        assertTrue(present(PlayerJoinEvent.getHandlerList(), a));

        registry.unregisterAll();

        assertFalse(present(PlayerJoinEvent.getHandlerList(), a));
        assertFalse(present(PlayerQuitEvent.getHandlerList(), a));
    }
}
