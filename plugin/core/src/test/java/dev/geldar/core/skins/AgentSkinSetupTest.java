package dev.geldar.core.skins;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertNotNull;

import java.lang.reflect.Proxy;
import java.util.logging.Logger;
import org.bukkit.plugin.Plugin;
import org.junit.jupiter.api.Test;

class AgentSkinSetupTest {
    private static final Logger LOG = Logger.getLogger("agent-skin-setup-test");

    @Test
    void registerWithoutAServerDoesNotThrow() {
        // No Bukkit server runs in a unit test, so the plugin manager lookup fails; register must absorb that.
        Plugin plugin = (Plugin) Proxy.newProxyInstance(
                Plugin.class.getClassLoader(),
                new Class<?>[] {Plugin.class},
                (proxy, method, args) -> method.getName().equals("getLogger") ? LOG : null);

        AgentSkinSetup setup = assertDoesNotThrow(() -> AgentSkinSetup.register(plugin, name -> null));

        assertNotNull(setup);
    }
}
