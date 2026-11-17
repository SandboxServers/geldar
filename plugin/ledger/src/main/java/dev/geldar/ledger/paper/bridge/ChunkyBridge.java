package dev.geldar.ledger.paper.bridge;

import dev.geldar.ledger.core.Names;
import java.io.IOException;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.nio.file.DirectoryStream;
import java.nio.file.Files;
import java.nio.file.LinkOption;
import java.nio.file.Path;
import java.nio.file.attribute.BasicFileAttributes;
import java.util.concurrent.atomic.AtomicLong;
import java.util.logging.Logger;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.bukkit.plugin.Plugin;
import org.bukkit.plugin.PluginManager;

/**
 * {@code geldar_bridge_chunky_running}: how many Chunky tasks are saved as not cancelled. Chunky keeps one JSON file per
 * task in {@code <data folder>/tasks}; this reads those files and nothing else. Reads are bounded (at most
 * {@value #MAX_FILES} files of at most {@value #MAX_BYTES} bytes), skip symbolic links, run off the main thread and
 * never throw. A missing folder is logged once and reads 0. The data folder comes from the plugin object, so a test
 * injects a temp folder; the field name {@code "cancelled"} is a guess about Chunky's task file (see the report).
 */
final class ChunkyBridge implements Bridge {
    static final String PLUGIN = "Chunky";
    static final int MAX_FILES = 64;
    static final int MAX_BYTES = 64 * 1024;
    private static final Pattern CANCELLED = Pattern.compile("\"cancelled\"\\s*:\\s*(true|false)");
    private static final Logger LOG = Logger.getLogger("dev.geldar.ledger.bridge");

    private final AtomicLong running = new AtomicLong();
    private volatile Path tasks;
    private volatile boolean warned;

    @Override
    public String plugin() {
        return PLUGIN;
    }

    @Override
    public String metric() {
        return Names.Bridge.CHUNKY_RUNNING;
    }

    @Override
    public String description() {
        return "Chunky tasks that are saved as not cancelled";
    }

    @Override
    public void probe(PluginManager manager) {
        Plugin p = Bridge.enabled(manager, PLUGIN);
        if (p == null) {
            tasks = null;
            running.set(0);
            return;
        }
        tasks = p.getDataFolder().toPath().resolve("tasks");
    }

    @Override
    public void scan() {
        Path dir = tasks;
        if (dir == null) {
            running.set(0);
            return;
        }
        long n = count(dir);
        if (n < 0) {
            if (!warned) {
                warned = true;
                LOG.info("Ledger: Chunky task folder is not readable, chunky bridge reports 0");
            }
            n = 0;
        }
        running.set(n);
    }

    /** Counts the not-cancelled task files in the folder, or -1 when it is missing, a link or unreadable. */
    static long count(Path dir) {
        try {
            if (!Files.isDirectory(dir, LinkOption.NOFOLLOW_LINKS)) {
                return -1;
            }
            long n = 0;
            int seen = 0;
            try (DirectoryStream<Path> files = Files.newDirectoryStream(dir, "*.json")) {
                for (Path f : files) {
                    if (++seen > MAX_FILES) {
                        break;
                    }
                    if (isRunning(f)) {
                        n++;
                    }
                }
            }
            return n;
        } catch (IOException | RuntimeException e) {
            return -1;
        }
    }

    private static boolean isRunning(Path f) {
        try {
            BasicFileAttributes a = Files.readAttributes(f, BasicFileAttributes.class, LinkOption.NOFOLLOW_LINKS);
            if (!a.isRegularFile()) {
                return false;
            }
            byte[] head;
            try (InputStream in = Files.newInputStream(f, LinkOption.NOFOLLOW_LINKS)) {
                head = in.readNBytes(MAX_BYTES);
            }
            Matcher m = CANCELLED.matcher(new String(head, StandardCharsets.UTF_8));
            return m.find() && m.group(1).equals("false");
        } catch (IOException | RuntimeException e) {
            return false;
        }
    }

    @Override
    public void clear() {
        tasks = null;
        running.set(0);
    }

    @Override
    public long value() {
        return running.get();
    }
}
