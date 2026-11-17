package dev.geldar.ledger.core;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Properties;
import java.util.TreeSet;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/** Parses and validates a {@link LedgerConfig} from {@link Properties}. See {@link LedgerConfig} for the keys. */
public final class ConfigParser {
    private static final Pattern COLLECTOR_KEY = Pattern.compile("^collector\\.([a-z0-9_]+)\\.(enabled|budget_avg_us|budget_max_us)$");
    private static final Pattern DUTY_KEY = Pattern.compile("^collector\\.census\\.duty\\.([A-Za-z0-9_$.]+)$");
    private static final Pattern DUTY_VALUE = Pattern.compile("^(\\d{1,9})/(\\d{1,9})$");
    private static final Pattern RATE_KEY = Pattern.compile("^rate\\.(geldar(?:\\.[a-z0-9_]+)+)$");
    private static final Pattern QUEUE_KEY = Pattern.compile("^queue\\.([a-z0-9_.]+)\\.capacity$");
    private static final List<String> CREDENTIAL_SUFFIXES = List.of("password", "secret", "token", "key", "authorization");

    /** The parse outcome. {@code config} is null when {@code errors} is not empty: a bad file applies nothing. */
    public record ParseResult(LedgerConfig config, List<String> errors) {
        public boolean ok() {
            return errors.isEmpty();
        }
    }

    private ConfigParser() {}

    public static ParseResult parse(Properties props) {
        TreeSet<String> keys = new TreeSet<>(props.stringPropertyNames());
        List<String> errors = new ArrayList<>();
        // S4: a credential-looking key rejects the whole file; the value is never read or reported.
        for (String key : keys) {
            if (isCredentialKey(key)) {
                errors.add("credential-looking key rejected: " + key);
            }
        }
        if (!errors.isEmpty()) {
            return new ParseResult(null, List.copyOf(errors));
        }

        LedgerConfig d = LedgerConfig.defaults();
        boolean enabled = d.enabled();
        Map<String, Boolean> collectorEnabled = new HashMap<>();
        Map<String, Integer> avg = new HashMap<>();
        Map<String, Integer> max = new HashMap<>();
        Map<String, LedgerConfig.Duty> duty = new HashMap<>();
        Map<String, Integer> rates = new HashMap<>();
        Map<String, Integer> queues = new HashMap<>();
        int contentMax = d.contentMaxBytes();
        long stall = d.stallThresholdMs();
        int worldTicks = d.sampleWorldEveryTicks();
        int playerTicks = d.samplePlayerEveryTicks();
        boolean jfr = d.jfrEnabled();

        for (String key : keys) {
            String v = props.getProperty(key).trim();
            Matcher m;
            try {
                if (key.equals("enabled")) {
                    enabled = bool(v);
                } else if (key.equals("jfr.enabled")) {
                    jfr = bool(v);
                } else if (key.equals("content.max_bytes")) {
                    contentMax = (int) range(v, 1, LedgerConfig.MAX_CONTENT_BYTES);
                } else if (key.equals("stall.threshold_ms")) {
                    stall = range(v, 1, 3_600_000);
                } else if (key.equals("sample.world_every_ticks")) {
                    worldTicks = (int) range(v, 1, 1_000_000);
                } else if (key.equals("sample.player_every_ticks")) {
                    playerTicks = (int) range(v, 1, 1_000_000);
                } else if ((m = DUTY_KEY.matcher(key)).matches()) {
                    duty.put(m.group(1), duty(v));
                } else if ((m = COLLECTOR_KEY.matcher(key)).matches()) {
                    String id = m.group(1);
                    switch (m.group(2)) {
                        case "enabled" -> collectorEnabled.put(id, bool(v));
                        case "budget_avg_us" -> avg.put(id, (int) range(v, 1, 10_000_000));
                        default -> max.put(id, (int) range(v, 1, 10_000_000));
                    }
                } else if ((m = RATE_KEY.matcher(key)).matches()) {
                    rates.put(m.group(1), (int) range(v, 0, 1_000_000));
                } else if ((m = QUEUE_KEY.matcher(key)).matches()) {
                    queues.put(m.group(1), (int) range(v, LedgerConfig.MIN_QUEUE_CAPACITY, LedgerConfig.MAX_QUEUE_CAPACITY));
                } else {
                    errors.add("unknown key: " + key);
                }
            } catch (IllegalArgumentException e) {
                errors.add(key + ": " + e.getMessage());
            }
        }
        if (!errors.isEmpty()) {
            return new ParseResult(null, List.copyOf(errors));
        }
        LedgerConfig cfg = new LedgerConfig(
                enabled, collectorEnabled, avg, max, duty, rates, queues, contentMax, stall, worldTicks, playerTicks, jfr);
        return new ParseResult(cfg, List.of());
    }

    /** S4: true when the key name ends with a credential word (case-insensitive). */
    static boolean isCredentialKey(String key) {
        String k = key.toLowerCase(Locale.ROOT);
        for (String suffix : CREDENTIAL_SUFFIXES) {
            if (k.endsWith(suffix)) {
                return true;
            }
        }
        return false;
    }

    private static boolean bool(String v) {
        if (v.equals("true")) {
            return true;
        }
        if (v.equals("false")) {
            return false;
        }
        throw new IllegalArgumentException("expected true or false");
    }

    private static long range(String v, long min, long max) {
        long n;
        try {
            n = Long.parseLong(v);
        } catch (NumberFormatException e) {
            throw new IllegalArgumentException("expected an integer");
        }
        if (n < min || n > max) {
            throw new IllegalArgumentException("expected " + min + ".." + max);
        }
        return n;
    }

    private static LedgerConfig.Duty duty(String v) {
        Matcher m = DUTY_VALUE.matcher(v);
        if (!m.matches()) {
            throw new IllegalArgumentException("expected <on_ticks>/<period_ticks>");
        }
        int on = Integer.parseInt(m.group(1));
        int period = Integer.parseInt(m.group(2));
        if (period < 1 || on > period) {
            throw new IllegalArgumentException("expected 0 <= on <= period and period >= 1");
        }
        return new LedgerConfig.Duty(on, period);
    }
}
