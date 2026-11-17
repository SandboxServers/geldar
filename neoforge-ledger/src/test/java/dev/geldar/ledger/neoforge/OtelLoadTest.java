package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertNotSame;
import static org.junit.jupiter.api.Assertions.assertSame;

import java.net.URL;
import java.net.URLClassLoader;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.zip.ZipFile;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

/**
 * PT-N3, the part that needs no Minecraft: the jars nested in the built mod jar, put on ONE class loader (what FML's
 * jar-in-jar did in the real server run, see docs/analysis/telemetry/neoforge-otel-spike.md), give ledger-core and the
 * OpenTelemetry API the same API classes, and without an agent GlobalOpenTelemetry is the no-op, so
 * LedgerBootstrap.agentPresent is false. With the agent it is true: that half is the manual runServer run in the note.
 */
class OtelLoadTest {
    @Test
    void nestedJarsShareOneApiAndWithoutAgentTheGlobalIsNoop(@TempDir Path tmp) throws Exception {
        List<URL> urls = new ArrayList<>();
        try (ZipFile zip = new ZipFile(Path.of(System.getProperty("ledger.mod.jar")).toFile())) {
            for (var e : zip.stream().filter(x -> x.getName().startsWith("META-INF/jarjar/") && x.getName().endsWith(".jar")).toList()) {
                Path out = tmp.resolve(Path.of(e.getName()).getFileName().toString());
                try (var in = zip.getInputStream(e)) {
                    Files.copy(in, out);
                }
                urls.add(out.toUri().toURL());
            }
        }
        assertEquals(4, urls.size());
        try (URLClassLoader cl = new URLClassLoader(urls.toArray(URL[]::new), ClassLoader.getPlatformClassLoader())) {
            Class<?> global = cl.loadClass("io.opentelemetry.api.GlobalOpenTelemetry");
            Class<?> core = cl.loadClass("dev.geldar.ledger.core.LedgerBootstrap");
            assertSame(cl, global.getClassLoader());
            assertSame(cl, core.getClassLoader());
            // ledger-core's view of the API is the API loaded above, not a second copy.
            assertSame(global, core.getClassLoader().loadClass("io.opentelemetry.api.GlobalOpenTelemetry"));
            assertNotSame(GlobalOpenTelemetryHolder.apiClass(), global, "test classpath copy must differ from the isolated one");
            Object otel = global.getMethod("get").invoke(null);
            Object noop = cl.loadClass("io.opentelemetry.api.metrics.MeterProvider").getMethod("noop").invoke(null);
            assertFalse(otel.getClass().getName().contains("javaagent"), "no agent is attached in unit tests");
            Object provider = cl.loadClass("io.opentelemetry.api.OpenTelemetry").getMethod("getMeterProvider").invoke(otel);
            assertSame(noop, provider, "without the agent the global meter provider is the no-op");
        }
    }

    private static final class GlobalOpenTelemetryHolder {
        static Class<?> apiClass() {
            return io.opentelemetry.api.GlobalOpenTelemetry.class;
        }
    }
}
