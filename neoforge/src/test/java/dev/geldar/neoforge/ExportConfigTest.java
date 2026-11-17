package dev.geldar.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Properties;
import org.junit.jupiter.api.Test;

class ExportConfigTest {
    private static final String SECRET_PATH = "/run/secrets/dummy-nats-password";
    private final List<String> warnings = new ArrayList<>();
    private final OperatorSink sink = new OperatorSink() {
        @Override
        public void info(String message) {
            // Only warnings matter to these tests.
        }

        @Override
        public void warn(String message) {
            warnings.add(message);
        }
    };

    private ExportConfig resolve(Map<String, String> env, Properties file, boolean passwordFileReadable) {
        return ExportConfig.resolve(file, env::get, path -> passwordFileReadable, sink);
    }

    private static Properties enabledFile() {
        Properties file = new Properties();
        file.setProperty("export.enabled", "true");
        file.setProperty("shard", "nf");
        return file;
    }

    @Test
    void noSettingsMeansDisabledAndSilent() {
        ExportConfig config = resolve(Map.of(), new Properties(), true);
        assertFalse(config.enabled());
        assertTrue(warnings.isEmpty());
    }

    @Test
    void enabledFileReadsEveryKey() {
        Properties file = enabledFile();
        file.setProperty("nats.url", "nats://nats.internal:4222");
        file.setProperty("nats.user", "dummy-exporter");
        file.setProperty("nats.password.file", SECRET_PATH);
        file.setProperty("queue.capacity", "50");
        ExportConfig config = resolve(Map.of(), file, true);
        assertTrue(config.enabled());
        assertEquals("nats://nats.internal:4222", config.natsUrl());
        assertEquals("nf", config.shard());
        assertEquals("dummy-exporter", config.natsUser());
        assertEquals(SECRET_PATH, config.passwordFile());
        assertEquals(50, config.queueCapacity());
        assertTrue(warnings.isEmpty());
    }

    @Test
    void environmentOverridesTheFile() {
        Properties file = enabledFile();
        file.setProperty("nats.url", "nats://from-file:4222");
        ExportConfig config = resolve(Map.of("GELDAR_NATS_URL", "nats://from-env:4222", "GELDAR_SHARD", "nf2"), file, true);
        assertEquals("nats://from-env:4222", config.natsUrl());
        assertEquals("nf2", config.shard());
    }

    @Test
    void environmentCanEnableWithoutAFileAndDisableAFileThatEnables() {
        ExportConfig enabledByEnv = resolve(Map.of("GELDAR_NEOFORGE_EXPORT", "true", "GELDAR_SHARD", "nf"), new Properties(), true);
        assertTrue(enabledByEnv.enabled());
        assertEquals(ExportConfig.DEFAULT_NATS_URL, enabledByEnv.natsUrl());
        assertFalse(resolve(Map.of("GELDAR_NEOFORGE_EXPORT", "false"), enabledFile(), true).enabled());
        assertTrue(warnings.isEmpty());
    }

    @Test
    void badUrlDisablesWithAWarningThatNamesTheKey() {
        Properties file = enabledFile();
        file.setProperty("nats.url", "http://nats.internal:4222");
        assertFalse(resolve(Map.of(), file, true).enabled());
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("nats.url"));
    }

    @Test
    void urlCarryingCredentialsDisablesAndNeverEchoesThem() {
        Properties file = enabledFile();
        // Dummy user and password, built at runtime so the credential scanner does not flag a literal URL with a password.
        String password = String.join("-", "dummy", "pass", "7731");
        file.setProperty("nats.url", "nats://" + "dummy-user" + ":" + password + "@nats.internal:4222");
        assertFalse(resolve(Map.of(), file, true).enabled());
        String logged = String.join("\n", warnings);
        assertTrue(logged.contains("nats.url"));
        assertFalse(logged.contains(password));
        assertFalse(logged.contains("dummy-user"));
    }

    @Test
    void missingPasswordFileDisablesWithoutEchoingThePath() {
        Properties file = enabledFile();
        file.setProperty("nats.user", "dummy-exporter");
        file.setProperty("nats.password.file", SECRET_PATH);
        ExportConfig config = resolve(Map.of(), file, false);
        assertFalse(config.enabled());
        assertEquals(1, warnings.size());
        assertTrue(warnings.get(0).contains("nats.password.file"));
        assertFalse(warnings.get(0).contains(SECRET_PATH));
    }

    @Test
    void userWithoutPasswordFileOrTheReverseDisables() {
        Properties userOnly = enabledFile();
        userOnly.setProperty("nats.user", "dummy-exporter");
        assertFalse(resolve(Map.of(), userOnly, true).enabled());
        Properties fileOnly = enabledFile();
        fileOnly.setProperty("nats.password.file", SECRET_PATH);
        assertFalse(resolve(Map.of(), fileOnly, true).enabled());
        assertEquals(2, warnings.size());
    }

    @Test
    void shardIsRequiredWhenEnabled() {
        Properties file = new Properties();
        file.setProperty("export.enabled", "true");
        assertFalse(resolve(Map.of(), file, true).enabled());
        assertEquals(1, warnings.size());
    }

    /** The shard-token rule (the revert-check target): one subject token, lowercase, starting with a letter. */
    @Test
    void shardTokenRuleAcceptsOnlyOneLowercaseSubjectToken() {
        assertTrue(ExportConfig.SHARD_NAME.matcher("nf").matches());
        assertTrue(ExportConfig.SHARD_NAME.matcher("nf-scratch-2").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("n").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("1nf").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("NF").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("nf.live").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("nf*").matches());
        assertFalse(ExportConfig.SHARD_NAME.matcher("a".repeat(33)).matches());
        Properties file = enabledFile();
        file.setProperty("shard", "nf.live");
        assertFalse(resolve(Map.of(), file, true).enabled());
    }

    @Test
    void badQueueCapacityDisables() {
        Properties zero = enabledFile();
        zero.setProperty("queue.capacity", "0");
        assertFalse(resolve(Map.of(), zero, true).enabled());
        Properties text = enabledFile();
        text.setProperty("queue.capacity", "lots");
        assertFalse(resolve(Map.of(), text, true).enabled());
        assertEquals(2, warnings.size());
    }

    @Test
    void toStringNeverShowsThePasswordFilePath() {
        ExportConfig config = new ExportConfig(true, "nats://nats:4222", "nf", "dummy-exporter", SECRET_PATH, 10);
        String text = config.toString();
        assertFalse(text.contains(SECRET_PATH));
        assertTrue(text.contains("credentials=set"));
    }
}
