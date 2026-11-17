package dev.geldar.neoforge;

import java.io.IOException;
import java.io.Reader;
import java.net.URI;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.InvalidPathException;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.Properties;
import java.util.function.Function;
import java.util.function.Predicate;
import java.util.regex.Pattern;

/**
 * Server-side export settings. Off unless enabled: with no config the mod does nothing. Environment variables
 * win over the properties file, as on Paper. Only the path of the password file is held, never its content.
 * Any problem while enabled leaves the export off and logs one warning per problem; it never throws.
 */
public record ExportConfig(
        boolean enabled, String natsUrl, String shard, String natsUser, String passwordFile, int queueCapacity) {
    /** The file read from the server's config directory (the working directory's {@code config/}). */
    public static final String FILE_NAME = "geldar_neoforge.properties";
    public static final String ENABLED_ENV = "GELDAR_NEOFORGE_EXPORT";
    /** The same default as Paper's CoreConfig. */
    public static final String DEFAULT_NATS_URL = "nats://nats:4222";
    public static final int DEFAULT_QUEUE_CAPACITY = 10_000;
    /** The shard token rule of Paper's CoreConfig: one NATS subject token. */
    static final Pattern SHARD_NAME = Pattern.compile("^[a-z][a-z0-9-]{1,31}$");

    public static ExportConfig disabled() {
        return new ExportConfig(false, DEFAULT_NATS_URL, null, null, null, DEFAULT_QUEUE_CAPACITY);
    }

    /** Reads {@code file} (absent means no file) and the environment, then validates. Never throws. */
    public static ExportConfig load(Path file, Function<String, String> env, Predicate<String> readable, OperatorSink log) {
        return resolve(readFile(file, log), env, readable, log);
    }

    /** True when the path names a readable file. The content is not read here; core-common reads it at connect time. */
    public static boolean isReadableFile(String path) {
        try {
            return Files.isReadable(Path.of(path));
        } catch (InvalidPathException e) {
            return false;
        }
    }

    static ExportConfig resolve(Properties file, Function<String, String> env, Predicate<String> readable, OperatorSink log) {
        String enabled = first(env.apply(ENABLED_ENV), file.getProperty("export.enabled"), "false");
        if (!"true".equalsIgnoreCase(enabled)) {
            return disabled();
        }
        List<String> problems = new ArrayList<>();
        String url = first(env.apply("GELDAR_NATS_URL"), file.getProperty("nats.url"), DEFAULT_NATS_URL);
        if (!validUrl(url)) {
            problems.add("nats.url must be a nats:// or tls:// URL with no credentials in it");
        }
        // No default shard: Paper's default is "phase0", and a NeoForge shard must not write into it by accident.
        String shard = first(env.apply("GELDAR_SHARD"), file.getProperty("shard"), null);
        if (shard == null || !SHARD_NAME.matcher(shard).matches()) {
            problems.add("shard must be set to a token matching " + SHARD_NAME.pattern());
        }
        String user = first(env.apply("GELDAR_NATS_USER"), file.getProperty("nats.user"), null);
        String passwordFile = first(env.apply("GELDAR_NATS_PASSWORD_FILE"), file.getProperty("nats.password.file"), null);
        if ((user == null) != (passwordFile == null)) {
            problems.add("nats.user and nats.password.file must be set together");
        } else if (passwordFile != null && !readable.test(passwordFile)) {
            problems.add("the file named by nats.password.file cannot be read");
        }
        int capacity = queueCapacity(file.getProperty("queue.capacity"));
        if (capacity < 1) {
            problems.add("queue.capacity must be a whole number of at least 1");
        }
        if (!problems.isEmpty()) {
            for (String problem : problems) {
                log.warn("geldar_neoforge export not started: " + problem);
            }
            return disabled();
        }
        return new ExportConfig(true, url, shard, user, passwordFile, capacity);
    }

    /** Never prints the password file path: the operator sees only whether credentials are set. */
    @Override
    public String toString() {
        return "ExportConfig[enabled=" + enabled + ", shard=" + shard + ", queueCapacity=" + queueCapacity
                + ", credentials=" + (passwordFile == null ? "not set" : "set") + "]";
    }

    /** A nats:// or tls:// URL with a host and no user information (credentials go in the password file). */
    static boolean validUrl(String url) {
        try {
            URI uri = new URI(url);
            String scheme = uri.getScheme();
            return ("nats".equals(scheme) || "tls".equals(scheme)) && uri.getHost() != null && uri.getUserInfo() == null;
        } catch (URISyntaxException e) {
            return false;
        }
    }

    private static int queueCapacity(String text) {
        if (text == null || text.isBlank()) {
            return DEFAULT_QUEUE_CAPACITY;
        }
        try {
            return Integer.parseInt(text.trim());
        } catch (NumberFormatException e) {
            return 0;
        }
    }

    private static Properties readFile(Path file, OperatorSink log) {
        Properties props = new Properties();
        if (!Files.exists(file)) {
            return props;
        }
        try (Reader reader = Files.newBufferedReader(file, StandardCharsets.UTF_8)) {
            props.load(reader);
            return props;
        } catch (IOException | IllegalArgumentException e) {
            log.warn("geldar_neoforge config file cannot be read (" + e.getClass().getSimpleName() + "); the environment is used alone");
            return new Properties();
        }
    }

    /** The first value that is not blank, trimmed; null when all are blank. */
    private static String first(String... values) {
        for (String value : values) {
            if (value != null && !value.isBlank()) {
                return value.trim();
            }
        }
        return null;
    }
}
