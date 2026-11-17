package dev.geldar.ledger.paper.players;

import com.google.gson.stream.JsonReader;
import com.google.gson.stream.JsonToken;
import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.function.LongConsumer;

/**
 * Reads one player's {@code <world>/stats/<uuid>.json} (PT-08c). Read only, blocking file I/O: call it from an async
 * thread, never the main thread.
 *
 * <p>The path is built from a UUID, never from a name. The file is opened without following links, must be a regular
 * file, must resolve inside the stats directory and must be at most {@value #MAX_BYTES} bytes (a larger file is skipped,
 * the read itself is bounded too). The JSON is scanned with gson's streaming reader (no tree, no new library); only the
 * fixed allow-list {@link #NAMES} is taken, and only numeric values. Anything else in the file is skipped unread.
 *
 * <p>A parse error (the file may be mid-write) is retried once after {@value #RETRY_MS} ms and then skipped.
 */
final class StatsFileReader {
    static final int MAX_BYTES = 256 * 1024;
    static final long RETRY_MS = 1000L;
    static final String PLAY_TIME = "play_time";
    static final String DEATHS = "deaths";
    static final String MOB_KILLS = "mob_kills";
    static final String WALK_CM = "walk_one_cm";
    static final String MINED_TOTAL = "mined_total";
    static final String CRAFTED_TOTAL = "crafted_total";
    /** The only stat names this reader ever returns. */
    static final List<String> NAMES = List.of(PLAY_TIME, DEATHS, MOB_KILLS, WALK_CM, MINED_TOTAL, CRAFTED_TOTAL);

    private static final Map<String, String> CUSTOM = Map.of(
            "minecraft:play_time", PLAY_TIME,
            "minecraft:deaths", DEATHS,
            "minecraft:mob_kills", MOB_KILLS,
            "minecraft:walk_one_cm", WALK_CM);

    private final Path root;
    private final LongConsumer sleeper;

    private StatsFileReader(Path root, LongConsumer sleeper) {
        this.root = root;
        this.sleeper = sleeper;
    }

    /** A reader for this stats directory (resolved to its real path once), or null when it is not a directory. */
    static StatsFileReader open(Path statsDir, LongConsumer sleeper) {
        try {
            if (statsDir == null || !Files.isDirectory(statsDir)) {
                return null;
            }
            return new StatsFileReader(statsDir.toRealPath(), sleeper);
        } catch (Throwable t) {
            return null;
        }
    }

    /** The allow-listed values of this player's file, or null when it is absent, unsafe, too large or unparseable. */
    Map<String, Long> read(UUID player) {
        try {
            Path file = root.resolve(player + ".json");
            byte[] bytes = load(file);
            if (bytes == null) {
                return null;
            }
            Map<String, Long> out = parse(bytes);
            if (out != null) {
                return out;
            }
            sleeper.accept(RETRY_MS);
            bytes = load(file);
            return bytes == null ? null : parse(bytes);
        } catch (Throwable t) {
            return null;
        }
    }

    private byte[] load(Path file) {
        try {
            if (!eligible(file, root)) {
                return null;
            }
            try (InputStream in = Files.newInputStream(file, LinkOption.NOFOLLOW_LINKS)) {
                byte[] b = in.readNBytes(MAX_BYTES + 1);
                return b.length > MAX_BYTES ? null : b;
            }
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    /** True when the path is a regular file (links not followed), within the size cap, and resolves inside {@code root}. */
    static boolean eligible(Path file, Path root) {
        try {
            BasicFileAttributes a = Files.readAttributes(file, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            return a.isRegularFile() && a.size() <= MAX_BYTES && file.toRealPath().startsWith(root);
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    /** The allow-listed numbers, or null when the text is not one complete JSON document. */
    static Map<String, Long> parse(byte[] bytes) {
        Map<String, Long> out = new LinkedHashMap<>();
        try (JsonReader r = new JsonReader(new InputStreamReader(new ByteArrayInputStream(bytes), StandardCharsets.UTF_8))) {
            if (r.peek() != JsonToken.BEGIN_OBJECT) {
                return null;
            }
            r.beginObject();
            while (r.hasNext()) {
                if (r.nextName().equals("stats") && r.peek() == JsonToken.BEGIN_OBJECT) {
                    categories(r, out);
                } else {
                    r.skipValue();
                }
            }
            r.endObject();
            return r.peek() == JsonToken.END_DOCUMENT ? out : null;
        } catch (IOException | RuntimeException e) {
            return null;
        }
    }

    private static void categories(JsonReader r, Map<String, Long> out) throws IOException {
        r.beginObject();
        while (r.hasNext()) {
            String cat = r.nextName();
            if (r.peek() != JsonToken.BEGIN_OBJECT) {
                r.skipValue();
            } else if (cat.equals("minecraft:custom")) {
                custom(r, out);
            } else if (cat.equals("minecraft:mined")) {
                total(r, out, MINED_TOTAL);
            } else if (cat.equals("minecraft:crafted")) {
                total(r, out, CRAFTED_TOTAL);
            } else {
                r.skipValue();
            }
        }
        r.endObject();
    }

    private static void custom(JsonReader r, Map<String, Long> out) throws IOException {
        r.beginObject();
        while (r.hasNext()) {
            String name = CUSTOM.get(r.nextName());
            Long v = name == null ? null : number(r);
            if (name == null) {
                r.skipValue();
            } else if (v != null) {
                out.put(name, v);
            }
        }
        r.endObject();
    }

    private static void total(JsonReader r, Map<String, Long> out, String name) throws IOException {
        long sum = 0;
        boolean any = false;
        r.beginObject();
        while (r.hasNext()) {
            r.nextName();
            Long v = number(r);
            if (v != null) {
                any = true;
                sum = sum > Long.MAX_VALUE - v ? Long.MAX_VALUE : sum + v;
            }
        }
        r.endObject();
        if (any) {
            out.put(name, sum);
        }
    }

    /** A non-negative integer value, or null (the value is consumed either way). */
    private static Long number(JsonReader r) throws IOException {
        if (r.peek() != JsonToken.NUMBER) {
            r.skipValue();
            return null;
        }
        try {
            long v = Long.parseLong(r.nextString());
            return v < 0 ? null : v;
        } catch (NumberFormatException e) {
            return null;
        }
    }
}
