package dev.geldar.ledger.neoforge;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import static org.junit.jupiter.api.Assertions.assertTrue;

import java.io.IOException;
import java.math.BigInteger;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.zip.ZipFile;
import org.junit.jupiter.api.Test;

/**
 * The jar-in-jar metadata carries a range and the exact (preferred) version. The range must contain the exact version,
 * and the exact version must be the one the catalog (opentelemetry) or the plugin build (ledger-core) pins, so the
 * three places cannot drift.
 */
class JarJarVersionTest {
    private static final Pattern ENTRY = Pattern.compile(
            "\"artifact\"\\s*:\\s*\"([^\"]+)\"[^}]*\\}\\s*,\\s*\"version\"\\s*:\\s*\\{\\s*\"range\"\\s*:\\s*\"([^\"]+)\"\\s*,"
                    + "\\s*\"artifactVersion\"\\s*:\\s*\"([^\"]+)\"");

    record Nested(String artifact, String range, String version) {}

    static List<Nested> parse(String json) {
        List<Nested> out = new ArrayList<>();
        Matcher m = ENTRY.matcher(json);
        while (m.find()) {
            out.add(new Nested(m.group(1), m.group(2), m.group(3)));
        }
        return out;
    }

    /** Maven-style range: "[a,b)", "[a,b]" or "[a]". Versions compare numerically by dot-separated component. */
    static boolean inRange(String range, String version) {
        String r = range.trim();
        boolean loInc = r.startsWith("[");
        boolean hiInc = r.endsWith("]");
        String[] parts = r.substring(1, r.length() - 1).split(",", -1);
        if (parts.length == 1) {
            return compare(parts[0].trim(), version) == 0;
        }
        String lo = parts[0].trim();
        String hi = parts[1].trim();
        if (!lo.isEmpty()) {
            int c = compare(version, lo);
            if (c < 0 || (c == 0 && !loInc)) {
                return false;
            }
        }
        if (!hi.isEmpty()) {
            int c = compare(version, hi);
            return c < 0 || (c == 0 && hiInc);
        }
        return true;
    }

    static int compare(String a, String b) {
        String[] x = a.split("\\.");
        String[] y = b.split("\\.");
        for (int i = 0; i < Math.max(x.length, y.length); i++) {
            BigInteger p = i < x.length ? new BigInteger(x[i]) : BigInteger.ZERO;
            BigInteger q = i < y.length ? new BigInteger(y[i]) : BigInteger.ZERO;
            int c = p.compareTo(q);
            if (c != 0) {
                return c;
            }
        }
        return 0;
    }

    @Test
    void rangeMatcherHandlesBothBoundsAndTheSingleVersionForm() {
        assertTrue(inRange("[1.67,1.68)", "1.67.0"));
        assertTrue(inRange("[1.67,1.68)", "1.67.9"));
        assertFalse(inRange("[1.67,1.68)", "1.68.0"));
        assertFalse(inRange("[1.67,1.68)", "1.66.9"));
        assertTrue(inRange("[1.67.0]", "1.67.0"));
        assertFalse(inRange("[1.67.0]", "1.67.1"));
        assertTrue(inRange("[1,2]", "2"));
    }

    @Test
    void preferredVersionsLieInTheirRangeAndMatchTheCatalog() throws IOException {
        String catalog = Files.readString(Path.of(System.getProperty("ledger.catalog")), StandardCharsets.UTF_8);
        Matcher cat = Pattern.compile("(?m)^opentelemetry-api\\s*=\\s*\"([^\"]+)\"").matcher(catalog);
        assertTrue(cat.find(), "opentelemetry-api missing in the catalog");
        String otel = cat.group(1);
        String plugin = Files.readString(Path.of(System.getProperty("ledger.plugin.build")), StandardCharsets.UTF_8);
        Matcher pv = Pattern.compile("(?m)^\\s*version\\s*=\\s*\"([^\"]+)\"").matcher(plugin);
        assertTrue(pv.find(), "version missing in the plugin build");
        String core = pv.group(1);

        try (ZipFile zip = new ZipFile(Path.of(System.getProperty("ledger.mod.jar")).toFile())) {
            String json = new String(zip.getInputStream(zip.getEntry("META-INF/jarjar/metadata.json")).readAllBytes(),
                    StandardCharsets.UTF_8);
            List<Nested> nested = parse(json);
            assertEquals(4, nested.size(), "metadata entries: " + nested);
            for (Nested n : nested) {
                assertTrue(inRange(n.range(), n.version()),
                        n.artifact() + ": preferred " + n.version() + " is outside its range " + n.range());
                String expected = n.artifact().equals("ledger-core") ? core : otel;
                assertEquals(expected, n.version(), n.artifact() + ": preferred version differs from the pinned one");
            }
        }
    }
}
