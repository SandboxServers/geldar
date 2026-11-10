package dev.geldar.identity;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import org.junit.jupiter.api.Test;
import org.slf4j.helpers.NOPLogger;

/** The skin bucket's record rules: a record is kept only when it names its life and carries a Mojang texture. */
class SkinRegistryTest {
    private static final String SIGNATURE = Base64.getEncoder().encodeToString("sig".getBytes(StandardCharsets.UTF_8));

    /** A base64 texture value whose SKIN url is on {@code host}. */
    static String texture(String url) {
        String json = "{\"textures\":{\"SKIN\":{\"url\":\"" + url + "\"}}}";
        return Base64.getEncoder().encodeToString(json.getBytes(StandardCharsets.UTF_8));
    }

    static byte[] record(String lifeId, String value, String signature) {
        return ("{\"life_id\":\"" + lifeId + "\",\"value\":\"" + value + "\",\"signature\":\"" + signature
                + "\",\"model\":\"classic\",\"set_at\":\"2026-11-09T00:00:00Z\"}").getBytes(StandardCharsets.UTF_8);
    }

    /** A registry whose one bucket replay has completed, holding the given key and record. */
    private static SkinRegistry synced(String key, byte[] value) {
        SkinRegistry skins = new SkinRegistry(NOPLogger.NOP_LOGGER);
        skins.beginReplay();
        skins.put(key, value);
        skins.markSynced();
        return skins;
    }

    private static final String GOOD = texture("https://textures.minecraft.net/texture/abc");

    @Test
    void aMojangTextureRecordIsKeptUnderItsLife() {
        SkinRegistry skins = synced("life-1", record("life-1", GOOD, SIGNATURE));
        assertEquals(GOOD, skins.find("life-1").orElseThrow().value());
        assertEquals(SIGNATURE, skins.find("life-1").orElseThrow().signature());
        assertTrue(skins.find("life-2").isEmpty());
    }

    @Test
    void aRecordThatNamesAnotherLifeIsRejected() {
        SkinRegistry skins = synced("life-1", record("life-2", GOOD, SIGNATURE));
        assertTrue(skins.find("life-1").isEmpty());
        assertTrue(skins.find("life-2").isEmpty());
    }

    @Test
    void aTextureOnAnotherHostIsRejected() {
        String[] urls = {
            "https://evil.example/texture/abc",
            "https://textures.minecraft.net.evil.example/texture/abc",
            "https://evil.example/?textures.minecraft.net",
            "https://textures.minecraft.net@evil.example/texture/abc",
            "ftp://textures.minecraft.net/texture/abc",
        };
        for (String url : urls) {
            SkinRegistry skins = synced("life-1", record("life-1", texture(url), SIGNATURE));
            assertTrue(skins.find("life-1").isEmpty(), url);
        }
    }

    @Test
    void aValueThatIsNotBase64JsonIsRejected() {
        String notJson = Base64.getEncoder().encodeToString("not json".getBytes(StandardCharsets.UTF_8));
        String noSkin = Base64.getEncoder().encodeToString("{\"textures\":{}}".getBytes(StandardCharsets.UTF_8));
        for (String value : new String[] {"!!!not-base64!!!", notJson, noSkin, ""}) {
            SkinRegistry skins = synced("life-1", record("life-1", value, SIGNATURE));
            assertTrue(skins.find("life-1").isEmpty(), value);
        }
    }

    @Test
    void aSignatureThatIsNotBase64IsRejected() {
        SkinRegistry skins = synced("life-1", record("life-1", GOOD, "not base64!"));
        assertTrue(skins.find("life-1").isEmpty());
    }

    @Test
    void aStoredSkinIsNotUsedUntilTheReplayCompletes() {
        SkinRegistry skins = new SkinRegistry(NOPLogger.NOP_LOGGER);
        skins.beginReplay();
        skins.put("life-1", record("life-1", GOOD, SIGNATURE));
        assertTrue(skins.find("life-1").isEmpty(), "unsynced: no skin");
        skins.markSynced();
        assertTrue(skins.find("life-1").isPresent());
        skins.markUnsynced();
        assertTrue(skins.find("life-1").isEmpty(), "a lost bucket (NATS down) means no skin");
    }

    @Test
    void aRejectedRecordRemovesTheSkinItReplaces() {
        SkinRegistry skins = synced("life-1", record("life-1", GOOD, SIGNATURE));
        skins.beginReplay();
        skins.put("life-1", record("life-1", texture("https://evil.example/a"), SIGNATURE));
        skins.markSynced();
        assertTrue(skins.find("life-1").isEmpty());
    }

    @Test
    void aKeyMissingFromTheNewReplayIsGone() {
        SkinRegistry skins = synced("life-1", record("life-1", GOOD, SIGNATURE));
        skins.beginReplay();
        skins.markSynced();
        assertFalse(skins.find("life-1").isPresent());
    }

    @Test
    void aTextureDoesNotPrintItsValue() {
        SkinRegistry.Texture texture = new SkinRegistry.Texture(GOOD, SIGNATURE);
        assertFalse(texture.toString().contains(GOOD));
        assertFalse(texture.toString().contains(SIGNATURE));
    }
}
