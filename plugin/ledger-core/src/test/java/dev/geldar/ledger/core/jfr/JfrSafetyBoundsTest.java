package dev.geldar.ledger.core.jfr;

import static org.junit.jupiter.api.Assertions.assertDoesNotThrow;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.time.Duration;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import jdk.jfr.consumer.RecordingStream;
import org.junit.jupiter.api.Test;

class JfrSafetyBoundsTest {
    private static final class Recorded implements JfrRunner.StreamConfigurer {
        final List<Duration> ages = new ArrayList<>();
        final List<Long> sizes = new ArrayList<>();
        Map<String, String> settings;

        @Override
        public void setMaxAge(Duration age) {
            ages.add(age);
        }

        @Override
        public void setMaxSize(long bytes) {
            sizes.add(bytes);
        }

        @Override
        public void setSettings(Map<String, String> s) {
            settings = s;
        }
    }

    @Test
    void streamIsBoundedTo30SecondsAnd8MiB() {
        Recorded r = new Recorded();
        JfrRunner.configure(r, JfrSettings.defaults().resolve(List.of("jdk.FileRead")));
        assertEquals(List.of(Duration.ofSeconds(30)), r.ages);
        assertEquals(List.of(8L * 1024 * 1024), r.sizes);
    }

    @Test
    void everyEnabledEventHasNoStackTraceAndAnExplicitThrottle() {
        JfrSettings s = JfrSettings.defaults();
        Recorded r = new Recorded();
        JfrRunner.configure(r, s.resolve(List.copyOf(s.allowed())));
        assertFalse(s.allowed().isEmpty());
        for (String name : s.allowed()) {
            assertEquals("true", r.settings.get(name + "#enabled"), name);
            assertEquals("false", r.settings.get(name + "#stackTrace"), name);
            JfrSettings.Setting setting = s.resolve(List.of(name)).get(name);
            String key = name + (setting.kind() == JfrSettings.Setting.Kind.PERIOD ? "#period" : "#threshold");
            assertEquals(setting.value().toNanos() + " ns", r.settings.get(key), name);
        }
        assertEquals(s.allowed().size() * 3, r.settings.size());
        assertTrue(r.settings.keySet().stream().noneMatch(k -> k.endsWith("#stackTrace=true")));
    }

    @Test
    void theRealRecordingStreamAcceptsTheSettings() {
        JfrSettings s = JfrSettings.defaults();
        try (RecordingStream rs = new RecordingStream()) {
            assertDoesNotThrow(() -> JfrRunner.configure(JfrRunner.forStream(rs), s.resolve(List.copyOf(s.allowed()))));
        }
    }

    @Test
    void everyDeniedEventIsRefusedEvenWhenTheAllowListNamesIt() {
        JfrSettings.Setting any = JfrSettings.Setting.threshold(Duration.ofMillis(1));
        assertTrue(JfrSettings.DENIED.containsAll(List.of(
                "jdk.SocketRead",
                "jdk.SocketWrite",
                "jdk.ProcessStart",
                "jdk.InitialEnvironmentVariable",
                "jdk.InitialSystemProperty",
                "jdk.JVMInformation",
                "jdk.SystemProcess",
                "jdk.NativeLibrary")));
        for (String name : JfrSettings.DENIED) {
            JfrSettings viaCtor = new JfrSettings(Map.of(name, any));
            JfrSettings viaWith = JfrSettings.defaults().with(name, any);
            assertFalse(viaCtor.allowed().contains(name), name);
            assertFalse(viaWith.allowed().contains(name), name);
            assertTrue(viaWith.resolve(List.of(name)).isEmpty(), name);
            assertFalse(JfrSettings.defaults().allowed().contains(name), name);
        }
    }

    @Test
    void fileEventsAreEnabledByDefaultButHandlersMustNeverReadThePath() {
        Map<String, JfrSettings.Setting> r = JfrSettings.defaults().resolve(List.of("jdk.FileRead", "jdk.FileWrite"));
        assertEquals(2, r.size());
        assertTrue(JfrHandler.forbiddenFields().contains("path"));
        assertTrue(JfrHandler.forbiddenFields().contains("stackTrace"));
    }
}
