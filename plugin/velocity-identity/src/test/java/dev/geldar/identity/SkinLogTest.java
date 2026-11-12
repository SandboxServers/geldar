package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import com.velocitypowered.api.event.player.GameProfileRequestEvent;
import com.velocitypowered.api.proxy.InboundConnection;
import com.velocitypowered.api.util.GameProfile;
import java.lang.reflect.Proxy;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.slf4j.Logger;

/** Every skin branch writes one fixed log line, and no line carries a texture value or a signature. */
class SkinLogTest {
    private static final String GOOD = SkinRegistryTest.texture("https://textures.minecraft.net/texture/abc");
    private static final String SIGNATURE = "c2VjcmV0LXNpZw==";

    private final List<String> lines = new ArrayList<>();
    private final Logger log = capture(lines);
    private final SkinRegistry skins = new SkinRegistry(log);
    private final IdentityPlugin plugin = new IdentityPlugin(null, log, () -> null, skins);

    /** A logger that records {@code LEVEL message} with {} filled in. */
    static Logger capture(List<String> sink) {
        return (Logger) Proxy.newProxyInstance(Logger.class.getClassLoader(), new Class<?>[] {Logger.class}, (p, m, a) -> {
            String level = m.getName();
            if (a != null && a.length > 0 && a[0] instanceof String format
                    && List.of("info", "warn", "error").contains(level)) {
                Object[] args = a.length == 2 && a[1] instanceof Object[] array
                        ? array
                        : java.util.Arrays.copyOfRange(a, 1, a.length);
                sink.add(level.toUpperCase() + " " + org.slf4j.helpers.MessageFormatter.arrayFormat(format, args).getMessage());
            }
            return m.getReturnType() == boolean.class ? false : null;
        });
    }

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

    private void login(String name) {
        InboundConnection connection = (InboundConnection) Proxy.newProxyInstance(
                InboundConnection.class.getClassLoader(), new Class<?>[] {InboundConnection.class},
                (p, m, a) -> m.getReturnType() == boolean.class ? false : null);
        plugin.onGameProfile(new GameProfileRequestEvent(connection, GameProfile.forOfflinePlayer(name), false));
    }

    private void sync(String key, byte[] record) {
        skins.beginReplay();
        skins.put(key, record);
        skins.markSynced();
    }

    private String all() {
        return String.join("\n", lines);
    }

    @Test
    void appliedLineNamesTheLifeAndVariant() throws Exception {
        registerLife("Jason", "ag_jason_01");
        sync("ag_jason_01", SkinRegistryTest.record("ag_jason_01", GOOD, SIGNATURE));
        lines.clear();
        login("Jason");
        assertEquals(List.of("INFO skin: applied for ag_jason_01 (variant classic)"), lines);
        assertFalse(all().contains(GOOD));
        assertFalse(all().contains(SIGNATURE));
    }

    @Test
    void slimVariantIsReported() throws Exception {
        registerLife("Jason", "ag_jason_01");
        String slim = new String(SkinRegistryTest.record("ag_jason_01", GOOD, SIGNATURE), StandardCharsets.UTF_8)
                .replace("\"classic\"", "\"slim\"");
        sync("ag_jason_01", slim.getBytes(StandardCharsets.UTF_8));
        lines.clear();
        login("Jason");
        assertEquals(List.of("INFO skin: applied for ag_jason_01 (variant slim)"), lines);
    }

    @Test
    void noRecordLine() throws Exception {
        registerLife("Jason", "ag_jason_01");
        sync("someone_else", SkinRegistryTest.record("someone_else", GOOD, SIGNATURE));
        lines.clear();
        login("Jason");
        assertEquals(List.of("INFO skin: no record for ag_jason_01"), lines);
    }

    @Test
    void rejectedLineGivesAFixedReasonAtPutAndAtLogin() throws Exception {
        registerLife("Jason", "ag_jason_01");
        String evil = SkinRegistryTest.texture("https://evil.example/texture/abc");
        sync("ag_jason_01", SkinRegistryTest.record("ag_jason_01", evil, SIGNATURE));
        assertTrue(lines.contains("WARN skin: record for ag_jason_01 rejected: texture is not on textures.minecraft.net"), all());
        lines.clear();
        login("Jason");
        assertEquals(List.of("WARN skin: record for ag_jason_01 rejected: texture is not on textures.minecraft.net"), lines);
        assertFalse(all().contains(evil));
    }

    @Test
    void aRecordForAnotherLifeIsRejectedWithItsReason() {
        sync("ag_jason_01", SkinRegistryTest.record("ag_zack_01", GOOD, SIGNATURE));
        assertTrue(lines.contains("WARN skin: record for ag_jason_01 rejected: life_id does not match the key"), all());
    }

    @Test
    void aGoodRecordAfterARejectedOneClearsTheRejection() throws Exception {
        registerLife("Jason", "ag_jason_01");
        sync("ag_jason_01", SkinRegistryTest.record("ag_zack_01", GOOD, SIGNATURE));
        skins.put("ag_jason_01", SkinRegistryTest.record("ag_jason_01", GOOD, SIGNATURE));
        lines.clear();
        login("Jason");
        assertEquals(List.of("INFO skin: applied for ag_jason_01 (variant classic)"), lines);
    }

    @Test
    void kvUnavailableWhenTheBucketIsNotSynced() throws Exception {
        registerLife("Jason", "ag_jason_01");
        lines.clear();
        login("Jason");
        assertEquals(List.of("WARN skin: KV unavailable: NotSynced"), lines);
    }

    @Test
    void kvUnavailableNamesTheErrorClassOfAFailingLookup() throws Exception {
        SkinRegistry failing = new SkinRegistry(log) {
            @Override
            public Optional<Texture> find(String lifeId) {
                throw new IllegalStateException("broke");
            }
        };
        IdentityPlugin broken = new IdentityPlugin(null, log, () -> null, failing);
        var field = IdentityPlugin.class.getDeclaredField("registry");
        field.setAccessible(true);
        LifeRegistry registry = (LifeRegistry) field.get(broken);
        registry.beginReplay();
        registry.put("jason", "{\"life_id\":\"ag_jason_01\",\"registered_at\":\"t\"}".getBytes(StandardCharsets.UTF_8));
        registry.markSynced();
        InboundConnection connection = (InboundConnection) Proxy.newProxyInstance(
                InboundConnection.class.getClassLoader(), new Class<?>[] {InboundConnection.class},
                (p, m, a) -> m.getReturnType() == boolean.class ? false : null);
        broken.onGameProfile(new GameProfileRequestEvent(connection, GameProfile.forOfflinePlayer("Jason"), false));
        assertEquals(List.of("WARN skin: KV unavailable: IllegalStateException"), lines);
    }

    @Test
    void skippedWhenTheNameIsNotASovereignLife() {
        login("Mallory");
        assertEquals(List.of("INFO skin: lookup skipped (not a sovereign life)"), lines);
    }

    @Test
    void theSyncLineNamesTheBucketAndTheKeyCount() {
        sync("ag_jason_01", SkinRegistryTest.record("ag_jason_01", GOOD, SIGNATURE));
        assertEquals(List.of("INFO skin: bucket geldar-skins synced, 1 keys cached, 0 rejected"), lines);
    }
}
