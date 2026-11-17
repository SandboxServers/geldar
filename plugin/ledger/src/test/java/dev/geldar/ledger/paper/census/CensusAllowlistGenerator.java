package dev.geldar.ledger.paper.census;

import java.io.IOException;
import java.lang.reflect.Method;
import java.lang.reflect.Modifier;
import java.net.URISyntaxException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.util.List;
import java.util.TreeSet;
import java.util.jar.JarEntry;
import java.util.jar.JarFile;
import org.bukkit.event.Event;

/** Builds the census allow-list from the paper-api jar on the classpath; {@code main(out)} writes the file. */
public final class CensusAllowlistGenerator {
    private static final List<String> PACKAGES =
            List.of("org/bukkit/event/", "io/papermc/paper/event/", "com/destroystokyo/paper/event/");

    private CensusAllowlistGenerator() {}

    /** Sorted, fully qualified names of the event classes the census may register. */
    public static List<String> compute() throws IOException {
        TreeSet<String> names = new TreeSet<>();
        Path jar = jarOf(Event.class);
        ClassLoader loader = Event.class.getClassLoader();
        try (JarFile file = new JarFile(jar.toFile())) {
            for (JarEntry entry : (Iterable<JarEntry>) file.stream()::iterator) {
                String path = entry.getName();
                if (!path.endsWith(".class") || PACKAGES.stream().noneMatch(path::startsWith)) {
                    continue;
                }
                String name = path.substring(0, path.length() - ".class".length()).replace('/', '.');
                Class<?> type;
                try {
                    type = Class.forName(name, false, loader);
                } catch (ClassNotFoundException | LinkageError e) {
                    continue;
                }
                if (eligible(type)) {
                    names.add(type.getName());
                }
            }
        }
        return List.copyOf(names);
    }

    private static boolean eligible(Class<?> type) {
        int mods = type.getModifiers();
        if (!Modifier.isPublic(mods) || Modifier.isAbstract(mods) || type.isInterface()) {
            return false;
        }
        if (!Event.class.isAssignableFrom(type) || CensusExclusions.isExcluded(type)) {
            return false;
        }
        try {
            Method m = type.getMethod("getHandlerList");
            return Modifier.isStatic(m.getModifiers()) && Modifier.isPublic(m.getModifiers());
        } catch (NoSuchMethodException | LinkageError e) {
            return false;
        }
    }

    private static Path jarOf(Class<?> type) throws IOException {
        try {
            return Paths.get(type.getProtectionDomain().getCodeSource().getLocation().toURI());
        } catch (URISyntaxException e) {
            throw new IOException(e);
        }
    }

    /** Renders the file body: one name per line, LF, trailing newline. */
    public static String render(List<String> names) {
        return String.join("\n", names) + "\n";
    }

    public static void main(String[] out) throws IOException {
        if (out.length != 1) {
            throw new IllegalArgumentException("usage: CensusAllowlistGenerator <output path>");
        }
        Files.writeString(Paths.get(out[0]), render(compute()), StandardCharsets.UTF_8);
    }
}
