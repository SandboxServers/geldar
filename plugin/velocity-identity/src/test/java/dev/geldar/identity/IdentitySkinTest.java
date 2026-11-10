package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.connection.LoginEvent;
import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.proxy.InboundConnection;
import com.velocitypowered.api.proxy.Player;
import com.velocitypowered.api.util.GameProfile;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** The skin handler on the login path: a stored texture is set for a registered life, and nothing else changes. */
class IdentitySkinTest {
    private static final String GOOD = SkinRegistryTest.texture("https://textures.minecraft.net/texture/abc");
    private static final String SIGNATURE = "c2ln";

    private final SkinRegistry skins = new SkinRegistry(NOPLogger.NOP_LOGGER);
    private final IdentityPlugin plugin = new IdentityPlugin(null, NOPLogger.NOP_LOGGER, () -> null, skins);

    /** Registers {@code name} for {@code lifeId} in the plugin's life registry. */
    private void registerLife(String name, String lifeId) throws Exception {
        var field = IdentityPlugin.class.getDeclaredField("registry");
        field.setAccessible(true);
        LifeRegistry registry = (LifeRegistry) field.get(plugin);
        if (!registry.isSynced()) {
            registry.beginReplay();
        }
        registry.put(LifeRegistry.key(name), ("{\"life_id\":\"" + lifeId + "\",\"registered_at\":\"t\"}").getBytes(StandardCharsets.UTF_8));
        registry.markSynced();
    }

    /** Stores a skin for {@code lifeId} and completes the bucket replay. */
    private void storeSkin(String lifeId, String value) {
        skins.beginReplay();
        skins.put(lifeId, SkinRegistryTest.record(lifeId, value, SIGNATURE));
        skins.markSynced();
    }

    private static GameProfileRequestEvent request(String name, GameProfile.Property... extra) {
        GameProfile profile = GameProfile.forOfflinePlayer(name);
        List<GameProfile.Property> properties = new ArrayList<>(profile.getProperties());
        properties.addAll(List.of(extra));
        InboundConnection connection = (InboundConnection) Proxy.newProxyInstance(
                InboundConnection.class.getClassLoader(), new Class<?>[] {InboundConnection.class},
                (p, m, a) -> m.getReturnType() == boolean.class ? false : null);
        return new GameProfileRequestEvent(connection, profile.withProperties(properties), false);
    }

    private static List<GameProfile.Property> textures(GameProfileRequestEvent event) {
        return event.getGameProfile().getProperties().stream()
                .filter(p -> IdentityPlugin.TEXTURES.equals(p.getName()))
                .toList();
    }

    @Test
    void aRegisteredLifeGetsItsStoredTexture() throws Exception {
        registerLife("Alice", "life-1");
        storeSkin("life-1", GOOD);
        GameProfileRequestEvent event = request("Alice");
        plugin.onGameProfile(event);
        List<GameProfile.Property> textures = textures(event);
        assertEquals(1, textures.size());
        assertEquals(GOOD, textures.get(0).getValue());
        assertEquals(SIGNATURE, textures.get(0).getSignature());
    }

    @Test
    void aStoredTextureReplacesATexturesPropertyTheClientSent() throws Exception {
        registerLife("Alice", "life-1");
        storeSkin("life-1", GOOD);
        GameProfileRequestEvent event = request("Alice", new GameProfile.Property("textures", "client-value", "client-sig"));
        plugin.onGameProfile(event);
        List<GameProfile.Property> textures = textures(event);
        assertEquals(1, textures.size());
        assertEquals(GOOD, textures.get(0).getValue());
    }

    @Test
    void aLifeWithoutAStoredSkinKeepsTheDefaultProfile() throws Exception {
        registerLife("Alice", "life-1");
        GameProfileRequestEvent event = request("Alice");
        plugin.onGameProfile(event);
        assertTrue(textures(event).isEmpty());
    }

    @Test
    void anUnregisteredNameGetsNoSkinEvenWhenAnyLifeHasOne() throws Exception {
        registerLife("Alice", "life-1");
        storeSkin("life-2", GOOD);
        GameProfileRequestEvent event = request("Mallory");
        plugin.onGameProfile(event);
        assertTrue(textures(event).isEmpty());
    }

    @Test
    void aSkinBucketThatIsNotSyncedGivesTheDefaultProfile() throws Exception {
        registerLife("Alice", "life-1");
        skins.beginReplay();
        skins.put("life-1", SkinRegistryTest.record("life-1", GOOD, SIGNATURE));
        GameProfileRequestEvent event = request("Alice");
        plugin.onGameProfile(event);
        assertTrue(textures(event).isEmpty(), "NATS down or the bucket missing: no skin, no error");
    }

    @Test
    void aFailingLookupKeepsTheDefaultProfileAndDoesNotThrow() throws Exception {
        SkinRegistry failing = new SkinRegistry(NOPLogger.NOP_LOGGER) {
            @Override
            public Optional<Texture> find(String lifeId) {
                throw new IllegalStateException("lookup broke");
            }
        };
        IdentityPlugin broken = new IdentityPlugin(null, NOPLogger.NOP_LOGGER, () -> null, failing);
        var field = IdentityPlugin.class.getDeclaredField("registry");
        field.setAccessible(true);
        LifeRegistry registry = (LifeRegistry) field.get(broken);
        registry.beginReplay();
        registry.put("alice", "{\"life_id\":\"life-1\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8));
        registry.markSynced();
        GameProfileRequestEvent event = request("Alice");
        broken.onGameProfile(event);
        assertTrue(textures(event).isEmpty());
        assertEquals("Alice", event.getGameProfile().getName());
    }

    @Test
    void aSkinNeverAdmitsALogin() throws Exception {
        storeSkin("life-1", GOOD);
        plugin.onGameProfile(request("Mallory"));
        UUID id = UUID.randomUUID();
        Player mallory = (Player) Proxy.newProxyInstance(Player.class.getClassLoader(), new Class<?>[] {Player.class},
                (p, m, a) -> switch (m.getName()) {
                    case "getUsername" -> "Mallory";
                    case "getUniqueId" -> id;
                    case "hashCode" -> id.hashCode();
                    case "equals" -> p == a[0];
                    default -> throw new UnsupportedOperationException(m.getName());
                });
        LoginEvent login = new LoginEvent(mallory);
        plugin.onLogin(login);
        assertFalse(login.getResult().isAllowed());
        assertNotNull(login.getResult().getReasonComponent().orElse(null));
    }
}
